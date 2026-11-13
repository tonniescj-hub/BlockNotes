import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {Document,Packer,Paragraph,TextRun,HeadingLevel,ImageRun,Table,TableRow,TableCell} from 'docx';
import {pdfFixture} from './reading-fixtures.mjs';
const require=createRequire(import.meta.url),{openStore}=require('../server/storage.cjs');
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'bn-reading-'));
const clean=dir=>{if(path.dirname(dir)===fs.realpathSync(os.tmpdir())&&path.basename(dir).startsWith('bn-reading-'))fs.rmSync(dir,{recursive:true,force:true});};
async function fixture(dir){const file=path.join(dir,'学习资料.docx');fs.writeFileSync(file,await Packer.toBuffer(new Document({sections:[{children:[new Paragraph({text:'第一章 阅读',heading:HeadingLevel.HEADING_1}),new Paragraph({children:[new TextRun({text:'中文学习资料，保留摘录出处。',bold:true})]})]}]})));return file;}
async function zipText(file,name){return new Promise((resolve,reject)=>require('yauzl').open(file,{lazyEntries:true},(error,zip)=>{if(error)return reject(error);zip.on('error',reject);zip.on('entry',e=>{if(e.fileName!==name)return zip.readEntry();zip.openReadStream(e,(error,stream)=>{if(error)return reject(error);const parts=[];stream.on('data',b=>parts.push(b));stream.on('error',reject);stream.on('end',()=>{zip.close();resolve(Buffer.concat(parts).toString())});});});zip.on('end',()=>reject(new Error('missing '+name)));zip.readEntry();}));}

test('Word export uses Chinese A4 styles, real chapters and ordered excerpts',async()=>{
 const dir=temp(),store=openStore(dir,{dailyBackup:false});try{
  const {readingFileTask}=require('../server/reading-file.cjs');const {document:d}=await readingFileTask('import',dir,{file:await fixture(dir)});
  for(const [quote,start] of [['第二段摘录',20],['第一段摘录',10]])store.run('reading.annotate',{documentId:d.id,quote,comment:'中文心得',anchor:{page:1,block:'b1',start,end:start+6,rects:[]}});
  const file=path.join(dir,'摘要.docx');await readingFileTask('export',dir,{documentId:d.id,file});
  const value=(await require('mammoth').extractRawText({path:file})).value;assert.ok(value.indexOf('第一段摘录')<value.indexOf('第二段摘录'));assert.match(value,/第一章 阅读/);assert.match(value,/心得：中文心得/);assert.doesNotMatch(value,/ · b1/);
  const xml=await zipText(file,'word/document.xml'),styles=await zipText(file,'word/styles.xml');assert.match(xml,/<w:pgSz[^>]*w:w="11906"[^>]*w:h="16838"/);assert.match(styles,/w:eastAsia="Microsoft YaHei"/);assert.match(xml,/w:pStyle w:val="ReadingQuote"/);
 }finally{store.close();clean(dir);}
});

