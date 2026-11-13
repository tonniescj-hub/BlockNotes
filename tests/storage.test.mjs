import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync,readFileSync,readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {openStore}=require('../server/storage.cjs')
const {backupFileTask}=require('../server/backup-file.cjs')
const {validateDoc,markdown}=require('../server/content.cjs')
const doc=text=>({type:'doc',content:[{type:'paragraph',content:text?[{type:'text',text}]:[]}]})
function fixture(t){const dir=mkdtempSync(path.join(tmpdir(),'blocknotes-test-'));const s=openStore(dir,{dailyBackup:false});t.after(()=>{s.close();rmSync(dir,{recursive:true,force:true})});return s}
test('删除书架：同名新增空分类可删除，基础分类与陈旧名称受保护',t=>{
 const s=fixture(t);s.run('shelf',{id:'custom-empty',name:'我的书架'});s.run('shelf',{id:'custom-other',name:'我的书架'})
 for(const id of ['main','ideas'])assert.throws(()=>s.run('deleteShelf',{id}),/基础书架/)
 assert.throws(()=>s.run('deleteShelf',{id:'missing',expectedName:'我的书架'}),/书架不存在/)
 assert.throws(()=>s.run('deleteShelf',{id:'custom-empty',expectedName:'旧名称'}),/已更改/)
 const result=s.run('deleteShelf',{id:'custom-empty',expectedName:'我的书架'});assert.equal(result.moved,0)
 assert.deepEqual(s.run('snapshot').shelves.map(x=>x.id),['main','ideas','custom-other']);assert.equal(s.run('snapshot').notes.length,0)
})
test('删除书架：迁移所有状态笔记、保留正文和分页，拒绝陈旧编辑',t=>{
 const s=fixture(t);s.run('shelf',{id:'custom-books',name:'待合并分类'})
 const paged={type:'doc',content:[...doc('完整正文').content,{type:'bookPageBreak'},{type:'paragraph'}]},notes=[]
 for(const status of ['active','archived','deleted']){let n=s.run('create',{title:status,doc:paged,tags:['分类'],shelfId:'custom-books'});if(status!=='active')n=s.run('location',{id:n.id,revision:n.revision,status});notes.push(n)}
 for(const targetId of [undefined,'custom-books','missing'])assert.throws(()=>s.run('deleteShelf',{id:'custom-books',expectedName:'待合并分类',targetId}),/接收书架|书架不存在/)
 assert.equal(s.run('snapshot').notes.filter(n=>n.shelfId==='custom-books').length,3)
 assert.equal(s.run('deleteShelf',{id:'custom-books',expectedName:'待合并分类',targetId:'ideas'}).moved,3)
 for(const original of notes){const saved=s.run('snapshot').notes.find(n=>n.id===original.id);assert.equal(saved.shelfId,'ideas');assert.equal(saved.status,original.status);assert.equal(saved.previousStatus,original.previousStatus);assert.equal(saved.revision,original.revision+1);assert.deepEqual(saved.doc,original.doc);assert.deepEqual(saved.tags,original.tags);assert.equal(saved.createdAt,original.createdAt)}
 assert.throws(()=>s.run('save',{...notes[0],doc:doc('陈旧写入')}),/其他窗口/);assert.equal(s.db.prepare('PRAGMA foreign_key_check').all().length,0)
})
test('删除书架：删除失败整体回滚，旧备份仍可恢复且反复恢复不增副本',t=>{
 const s=fixture(t);s.run('shelf',{id:'custom-rollback',name:'保护数据'});s.run('create',{shelfId:'custom-rollback',doc:doc('原始正文')})
 const before=s.run('snapshot'),backup=s.run('backup');s.db.exec("CREATE TRIGGER refuse_shelf_delete BEFORE DELETE ON shelves WHEN OLD.id='custom-rollback' BEGIN SELECT RAISE(ABORT,'模拟删除失败'); END")
 assert.throws(()=>s.run('deleteShelf',{id:'custom-rollback',expectedName:'保护数据',targetId:'main'}),/模拟删除失败/);assert.deepEqual(s.run('snapshot'),before)
 s.db.exec('DROP TRIGGER refuse_shelf_delete');s.run('deleteShelf',{id:'custom-rollback',expectedName:'保护数据',targetId:'main'})
 assert.deepEqual(s.run('restore',backup),{added:1,duplicates:0});assert.deepEqual(s.run('restore',backup),{added:0,duplicates:1});assert.equal(s.run('snapshot').notes.length,2);assert.ok(s.run('snapshot').notes.every(n=>n.plain==='原始正文'));assert.equal(s.db.prepare('PRAGMA foreign_key_check').all().length,0)
})
test('空库 migration、默认分类与真实 SQLite 文件',t=>{const s=fixture(t);const snap=s.run('snapshot');assert.equal(snap.notes.length,0);assert.equal(snap.shelves.length,2);assert.equal(s.db.prepare('PRAGMA user_version').get().user_version,3);assert.equal(readFileSync(s.filename).subarray(0,15).toString(),'SQLite format 3')})
test('20 条中文/混合/长标题/空笔记，多书架和 1、2、3 字搜索',t=>{const s=fixture(t);for(let i=0;i<20;i++){s.run('create',{title:i===19?'很长的标题'.repeat(40):`第 ${i} 本 · A&B <书>`,doc:doc(i===0?'':`今天在书房中写下知识库 ${i}，你好，Minecraft & TypeScript。特殊符号 "<>\\%_😀"。`),tags:i%2?['想法','知识管理']:['学习'],shelfId:i%2?'ideas':'main'})}
 assert.equal(s.run('snapshot').notes.length,20);for(const q of ['知','知识','知识库','你好','房','想法','Ｍｉｎｅｃｒａｆｔ'])assert.ok(s.run('search',{query:q}).length>0,q)
 assert.equal(s.run('search',{query:'知识库'}).length,19);assert.equal(s.run('search',{query:'不存在的词'}).length,0);assert.equal(s.run('search',{query:'知识库 TypeScript'}).length,19)
})
test('编辑、重命名、标签、书架移动、归档和软删除恢复保持元数据',t=>{const s=fixture(t);let n=s.run('create');n=s.run('save',{...n,title:'中文书名',doc:doc('完整正文'),tags:['中文','中文','备忘']});assert.deepEqual(n.tags,['中文','备忘']);n=s.run('location',{id:n.id,revision:n.revision,shelfId:'ideas',status:'archived'});assert.equal(s.run('search',{query:'正文'})[0],n.id);n=s.run('location',{id:n.id,revision:n.revision,status:'deleted'});assert.equal(s.run('search',{query:'正文'}).length,0);assert.equal(n.previousStatus,'archived');n=s.run('location',{id:n.id,revision:n.revision,status:'active',restoreDeleted:true});assert.equal(n.status,'archived');n=s.run('location',{id:n.id,revision:n.revision,status:'active'});assert.equal(n.shelfId,'ideas');assert.equal(n.plain,'完整正文')})
test('陈旧写入和非法归属被拒绝，事务不破坏正文',t=>{const s=fixture(t);const n=s.run('create',{title:'old'});s.run('save',{...n,title:'new'});assert.throws(()=>s.run('save',{...n,title:'stale'}),/其他窗口/);assert.throws(()=>s.run('location',{id:n.id,revision:2,status:'active',shelfId:'missing'}),/书架不存在/);assert.equal(s.run('snapshot').notes[0].title,'new')})
test('写入失败向调用者报告，正文仍保留',t=>{const s=fixture(t);const n=s.run('create',{doc:doc('原文')});s.db.exec('PRAGMA query_only=ON');assert.throws(()=>s.run('save',{...n,doc:doc('改动')}),/readonly/);assert.equal(s.run('snapshot').notes[0].plain,'原文');s.db.exec('PRAGMA query_only=OFF')})
test('完整备份合并：相同笔记跳过，修改冲突另存副本，恢复失败原子回滚',t=>{const s=fixture(t);let n=s.run('create',{title:'原书',doc:doc('最初内容'),tags:['标签'],shelfId:'ideas'});const backup=s.run('backup');assert.deepEqual(s.run('restore',backup),{added:0,duplicates:1});n=s.run('save',{...n,doc:doc('当前内容')});const r=s.run('restore',backup);assert.equal(r.added,1);const notes=s.run('snapshot').notes;assert.equal(notes.length,2);assert.ok(notes.some(n=>n.title==='原书（恢复副本）'&&n.plain==='最初内容'));assert.ok(notes.some(n=>n.id===n.id&&n.plain==='当前内容'));const bad=structuredClone(backup);bad.notes[0].shelfId='bad';assert.throws(()=>s.run('restore',bad),/元数据/);assert.equal(s.run('snapshot').notes.length,2)})
test('重启、意外退出/WAL 恢复及每日 SQLite 备份',t=>{const dir=mkdtempSync(path.join(tmpdir(),'blocknotes-crash-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const script=`const {openStore}=require(${JSON.stringify(path.resolve('server/storage.cjs'))});const s=openStore(${JSON.stringify(dir)},{dailyBackup:false});s.run('create',{title:'意外退出的中文笔记',doc:${JSON.stringify(doc('已提交事务不会丢失'))}});process.exit(0);`;assert.equal(spawnSync(process.execPath,['-e',script]).status,0);const s=openStore(dir);assert.equal(s.run('snapshot').notes[0].plain,'已提交事务不会丢失');s.close();const s2=openStore(dir);assert.equal(s2.run('snapshot').notes.length,1);s2.close()})
test('损坏数据库拒绝启动，不静默覆盖',t=>{const dir=mkdtempSync(path.join(tmpdir(),'blocknotes-corrupt-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'blocknotes.sqlite');writeFileSync(file,'original corrupted bytes');assert.throws(()=>openStore(dir));assert.equal(readFileSync(file,'utf8'),'original corrupted bytes')})
test('Markdown 导出支持中文、列表、引用、代码并拒绝不安全链接',t=>{const s=fixture(t);const rich={type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'知识'}]},{type:'paragraph',content:[{type:'text',text:'重点',marks:[{type:'bold'}]}]},{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'中文项目'}]}]}]},{type:'codeBlock',content:[{type:'text',text:'const a = "```";'}]}]};const n=s.run('create',{title:'书:一',doc:rich});const out=s.run('export',{id:n.id});assert.equal(out.name,'书_一.md');assert.match(out.text,/## 知识/);assert.match(out.text,/\*\*重点\*\*/);assert.match(out.text,/- 中文项目/);assert.match(markdown(rich),/````/);assert.throws(()=>validateDoc({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'a',marks:[{type:'link',attrs:{href:'javascript:alert(1)'}}]}]}]}),/链接/);assert.throws(()=>s.run('create',{doc:{type:'doc',content:[{type:'html',text:'evil'}]}}),/正文/)} )


test('显式空白分页随笔记和备份保留，检索正文不截断，非法分页被拒绝',t=>{
 const s=fixture(t),paged={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'前页知识'}]},{type:'bookPageBreak'},{type:'paragraph',content:[{type:'text',text:'后页内容'}]},{type:'bookPageBreak'},{type:'paragraph'}]}
 const n=s.run('create',{doc:paged});assert.deepEqual(n.doc,paged);assert.ok(n.plain.includes('前页知识'));assert.ok(n.plain.includes('后页内容'));assert.equal(s.run('search',{query:'后页内容'})[0],n.id)
 assert.deepEqual(s.run('backup').notes[0].doc,paged);assert.match(s.run('export',{id:n.id}).text,/<!-- page break -->/)
 assert.throws(()=>validateDoc({type:'doc',content:[{type:'paragraph',content:[{type:'bookPageBreak'}]}]}),/分页/)
})

