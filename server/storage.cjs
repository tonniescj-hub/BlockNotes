const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { validateDoc, plainText, markdown } = require('./content.cjs');
const EMPTY={type:'doc',content:[{type:'paragraph'}]};
const RESTORE_SUFFIX='（恢复副本）';
const legacyTitleLimit=title=>typeof title==='string'&&title.endsWith(RESTORE_SUFFIX)?500+RESTORE_SUFFIX.length:500;
function string(value, max, label) { if(typeof value!=='string'||value.length>max) throw new Error(`${label}无效或过长`); return value; }
function tags(value) { if(!Array.isArray(value)||value.length>30) throw new Error('标签最多 30 个'); return [...new Set(value.map(t=>string(t,80,'标签').trim()).filter(Boolean))]; }
function normalize(s) { return s.normalize('NFKC').toLocaleLowerCase(); }
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
function fingerprint(value){return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}
function noteValue(n){return {title:n.title,doc:typeof n.doc==='string'?JSON.parse(n.doc):n.doc,tags:tags(typeof n.tags==='string'?JSON.parse(n.tags):n.tags),shelfId:n.shelfId,status:n.status,previousStatus:n.previousStatus};}
function validateBackupHeader(payload){
  if(payload?.format!=='blocknotes-backup'||![1,2].includes(payload.schemaVersion)||!Array.isArray(payload.shelves)||payload.shelves.length>1000)throw new Error('不是受支持的 BlockNotes 备份');
  const ids=new Set();for(const s of payload.shelves){string(s.id,100,'书架 ID');string(s.name,100,'书架名称');if(ids.has(s.id)||!/^#[\da-f]{6}$/i.test(s.color))throw new Error('备份书架无效');ids.add(s.id);}return ids;
}
function validateBackupNote(n,shelfIds){
  string(n?.id,100,'笔记 ID');string(n.title,legacyTitleLimit(n.title),'标题');validateDoc(n.doc);tags(n.tags);
  if(typeof n.shelfId!=='string'||(shelfIds&&!shelfIds.has(n.shelfId))||!['active','archived','deleted'].includes(n.status)||!['active','archived'].includes(n.previousStatus)||!Number.isInteger(n.revision)||n.revision<1||!Number.isFinite(Date.parse(n.createdAt))||!Number.isFinite(Date.parse(n.updatedAt)))throw new Error('备份笔记元数据无效');
}
function openStore(directory, {dailyBackup=true}={}) {
  fs.mkdirSync(directory,{recursive:true});
  const filename=path.join(directory,'blocknotes.sqlite');
  const db=new DatabaseSync(filename);
  try {db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');}
  catch(e) {db.close();throw e;}
  const version=db.prepare('PRAGMA user_version').get().user_version;
  if(version>3) {db.close();throw new Error('数据库来自更高版本，请升级应用；未修改数据。');}
  const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  if(version===0) tx(()=>{
    db.exec(`CREATE TABLE shelves(id TEXT PRIMARY KEY,name TEXT NOT NULL,color TEXT NOT NULL);
      CREATE TABLE notes(id TEXT PRIMARY KEY,title TEXT NOT NULL,doc TEXT NOT NULL,plain TEXT NOT NULL,tags TEXT NOT NULL,shelfId TEXT NOT NULL REFERENCES shelves(id),status TEXT NOT NULL CHECK(status IN ('active','archived','deleted')),previousStatus TEXT NOT NULL DEFAULT 'active',revision INTEGER NOT NULL DEFAULT 1,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
      CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE INDEX notes_location ON notes(shelfId,status);
      INSERT INTO shelves VALUES('main','知识书架','#527f67'),('ideas','灵感书架','#bd794b');
      PRAGMA user_version=1;`);
  });
  if(version===1){
    try{const dir=path.join(directory,'backups');fs.mkdirSync(dir,{recursive:true});db.prepare('VACUUM INTO ?').run(path.join(dir,`blocknotes-before-v2-${Date.now()}-${randomUUID()}.sqlite`));}
    catch(e){db.close();throw new Error('升级前备份失败，未升级数据库：'+e.message);}
  }
  if(version<2)tx(()=>{
    // Additive migration: existing notes and v1 JSON backups are unchanged.
    db.exec(`CREATE TABLE restore_notes(sourceId TEXT NOT NULL,fingerprint TEXT NOT NULL,targetId TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,PRIMARY KEY(sourceId,fingerprint,targetId));
      CREATE TABLE restore_shelves(sourceId TEXT NOT NULL,fingerprint TEXT NOT NULL,targetId TEXT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,PRIMARY KEY(sourceId,fingerprint,targetId));
      CREATE INDEX restore_notes_target ON restore_notes(targetId);
      PRAGMA user_version=2;`);
  });
  if(version<3){
    if(version>0){try{const dir=path.join(directory,'backups');fs.mkdirSync(dir,{recursive:true});db.prepare('VACUUM INTO ?').run(path.join(dir,`blocknotes-before-v3-${Date.now()}-${randomUUID()}.sqlite`));}catch(e){db.close();throw new Error('升级前备份失败：'+e.message);}}
    tx(()=>db.exec(`CREATE TABLE reading_documents(id TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE reading_assets(hash TEXT NOT NULL,part INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(hash,part));
      CREATE TABLE reading_annotations(id TEXT PRIMARY KEY,documentId TEXT NOT NULL REFERENCES reading_documents(id),json TEXT NOT NULL);
      CREATE TABLE reading_links(noteId TEXT NOT NULL REFERENCES notes(id),documentId TEXT NOT NULL REFERENCES reading_documents(id),annotationId TEXT NOT NULL,PRIMARY KEY(noteId,documentId,annotationId));
      CREATE TABLE reading_restores(source TEXT PRIMARY KEY,targetId TEXT NOT NULL,snapshot TEXT NOT NULL);
      PRAGMA user_version=3;`));
  }
  const reading=require('./reading.cjs').readingStore(db);
  const integrity=db.prepare('PRAGMA quick_check').get().quick_check;
  if(integrity!=='ok'){db.close();throw new Error('数据库完整性检查失败。请保留原文件，使用备份恢复。');}
  const unpack=r=>({...r,doc:JSON.parse(r.doc),tags:JSON.parse(r.tags)});
  function getNote(id) {const r=db.prepare('SELECT * FROM notes WHERE id=?').get(string(id,100,'笔记 ID')); if(!r)throw new Error('笔记不存在');return unpack(r);}
  function shelf(id) {if(!db.prepare('SELECT id FROM shelves WHERE id=?').get(id)) throw new Error('书架不存在'); return id;}
  function snapshot(){return {documents:reading.list(),notes:db.prepare('SELECT * FROM notes ORDER BY updatedAt DESC,id').all().map(unpack),shelves:db.prepare('SELECT * FROM shelves ORDER BY rowid').all(),settings:Object.fromEntries(db.prepare('SELECT * FROM settings').all().map(r=>[r.key,JSON.parse(r.value)])),dataPath:filename};}
  function save(input) {
    const n=getNote(input.id);
    if(input.revision!==n.revision)throw new Error('笔记已被其他窗口修改。草稿已保留，请重新打开或另存副本。');
    if(n.status==='deleted') throw new Error('笔记已在回收区，请先恢复');
    const doc=validateDoc(input.doc); const title=string(input.title,input.title===n.title?legacyTitleLimit(n.title):500,'标题');const t=tags(input.tags);
    db.prepare('UPDATE notes SET title=?,doc=?,plain=?,tags=?,revision=revision+1,updatedAt=? WHERE id=?').run(title,JSON.stringify(doc),plainText(doc),JSON.stringify(t),new Date().toISOString(),n.id);
    return getNote(n.id);
  }
  function create(input={}) {
    const id=randomUUID(),now=new Date().toISOString(); const doc=validateDoc(input.doc||EMPTY);
    db.prepare('INSERT INTO notes(id,title,doc,plain,tags,shelfId,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)').run(id,string(input.title??'',500,'标题'),JSON.stringify(doc),plainText(doc),JSON.stringify(tags(input.tags||[])),shelf(input.shelfId||'main'),'active',now,now);
    return getNote(id);
  }
  function backup() {const result={format:'blocknotes-backup',schemaVersion:1,exportedAt:new Date().toISOString(),...snapshot(),dataPath:undefined};const ids=validateBackupHeader(result);if(result.notes.length>100000)throw new Error('笔记数量超过备份支持范围');for(const n of result.notes)validateBackupNote(n,ids);return result;}
  function mergeRows(payload,notes,readingRecords=[]) {
    const shelfIds=validateBackupHeader(payload),noteIds=new Set();let added=0,duplicates=0;
    const shelfMap=new Map();
    for(const sh of payload.shelves){
      const existing=db.prepare('SELECT * FROM shelves WHERE id=?').get(sh.id),hash=fingerprint({name:sh.name,color:sh.color});let target=existing;
      if(existing&&(existing.name!==sh.name||existing.color!==sh.color)){
        target=db.prepare('SELECT s.* FROM restore_shelves r JOIN shelves s ON s.id=r.targetId WHERE r.sourceId=? AND r.fingerprint=? AND s.name=? AND s.color=?').get(sh.id,hash,sh.name,sh.color);
        if(!target)target=db.prepare('SELECT * FROM shelves s WHERE name=? AND color=? AND NOT EXISTS(SELECT 1 FROM restore_shelves r WHERE r.targetId=s.id) ORDER BY rowid LIMIT 1').get(sh.name,sh.color);
      }
      const id=target?.id||(existing?randomUUID():sh.id);shelfMap.set(sh.id,id);
      if(!target)db.prepare('INSERT INTO shelves VALUES(?,?,?)').run(id,sh.name,sh.color);
      if(existing&&id!==sh.id)db.prepare('INSERT OR IGNORE INTO restore_shelves VALUES(?,?,?)').run(sh.id,hash,id);
    }
    const restored=reading.restore(readingRecords,shelfMap),noteMap=new Map();
    for(const n of notes){
      validateBackupNote(n,shelfIds);if(noteIds.has(n.id))throw new Error('备份存在重复 ID');noteIds.add(n.id);if(noteIds.size>100000)throw new Error('不是受支持的 BlockNotes 备份');
      const existing=db.prepare('SELECT * FROM notes WHERE id=?').get(n.id),target=shelfMap.get(n.shelfId),value={...noteValue(n),shelfId:target};
      if(existing&&fingerprint(noteValue(existing))===fingerprint(value)){duplicates++;noteMap.set(n.id,n.id);continue;}
      const sourceHash=fingerprint(noteValue(n)),copyTitle=n.title.slice(0,500-RESTORE_SUFFIX.length)+RESTORE_SUFFIX,copyValue={...value,title:copyTitle};
      if(existing){
        const recorded=db.prepare('SELECT n.* FROM restore_notes r JOIN notes n ON n.id=r.targetId WHERE r.sourceId=? AND r.fingerprint=?').all(n.id,sourceHash);
        // Adopt an equivalent pre-migration copy, but never a copy owned by a different source.
        const legacy=db.prepare('SELECT * FROM notes n WHERE (title=? OR title=?) AND shelfId=? AND NOT EXISTS(SELECT 1 FROM restore_notes r WHERE r.targetId=n.id)').all(copyTitle,n.title+'（恢复副本）',target);
        const same=[...recorded,...legacy].find(candidate=>fingerprint({...noteValue(candidate),title:copyTitle})===fingerprint(copyValue)&&(candidate.title===copyTitle||candidate.title===n.title+'（恢复副本）'));
        if(same){db.prepare('INSERT OR IGNORE INTO restore_notes VALUES(?,?,?)').run(n.id,sourceHash,same.id);duplicates++;noteMap.set(n.id,same.id);continue;}
      }
      const id=existing?randomUUID():n.id;
      db.prepare('INSERT INTO notes VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,existing?copyTitle:n.title,JSON.stringify(n.doc),plainText(n.doc),JSON.stringify(tags(n.tags)),target,n.status,n.previousStatus,n.revision,n.createdAt,n.updatedAt);
      if(existing)db.prepare('INSERT INTO restore_notes VALUES(?,?,?)').run(n.id,sourceHash,id);noteMap.set(n.id,id);added++;
    }
    for(const l of restored.links){const noteId=noteMap.get(l.noteId);if(noteId&&l.documentId&&l.annotationId)db.prepare('INSERT OR IGNORE INTO reading_links VALUES(?,?,?)').run(noteId,l.documentId,l.annotationId);}
    return {added,duplicates,...(restored.map.size?{documents:restored.map.size}:{})};
  }
  function restore(payload){if(!Array.isArray(payload?.notes))throw new Error('不是受支持的 BlockNotes 备份');return mergeRows(payload,payload.notes,payload.reading||[]);}
  let backupWarning='';
  if(dailyBackup&&fs.existsSync(filename)) {
    try {const dir=path.join(directory,'backups');fs.mkdirSync(dir,{recursive:true});const day=new Date().toISOString().slice(0,10);const target=path.join(dir,`blocknotes-${day}.sqlite`);if(!fs.existsSync(target))db.prepare('VACUUM INTO ?').run(target);
    const files=fs.readdirSync(dir).filter(f=>/^blocknotes-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort();for(const f of files.slice(0,-14))fs.unlinkSync(path.join(dir,f));
    }catch(e){backupWarning='自动备份失败：'+e.message;}
  }
  function run(operation,input={}) {
    if(operation==='reading.links')return reading.links(input.noteId);
    if(operation==='reading.excerpt')return tx(()=>reading.excerpt(input,create,save,getNote));
    if(operation.startsWith('reading.'))return ['reading.list','reading.get','reading.search'].includes(operation)?reading.run(operation,input):tx(()=>reading.run(operation,input));
    switch(operation){
      case 'snapshot': return {...snapshot(),backupWarning};
      case 'create': return tx(()=>create(input));
      case 'save': return tx(()=>save(input));
      case 'location': return tx(()=>{const n=getNote(input.id);if(n.revision!==input.revision)throw new Error('笔记版本冲突，请重新打开');if(!['active','archived','deleted'].includes(input.status))throw new Error('状态无效');const previous=input.status==='deleted'?(n.status==='deleted'?n.previousStatus:n.status):n.previousStatus;const status=input.restoreDeleted?n.previousStatus:input.status;db.prepare('UPDATE notes SET shelfId=?,status=?,previousStatus=?,revision=revision+1,updatedAt=? WHERE id=?').run(shelf(input.shelfId||n.shelfId),status,previous,new Date().toISOString(),n.id);return getNote(n.id);});
      case 'shelf': return tx(()=>{string(input.name,100,'书架名称');if(!input.name.trim())throw new Error('请输入书架名称');const id=input.id||randomUUID();const color=input.color||'#527f67';if(!/^#[\da-f]{6}$/i.test(color))throw new Error('颜色无效');db.prepare('INSERT INTO shelves VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color').run(id,input.name.trim(),color);return snapshot();});
      case 'deleteShelf': return tx(()=>{
        const id=string(input.id,100,'书架 ID');if(['main','ideas'].includes(id))throw new Error('场景绑定的基础书架不能删除，可以重命名');
        const source=db.prepare('SELECT * FROM shelves WHERE id=?').get(id);if(!source)throw new Error('书架不存在，请重新打开');
        if(string(input.expectedName,100,'书架名称')!==source.name)throw new Error('书架名称已更改，请重新确认删除');
        const moved=db.prepare('SELECT count(*) AS count FROM notes WHERE shelfId=?').get(id).count+reading.list().filter(d=>d.shelfId===id).length;
        if(moved){
          if(!input.targetId||input.targetId===id)throw new Error('请选择其他接收书架，笔记不会被删除');
          const target=shelf(string(input.targetId,100,'接收书架 ID'));
          db.prepare('UPDATE notes SET shelfId=?,revision=revision+1,updatedAt=? WHERE shelfId=?').run(target,new Date().toISOString(),id);reading.moveShelf(id,target);
        }
        db.prepare('DELETE FROM shelves WHERE id=?').run(id);return {moved};
      });
      case 'settings': return tx(()=>{if(!['parallax','lastNoteId','soundVolume','musicVolume','musicTrack'].includes(input.key))throw new Error('设置无效');if(['parallax','soundVolume','musicVolume'].includes(input.key)&&(!Number.isFinite(input.value)||input.value<0||input.value>1))throw new Error('设置强度无效');if(input.key==='lastNoteId')string(input.value,100,'笔记 ID');if(input.key==='musicTrack'&&!/^records\/[a-z0-9_]+$/.test(string(input.value,200,'音乐 ID')))throw new Error('音乐 ID 无效');db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(input.key,JSON.stringify(input.value));return input.value;});
      case 'search': {const words=normalize(string(input.query||'',1000,'搜索词')).trim().split(/\s+/).filter(Boolean);return snapshot().notes.filter(n=>n.status!=='deleted'&&words.every(w=>normalize(n.title+'\n'+n.plain+'\n'+n.tags.join(' ')).includes(w))).map(n=>n.id);}
      case 'backup': {if(reading.list().length)throw new Error('资料库请使用完整文件备份');return backup();}
      case 'restore': return tx(()=>restore(input));
      case 'export': {const n=getNote(input.id);return {name:(n.title||'未命名笔记').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,100)+'.md',text:'# '+(n.title||'未命名笔记').replace(/\n/g,' ')+'\n\n'+(n.tags.length?'标签：'+n.tags.join(' · ')+'\n\n':'')+markdown(n.doc)+'\n'};}
      default: throw new Error('不支持的操作');
    }
  }
  return {run,reading,transaction:tx,restoreRows(payload,notes,records=[]){return tx(()=>mergeRows(payload,notes,records));},close(){db.close();},filename,db};
}
module.exports={openStore,normalize,validateBackupHeader,validateBackupNote};
