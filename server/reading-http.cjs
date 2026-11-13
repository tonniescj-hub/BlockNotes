// Shared byte-range delivery for original PDFs; no file paths cross the renderer boundary.
function documentResponse(store,id,range){
 const file=store.reading.file(id);let start=0,end=file.size-1,status=200;
 if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||!m[1]&&!m[2])return new Response(null,{status:416,headers:{'Content-Range':`bytes */${file.size}`}});if(!m[1])start=Math.max(0,file.size-Number(m[2]));else{start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}if(start>end||start>=file.size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${file.size}`}});status=206;}
 const iterator=file.chunks(start,end),stream=new ReadableStream({pull(controller){const next=iterator.next();if(next.done)controller.close();else controller.enqueue(next.value);},cancel(){iterator.return?.();}});
 return new Response(stream,{status,headers:{'Content-Type':file.kind==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Cache-Control':'no-store',...(status===206?{'Content-Range':`bytes ${start}-${end}/${file.size}`}:{})}});
}
module.exports={documentResponse};
