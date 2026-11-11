'use strict';
const crypto=require('node:crypto');
const MAX_CONTENT=700000, CHUNK_SIZE=65536, MAX_UPLOADS=4, TTL_MS=120000;
function fail(code){const e=Error(code);e.code=code;e.execution='not_executed';throw e;}
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('INVALID_UPLOAD');}
function createUploads({run,accounts,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,random=()=>crypto.randomBytes(16).toString('hex')}={}){
 const pending=new Map();
 const drop=id=>{const u=pending.get(id);if(u?.timer)clearTimer(u.timer);pending.delete(id);};
 const sweep=()=>{for(const [id,u] of pending)if(now()>=u.expires)drop(id);};
 const get=id=>{sweep();if(typeof id!=='string'||!pending.has(id))fail('UPLOAD_NOT_FOUND');return pending.get(id);};
 return {
  async handle(method,args){
   sweep();
   if(method==='upload_begin'){
    exact(args,['input','total']);exact(args.input,['account','repo','operation','args']);
    const input=args.input;
    if(!accounts.includes(input.account))fail('ACCOUNT_NOT_AVAILABLE_ON_THIS_HOST');
    if(input.account==='qq'||input.account==='reviewinbox')fail('OPERATION_NOT_ALLOWED');
    if(input.operation!=='update_file'||typeof input.repo!=='string')fail('INVALID_UPLOAD');
    exact(input.args,['path','branch','expected_sha','message']);
    if(!Number.isSafeInteger(args.total)||args.total<0||args.total>MAX_CONTENT)fail('FILE_TOO_LARGE');
    if(Buffer.byteLength(JSON.stringify(input))>8192)fail('UPLOAD_METADATA_TOO_LARGE');
    if(pending.size>=MAX_UPLOADS)fail('UPLOAD_CAPACITY');
    const id=random();if(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id)||pending.has(id))fail('UPLOAD_ID_UNAVAILABLE');
    const timer=setTimer(()=>drop(id),TTL_MS);timer?.unref?.();
    pending.set(id,{input:JSON.parse(JSON.stringify(input)),total:args.total,body:'',expires:now()+TTL_MS,timer});
    return {ok:true,uploadId:id};
   }
   exact(args,method==='upload_chunk'?['uploadId','offset','content']:['uploadId']);
   const u=get(args.uploadId);
   if(method==='upload_abort'){drop(args.uploadId);return {ok:true};}
   if(method==='upload_chunk'){
    if(args.offset!==u.body.length||typeof args.content!=='string'||!args.content.length||args.content.length>CHUNK_SIZE||!/^[A-Za-z0-9+/=]+$/.test(args.content)||u.body.length+args.content.length>u.total){drop(args.uploadId);fail('INVALID_UPLOAD_CHUNK');}
    u.body+=args.content;return {ok:true,received:u.body.length};
   }
   if(method==='upload_finish'){
    drop(args.uploadId); // Consume before any awaited write; never replay a commit.
    if(u.body.length!==u.total)fail('UPLOAD_INCOMPLETE');
    return run({...u.input,args:{...u.input.args,content_base64:u.body}});
   }
   fail('UNKNOWN_METHOD');
  },
  stats(){sweep();return {count:pending.size,chars:[...pending.values()].reduce((n,u)=>n+u.body.length,0)};},
 };
}
module.exports={createUploads,MAX_CONTENT,CHUNK_SIZE,MAX_UPLOADS,TTL_MS};
