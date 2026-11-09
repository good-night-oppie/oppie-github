'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function createManager({configPath}){
 let child=null,settings=null,nonce='',lastError=null,serial=Promise.resolve();
 const ordered=fn=>{const p=serial.then(fn,fn);serial=p.catch(()=>{});return p;};
 async function healthy(){if(!child||child.exitCode!==null||!settings)return false;try{const r=await fetch(`http://127.0.0.1:${settings.port}/_oppie_health`,{signal:AbortSignal.timeout(500)});const b=await r.json();return r.ok&&b.instance===nonce&&b.mode==='preview';}catch{return false;}}
 async function status(){const ready=await healthy();return {ok:ready,ready,state:ready?'preview':child?'starting':'stopped',pid:child?.pid||null,url:settings?`http://127.0.0.1:${settings.port}`:null,errorCode:lastError,pipelineEnabled:false};}
 async function stopOwned(){const c=child;if(c){c.stdin.end();await Promise.race([new Promise(r=>c.once('exit',r)),delay(2000)]);if(c.exitCode===null&&!c.killed)c.kill();await Promise.race([new Promise(r=>c.once('exit',r)),delay(1000)]);if(c.exitCode===null){lastError='STOP_FAILED';return {ok:false,ready:false,errorCode:lastError};}if(child===c)child=null;}return {ok:true,ready:false,state:'stopped'};}
 async function start(){return ordered(async()=>{
  if(await healthy())return status();if(child)await stopOwned();
  try{
   const st=await fs.lstat(configPath);if(!st.isFile()||st.isSymbolicLink()||st.size>8192)throw Error('INVALID_CONFIG');
   const c=JSON.parse(await fs.readFile(configPath,'utf8'));if(!c.enabled)throw Error('SERVICE_DISABLED');
   if(Object.keys(c).some(k=>!['enabled','python','port','dataDir','mode'].includes(k))||c.mode!=='preview'||typeof c.python!=='string'||!c.python||!Number.isInteger(c.port)||c.port<1024||c.port>65535||!path.isAbsolute(c.dataDir))throw Error('INVALID_CONFIG');
   // Only a dedicated previously-empty directory can become managed data. Never adopt a live Inbox.
   await fs.mkdir(c.dataDir,{recursive:true});const dataStat=await fs.lstat(c.dataDir);if(dataStat.isSymbolicLink()||!dataStat.isDirectory())throw Error('UNSAFE_DATA_DIR');
   const marker=path.join(c.dataDir,'.oppie-preview');const entries=await fs.readdir(c.dataDir);if(entries.length){if(await fs.readFile(marker,'utf8').catch(()=>'')!=='oppie-preview-v1')throw Error('DATA_DIR_NOT_OWNED');}else await fs.writeFile(marker,'oppie-preview-v1',{flag:'wx'});
   const free=await new Promise(resolve=>{const s=net.createServer();s.once('error',()=>resolve(false));s.listen(c.port,'127.0.0.1',()=>s.close(()=>resolve(true)));});if(!free)throw Error('PORT_IN_USE');
   const vendor=path.resolve(__dirname,'../vendor/review-inbox');await fs.access(path.join(vendor,'server.py')).catch(()=>{throw Error('SUBMODULE_REQUIRED');});
   settings=c;nonce=crypto.randomBytes(24).toString('hex');lastError=null;
   const cproc=spawn(c.python,['-u',path.join(__dirname,'inbox-runner.py'),vendor],{windowsHide:true,stdio:['pipe','pipe','pipe']});child=cproc;
   cproc.stdout.on('data',()=>{});cproc.stderr.on('data',()=>{});cproc.stdin.on('error',()=>{});
   cproc.on('error',()=>{lastError='START_FAILED';if(child===cproc)child=null;});cproc.on('exit',()=>{if(child===cproc){child=null;lastError=lastError||'PROCESS_EXITED';}});
   cproc.stdin.write(JSON.stringify({...c,instance:nonce})+'\n');
   for(let i=0;i<100;i++){if(await healthy())return status();if(!child)throw Error('START_FAILED');await delay(50);}throw Error('HEALTH_TIMEOUT');
  }catch(e){const known=['INVALID_CONFIG','SERVICE_DISABLED','UNSAFE_DATA_DIR','DATA_DIR_NOT_OWNED','PORT_IN_USE','SUBMODULE_REQUIRED','START_FAILED','HEALTH_TIMEOUT'];lastError=e.code==='ENOENT'?'CONFIG_REQUIRED':known.includes(e.message)?e.message:'INVALID_CONFIG';const code=lastError;await stopOwned();lastError=code;return {ok:false,ready:false,errorCode:code};}
 });}
 return {start,status,stop:()=>ordered(stopOwned)};
}
module.exports={createManager};