test('音乐设置落库，不接受非法音量或资源路径，不改变笔记内容',t=>{
 const s=fixture(t),n=s.run('create',{doc:doc('原文保留')})
 s.run('settings',{key:'musicVolume',value:.35});s.run('settings',{key:'musicTrack',value:'records/cat'})
 assert.equal(s.run('snapshot').settings.musicVolume,.35);assert.equal(s.run('snapshot').settings.musicTrack,'records/cat')
 for(const value of [-1,2,NaN,'1'])assert.throws(()=>s.run('settings',{key:'musicVolume',value}),/设置强度/)
 for(const value of ['https://remote/song','music/../../secret','records/../secret','music/game/test.ogg'])assert.throws(()=>s.run('settings',{key:'musicTrack',value}),/音乐 ID/)
 assert.equal(s.run('snapshot').notes[0].plain,n.plain)
})

test('BN-P1-01：冲突旧备份连续恢复三次且重启后再恢复，只保留一个未修改副本',t=>{
 const s=fixture(t),original=s.run('create',{title:'同一本书',doc:doc('早期内容'),tags:['旧标签']})
 const old=s.run('backup');s.run('save',{...original,doc:doc('新内容')})
 assert.deepEqual(s.run('restore',old),{added:1,duplicates:0})
 for(let i=0;i<2;i++)assert.deepEqual(s.run('restore',old),{added:0,duplicates:1})
 assert.equal(s.run('snapshot').notes.length,2)
 const second=openStore(path.dirname(s.filename),{dailyBackup:false});try{assert.deepEqual(second.run('restore',old),{added:0,duplicates:1})}finally{second.close()}
 assert.equal(s.run('snapshot').notes.find(n=>n.id===original.id).plain,'新内容')
})

