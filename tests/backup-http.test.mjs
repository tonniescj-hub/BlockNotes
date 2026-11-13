import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,createReadStream,statSync} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createRequire} from 'node:module'
import {createServer} from 'vite'
const require=createRequire(import.meta.url),{openStore}=require('../server/storage.cjs'),{backupFileTask}=require('../server/backup-file.cjs')

test('BN-P1-02：浏览器恢复入口流式接收超过 64 MB 的自产备份，拒绝外部 Origin',async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'blocknotes-http-')),previous=process.env.BLOCKNOTES_DATA_DIR;let server,store
 try{
  process.env.BLOCKNOTES_DATA_DIR=directory;store=openStore(directory,{dailyBackup:false})
  const text='备'.repeat(750000);for(let i=0;i<16;i++)store.run('create',{title:`浏览器大备份 ${i}`,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:text+i}]}]}})
  const file=path.join(directory,'legacy.json');await backupFileTask('backup',directory,file);assert.ok(statSync(file).size>64_000_000)
  store.db.exec('DELETE FROM notes');store.close();store=null
  server=await createServer({configFile:path.resolve('vite.config.ts'),server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error',optimizeDeps:{noDiscovery:true,include:[]}});await server.listen()
  const origin=server.resolvedUrls.local[0].replace(/\/$/,''),url=origin+'/api/restore-file'
  const denied=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://external.invalid'},body:'{}'});assert.equal(denied.status,403)
  for(const expected of [{added:16,duplicates:0},{added:0,duplicates:16}]){
   const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:createReadStream(file),duplex:'half'})
   assert.equal(response.status,200);assert.deepEqual((await response.json()).result,expected)
  }
  const check=openStore(directory,{dailyBackup:false});try{const notes=check.run('snapshot').notes;assert.equal(notes.length,16);for(const n of notes)assert.ok(n.plain.startsWith(text))}finally{check.close()}
 }finally{
  await server?.close();store?.close();if(previous===undefined)delete process.env.BLOCKNOTES_DATA_DIR;else process.env.BLOCKNOTES_DATA_DIR=previous
  if(path.dirname(directory)===path.resolve(os.tmpdir())&&path.basename(directory).startsWith('blocknotes-http-'))rmSync(directory,{recursive:true,force:true})
 }
})
