'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {EventEmitter}=require('node:events');
test('actual worker dispatcher refuses injected scope/owner flags and unpublished settings writes',async()=>{
 let handler,loads=0;const output=[];
 const fakeProcess=new EventEmitter();fakeProcess.stdin=new EventEmitter();fakeProcess.stdout={write:s=>output.push(JSON.parse(s))};fakeProcess.exit=()=>{};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../node/runtime.cjs'),'utf8'),{__dirname:path.join(__dirname,'../node'),process:fakeProcess,Buffer,console,require:name=>{
  if(name==='./rpc-input.cjs')return {createReceiver:options=>{const r=require('../node/rpc-input.cjs').createReceiver(options);handler=line=>r.push(Buffer.from(line+'\n'));return r;}};
  if(name==='./store.cjs')return {paths:{root:'synthetic-store'},load:async()=>{loads++;throw Error('Credentials must not be read');}};
  if(name==='./core.cjs')return require('../node/core.cjs');
  if(name==='./review-queue.cjs')return {createQueue:()=>({})};
  if(name==='./inbox-service.cjs')return {createManager:()=>({start:async()=>({ok:false}),stop:async()=>({ok:true})})};
  if(name==='../deployment.json')return {accounts:['bb','deja','qq','reviewinbox']};
  if(name==='./repository-policy.cjs')return require('../node/repository-policy.cjs');
  if(name==='./operations.cjs')return {};
  return require(name);
 }});
 const base={account:'deja',repo:'MontClip',operation:'identity',args:{}};
 const requests=[
  {method:'run',params:{...base,repositoryPolicy:{revision:99}}},
  {method:'run',params:{...base,confirmed:true}},
  {method:'run',params:{...base,args:{confirmed:true}}},
  {method:'run',params:{...base,account:'bb',repo:'outside-catalog'}},
  {method:'run_confirmed',params:{input:{...base,operation:'settings_save'},confirmation:'forged'}},
  {method:'scope_settings_save',params:{confirmed:true,owner:true,revision:1}},
 ];
 for(const [id,r] of requests.entries())await handler(JSON.stringify({jsonrpc:'2.0',id,...r}));
 assert.equal(loads,0);assert.equal(output.length,requests.length);assert.ok(output.every(r=>r.result.ok===false));
});