test('BN-P1-01：同标题不同内容、修改过的副本、旧版已有恢复副本都不能丢失',t=>{
 const s=fixture(t),n=s.run('create',{title:'相同标题',doc:doc('旧内容')});const old=s.run('backup')
 s.run('save',{...n,doc:doc('现内容')})
 const legacy=s.run('create',{title:'相同标题（恢复副本）',doc:doc('旧内容')})
 assert.deepEqual(s.run('restore',old),{added:0,duplicates:1})
 s.run('save',{...legacy,doc:doc('用户修改过的副本')})
 assert.deepEqual(s.run('restore',old),{added:1,duplicates:0})
 assert.deepEqual(s.run('restore',old),{added:0,duplicates:1})
 const different=structuredClone(old);different.notes[0].doc=doc('另一个有效快照')
 assert.deepEqual(s.run('restore',different),{added:1,duplicates:0})
 assert.deepEqual(s.run('restore',different),{added:0,duplicates:1})
 const independent=structuredClone(old);independent.notes[0].id='independent-note-same-title';independent.notes[0].doc=doc('独立笔记内容')
 assert.deepEqual(s.run('restore',independent),{added:1,duplicates:0})
 assert.deepEqual(new Set(s.run('snapshot').notes.map(n=>n.plain)),new Set(['现内容','用户修改过的副本','旧内容','另一个有效快照','独立笔记内容']))
})

