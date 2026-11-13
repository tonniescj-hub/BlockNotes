const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
function readingFileTask(operation,directory,input,options={}){
 return new Promise((resolve,reject)=>{
  const worker=new Worker(__filename,{workerData:{operation,directory,input}});let settled=false,message;
  const finish=(error,result)=>{if(settled)return;settled=true;options.signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
  const abort=()=>{worker.terminate().then(()=>finish(new Error('导入已取消；若提交已完成，资料会保留在书架中')));};
  if(options.signal?.aborted){abort();return;}options.signal?.addEventListener('abort',abort,{once:true});
  worker.on('message',m=>{if(m.progress)options.onProgress?.(m.progress);else message=m;});worker.once('error',e=>finish(e));worker.once('exit',code=>{if(message&&!code)finish(message.error?new Error(message.error):null,message.result);else if(!settled)finish(new Error('文档处理已中断（'+code+'）'));});
 });
}
if(!isMainThread){(async()=>{let store;try{const {operation,directory,input}=workerData;const {openStore}=require('./storage.cjs');
 if(operation==='search'){store=openStore(directory,{dailyBackup:false});parentPort.postMessage({result:store.run('reading.search',input)});return;}
 const files=require('./reading-files.cjs');
 if(operation==='import'){const {parsed,bytes}=await files.parseDocument(input.file,progress=>parentPort.postMessage({progress}));if(input.title)parsed.title=String(input.title).slice(0,500);store=openStore(directory,{dailyBackup:false});parentPort.postMessage({result:store.transaction(()=>store.reading.insert(parsed,bytes,input))});}
 else {store=openStore(directory,{dailyBackup:false});parentPort.postMessage({result:await files.exportWord(store,input)});}
 }catch(e){parentPort.postMessage({error:e.message});}finally{store?.close();}})();}
module.exports={readingFileTask};
