import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import {Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
const require=createRequire(import.meta.url)
// Windows junctions must use the same physical root for esbuild and Vite.
const projectRoot=fs.realpathSync(process.cwd())
if(projectRoot!==process.cwd())process.chdir(projectRoot)
export default defineConfig({
  root:projectRoot,base:'./', plugins:[react(),{name:'pdf-local-assets',generateBundle(){const root=path.dirname(require.resolve('pdfjs-dist/package.json'));for(const name of ['cmaps','standard_fonts','wasm'])for(const entry of fs.readdirSync(path.join(root,name),{withFileTypes:true}))if(entry.isFile())this.emitFile({type:'asset',fileName:'pdf-assets/'+name+'/'+entry.name,source:fs.readFileSync(path.join(root,name,entry.name))})}},{
    name:'local-sqlite-development',
    configureServer(server) {
      const {openStore}=require('./server/storage.cjs')
      const dataDirectory=process.env.BLOCKNOTES_DATA_DIR||path.resolve('.local'),store=openStore(dataDirectory)
      const {backupFileTask}=require('./server/backup-file.cjs')
      const {readingFileTask}=require('./server/reading-file.cjs'),{documentResponse}=require('./server/reading-http.cjs')
      server.middlewares.use('/reading-file',async(req,res)=>{try{if(!req.headers.host?.startsWith('127.0.0.1:')){res.statusCode=403;res.end();return}const response=documentResponse(store,decodeURIComponent((req.url||'').slice(1).split('?')[0]),req.headers.range);res.statusCode=response.status;response.headers.forEach((v:string,k:string)=>res.setHeader(k,v));if(response.body)await pipeline(Readable.fromWeb(response.body as any),res);else res.end()}catch{res.statusCode=404;res.end()}})
      server.middlewares.use('/pdf-assets',async(req,res,next)=>{const relative=decodeURIComponent((req.url||'').split('?')[0]),root=path.dirname(require.resolve('pdfjs-dist/package.json')),file=path.resolve(root,'.'+relative);if(!/^\/(cmaps|standard_fonts|wasm)\//.test(relative)||!file.startsWith(root+path.sep)){res.statusCode=403;res.end();return}try{await pipeline(fs.createReadStream(file),res)}catch{res.statusCode=404;res.end()}})
      server.httpServer?.on('close',()=>store.close())
      server.middlewares.use('/api',async(req,res)=>{
        res.setHeader('Content-Type','application/json; charset=utf-8')
        const origin=req.headers.origin
        if(req.method!=='POST'||!req.headers.host?.startsWith('127.0.0.1:')||(origin&&origin!==`http://${req.headers.host}`)||!req.headers['content-type']?.startsWith('application/json')){res.statusCode=403;res.end(JSON.stringify({error:'仅支持本机应用请求'}));return}
        if(req.url?.startsWith('/import-document')){
          const temp=fs.mkdtempSync(path.join(os.tmpdir(),'blocknotes-upload-')),params=new URL(req.url,'http://localhost').searchParams,ext=params.get('kind'),file=path.join(temp,'document.'+ext),controller=new AbortController();
          if(!['docx','pdf'].includes(ext||'')){fs.rmdirSync(temp);res.statusCode=400;res.end(JSON.stringify({error:'仅支持 Word .docx 与 PDF'}));return}
          res.on('close',()=>{if(!res.writableEnded)controller.abort()})
          try{let size=0;req.on('data',c=>{size+=c.length;if(size>512*1024*1024)req.destroy(new Error('文件超过 512 MB'))});await pipeline(req,fs.createWriteStream(file,{flags:'wx'}));const result=await readingFileTask('import',dataDirectory,{file,shelfId:params.get('shelfId')||'main',copy:params.get('copy')==='true',title:(params.get('name')||'学习资料').replace(/\.(docx|pdf)$/i,'').slice(0,500)},{signal:controller.signal});res.end(JSON.stringify({result}))}
          catch(e){res.statusCode=400;res.end(JSON.stringify({error:e instanceof Error?e.message:'导入失败'}))}
          finally{if(path.dirname(temp)===path.resolve(os.tmpdir())&&path.basename(temp).startsWith('blocknotes-upload-'))fs.rmSync(temp,{recursive:true,force:true})}return
        }
        if(req.url==='/download'){
          const temp=fs.mkdtempSync(path.join(os.tmpdir(),'blocknotes-upload-'));
          try{let body='';for await(const c of req){body+=c;if(body.length>10000)throw new Error('请求过大')}const input=JSON.parse(body),file=path.join(temp,'download');if(input.operation==='backup')await backupFileTask('backup',dataDirectory,file);else if(input.operation==='word')await readingFileTask('export',dataDirectory,{...input,file});else throw new Error('下载操作无效');res.setHeader('Content-Type','application/octet-stream');await pipeline(fs.createReadStream(file),res)}catch(e){res.statusCode=400;res.end(JSON.stringify({error:e instanceof Error?e.message:'导出失败'}))}finally{if(path.dirname(temp)===path.resolve(os.tmpdir())&&path.basename(temp).startsWith('blocknotes-upload-'))fs.rmSync(temp,{recursive:true,force:true})}return
        }
        if(req.url==='/restore-file'){
          const temp=fs.mkdtempSync(path.join(os.tmpdir(),'blocknotes-upload-')),file=path.join(temp,'backup.json')
          try{await pipeline(req,fs.createWriteStream(file,{flags:'wx'}));res.end(JSON.stringify({result:await backupFileTask('restore',dataDirectory,file)}))}
          catch(e){res.statusCode=400;res.end(JSON.stringify({error:e instanceof Error?e.message:'恢复失败'}))}
          finally{if(path.dirname(temp)===path.resolve(os.tmpdir())&&path.basename(temp).startsWith('blocknotes-upload-'))fs.rmSync(temp,{recursive:true,force:true})}return
        }
        try {let body='';for await (const chunk of req){body+=chunk;if(body.length>64_000_000)throw new Error('请求过大')}
          const {operation,input}=JSON.parse(body);res.end(JSON.stringify({result:operation==='reading.search'?await readingFileTask('search',dataDirectory,input):store.run(operation,input)}))
        } catch(e){res.statusCode=400;res.end(JSON.stringify({error:e instanceof Error?e.message:'存储失败'}))}
      })
    }
  }], server:{host:'127.0.0.1',port:5173,strictPort:true},
  build:{rollupOptions:{output:{manualChunks:{scene:['three','@react-three/fiber'],editor:['@tiptap/react','@tiptap/starter-kit']}}}}
})
