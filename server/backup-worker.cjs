const {parentPort,workerData}=require('node:worker_threads');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {randomUUID}=require('node:crypto');
const {pipeline}=require('node:stream/promises');
const {once}=require('node:events');
const {openStore,validateBackupHeader,validateBackupNote}=require('./storage.cjs');

async function restoreFile(directory,file){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'blocknotes-restore-'));
  const stage=new DatabaseSync(path.join(temp,'staging.sqlite'));let store,source,tokens;
  try{
    stage.exec('PRAGMA journal_mode=OFF; CREATE TABLE entries(id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE reading_entries(json TEXT NOT NULL); BEGIN;');
    const insert=stage.prepare('INSERT INTO entries VALUES(?,?)'),insertReading=stage.prepare('INSERT INTO reading_entries VALUES(?)');
    const {parser}=await import('stream-json/parser.js'),{default:Assembler}=await import('stream-json/assembler.js');
    source=fs.createReadStream(file,{highWaterMark:64*1024});tokens=parser.asStream({streamNumbers:false});
    let failure;const complete=pipeline(source,tokens).catch(e=>{failure=e;});
    let depth=0,key=null,assembly=null,kind=null,rootSeen=false,notesSeen=false,count=0,characters=0,stringLength=0,shelfCount=0;
    const keys=new Set(),header={};
    try{
      for await(const token of tokens){
        const name=token.name;
        if(name==='startString'||name==='startKey')stringLength=0;
        if(name==='stringChunk'&&(stringLength+=token.value.length)>40_100_000)throw new Error('备份单个字段过大');
        if(!rootSeen){if(name!=='startObject')throw new Error('备份根节点必须是对象');rootSeen=true;depth=1;continue;}
        if(name==='keyValue'&&depth===1&&!assembly){if(keys.has(token.value))throw new Error('备份存在重复字段');keys.add(token.value);key=token.value;continue;}
        if(['notes','reading'].includes(key)&&depth===1&&name==='startArray'){if(key==='notes')notesSeen=true;depth++;continue;}
        if(['notes','reading'].includes(key)&&depth===1&&['startObject','stringValue','numberValue','nullValue','trueValue','falseValue'].includes(name))throw new Error('备份笔记必须是数组');
        if(!assembly&&['notes','reading'].includes(key)&&depth===2&&name!=='endArray'&&!['startString','stringChunk','endString'].includes(name)){
          if(name!=='startObject')throw new Error('备份笔记无效');assembly=new Assembler();kind=key==='notes'?'note':'reading';characters=0;
        }
        if(!assembly&&depth===1&&['format','schemaVersion','shelves'].includes(key)&&!['startString','stringChunk','endString','startKey','endKey'].includes(name)){
          assembly=new Assembler();kind=key;characters=0;
        }
        if(key==='shelves'&&depth===2&&name==='startObject'&&++shelfCount>1000)throw new Error('备份书架过多');
        if(assembly){
          if(name==='keyValue'||name==='stringValue')characters+=JSON.stringify(token.value).length+1;
          else if(name==='numberValue')characters+=String(token.value).length+1;
          else if(['startObject','endObject','startArray','endArray'].includes(name))characters++;
          else if(['nullValue','trueValue','falseValue'].includes(name))characters+=6;
          if(characters>(kind==='note'?18_100_000:kind==='reading'?80_000_000:1_000_000))throw new Error('备份条目过大');
          assembly.consume(token);
          if(assembly.done){
            if(kind==='note'){
              if(++count>100000)throw new Error('备份笔记过多');const note=assembly.current;validateBackupNote(note);
              try{insert.run(note.id,JSON.stringify(note));}catch(e){if(e.code?.startsWith('ERR_SQLITE')&&stage.prepare('SELECT 1 FROM entries WHERE id=?').get(note.id))throw new Error('备份存在重复 ID');throw e;}
            }else if(kind==='reading'){insertReading.run(JSON.stringify(assembly.current));}else {header[kind]=assembly.current;key=null;}
            assembly=null;kind=null;
          }
        }
        if(name==='startObject'||name==='startArray'){if(++depth>1024)throw new Error('备份结构嵌套过深');}
        if(name==='endObject'||name==='endArray'){if(['notes','reading'].includes(key)&&depth===2&&name==='endArray')key=null;depth--;}
      }
    }finally{source.destroy();tokens.destroy();await complete;}
    if(failure)throw failure;
    if(!rootSeen||depth!==0||!notesSeen)throw new Error('备份不完整');validateBackupHeader(header);
    stage.exec('COMMIT');store=openStore(directory,{dailyBackup:false});
    // All bytes were parsed before touching user notes. The final merge is one transaction.
    const rows=stage.prepare('SELECT json FROM entries ORDER BY rowid').iterate();
    return store.restoreRows(header,(function*(){for(const row of rows)yield JSON.parse(row.json);})(),(function*(){for(const row of stage.prepare('SELECT json FROM reading_entries ORDER BY rowid').iterate())yield JSON.parse(row.json);})());
  }finally{
    source?.destroy();tokens?.destroy();store?.close();stage.close();
    if(path.dirname(temp)===path.resolve(os.tmpdir())&&path.basename(temp).startsWith('blocknotes-restore-'))fs.rmSync(temp,{recursive:true,force:true});
  }
}

async function exportFile(directory,file){
  const store=openStore(directory,{dailyBackup:false}),tmp=file+'.'+randomUUID()+'.tmp';let output;
  try{
    store.db.exec('BEGIN');
    const shelves=store.db.prepare('SELECT * FROM shelves ORDER BY rowid').all(),shelfIds=validateBackupHeader({format:'blocknotes-backup',schemaVersion:1,shelves});
    if(store.db.prepare('SELECT count(*) AS n FROM notes').get().n>100000)throw new Error('笔记数量超过备份支持范围');
    output=fs.createWriteStream(tmp,{flags:'wx',encoding:'utf8'});
    // Observe errors even when a small write fits the stream buffer.
    let error;output.on('error',e=>{error=e;});
    const write=async text=>{if(error)throw error;if(!output.write(text))await once(output,'drain');if(error)throw error;};
    await write('{"format":"blocknotes-backup","schemaVersion":'+(store.reading.list().length?2:1)+',"exportedAt":'+JSON.stringify(new Date().toISOString())+',"notes":[');
    let first=true;
    for(const row of store.db.prepare('SELECT * FROM notes ORDER BY updatedAt DESC,id').iterate()){
      const note={...row,doc:JSON.parse(row.doc),tags:JSON.parse(row.tags)};validateBackupNote(note,shelfIds);
      await write((first?'':',')+JSON.stringify(note));first=false;
    }
    const settings=Object.fromEntries(store.db.prepare('SELECT * FROM settings').all().map(r=>[r.key,JSON.parse(r.value)]));
    await write('],"shelves":'+JSON.stringify(shelves)+',"settings":'+JSON.stringify(settings));
    await write(',"reading":[');first=true;for(const record of store.reading.records()){await write((first?'':',')+JSON.stringify(record));first=false;}await write(']}');
    const finished=once(output,'finish');output.end();await finished;store.db.exec('COMMIT');fs.renameSync(tmp,file);return {filePath:file};
  }finally{
    output?.destroy();store.close();if(fs.existsSync(tmp))fs.unlinkSync(tmp);
  }
}
(async()=>{
  try{const {operation,directory,file}=workerData;const result=operation==='restore'?await restoreFile(directory,file):operation==='backup'?await exportFile(directory,file):(()=>{throw new Error('不支持的备份任务');})();parentPort.postMessage({result});}
  catch(error){parentPort.postMessage({error:error.message});}
})();
