'use strict';
const PARAM_BYTES=261120, LINE_BYTES=327680;
const printable=s=>[...s].map(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127?' ':c).join('');
function createReceiver({dispatch,reply,describe=r=>r}){
 let pending=Buffer.alloc(0),dropping=false,active=0;
 const receive=async line=>{
  let r;try{r=JSON.parse(line);if(!r||typeof r!=='object'||Array.isArray(r)||!['string','number'].includes(typeof r.id)||typeof r.method!=='string')throw Error();}
  catch{reply({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid request'}});return;}
  if(r.params!==undefined&&r.params!==null&&(typeof r.params!=='object'||Array.isArray(r.params))){reply({jsonrpc:'2.0',id:r.id,result:{ok:false,errorCode:'INVALID_PARAMS',execution:'not_executed'}});return;}
  if(Buffer.byteLength(JSON.stringify(r.params??{}))>PARAM_BYTES){reply({jsonrpc:'2.0',id:r.id,result:{ok:false,errorCode:'REQUEST_TOO_LARGE',execution:'not_executed'}});return;}
  if(active>=32){reply({jsonrpc:'2.0',id:r.id,result:{ok:false,errorCode:'REQUEST_CAPACITY',execution:'not_executed'}});return;}
  active++;
  try{const host=r.cindy&&typeof r.cindy==='object'&&!Array.isArray(r.cindy)?r.cindy:undefined;const result=await dispatch(r.method,r.params||{},host);reply({jsonrpc:'2.0',id:r.id,result:describe(result)});}
  catch(e){const code=typeof e.code==='string'&&/^[A-Z_]+$/.test(e.code)?e.code:'REQUEST_FAILED';
   // Only a configuration failure reason is passed on (bounded text, no exception message or stack).
   const reason=code!=='REQUEST_FAILED'&&typeof(e.details?.reason??e.reason)==='string'?printable(String(e.details?.reason??e.reason)).slice(0,200):undefined;
   reply({jsonrpc:'2.0',id:r.id,result:describe({ok:false,errorCode:code,execution:e.execution==='not_executed'?'not_executed':['accounts','operations','author_cue'].includes(r.method)?'not_executed':'unknown',message:'请求未执行或未完成；写操作结果未知时先读回，不自动重试。',...(reason?{details:{reason}}:{})})});}
  finally{active--;}
 };
 return {
  push(chunk){
   const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);const jobs=[];let start=0;
   while(start<buffer.length){
    const end=buffer.indexOf(10,start),stop=end<0?buffer.length:end,part=buffer.subarray(start,stop);
    if(!dropping){
     if(pending.length+part.length>LINE_BYTES){pending=Buffer.alloc(0);dropping=true;reply({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Request line too large'}});}
     else if(part.length)pending=Buffer.concat([pending,part],pending.length+part.length);
    }
    if(end<0)break;
    if(!dropping)jobs.push(receive(pending.toString('utf8')));
    pending=Buffer.alloc(0);dropping=false;start=end+1;
   }
   return Promise.all(jobs);
  },
  bufferedBytes(){return pending.length;},
 };
}
module.exports={createReceiver,PARAM_BYTES,LINE_BYTES};
