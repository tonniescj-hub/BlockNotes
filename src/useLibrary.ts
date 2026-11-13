import {useCallback,useEffect,useRef,useState} from 'react'
import {call} from './api'
import type {Note,Snapshot} from './types'
const RECOVERY='blocknotes.pending.v1'
export default function useLibrary(){
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[status,setStatus]=useState('正在打开书房…'),[error,setError]=useState(''),[dirty,setDirty]=useState(false)
 const beforeClose=useRef<()=>Promise<void>>(async()=>{})
 const current=useRef<Snapshot|null>(null),pending=useRef(new Map<string,{note:Note;version:number}>()),running=useRef<Promise<void>|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),counter=useRef(0)
 const publish=useCallback((s:Snapshot)=>{current.current=s;setSnapshot(s)},[])
 const persistDraft=useCallback(()=>{try{if(pending.current.size)localStorage.setItem(RECOVERY,JSON.stringify([...pending.current.values()].map(v=>v.note)));else localStorage.removeItem(RECOVERY)}catch{setError('草稿恢复缓存不可用。请保持窗口打开直到保存成功。')}},[])
 const refresh=useCallback(async()=>{const s=await call<Snapshot>('snapshot');publish(s);return s},[publish])
 const flush=useCallback(async()=>{
  if(timer.current)clearTimeout(timer.current)
  while(running.current){await running.current;if(!pending.current.size)return}
  const task=(async()=>{while(pending.current.size){
    const [id,entry]=pending.current.entries().next().value!;const stored=current.current?.notes.find(n=>n.id===id);if(!stored)throw new Error('找不到待保存笔记')
    setStatus('正在保存…');setError('')
    try{const saved=await call<Note>('save',{...entry.note,revision:stored.revision})
      const newer=pending.current.get(id)
      if(newer?.version===entry.version)pending.current.delete(id)
      else if(newer)newer.note={...newer.note,revision:saved.revision}
      const s=current.current!;publish({...s,notes:s.notes.map(n=>n.id===id?(pending.current.has(id)?{...n,revision:saved.revision,updatedAt:saved.updatedAt}:saved):n)})
      persistDraft();setDirty(pending.current.size>0)
    }catch(e){setStatus('保存失败 · 草稿已保留');setError(e instanceof Error?e.message:'保存失败');throw e}
  }setStatus('已保存到本机');setDirty(false)})()
  running.current=task;try{await task}finally{if(running.current===task)running.current=null}
 },[publish,persistDraft])
 const edit=useCallback((id:string,patch:Partial<Note>)=>{
  const s=current.current;if(!s)return
  const n=s.notes.find(n=>n.id===id);if(!n)return
  const note={...n,...patch};publish({...s,notes:s.notes.map(n=>n.id===id?note:n)})
  pending.current.set(id,{note,version:++counter.current});persistDraft();setDirty(true);setStatus('待保存…')
  if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>{flush().catch(()=>{})},450)
 },[flush,publish,persistDraft])
 const command=useCallback(async<T=any>(operation:string,input:unknown={})=>{await flush();const result=await call<T>(operation,input);await refresh();return result},[flush,refresh])
 useEffect(()=>{
  let active=true
  refresh().then(async s=>{
    if(!active)return
    // Recovery is additive: never overwrite the authoritative database, even after a crash.
    const cache=localStorage.getItem(RECOVERY)
    if(cache){try{const drafts:Note[]=JSON.parse(cache);for(const draft of drafts){const n=s.notes.find(n=>n.id===draft.id);if(n&&JSON.stringify(n.doc)===JSON.stringify(draft.doc)&&n.title===draft.title&&JSON.stringify(n.tags)===JSON.stringify(draft.tags))continue
      await call('create',{title:(draft.title||'未命名笔记')+'（恢复草稿）',doc:draft.doc,tags:draft.tags,shelfId:s.shelves.some(x=>x.id===draft.shelfId)?draft.shelfId:'main'})}
      localStorage.removeItem(RECOVERY);await refresh();setError('已将上次未完成的编辑恢复为独立草稿，请在书架中查看。')
    }catch(e){setError('恢复草稿未完成，缓存已保留：'+(e instanceof Error?e.message:''))}}
    setStatus('已保存到本机');if(s.backupWarning)setError(s.backupWarning)
  }).catch(e=>{setError(e.message);setStatus('打开失败')})
  return()=>{active=false}
 },[refresh])
 useEffect(()=>{
  const before=(e:BeforeUnloadEvent)=>{if(pending.current.size){persistDraft();e.preventDefault();e.returnValue=''}}
  window.addEventListener('beforeunload',before)
  const unsubscribe=window.blocknotes?.onClose(()=>{beforeClose.current().then(()=>flush()).then(()=>window.blocknotes?.readyToClose()).catch(()=>{})})
  return()=>{window.removeEventListener('beforeunload',before);unsubscribe?.()}
 },[flush,persistDraft])
 return{beforeClose,snapshot,current,status,error,setError,dirty,edit,flush,command,refresh}
}