test('long Word with embedded image and table imports and survives backup intact',async()=>{
 const dir=temp(),other=temp(),store=openStore(dir,{dailyBackup:false});let restored;try{
  const png=require('pngjs').PNG.sync.write({width:2,height:2,data:Buffer.alloc(16,255)}),file=path.join(dir,'长篇图文.docx');
  fs.writeFileSync(file,await Packer.toBuffer(new Document({sections:[{children:[new Paragraph({children:[new ImageRun({type:'png',data:png,transformation:{width:20,height:20}})]}),new Table({rows:[new TableRow({children:[new TableCell({children:[new Paragraph('表格中文')]}),new TableCell({children:[new Paragraph('数据 42')]})]})]}),...Array.from({length:800},(_,i)=>new Paragraph(`段落 ${i}：`+'学习资料。'.repeat(40)))]}]})));
  const {readingFileTask}=require('../server/reading-file.cjs'),{backupFileTask}=require('../server/backup-file.cjs');const {document:d}=await readingFileTask('import',dir,{file});const before=store.run('reading.get',{id:d.id});assert.match(before.html,/<table>/);assert.match(before.html,/data:image\/png;base64/);assert.match(before.pages[0],/段落 799/);assert.match(before.pages[0],/表格中文/);
  const backup=path.join(dir,'backup.json');await backupFileTask('backup',dir,backup);await backupFileTask('restore',other,backup);restored=openStore(other,{dailyBackup:false});assert.deepEqual(restored.reading.file(d.id).bytes(),fs.readFileSync(file));assert.equal(restored.run('reading.get',{id:d.id}).html,before.html);
  const legacy={...before,annotations:undefined,html:before.html.replaceAll(' />','>')};store.db.prepare('UPDATE reading_documents SET json=? WHERE id=?').run(JSON.stringify(legacy),d.id);await backupFileTask('restore',dir,backup);await backupFileTask('restore',dir,backup);assert.equal(store.run('reading.list').length,1);
 }finally{restored?.close();store.close();clean(dir);clean(other);}
});
test('long PDF preserves final page search and reopening position',async()=>{
 const dir=temp();let store=openStore(dir,{dailyBackup:false});try{
  const file=path.join(dir,'long.pdf');fs.writeFileSync(file,pdfFixture(false,120));const {readingFileTask}=require('../server/reading-file.cjs');const {document:d}=await readingFileTask('import',dir,{file});assert.equal(d.pageCount,120);assert.equal(store.run('reading.search',{query:'material 120'})[0].page,120);store.run('reading.position',{id:d.id,position:{page:120,offset:.4}});store.close();store=openStore(dir,{dailyBackup:false});assert.deepEqual(store.run('reading.get',{id:d.id}).position,{page:120,offset:.4});assert.deepEqual(store.reading.file(d.id).bytes(),fs.readFileSync(file));
 }finally{store.close();clean(dir);}
});

test('batch excerpts keep source order, readable chapter, unique links and atomic failures',async()=>{
 const dir=temp(),store=openStore(dir,{dailyBackup:false});try{
  const {readingFileTask}=require('../server/reading-file.cjs');const {document:d}=await readingFileTask('import',dir,{file:await fixture(dir)});
  const later=store.run('reading.annotate',{documentId:d.id,quote:'后段',comment:'后段心得',anchor:{page:1,block:'b1',start:20,end:22,rects:[]}});
  const first=store.run('reading.annotate',{documentId:d.id,quote:'前段',comment:'前段心得',anchor:{page:1,block:'b1',start:10,end:12,rects:[]}});
  const n=store.run('reading.excerpt',{annotationIds:[later.id,first.id,first.id]});
  assert.ok(n.plain.indexOf('前段')<n.plain.indexOf('后段'));assert.match(n.plain,/第一章 阅读/);assert.doesNotMatch(n.plain,/ · b1/);
  assert.equal(store.run('reading.links',{noteId:n.id}).length,2);assert.match(store.run('reading.links',{noteId:n.id})[0].location,/第一章 阅读/);
  const copy=await readingFileTask('import',dir,{file:await fixture(dir),copy:true}),foreign=store.run('reading.annotate',{documentId:copy.document.id,quote:'另一份资料',anchor:{page:1,rects:[]}});
  assert.throws(()=>store.run('reading.excerpt',{annotationIds:[first.id,foreign.id],noteId:n.id,revision:n.revision}),/同一份/);
  assert.deepEqual(store.run('reading.excerpt',{annotationIds:[first.id,later.id],noteId:n.id,revision:n.revision}),n);
  assert.throws(()=>store.run('reading.excerpt',{annotationIds:[first.id,'missing'],noteId:n.id,revision:n.revision}),/摘录/);
  assert.throws(()=>store.run('reading.excerpt',{annotationIds:[first.id],noteId:n.id,revision:0}),/版本/);
  assert.deepEqual(store.run('snapshot').notes.find(v=>v.id===n.id),n);
  const removed=store.run('location',{id:n.id,revision:n.revision,status:'deleted',shelfId:n.shelfId});
  assert.throws(()=>store.run('reading.excerpt',{annotationIds:[first.id],noteId:n.id,revision:removed.revision}),/恢复/);
 }finally{store.close();clean(dir);}
});

