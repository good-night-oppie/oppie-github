'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const BASE=path.join(__dirname,'..');
async function invoke(content,{rejectFinish=false,rejectChunk=false,badReceived=false}={}){
 let handler;const calls=[],replies=[],writes=[],uploads=new Map();let serial=0;
 const request=async r=>{
  calls.push(r);assert.ok(Buffer.byteLength(JSON.stringify(r.params))<=262144,'host params budget');
  if(r.method==='upload_begin'){const id='a'.repeat(31)+(++serial);uploads.set(id,{input:r.params.input,total:r.params.total,body:''});return {ok:true,result:{ok:true,uploadId:id}};}
  if(r.method==='upload_chunk'){if(rejectChunk)return {ok:false,errorCode:'CANCELLED'};const u=uploads.get(r.params.uploadId);assert.equal(r.params.offset,u.body.length);u.body+=r.params.content;return {ok:true,result:{ok:true,received:badReceived?u.body.length+1:u.body.length}};}
  if(r.method==='upload_abort'){uploads.delete(r.params.uploadId);return {ok:true,result:{ok:true}};}
  if(r.method==='upload_finish'){const u=uploads.get(r.params.uploadId);assert.equal(u.body.length,u.total);uploads.delete(r.params.uploadId);if(rejectFinish)return {ok:false,errorCode:'TIMEOUT'};writes.push({...u.input,args:{...u.input.args,content_base64:u.body}});return {ok:true,result:{ok:true}};}
  if(r.method==='run'){writes.push(r.params);return {ok:true,result:{ok:true}};}
  throw Error('unexpected method');
 };
 vm.runInNewContext(fs.readFileSync(path.join(BASE,'main.js'),'utf8'),{TextEncoder,cindy:{onHostMessage:f=>handler=f,node:{request},send:async r=>replies.push(r)}});
 const input={account:'cindy',repo:'MontClip',operation:'update_file',args:{path:'CLAUDE.md',branch:'docs/synthetic',expected_sha:'a'.repeat(40),message:'test',content_base64:content}};
 await handler({type:'tool-call',tool:'github',callId:'synthetic-current-call',args:input});return {calls,replies,writes,input};
}
test('reported 260876-byte file crosses bounded host requests and commits once',async()=>{const r=await invoke(Buffer.alloc(260876,7).toString('base64'));assert.equal(r.writes.length,1);assert.deepEqual(r.writes[0],r.input);assert.ok(r.calls.length>1);assert.ok(r.calls.every(c=>c.callId==='synthetic-current-call'&&c.cancelWithCall));});
test('700000 base64 characters fit existing total limit without increasing host limit',async()=>{const r=await invoke('a'.repeat(700000));assert.equal(r.writes.length,1);assert.equal(r.writes[0].args.content_base64.length,700000);});
test('over-total rejected before native call with explicit not-executed result',async()=>{const r=await invoke('a'.repeat(700004));assert.equal(r.calls.length,0);assert.equal(r.replies[0].result.errorCode,'FILE_TOO_LARGE');assert.equal(r.replies[0].result.execution,'not_executed');});
test('uncertain final call is never replayed or called not executed',async()=>{const r=await invoke('a'.repeat(400000),{rejectFinish:true});assert.equal(r.calls.filter(c=>c.method==='upload_finish').length,1);assert.equal(r.replies[0].result.execution,'unknown');});
test('small update_file keeps one original run',async()=>{const r=await invoke('dGVzdA==');assert.equal(r.calls.length,1);assert.equal(r.calls[0].method,'run');});

test('chunk cancellation and malformed acknowledgement abort without a write',async()=>{for(const options of [{rejectChunk:true},{badReceived:true}]){const r=await invoke('a'.repeat(400000),options);assert.equal(r.writes.length,0);assert.equal(r.calls.some(x=>x.method==='upload_finish'),false);assert.equal(r.calls.filter(x=>x.method==='upload_abort').length,1);assert.equal(r.replies[0].result.execution,'not_executed');}});
