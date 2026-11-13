import {useEffect,useRef,useState} from 'react'
import Icon from './Icon'
import {call,importReading} from './api'
import type {ReadingDocument,Shelf} from './types'

type Props={documents:ReadingDocument[];shelves:Shelf[];shelfId?:string;status?:ReadingDocument['status'];query?:string;busy:boolean;onOpen:(id:string,page?:number,annotationId?:string,term?:string)=>void;onFilter?:(shelf:string,tag:string)=>void;onChange:()=>Promise<unknown>;act:(fn:()=>Promise<void>)=>Promise<void>;onError:(error:string)=>void}
export default function ReadingLibrary({documents,shelves,shelfId,status='active',query,busy,onOpen,onChange,act,onError,onFilter}:Props){
 const input=useRef<HTMLInputElement>(null),controller=useRef<AbortController|null>(null)
 const [importing,setImporting]=useState(false),[progress,setProgress]=useState(''),[duplicate,setDuplicate]=useState<ReadingDocument|null>(null),[copy,setCopy]=useState(false),[recent,setRecent]=useState(false),[tag,setTag]=useState(''),[filterShelf,setFilterShelf]=useState(''),[hits,setHits]=useState<{documentId:string;title:string;page:number;annotationId?:string;snippet:string;type:string}[]>([])
 useEffect(()=>{onFilter?.(filterShelf,tag)},[filterShelf,tag])
 useEffect(()=>{if(!importing||!window.blocknotes)return;const t=setInterval(()=>{call('reading.importStatus').then(p=>{if(p)setProgress(`${p.phase} ${p.done}/${p.total}`)}).catch(()=>{})},500);return()=>clearInterval(t)},[importing])
 useEffect(()=>{if(query===undefined)return;let active=true;call('reading.search',{query,shelfId:filterShelf,tag}).then(r=>{if(active)setHits(r)}).catch(e=>{if(active)onError(e.message)});return()=>{active=false}},[query,documents,tag,filterShelf])
 const load=(file?:File)=>act(async()=>{setImporting(true);setProgress('正在导入资料…');controller.current=new AbortController();try{const result=window.blocknotes?await call('reading.importFile',{shelfId,copy}):file?await importReading(file,shelfId||'main',controller.current.signal,copy):null;if(result&&!result.canceled){await onChange();if(result.duplicate)setDuplicate(result.document);else onOpen(result.document.id)}}finally{setImporting(false);controller.current=null;setCopy(false);await onChange()}})
 const choose=()=>{setDuplicate(null);if(window.blocknotes)void load();else input.current?.click()}
 const location=(d:ReadingDocument,next:ReadingDocument['status'])=>act(async()=>{await call('reading.update',{id:d.id,revision:d.revision,status:next,restoreDeleted:d.status==='deleted'});await onChange()})
 const visible=documents.filter(d=>d.status===status&&(!shelfId||d.shelfId===shelfId)&&(!tag||d.tags.includes(tag))).sort((a,b)=>recent?(b.lastReadAt||'').localeCompare(a.lastReadAt||''):b.createdAt.localeCompare(a.createdAt))
 return <section className="reading-library" aria-label="阅读资料">
  <input hidden ref={input} type="file" accept=".pdf,.docx" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void load(f)}}/>
  <div className="reading-library-tools"><strong>阅读资料</strong>{query===undefined&&status==='active'&&<><button className="pixel-button" disabled={busy||importing} onClick={choose}>导入 Word / PDF</button><button className="text-button" aria-pressed={recent} onClick={()=>setRecent(!recent)}>{recent?'按最近阅读':'按导入时间'}</button></>}
   {query!==undefined&&<select aria-label="搜索资料书架" value={filterShelf} onChange={e=>setFilterShelf(e.target.value)}><option value="">全部书架</option>{shelves.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>}
   <select aria-label="资料标签筛选" value={tag} onChange={e=>setTag(e.target.value)}><option value="">全部标签</option>{[...new Set(documents.flatMap(d=>d.tags))].map(t=><option key={t}>{t}</option>)}</select>
  </div>
  {importing&&<div role="status">{progress}<button className="pixel-button" onClick={()=>{controller.current?.abort();if(window.blocknotes)void call('reading.cancelImport')}}>取消导入</button></div>}
  {duplicate&&<div className="reading-notice">这份资料已经在书房中。<button className="pixel-button" onClick={()=>onOpen(duplicate.id)}>打开已有资料</button><button className="pixel-button" onClick={()=>{setCopy(true);setDuplicate(null)}}>另存副本（再次导入）</button></div>}
  {copy&&<p>再次选择文件，将作为独立资料导入。</p>}
  {query!==undefined?<div className="reading-results">{hits.map((h,i)=><button className="reading-result" key={i} disabled={busy} onClick={()=>onOpen(h.documentId,h.page,h.annotationId,query)}><strong>{h.type==='annotation'?'摘录':'资料'} · {h.title}</strong><span>{h.snippet||'标题或标签匹配'}</span><small>第 {h.page} 页 / 内容区</small></button>)}{!hits.length&&<p className="muted">没有匹配的阅读资料或摘录。</p>}</div>:<div className="reading-results">{visible.map(d=><article className="reading-result" key={d.id}><button className="reading-document-open" disabled={busy||d.status==='deleted'} onClick={()=>onOpen(d.id)}><Icon name="book"/><span><strong>{d.title}</strong><small>{d.kind.toUpperCase()} · {d.kind==='pdf'?d.pageCount+' 页':'Word 资料'}{d.lastReadAt?' · 最近 '+new Date(d.lastReadAt).toLocaleDateString('zh-CN'):''}</small></span></button>{status!=='active'&&<button className="pixel-button" disabled={busy} onClick={()=>location(d,d.status==='deleted'?d.previousStatus:'active')}>恢复资料</button>}</article>)}{!visible.length&&<p className="muted">{status==='active'?'导入 Word 或 PDF，在讲台阅读并记录想法。':'这里没有阅读资料。'}</p>}</div>}
 </section>
}
