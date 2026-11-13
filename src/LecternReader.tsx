import {useLayoutEffect,useRef,useState} from 'react'
import BookEditor from './BookEditor'
import Icon from './Icon'
import type {Note,Shelf,ReadingDocument} from './types'

type Props={documents:ReadingDocument[];onDocument:(id:string)=>void;note?:Note;notes:Note[];shelves:Shelf[];busy:boolean;searchTerm:string;onSelect:(note:Note)=>void;onEdit:()=>void;onClose:()=>void}
export default function LecternReader({documents,onDocument,note,notes,shelves,busy,searchTerm,onSelect,onEdit,onClose}:Props){
 const [query,setQuery]=useState(''),[category,setCategory]=useState('all'),[collapsed,setCollapsed]=useState(false)
 const list=useRef<HTMLElement>(null)
 useLayoutEffect(()=>{list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({block:'nearest'})},[note?.id,collapsed,category,query])
 const terms=query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
 const available=notes.filter(n=>n.status!=='deleted'),visible=available.filter(n=>(category==='all'||category==='archived'&&n.status==='archived'||n.status==='active'&&n.shelfId===category)&&terms.every(t=>[n.title,n.plain,...n.tags].join('\n').normalize('NFKC').toLocaleLowerCase().includes(t)))
 return <div className={'lectern-workbench'+(collapsed?' catalogue-collapsed':'')}>
  {!collapsed&&<aside className="lectern-catalogue mc-panel" aria-label="讲台笔记列表">
   <header className="lectern-catalogue-heading"><Icon name="shelf"/><h2>选择阅读的书</h2><button className="catalogue-hide" aria-label="收起笔记列表" title="收起笔记列表" onClick={()=>setCollapsed(true)}>‹</button></header>
   <input aria-label="筛选阅读笔记" placeholder="搜索书名、正文、标签…" value={query} onChange={e=>setQuery(e.target.value)}/>
   <select aria-label="阅读书架分类" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">全部笔记</option>{shelves.map(sh=><option key={sh.id} value={sh.id}>{sh.name}</option>)}<option value="archived">归档箱</option></select>
   <div className="lectern-count">{visible.length} 本书</div>
   <nav ref={list} className="lectern-note-list" aria-label="可阅读笔记">{documents.filter(d=>d.status!=='deleted'&&(category==='all'||category==='archived'&&d.status==='archived'||d.status==='active'&&d.shelfId===category)&&terms.every(t=>[d.title,...d.tags].join(' \n').normalize('NFKC').toLocaleLowerCase().includes(t))).map(d=><button key={d.id} className="lectern-note" disabled={busy} onClick={()=>onDocument(d.id)}><span className="lectern-book-slot"><Icon name="book"/></span><span><strong>{d.title}</strong><small>{d.kind.toUpperCase()} · 阅读资料</small></span></button>)}{visible.map(n=><button key={n.id} className={'lectern-note'+(note?.id===n.id?' current':'')} aria-label={`阅读 ${n.title||'未命名笔记'}`} aria-current={note?.id===n.id?'true':undefined} disabled={busy} onClick={()=>onSelect(n)}><span className="lectern-book-slot"><Icon name="book"/></span><span><strong>{n.title||'未命名笔记'}</strong><small>{n.status==='archived'?'已归档 · ':''}{shelves.find(sh=>sh.id===n.shelfId)?.name}</small></span></button>)}</nav>
   {!visible.length&&<p className="lectern-list-empty">{available.length?'没有匹配的笔记':'还没有笔记。用书与笔写下第一篇。'}</p>}
  </aside>}
  <section className="lectern-reading-area" aria-label="讲台阅读工作台">
   <header className="lectern-book-heading">{collapsed&&<button className="pixel-button catalogue-show" aria-label="展开笔记列表" onClick={()=>setCollapsed(false)}><Icon name="shelf"/>选书</button>}<div><span className="lectern-mode"><Icon name="lectern"/>讲台阅读</span><h1>{note?.title|| (note?'未命名笔记':'讲台上还没有书')}</h1></div></header>
   {note?<BookEditor key={note.id} note={note} shelves={shelves} readOnly readingDesk searchTerm={searchTerm} onEdit={()=>{}} onAction={()=>{}} onRead={onEdit} onSave={()=>{}} onClose={onClose} status=""/>:<div className="lectern-empty-book"><Icon name="book"/><p>从左侧选择一本笔记</p></div>}
   <footer className="lectern-controls"><button className="pixel-button" disabled={!note||busy} onClick={onEdit}>继续编辑</button><button className="pixel-button" data-sound="semantic" onClick={onClose}>返回书房</button></footer>
  </section>
 </div>
}
