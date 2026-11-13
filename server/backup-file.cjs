const path=require('node:path');
const {Worker}=require('node:worker_threads');

// File data stays off Electron's UI thread and never crosses renderer IPC.
function backupFileTask(operation,directory,file){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(path.join(__dirname,'backup-worker.cjs'),{workerData:{operation,directory,file}});let settled=false,message;
    worker.once('message',value=>{message=value;});
    worker.once('error',error=>{settled=true;reject(error);});
    worker.once('exit',code=>{if(settled)return;if(message&&!code){message.error?reject(new Error(message.error)):resolve(message.result);}else reject(new Error(`备份处理意外退出 (${code})，未确认恢复成功`));});
  });
}
module.exports={backupFileTask};