test('DOCX import owns original bytes, detects duplicate, retains Chinese structure and does not edit notes',async()=>{
 const dir=temp();let store=openStore(dir,{dailyBackup:false});try{
  const note=store.run('create',{title:'现有笔记'}),file=await fixture(dir);
  const {readingFileTask}=require('../server/reading-file.cjs');
  const result=await readingFileTask('import',dir,{file,shelfId:'main'});
  assert.equal(result.document.kind,'docx');assert.equal(result.document.title,'学习资料');
  assert.match(store.run('reading.get',{id:result.document.id}).html,/<h1[^>]*>第一章 阅读/);
  assert.equal((await readingFileTask('import',dir,{file,shelfId:'main'})).duplicate,true);
  fs.unlinkSync(file);assert.ok(store.reading.file(result.document.id).size>0);
  assert.deepEqual(store.run('snapshot').notes,[note]);
 }finally{store.close();clean(dir);}
});
test('annotations, position, revision conflicts, note insertion and shelf deletion are atomic',async()=>{
 const dir=temp(),store=openStore(dir,{dailyBackup:false});try{
  const {readingFileTask}=require('../server/reading-file.cjs');store.run('shelf',{id:'reading',name:'阅读'});
  const {document:d}=await readingFileTask('import',dir,{file:await fixture(dir),shelfId:'reading'});
  const a=store.run('reading.annotate',{documentId:d.id,quote:'中文学习资料',comment:'值得记住',anchor:{page:1,start:0,end:6,rects:[]}});
  assert.throws(()=>store.run('reading.annotate',{...a,revision:0,comment:'冲突'}),/版本/);
  store.run('reading.position',{id:d.id,position:{page:1,block:'b0',offset:0}});
  const n=store.run('reading.excerpt',{annotationId:a.id});assert.match(n.plain,/中文学习资料/);assert.match(n.plain,/学习资料/);
  store.run('deleteShelf',{id:'reading',expectedName:'阅读',targetId:'ideas'});
  assert.equal(store.run('reading.get',{id:d.id}).shelfId,'ideas');
  assert.equal(store.run('reading.get',{id:d.id}).position.block,'b0');
  const revision=store.run('snapshot').notes[0].revision;store.run('reading.get',{id:d.id});assert.equal(store.run('snapshot').notes[0].revision,revision);
 }finally{store.close();clean(dir);}
});
test('streaming backup includes original, annotations and position, merges idempotently and still reads old JSON',async()=>{
 const dir=temp(),other=temp(),store=openStore(dir,{dailyBackup:false});let target;
 try{const {readingFileTask}=require('../server/reading-file.cjs'),{backupFileTask}=require('../server/backup-file.cjs');
  const {document:d}=await readingFileTask('import',dir,{file:await fixture(dir),shelfId:'main'});
  store.run('reading.annotate',{documentId:d.id,quote:'中文',comment:'想法',anchor:{page:1,rects:[]}});
  const file=path.join(dir,'backup.json');await backupFileTask('backup',dir,file);await backupFileTask('restore',other,file);
  target=openStore(other,{dailyBackup:false});assert.equal(target.run('reading.get',{id:d.id}).annotations.length,1);
  assert.deepEqual(target.reading.file(d.id).bytes(),store.reading.file(d.id).bytes());
  await backupFileTask('restore',other,file);assert.equal(target.run('reading.list').length,1);
  const old={format:'blocknotes-backup',schemaVersion:1,shelves:[],notes:[]};fs.writeFileSync(file,JSON.stringify(old));await backupFileTask('restore',other,file);assert.equal(target.run('reading.list').length,1);
 }finally{target?.close();store.close();clean(dir);clean(other);}
});
test('Word export retains note content and page breaks; damaged imports do not create entries',async()=>{
 const dir=temp(),store=openStore(dir,{dailyBackup:false});try{const {readingFileTask}=require('../server/reading-file.cjs');
  const n=store.run('create',{title:'我的心得',doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'学习收获'}]},{type:'bookPageBreak'},{type:'paragraph',content:[{type:'text',text:'第二页'}]}]}});
  const file=path.join(dir,'export.docx');await readingFileTask('export',dir,{noteId:n.id,file});
  const text=await require('mammoth').extractRawText({path:file});assert.match(text.value,/学习收获/);assert.match(text.value,/第二页/);
  const bad=path.join(dir,'bad.pdf');fs.writeFileSync(bad,'not pdf');await assert.rejects(readingFileTask('import',dir,{file:bad}),/PDF|pdf|文档/);assert.equal(store.run('reading.list').length,0);
 }finally{store.close();clean(dir);}
});
test('PDF text extraction, scan fallback, ranges and restored deleted annotations',async()=>{
 const dir=temp(),other=temp(),store=openStore(dir,{dailyBackup:false});let target;try{
  const {readingFileTask}=require('../server/reading-file.cjs'),{documentResponse}=require('../server/reading-http.cjs'),{backupFileTask}=require('../server/backup-file.cjs');
  const file=path.join(dir,'reading.pdf');fs.writeFileSync(file,pdfFixture());const {document:d}=await readingFileTask('import',dir,{file});
  assert.equal(d.pageCount,2);assert.match(store.run('reading.get',{id:d.id}).pages[1],/material two/);
  const response=documentResponse(store,d.id,'bytes=0-4');assert.equal(response.status,206);assert.equal(await response.text(),'%PDF-');assert.equal(documentResponse(store,d.id,'bytes=99999-').status,416);
  assert.equal(store.run('reading.search',{query:'material two'})[0].page,2);
  store.run('reading.annotate',{documentId:d.id,quote:'material two',comment:'keep',anchor:{page:2,rects:[[.1,.2,.3,.02]]}});store.run('reading.update',{id:d.id,revision:1,status:'deleted'});
  const backup=path.join(dir,'backup.json');await backupFileTask('backup',dir,backup);await backupFileTask('restore',other,backup);target=openStore(other,{dailyBackup:false});assert.equal(target.run('reading.get',{id:d.id}).annotations.length,1);
  fs.writeFileSync(file,pdfFixture(true));const scan=await readingFileTask('import',dir,{file});assert.match(scan.document.warnings.join(' '),/文字层/);
 }finally{target?.close();store.close();clean(dir);clean(other);}
});
test('HTML sanitization and corrupt source backup rollback protect existing notes',async()=>{
 const dir=temp(),other=temp(),store=openStore(dir,{dailyBackup:false}),target=openStore(other,{dailyBackup:false});try{
  const {cleanHtml}=require('../server/reading-files.cjs');const html=cleanHtml('<p onclick="alert(1)">正文<script>alert(1)</script><a href="javascript:alert(1)">危险链接</a><img src="https://external.invalid/tracker"><img src="data:image/svg+xml;base64,PHN2Zz4="></p>');assert.doesNotMatch(html,/script|onclick|https:|svg\+xml/);
  const {readingFileTask}=require('../server/reading-file.cjs');await readingFileTask('import',dir,{file:await fixture(dir)});const n=target.run('create',{title:'不得丢失'}),backup={format:'blocknotes-backup',schemaVersion:2,shelves:store.run('snapshot').shelves,notes:[],reading:[...store.reading.records()]};backup.reading[0].data=Buffer.from('bad').toString('base64');assert.throws(()=>target.run('restore',backup),/校验/);assert.deepEqual(target.run('snapshot').notes,[n]);assert.equal(target.run('reading.list').length,0);
 }finally{store.close();target.close();clean(dir);clean(other);}
});
test('restoring edited annotation and reading a restored document do not multiply copies',async()=>{
 const dir=temp(),store=openStore(dir,{dailyBackup:false});try{
  const {readingFileTask}=require('../server/reading-file.cjs');const {document:d}=await readingFileTask('import',dir,{file:await fixture(dir)});
  const a=store.run('reading.annotate',{documentId:d.id,quote:'中文',comment:'原想法',anchor:{page:1,rects:[]}});
  const backup={format:'blocknotes-backup',schemaVersion:2,shelves:store.run('snapshot').shelves,notes:[],reading:[...store.reading.records()]};
  store.run('reading.annotate',{...a,comment:'用户修改'});store.run('restore',backup);store.run('restore',backup);assert.equal(store.run('reading.get',{id:d.id}).annotations.length,2);
  store.run('reading.update',{id:d.id,revision:d.revision,title:'用户改名'});store.run('restore',backup);const copy=store.run('reading.list').find(x=>x.id!==d.id);store.run('reading.position',{id:copy.id,position:{page:1,offset:.5}});store.run('restore',backup);assert.equal(store.run('reading.list').length,2);
 }finally{store.close();clean(dir);}
});
test('import and restore enforce identical outline metadata limits',async()=>{
 const dir=temp(),store=openStore(dir,{dailyBackup:false});try{
  const file=path.join(dir,'long-heading.docx');fs.writeFileSync(file,await Packer.toBuffer(new Document({sections:[{children:[new Paragraph({text:'章'.repeat(10001),heading:HeadingLevel.HEADING_1})]}]})));
  const {readingFileTask}=require('../server/reading-file.cjs');await assert.rejects(readingFileTask('import',dir,{file}),/字段|目录/);assert.equal(store.run('reading.list').length,0);
 }finally{store.close();clean(dir);}
});
