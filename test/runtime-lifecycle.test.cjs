'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
test('resident worker boot without Inbox config does not load keys; every GitHub call loads afresh',async()=>{
 let handler,loads=0,starts=0;const output=[];
 const fakeProcess=new EventEmitter();fakeProcess.stdin=new EventEmitter();fakeProcess.stdout={write:s=>output.push(JSON.parse(s))};fakeProcess.exit=()=>{};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../node/runtime.cjs'),'utf8'),{__dirname:path.join(__dirname,'../node'),process:fakeProcess,Buffer,console,require:name=>{
  if(name==='./rpc-input.cjs')return {createReceiver:options=>{const r=require('../node/rpc-input.cjs').createReceiver(options);handler=line=>r.push(Buffer.from(line+'\n'));return r;}};
  if(name==='./file-upload.cjs')return require('../node/file-upload.cjs');
  if(name==='./store.cjs')return {paths:{root:'synthetic-store'},load:async()=>{loads++;return {privateKey:'synthetic-key'};}};
  if(name==='./core.cjs')return {ACCOUNTS:{bb:{}},createClient:({credentials})=>({run:async args=>{await credentials(args.account);return {ok:true};}})};
  if(name==='./review-queue.cjs')return {createQueue:()=>({})};
  if(name==='./inbox-service.cjs')return {createManager:()=>({start:async()=>{starts++;return {ok:false,errorCode:'CONFIG_REQUIRED'};},stop:async()=>({ok:true})})};
  if(name==='../deployment.json')return {accounts:['bb']};
  if(name==='./repository-policy.cjs')return require('../node/repository-policy.cjs');
  if(name==='./operations.cjs')return {};
  return require(name);
 }});
 assert.equal(starts,1);assert.equal(loads,0);
 for(let id=1;id<=2;id++)await handler(JSON.stringify({id,method:'run',params:{account:'bb',repo:'MontClip',operation:'identity',args:{}}}));
 assert.equal(loads,2);assert.equal(output.length,2);assert.ok(output.every(x=>x.result.ok));
 const input={account:'bb',repo:'MontClip',operation:'update_file',args:{path:'a.txt',branch:'docs/test',message:'test',expected_sha:null}};
 await handler(JSON.stringify({id:3,method:'upload_begin',params:{input,total:4}}));
 const uploadId=output.at(-1).result.uploadId;assert.equal(loads,2);
 await handler(JSON.stringify({id:4,method:'upload_chunk',params:{uploadId,offset:0,content:'aaaa'}}));assert.equal(loads,2);
 await handler(JSON.stringify({id:5,method:'upload_finish',params:{uploadId}}));assert.equal(output.at(-1).result.ok,true);assert.equal(loads,3);
 await handler(JSON.stringify({id:6,method:'upload_finish',params:{uploadId}}));assert.equal(output.at(-1).result.errorCode,'UPLOAD_NOT_FOUND');assert.equal(loads,3);
});
