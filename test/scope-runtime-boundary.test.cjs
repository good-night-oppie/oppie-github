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
  if(name==='./scope-config.cjs')return require('../node/scope-config.cjs');
  if(name==='./scope-settings.cjs')return require('../node/scope-settings.cjs');
  if(name==='./scope-loader.cjs')return require('../node/scope-loader.cjs');
  if(name==='./store.cjs')return {setAccountResolver:()=>{},paths:{root:'synthetic-store'},load:async()=>{loads++;throw Error('Credentials must not be read');}};
  if(name==='./core.cjs')return require('../node/core.cjs');
  if(name==='./review-queue.cjs')return {createQueue:()=>({})};
  if(name==='./inbox-service.cjs')return {createManager:()=>({start:async()=>({ok:false}),stop:async()=>({ok:true})})};
  if(name==='./messages.cjs')return require('../node/messages.cjs');
  if(name==='./deployment.cjs')return {createDeploymentReader:()=>async()=>({accounts:['bb','deja','qq','reviewinbox'],automaticReviews:false})};
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
// ADR 0003 section 4: the confirmed route accepts admin_update and ruleset_update only; a confirmed
// admin_update goes on to the client (which then reads the key), any other operation is refused first.
test('confirmed route: admin_update passes the gate, other operations are refused before the key',async()=>{
 let handler,loads=0;const output=[];
 const fakeProcess=new EventEmitter();fakeProcess.stdin=new EventEmitter();fakeProcess.stdout={write:s=>output.push(JSON.parse(s))};fakeProcess.exit=()=>{};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../node/runtime.cjs'),'utf8'),{__dirname:path.join(__dirname,'../node'),process:fakeProcess,Buffer,console,require:name=>{
  if(name==='./rpc-input.cjs')return {createReceiver:options=>{const r=require('../node/rpc-input.cjs').createReceiver(options);handler=line=>r.push(Buffer.from(line+String.fromCharCode(10)));return r;}};
  if(name==='./scope-config.cjs')return require('../node/scope-config.cjs');
  if(name==='./scope-settings.cjs')return require('../node/scope-settings.cjs');
  if(name==='./scope-loader.cjs')return require('../node/scope-loader.cjs');
  if(name==='./store.cjs')return {setAccountResolver:()=>{},paths:{root:'synthetic-store'},list:async()=>[],readPrivate:async()=>null,readScopeKey:async()=>null,load:async()=>{loads++;throw Error('stop after the gate');}};
  if(name==='./core.cjs')return require('../node/core.cjs');
  if(name==='./review-queue.cjs')return {createQueue:()=>({})};
  if(name==='./inbox-service.cjs')return {createManager:()=>({start:async()=>({ok:false}),stop:async()=>({ok:true})})};
  if(name==='./messages.cjs')return require('../node/messages.cjs');
  if(name==='./deployment.cjs')return {createDeploymentReader:()=>async()=>({accounts:['bb','deja','qq','reviewinbox'],automaticReviews:false})};
  if(name==='./operations.cjs')return {};
  return require(name);
 }});
 const input={account:'deja',repo:'MontClip',operation:'admin_update',args:{allow_squash_merge:true}};
 await handler(JSON.stringify({jsonrpc:'2.0',id:1,method:'run_confirmed',params:{input,confirmation:'host-call'}}));
 await new Promise(r=>setTimeout(r,50));
 assert.equal(loads,1,'a confirmed admin_update reaches the client');
 await handler(JSON.stringify({jsonrpc:'2.0',id:2,method:'run_confirmed',params:{input:{...input,operation:'comment_issue',args:{number:1,body:'x'}},confirmation:'host-call'}}));
 await handler(JSON.stringify({jsonrpc:'2.0',id:3,method:'run_confirmed',params:{input,confirmation:''}}));
 await new Promise(r=>setTimeout(r,50));
 assert.equal(loads,1,'other operations and a missing confirmation never read the key');
});
