import {useEditor,EditorContent} from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {TextSelection} from '@tiptap/pm/state'
import {useEffect,useRef,useState} from 'react'
import type {Note,Shelf} from './types'
import {call} from './api'
import {playSound} from './minecraft/sound'
import {BookPageBreak,BookDocument,measurePages} from './BookPageBreak'
export default function BookEditor({note,shelves,wordAvailable=false,onReturnReading,initialPage,onPageChange,readOnly,readingDesk=false,searchTerm,onEdit,onAction,onRead,onSave,onClose,status}:{note:Note;shelves:Shelf[];wordAvailable?:boolean;onReturnReading?:()=>void;initialPage?:number;onPageChange?:(page:number)=>void;readOnly:boolean;readingDesk?:boolean;searchTerm?:string;onEdit:(patch:Partial<Note>)=>void;onAction:(action:string,value?:string)=>void;onRead:()=>void;onSave:()=>void;onClose:()=>void;status:string}){
 const [sources,setSources]=useState<{documentId:string;annotationId:string;title:string;location:string}[]>([])
 useEffect(()=>{let live=true;call('reading.links',{noteId:note.id}).then(r=>{if(live)setSources(r)}).catch(()=>{});return()=>{live=false}},[note.id,note.revision])
 const change=useRef(onEdit);change.current=onEdit
 const lastDocument=useRef<string|null>(null);if(lastDocument.current===null)lastDocument.current=JSON.stringify(note.doc)
 const [tagInput,setTagInput]=useState(''),[metadata,setMetadata]=useState(false),[formatting,setFormatting]=useState(false),[page,setPage]=useState(0),[pageCount,setPageCount]=useState(1)
 const pageCallback=useRef(onPageChange);pageCallback.current=onPageChange
 const restorePage=useRef(initialPage),didRestore=useRef(false)
 const scroll=useRef<HTMLDivElement>(null),reflow=useRef<()=>void>(()=>{})
 const editor=useEditor({extensions:[StarterKit.configure({document:false,heading:{levels:[1,2,3]},link:{openOnClick:false},trailingNode:false}),BookDocument,BookPageBreak],content:note.doc,editable:!readOnly,immediatelyRender:true,onUpdate:({editor})=>{if(!editor.isEditable)return;const doc=editor.getJSON(),serialized=JSON.stringify(doc);if(serialized===lastDocument.current)return;lastDocument.current=serialized;change.current({doc,plain:editor.getText()})},editorProps:{attributes:{'aria-label':readOnly?'笔记正文（阅读）':'笔记正文','data-testid':'note-body',tabindex:'0',spellcheck:'false'},handleKeyDown:(view,event)=>{if((event.ctrlKey||event.metaKey)&&!event.isComposing&&(event.key==='Home'||event.key==='End')){event.preventDefault();const start=event.key==='Home';view.dispatch(view.state.tr.setSelection(start?TextSelection.atStart(view.state.doc):TextSelection.atEnd(view.state.doc)));const box=scroll.current;if(box){box.scrollTop=start?0:box.scrollHeight;setPage(start?0:Math.max(0,Math.ceil(box.scrollHeight/box.clientHeight)-1))}return true}return false}}},[note.id])
 useEffect(()=>{editor?.setEditable(!readOnly)},[editor,readOnly])
 useEffect(()=>{if(!editor)return
  if(searchTerm){const term=searchTerm.trim().split(/\s+/)[0];let found=0;editor.state.doc.descendants((node,pos)=>{if(found||!node.isText)return;const at=node.text?.normalize('NFKC').toLocaleLowerCase().indexOf(term.normalize('NFKC').toLocaleLowerCase())??-1;if(at>=0)found=pos+at});if(found)editor.commands.setTextSelection({from:found,to:found+term.length});editor.commands.scrollIntoView()}
  if(!readOnly&&!searchTerm&&restorePage.current===undefined)editor.commands.focus('end')
 },[editor,note.id,searchTerm,readOnly])
 useEffect(()=>{const box=scroll.current;if(!box)return
  const update=()=>{const height=Math.max(1,box.clientHeight),body=box.querySelector<HTMLElement>('.tiptap');if(!body)return;const count=measurePages(body,height);setPageCount(count);if(!didRestore.current&&restorePage.current!==undefined&&height>1){box.scrollTop=Math.min(restorePage.current,count-1)*height;didRestore.current=true}const currentPage=Math.min(Math.max(0,Math.floor(box.scrollTop/height+.02)),count-1);pageCallback.current?.(currentPage);setPage(Math.min(Math.max(0,Math.floor(box.scrollTop/height+.02)),count-1))}
  reflow.current=update;const ro=new ResizeObserver(update);ro.observe(box);const body=box.querySelector('.tiptap');if(body)ro.observe(body);box.addEventListener('scroll',update);editor?.on('update',update);document.fonts.ready.then(update);update();return()=>{ro.disconnect();box.removeEventListener('scroll',update);editor?.off('update',update)}
 },[editor])
 const turn=(p:number)=>{
  const box=scroll.current;if(!box||!editor)return
  const create=p>=pageCount&&!readOnly
  if(create){editor.commands.insertContentAt(editor.state.doc.content.size,[{type:'bookPageBreak'},{type:'paragraph'}]);reflow.current()}
  box.scrollTo({top:p*box.clientHeight,behavior:'instant'})
  if(!readOnly){
   if(!create){const bounds=box.getBoundingClientRect(),point=editor.view.posAtCoords({left:bounds.left+2,top:bounds.top+2});if(point)editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(point.pos))))}
   // EditorView.focus synchronizes the native caret with the document
   // selection; focusing only the DOM can leave typing on the old sheet.
   editor.view.focus()
  }
  setPage(p);playSound('item.book.page_turn')
 }
 const addTag=()=>{const t=tagInput.trim();if(t&&note.tags.length<30){onEdit({tags:[...new Set([...note.tags,t])]});setTagInput('')}}
 const toolbar=[{label:'粗体',text:'B',active:editor?.isActive('bold'),run:()=>editor?.chain().focus().toggleBold().run()},{label:'斜体',text:'I',active:editor?.isActive('italic'),run:()=>editor?.chain().focus().toggleItalic().run()},{label:'小标题',text:'H₂',active:editor?.isActive('heading'),run:()=>editor?.chain().focus().toggleHeading({level:2}).run()},{label:'列表',text:'≡',active:editor?.isActive('bulletList'),run:()=>editor?.chain().focus().toggleBulletList().run()},{label:'引用',text:'❞',active:editor?.isActive('blockquote'),run:()=>editor?.chain().focus().toggleBlockquote().run()},{label:'代码块',text:'</>',active:editor?.isActive('codeBlock'),run:()=>editor?.chain().focus().toggleCodeBlock().run()}]
 return <div className={'book-spread '+(readOnly?'reading ':'')+(metadata?'metadata-open':'')}>
  {metadata&&!readingDesk&&<aside className="book-meta mc-panel">
   <h3>书名与标签</h3><label className="field-label" htmlFor="note-title">书名</label>
   <input id="note-title" aria-label="笔记标题" className="title-input" placeholder="未命名笔记" maxLength={500} value={note.title} readOnly={readOnly} onChange={e=>onEdit({title:e.target.value})}/>
   <label className="field-label" htmlFor="note-shelf">所在书架</label><select id="note-shelf" aria-label="所在书架" disabled={readOnly} value={note.shelfId} onChange={e=>onAction('move',e.target.value)}>{shelves.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
   <div className="field-label">标签</div><div className="tags">{note.tags.map(t=><button key={t} disabled={readOnly} title="移除标签" onClick={()=>onEdit({tags:note.tags.filter(x=>x!==t)})}>{t}{!readOnly&&' ×'}</button>)}{!note.tags.length&&<span className="muted">无标签</span>}</div>
   {!readOnly&&<div className="tag-input"><input aria-label="添加标签" placeholder="输入标签" maxLength={80} value={tagInput} onChange={e=>setTagInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();addTag()}}}/><button aria-label="确认添加标签" onClick={addTag}>+</button></div>}
   {sources.map((source,i)=><button className="text-button" title={source.location} key={i} onClick={()=>onAction('source',source.documentId+'#'+source.annotationId)}>查看原文：{source.title}</button>)}<div className="book-details"><span>{note.plain.replace(/\s/g,'').length.toLocaleString()} 字 · {note.status==='archived'?'已归档':'书架中'}</span></div>
   <div className="book-actions"><button className="pixel-button" onClick={onRead}>{readOnly?'继续编辑':'放到讲台阅读'}</button><button className="pixel-button" onClick={()=>onAction('export')}>导出 Markdown</button>{!readOnly&&<><button className="pixel-button" onClick={()=>onAction(note.status==='archived'?'restore':'archive')}>{note.status==='archived'?'恢复到书架':'收进归档箱'}</button><button className="pixel-button" onClick={()=>onAction('delete')}>移入回收区…</button></>}<button className="pixel-button" onClick={()=>setMetadata(false)}>收起</button></div>
  </aside>}
  <div className="book-workspace">
   <section className="book-page">
    <header className="page-heading">第 {page+1} 页，共 {pageCount} 页</header>
    <div className="page-scroll" ref={scroll} onKeyDownCapture={e=>{if(readOnly&&!e.nativeEvent.isComposing&&(e.ctrlKey||e.metaKey)&&(e.key==='Home'||e.key==='End')){e.preventDefault();e.stopPropagation();const target=e.key==='Home'?0:pageCount-1;scroll.current?.scrollTo({top:target*(scroll.current?.clientHeight||1),behavior:'instant'});setPage(target)}}}><EditorContent editor={editor}/></div>
    <nav className="page-turns" aria-label="书页翻页"><button className="page-back" aria-label="上一页" title="上一页" disabled={page===0} onClick={()=>turn(page-1)}/><button className="page-forward" aria-label="下一页" title="下一页" disabled={readOnly&&page+1>=pageCount} onClick={()=>turn(page+1)}/></nav>
   </section>
   {formatting&&!readOnly&&<div className="page-toolbar">{toolbar.map(t=><button aria-label={t.label} aria-pressed={t.active} title={t.label} key={t.label} onClick={t.run}>{t.text}</button>)}<button aria-label="撤销" title="撤销 Ctrl+Z" onClick={()=>editor?.chain().focus().undo().run()}>↶</button><button aria-label="重做" title="重做 Ctrl+Shift+Z" onClick={()=>editor?.chain().focus().redo().run()}>↷</button></div>}
   {!readingDesk&&<><div className="book-bottom">{onReturnReading&&<button className="pixel-button" onClick={onReturnReading}>返回阅读</button>}<button className="pixel-button" onClick={()=>onAction('exportWord')}>导出 Word</button>{wordAvailable&&<button className="pixel-button" onClick={()=>onAction('openWord')}>用 WPS / 默认程序打开</button>}<button className="pixel-button" onClick={()=>setMetadata(!metadata)}>书名与标签…</button><button className="pixel-button" data-sound="semantic" onClick={onClose}>完成</button></div>
   <footer className="page-footer"><span className={status.includes('失败')?'save-error':''}>{status}</span>{readOnly?<button className="text-button" onClick={onRead}>继续编辑</button>:<button className="text-button" onClick={()=>setFormatting(!formatting)}>格式…</button>}<button className="text-button" onClick={onSave}>保存</button></footer></>}
  </div>
 </div>
}