test('BN-P1-01：冲突书架恢复也必须幂等，失败不留下来源记录或半次恢复',t=>{
 const s=fixture(t),n=s.run('create',{title:'书架冲突',doc:doc('旧')});const old=s.run('backup')
 s.run('shelf',{id:'main',name:'已改名的书架'});s.run('save',{...n,doc:doc('新')})
 s.db.exec("CREATE TRIGGER fail_restore BEFORE INSERT ON notes BEGIN SELECT RAISE(ABORT,'恢复失败'); END;")
 assert.throws(()=>s.run('restore',old),/恢复失败/)
 assert.equal(s.db.prepare('SELECT count(*) AS n FROM restore_notes').get().n,0);assert.equal(s.db.prepare('SELECT count(*) AS n FROM restore_shelves').get().n,0)
 assert.equal(s.run('snapshot').shelves.length,2);s.db.exec('DROP TRIGGER fail_restore')
 assert.deepEqual(s.run('restore',old),{added:1,duplicates:0})
 assert.deepEqual(s.run('restore',old),{added:0,duplicates:1})
 assert.equal(s.run('snapshot').shelves.length,3)
})

test('BN-P1-02：流式旧备份支持字段乱序、冲突幂等，坏尾部或重复 ID 不修改用户库',async t=>{
 const s=fixture(t),n=s.run('create',{title:'原文',doc:doc('旧正文')}),old=s.run('backup');s.run('save',{...n,doc:doc('保留当前正文')})
 const file=path.join(path.dirname(s.filename),'input.json')
 writeFileSync(file,JSON.stringify({shelves:old.shelves,notes:old.notes,schemaVersion:1,format:'blocknotes-backup'}))
 assert.deepEqual(await backupFileTask('restore',path.dirname(s.filename),file),{added:1,duplicates:0})
 assert.deepEqual(await backupFileTask('restore',path.dirname(s.filename),file),{added:0,duplicates:1})
 const before=s.run('snapshot');for(const bad of [JSON.stringify(old).slice(0,-1),JSON.stringify({...old,notes:[old.notes[0],old.notes[0]]}),JSON.stringify({...old,shelves:[]}),JSON.stringify({...old,notes:{invalid:1}})]){
  writeFileSync(file,bad);await assert.rejects(backupFileTask('restore',path.dirname(s.filename),file));assert.deepEqual(s.run('snapshot'),before)
 }
})

