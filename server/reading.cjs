const {randomUUID,createHash}=require('node:crypto');
const {validateDoc,plainText}=require('./content.cjs');
const CHUNK=256*1024;
const text=(v,max=1000)=>{if(typeof v!=='string'||v.length>max)throw new Error('资料字段无效或过长');return v;};
const hash=v=>createHash('sha256').update(v).digest('hex');
function sourceLocation(d,a){
 if(d.kind==='pdf')return `PDF 第 ${a.anchor.page} 页`;
 const block=/^b(\d+)$/.exec(a.anchor.block||'');
 const chapter=block?(d.outline||[]).filter(o=>/^b\d+$/.test(o.block||'')&&Number(o.block.slice(1))<=Number(block[1])).at(-1):null;
 return 'Word 文档'+(chapter?' · '+chapter.title:block?' · 第 '+(Number(block[1])+1)+' 段':'');
}
function compareAnnotations(a,b){return a.anchor.page-b.anchor.page||(a.anchor.start??(Number(a.anchor.block?.slice(1))||0))-(b.anchor.start??(Number(b.anchor.block?.slice(1))||0))||(a.anchor.rects[0]?.[1]||0)-(b.anchor.rects[0]?.[1]||0)||(a.anchor.rects[0]?.[0]||0)-(b.anchor.rects[0]?.[0]||0);}
function excerptBlocks(d,a){const p=s=>({type:'paragraph',content:[{type:'text',text:s}]});return [...(a.quote?[{type:'blockquote',content:[p(a.quote)]}]:[]),p(`出处：${d.title} · ${sourceLocation(d,a)}`),...(a.comment?[p('心得：'+a.comment)]:[])];}
function validateReadingDocument(d){
 text(d.id,100);text(d.title,500);if(!['pdf','docx'].includes(d.kind)||!['active','archived','deleted'].includes(d.status)||!['active','archived'].includes(d.previousStatus)||!Array.isArray(d.tags)||d.tags.length>30||!Array.isArray(d.pages)||!Number.isInteger(d.pageCount)||d.pageCount<1||!Number.isInteger(d.revision)||d.revision<1||!Number.isInteger(d.size)||d.size<1||d.size>512*1024*1024)throw new Error('资料备份元数据无效');d.tags.forEach(t=>text(t,80));d.pages.forEach(p=>text(p,32_000_000));if(d.pages.length!==d.pageCount||d.pages.reduce((n,p)=>n+p.length,0)>32_000_000||!Array.isArray(d.outline)||d.outline.length>100000||!Array.isArray(d.warnings)||d.warnings.length>10000||!d.position||!Number.isInteger(d.position.page)||d.position.page<1||d.position.page>d.pageCount||!Number.isFinite(d.position.offset)||d.position.offset<0||d.position.offset>1||!Number.isFinite(Date.parse(d.createdAt))||!Number.isFinite(Date.parse(d.updatedAt)))throw new Error('资料备份阅读状态无效');d.warnings.forEach(w=>text(w,10000));for(const o of d.outline){text(o.title,10000);if(!Number.isInteger(o.page)||o.page<1||o.page>d.pageCount)throw new Error('资料备份目录无效');if(o.block!==undefined)text(o.block,100);}if(d.position.block!==undefined)text(d.position.block,100);
 if(d.kind==='docx')text(d.html,32_000_000);
}
function readingStore(db){
 const get=id=>{const row=db.prepare('SELECT json FROM reading_documents WHERE id=?').get(text(id,100));if(!row)throw new Error('阅读资料不存在');return JSON.parse(row.json);};
 const list=()=>db.prepare("SELECT json_remove(json,'$.html','$.pages','$.outline') AS json FROM reading_documents ORDER BY rowid DESC").all().map(r=>{const {html,pages,outline,...d}=JSON.parse(r.json);return d;});
 const put=d=>db.prepare('INSERT INTO reading_documents VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(d.id,JSON.stringify(d));
 const annotations=id=>db.prepare('SELECT json FROM reading_annotations WHERE documentId=? ORDER BY rowid').all(id).map(r=>JSON.parse(r.json));
 const annotation=id=>{const r=db.prepare('SELECT json FROM reading_annotations WHERE id=?').get(text(id,100));if(!r)throw new Error('摘录不存在');return JSON.parse(r.json);};
 const putAnnotation=a=>db.prepare('INSERT INTO reading_annotations VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(a.id,a.documentId,JSON.stringify(a));
 const shelf=id=>{if(!db.prepare('SELECT id FROM shelves WHERE id=?').get(id))throw new Error('书架不存在');return id;};
 const check=(d,input)=>{if(d.revision!==input.revision)throw new Error('资料版本冲突，请重新打开');};
 function file(id){const d=get(id),rows=()=>db.prepare('SELECT data FROM reading_assets WHERE hash=? ORDER BY part').iterate(d.hash);return {size:d.size,kind:d.kind,name:d.title,bytes:()=>Buffer.concat([...rows()].map(r=>Buffer.from(r.data))),*chunks(start=0,end=d.size-1){let offset=0;for(const r of rows()){const b=Buffer.from(r.data);if(offset+b.length>start&&offset<=end)yield b.subarray(Math.max(0,start-offset),Math.min(b.length,end-offset+1));offset+=b.length;if(offset>end)break;}}};}
 function insert(parsed,bytes,input){
  const digest=hash(bytes),existing=list().find(d=>d.hash===digest);
  if(existing&&!input.copy)return {document:existing,duplicate:true};
  const now=new Date().toISOString(),d={...parsed,id:randomUUID(),hash:digest,size:bytes.length,shelfId:shelf(input.shelfId||'main'),tags:[],status:'active',previousStatus:'active',revision:1,createdAt:now,updatedAt:now,lastReadAt:null,position:{page:1,offset:0}};
  validateReadingDocument(d);
  for(let part=0;part*CHUNK<bytes.length;part++)db.prepare('INSERT OR IGNORE INTO reading_assets VALUES(?,?,?)').run(digest,part,bytes.subarray(part*CHUNK,(part+1)*CHUNK));
  put(d);return {document:list().find(x=>x.id===d.id),duplicate:false};
 }
 function run(op,input={},restoring=false){
  if(op==='reading.list')return list();
  if(op==='reading.get'){const d=get(input.id);return {...d,annotations:annotations(d.id)};}
  if(op==='reading.position'){
   const d=get(input.id),p=input.position;
   if(!p||!Number.isInteger(p.page)||p.page<1||p.page>d.pageCount||!Number.isFinite(p.offset)||p.offset<0||p.offset>1||p.block!==undefined&&typeof p.block!=='string')throw new Error('阅读位置无效');
   d.position={page:p.page,offset:p.offset,...(p.block?{block:text(p.block,100)}:{})};d.lastReadAt=new Date().toISOString();put(d);return d.position;
  }
  if(op==='reading.update'){
   const d=get(input.id);check(d,input);
   if(input.title!==undefined)d.title=text(input.title,500).trim()||'未命名资料';
   if(input.tags!==undefined){if(!Array.isArray(input.tags)||input.tags.length>30)throw new Error('标签无效');d.tags=[...new Set(input.tags.map(t=>text(t,80).trim()).filter(Boolean))];}
   if(input.shelfId)d.shelfId=shelf(input.shelfId);
   if(input.status){if(!['active','archived','deleted'].includes(input.status))throw new Error('状态无效');if(input.status==='deleted'&&d.status!=='deleted')d.previousStatus=d.status;d.status=input.restoreDeleted?d.previousStatus:input.status;}
   d.revision++;d.updatedAt=new Date().toISOString();put(d);return d;
  }
  if(op==='reading.annotate'){
   const d=get(input.documentId);if(d.status==='deleted'&&!restoring)throw new Error('请先恢复资料');
   const prev=input.id?annotation(input.id):null;if(prev){check(prev,input);if(prev.documentId!==d.id)throw new Error('摘录来源不一致');}
   const anchor=input.anchor||prev?.anchor;
   if(!anchor||!Number.isInteger(anchor.page)||anchor.page<1||anchor.page>d.pageCount||JSON.stringify(anchor).length>30000)throw new Error('摘录位置无效');
   const rects=anchor.rects||[];if(!Array.isArray(rects)||rects.length>500||rects.some(r=>!Array.isArray(r)||r.length!==4||r.some(v=>!Number.isFinite(v)||v<0||v>1)))throw new Error('高亮区域无效');
   const a={id:prev?.id||randomUUID(),documentId:d.id,quote:text(input.quote??prev?.quote??'',20000),comment:text(input.comment??'',20000),anchor:{page:anchor.page,rects,...(typeof anchor.block==='string'?{block:text(anchor.block,100)}:{}),...(Number.isInteger(anchor.start)&&anchor.start>=0?{start:anchor.start}:{}),...(Number.isInteger(anchor.end)&&anchor.end>=0?{end:anchor.end}:{})},revision:(prev?.revision||0)+1,createdAt:prev?.createdAt||new Date().toISOString()};
   if(!a.quote&&!a.comment.trim())throw new Error('请输入想法或选择原文');putAnnotation(a);return a;
  }
  if(op==='reading.deleteAnnotation'){const a=annotation(input.id);check(a,input);db.prepare('DELETE FROM reading_annotations WHERE id=?').run(a.id);return {deleted:true};}
  if(op==='reading.search'){
   const words=text(input.query||'',1000).normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean),found=[];
   for(const summary of list()){
    if(summary.status==='deleted'||input.shelfId&&summary.shelfId!==input.shelfId||input.tag&&!summary.tags.includes(input.tag))continue;
    const d=get(summary.id),items=[...(d.pages||[]).map((p,i)=>({type:'document',text:p,page:i+1})),...annotations(d.id).map(a=>({type:'annotation',text:a.quote+'\n'+a.comment,page:a.anchor.page,annotationId:a.id}))];
    for(const item of items){const hay=[d.title,...d.tags,item.text].join('\n').normalize('NFKC').toLowerCase();if(words.every(w=>hay.includes(w))){const at=Math.max(0,item.text.normalize('NFKC').toLowerCase().indexOf(words[0]||''));found.push({documentId:d.id,title:d.title,kind:d.kind,...item,text:undefined,snippet:item.text.slice(Math.max(0,at-40),at+140)});if(found.length>=200)return found;}}
   }return found;
  }
  throw new Error('不支持的阅读操作');
 }
 function excerpt(input,create,save,getNote){
  const ids=input.annotationIds??[input.annotationId];if(!Array.isArray(ids)||!ids.length||ids.length>500)throw new Error('请选择 1 至 500 条摘录');
  const selected=[...new Set(ids)].map(annotation).sort(compareAnnotations),d=get(selected[0].documentId);
  if(selected.some(a=>a.documentId!==d.id))throw new Error('请每次整理同一份资料的摘录');
  if(d.status==='deleted')throw new Error('请先恢复资料');
  let n;if(input.noteId){n=getNote(input.noteId);if(n.status==='deleted')throw new Error('请先恢复笔记');if(n.revision!==input.revision)throw new Error('笔记版本冲突，请重新打开');}
  const fresh=selected.filter(a=>!n||!db.prepare('SELECT 1 FROM reading_links WHERE noteId=? AND documentId=? AND annotationId=?').get(n.id,d.id,a.id));
  if(!fresh.length)return n;
  const blocks=fresh.flatMap(a=>excerptBlocks(d,a));
  if(n)n=save({...n,doc:validateDoc({...n.doc,content:[...(n.doc.content||[]),...blocks]})});else n=create({title:(d.title+' · 读书笔记').slice(0,500),shelfId:d.shelfId,doc:validateDoc({type:'doc',content:blocks})});
  for(const a of fresh)db.prepare('INSERT OR IGNORE INTO reading_links VALUES(?,?,?)').run(n.id,d.id,a.id);return n;
 }
 function* records(){for(const r of db.prepare('SELECT hash,part,data FROM reading_assets ORDER BY hash,part').iterate())yield {type:'asset',hash:r.hash,part:r.part,data:Buffer.from(r.data).toString('base64')};for(const r of db.prepare('SELECT json FROM reading_documents').iterate())yield {type:'document',value:JSON.parse(r.json)};for(const r of db.prepare('SELECT json FROM reading_annotations').iterate())yield {type:'annotation',value:JSON.parse(r.json)};for(const r of db.prepare('SELECT * FROM reading_links').iterate())yield {type:'link',value:r};}
 function restore(records,shelfMap){
  const map=new Map(),annMap=new Map(),links=[];
  for(const r of records){
   if(r.type==='asset'){
    if(!/^[a-f0-9]{64}$/.test(r.hash)||!Number.isInteger(r.part)||r.part<0||r.part>8192||typeof r.data!=='string'||r.data.length>CHUNK*2||!/^[A-Za-z0-9+/]*={0,2}$/.test(r.data))throw new Error('资料备份块无效');
    const b=Buffer.from(r.data,'base64');if(b.length>CHUNK)throw new Error('资料备份块过大');const old=db.prepare('SELECT data FROM reading_assets WHERE hash=? AND part=?').get(r.hash,r.part);if(old&&!Buffer.from(old.data).equals(b))throw new Error('资料备份校验冲突');db.prepare('INSERT OR IGNORE INTO reading_assets VALUES(?,?,?)').run(r.hash,r.part,b);
   }else if(r.type==='document'){
    const d=structuredClone(r.value);validateReadingDocument(d);
    // Never render HTML supplied by a backup without applying the same allow-list.
    if(d.kind==='docx')d.html=require('./reading-files.cjs').cleanHtml(text(d.html,32_000_000));
    const chunks=db.prepare('SELECT part,data FROM reading_assets WHERE hash=? ORDER BY part').iterate(d.hash),digest=createHash('sha256');let size=0,index=0;for(const chunk of chunks){if(chunk.part!==index++)throw new Error('资料备份缺块');digest.update(chunk.data);size+=chunk.data.length;}if(size!==d.size||digest.digest('hex')!==d.hash)throw new Error('资料备份原文件校验失败');
    const source=d.id,original=JSON.stringify(d),existing=db.prepare('SELECT json FROM reading_documents WHERE id=?').get(source);d.shelfId=shelf(shelfMap.get(d.shelfId)||d.shelfId);
    const fingerprint=hash(original),restoreKey=source+':'+fingerprint;
    if(existing){const old=JSON.parse(existing.json);const content=v=>{const {position,lastReadAt,updatedAt,revision,...rest}=v;if(rest.kind==='docx')rest.html=require('./reading-files.cjs').cleanHtml(rest.html);return JSON.stringify(rest)};if(content(old)===content(d)){map.set(source,source);continue;}const prior=db.prepare('SELECT targetId,snapshot FROM reading_restores WHERE source=?').get(restoreKey);if(prior&&(()=>{const row=db.prepare('SELECT json FROM reading_documents WHERE id=?').get(prior.targetId);return row&&content(JSON.parse(row.json))===content(JSON.parse(prior.snapshot))})()){map.set(source,prior.targetId);continue;}d.id=randomUUID();d.title=d.title.slice(0,490)+'（恢复副本）';}
    put(d);map.set(source,d.id);db.prepare('INSERT INTO reading_restores VALUES(?,?,?) ON CONFLICT(source) DO UPDATE SET targetId=excluded.targetId,snapshot=excluded.snapshot').run(restoreKey,d.id,JSON.stringify(d));
   }else if(r.type==='annotation'){
    const a=r.value,source=a.id;const documentId=map.get(a.documentId);if(!documentId)throw new Error('摘录来源缺失');const found=annotations(documentId).find(x=>(x.id===source||x.sourceId===source)&&x.quote===a.quote&&x.comment===a.comment&&JSON.stringify(x.anchor)===JSON.stringify(a.anchor));if(found){annMap.set(source,found.id);continue;}
    const saved=run('reading.annotate',{documentId,quote:a.quote,comment:a.comment,anchor:a.anchor},true);saved.sourceId=source;putAnnotation(saved);annMap.set(source,saved.id);
   }else if(r.type==='link'){links.push(r.value);}else throw new Error('未知资料备份条目');
  }
  return {map,links:links.map(l=>({...l,documentId:map.get(l.documentId),annotationId:annMap.get(l.annotationId)}))};
 }
 return {run,get,list,insert,file,excerpt,records,restore,annotations,links:noteId=>db.prepare('SELECT l.*,d.json FROM reading_links l JOIN reading_documents d ON d.id=l.documentId WHERE noteId=?').all(noteId).map(({json,...l})=>{const d=JSON.parse(json),row=db.prepare('SELECT json FROM reading_annotations WHERE id=?').get(l.annotationId);return {...l,title:d.title,location:row?sourceLocation(d,JSON.parse(row.json)):'原摘录已删除，仍可打开资料'};}),moveShelf(from,to){for(const d of list().filter(d=>d.shelfId===from)){const full=get(d.id);full.shelfId=to;full.revision++;full.updatedAt=new Date().toISOString();put(full);}}};
}
module.exports={readingStore,CHUNK,sourceLocation,compareAnnotations,excerptBlocks};
