'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
test('resident worker boot without Inbox config does not load keys; every GitHub call loads afresh',async()=>{
 let handler,loads=0,starts=0;const output=[];
 const fakeProcess=new EventEmitter();fakeProcess.stdin=new EventEmitter();fakeProcess.stdout={write:s=>output.push(JSON.parse(s))};fakeProcess.exit=()=>{};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../node/runtime.cjs'),'utf8'),{__dirname:path.join(__dirname,'../node'),process:fakeProcess,Buffer,console,require:name=>{
  if(name==='./rpc-input.cjs')return {createReceiver:options=>{const r=require('../node/rpc-input.cjs').createReceiver(options);handler=line=>r.push(Buffer.from(line+'\n'));return r;}};
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

});