test('BN-P1-02：后台导出仍为 schemaVersion 1，重新恢复不变更正文',async t=>{
 const s=fixture(t),n=s.run('create',{title:'导出兼容',doc:doc('原文'),tags:['中文']}),file=path.join(path.dirname(s.filename),'export.json')
 await backupFileTask('backup',path.dirname(s.filename),file);const old=JSON.parse(readFileSync(file,'utf8'))
 assert.equal(old.schemaVersion,1);assert.deepEqual(old.notes,[n]);assert.deepEqual(await backupFileTask('restore',path.dirname(s.filename),file),{added:0,duplicates:1})
})

test('v1 数据库加法迁移不修改已有笔记，旧备份格式继续可用',t=>{
 const s=fixture(t),n=s.run('create',{title:'旧库保留',doc:doc('原文')}),backup=s.run('backup')
 s.db.exec('DROP TABLE reading_links; DROP TABLE reading_annotations; DROP TABLE reading_documents; DROP TABLE reading_assets; DROP TABLE reading_restores; DROP TABLE restore_notes; DROP TABLE restore_shelves; PRAGMA user_version=1;')
 const migrated=openStore(path.dirname(s.filename));try{assert.equal(migrated.db.prepare('PRAGMA user_version').get().user_version,3);assert.deepEqual(migrated.run('snapshot').notes,[n]);assert.deepEqual(migrated.run('restore',backup),{added:0,duplicates:1});assert.ok(readdirSync(path.join(path.dirname(s.filename),'backups')).some(f=>f.startsWith('blocknotes-before-v2-')))}finally{migrated.close()}
})

test('BN-P1-01：两个来源 ID 的同名同内容冲突笔记，各保留自己的副本',t=>{
 const s=fixture(t),a=s.run('create',{title:'同名',doc:doc('旧')}),b=s.run('create',{title:'同名',doc:doc('旧')}),backup=s.run('backup')
 s.run('save',{...a,doc:doc('当前 A')});s.run('save',{...b,doc:doc('当前 B')})
 assert.deepEqual(s.run('restore',backup),{added:2,duplicates:0});assert.deepEqual(s.run('restore',backup),{added:0,duplicates:2});assert.equal(s.run('snapshot').notes.length,4)
})

test('BN-P1-01：500 字标题保留恢复标记，兼容旧版超长恢复副本标题',t=>{
 const s=fixture(t),title='题'.repeat(500),n=s.run('create',{title,doc:doc('旧')}),backup=s.run('backup');s.run('save',{...n,doc:doc('新')})
 s.run('restore',backup);const copy=s.run('snapshot').notes.find(row=>row.id!==n.id)
 assert.ok(copy.title.endsWith('（恢复副本）'));assert.ok(copy.title.length<=500)
 const legacy=structuredClone(backup);legacy.notes[0].id='legacy-long-copy';legacy.notes[0].title=title+'（恢复副本）'
 assert.deepEqual(s.run('restore',legacy),{added:1,duplicates:0});const old=s.run('snapshot').notes.find(row=>row.id==='legacy-long-copy')
 assert.equal(s.run('save',{...old,doc:doc('旧副本继续编辑')}).title,legacy.notes[0].title)
 assert.deepEqual(s.run('restore',s.run('backup')),{added:0,duplicates:3})
})

test('BN-P1-02：超出既有书架数量范围时不导出不可恢复备份，也不覆盖已有文件',async t=>{
 const s=fixture(t),file=path.join(path.dirname(s.filename),'preserved.json');writeFileSync(file,'已有备份必须保留')
 s.db.exec('BEGIN');const insert=s.db.prepare('INSERT INTO shelves VALUES(?,?,?)');for(let i=0;i<999;i++)insert.run('extra-'+i,'分类 '+i,'#527f67');s.db.exec('COMMIT')
 assert.throws(()=>s.run('backup'),/备份/);await assert.rejects(backupFileTask('backup',path.dirname(s.filename),file),/备份/);assert.equal(readFileSync(file,'utf8'),'已有备份必须保留')
})
