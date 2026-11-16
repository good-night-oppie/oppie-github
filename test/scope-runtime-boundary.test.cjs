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
// #39: the worker never stores a key from a file without the two steps main.js runs around the owner's
// card. A call without a phase, with extra fields or with a store step lacking a proper hash is refused
// before the file is read or the key store is touched.
test('file import (#39): no phase, extra fields or a store step without a hash are refused before the file is read',async()=>{
 let handler,touched=0;const output=[];
 const fakeProcess=new EventEmitter();fakeProcess.stdin=new EventEmitter();fakeProcess.stdout={write:s=>output.push(JSON.parse(s))};fakeProcess.exit=()=>{};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../node/runtime.cjs'),'utf8'),{__dirname:path.join(__dirname,'../node'),process:fakeProcess,Buffer,console,require:name=>{
  if(name==='./rpc-input.cjs')return {createReceiver:options=>{const r=require('../node/rpc-input.cjs').createReceiver(options);handler=line=>r.push(Buffer.from(line+String.fromCharCode(10)));return r;}};
  if(name==='node:fs/promises')return {lstat:async()=>{touched++;throw Error('the file must not be read');},readFile:async()=>{touched++;throw Error('the file must not be read');}};
  if(name==='./store.cjs')return {setAccountResolver:()=>{},paths:{root:'synthetic-store'},importKey:async()=>{touched++;throw Error('nothing may be stored');},load:async()=>{touched++;throw Error('no key read');}};
  if(['./scope-config.cjs','./scope-settings.cjs','./scope-loader.cjs','./core.cjs','./messages.cjs'].includes(name))return require('../node/'+name.slice(2));
  if(name==='./review-queue.cjs')return {createQueue:()=>({})};
  if(name==='./inbox-service.cjs')return {createManager:()=>({start:async()=>({ok:false}),stop:async()=>({ok:true})})};
  if(name==='./deployment.cjs')return {createDeploymentReader:()=>async()=>({accounts:['ad'],automaticReviews:false})};
  if(name==='./operations.cjs')return {};
  return require(name);
 }});
 const file={account:'ad',pem_path:'C:/keys/ad.pem'};
 const requests=[{...file},{...file,phase:'store'},{...file,phase:'store',hash:'not-a-hash'},{...file,phase:'inspect',confirmed:true},{...file,phase:'save'}];
 for(const [id,params] of requests.entries())await handler(JSON.stringify({jsonrpc:'2.0',id,method:'import',params}));
 assert.equal(touched,0);assert.equal(output.length,requests.length);
 for(const r of output){assert.equal(r.result?.ok??r.ok,false,JSON.stringify(r));assert.equal(r.result?.errorCode??r.error?.code,'INVALID_IMPORT',JSON.stringify(r));}
});
test('file import (#39): the key is stored only with the hash of what the owner was shown',async()=>{
 const crypto=require('node:crypto');
 const pem=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
 const remote={app_id:5764947,app_slug:'adoppiexyz',installation_id:182084517,installationRepositorySelection:'all',installationPermissions:{contents:'write',metadata:'read'},installationRepositories:{complete:true,repositories:['good-night-oppie/MontClip']}};
 let handler;const output=[],stored=[];
 const fakeProcess=new EventEmitter();fakeProcess.stdin=new EventEmitter();fakeProcess.stdout={write:s=>output.push(JSON.parse(s))};fakeProcess.exit=()=>{};
 const loader=async()=>({accounts:['ad'],newAccounts:{}});loader.load=loader;loader.current=()=>({newAccounts:{}});loader.paths={configPath:'synthetic-config'};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../node/runtime.cjs'),'utf8'),{__dirname:path.join(__dirname,'../node'),process:fakeProcess,Buffer,console,require:name=>{
  if(name==='./rpc-input.cjs')return {createReceiver:options=>{const r=require('../node/rpc-input.cjs').createReceiver(options);handler=line=>r.push(Buffer.from(line+String.fromCharCode(10)));return r;}};
  if(name==='node:fs/promises')return {lstat:async()=>({isFile:()=>true,isSymbolicLink:()=>false,size:pem.length}),readFile:async()=>Buffer.from(pem)};
  if(name==='./store.cjs')return {setAccountResolver:()=>{},paths:{root:'synthetic-store'},importKey:async a=>{stored.push(a);return {account:'ad',fingerprint:a.expected_fingerprint};}};
  if(name==='./scope-loader.cjs')return {createSignedLoader:()=>loader};
  if(name==='./core.cjs')return {...require('../node/core.cjs'),configuredAccount:()=>({account:'ad'}),createClient:()=>({run:async()=>({ok:true,result:remote})})};
  if(['./scope-config.cjs','./scope-settings.cjs','./messages.cjs'].includes(name))return require('../node/'+name.slice(2));
  if(name==='./review-queue.cjs')return {createQueue:()=>({})};
  if(name==='./inbox-service.cjs')return {createManager:()=>({start:async()=>({ok:false}),stop:async()=>({ok:true})})};
  if(name==='./deployment.cjs')return {createDeploymentReader:()=>async()=>({accounts:['ad'],automaticReviews:false})};
  if(name==='./operations.cjs')return {};
  return require(name);
 }});
 const file={account:'ad',pem_path:'C:/keys/ad.pem'};
 await handler(JSON.stringify({jsonrpc:'2.0',id:1,method:'import',params:{...file,phase:'inspect'}}));
 const seen=output[0].result;assert.equal(seen.ok,true,JSON.stringify(output[0]));assert.match(seen.hash,/^[0-9a-f]{64}$/);assert.ok(seen.card.includes('私钥指纹'));assert.equal(stored.length,0,'inspect stores nothing');
 await handler(JSON.stringify({jsonrpc:'2.0',id:2,method:'import',params:{...file,phase:'store',hash:'0'.repeat(64)}}));
 assert.equal(output[1].result?.errorCode??output[1].error?.code,'PROPOSAL_CHANGED');assert.equal(stored.length,0,'a different hash stores nothing');
 await handler(JSON.stringify({jsonrpc:'2.0',id:3,method:'import',params:{...file,phase:'store',hash:seen.hash}}));
 assert.equal(output[2].result.ok,true,JSON.stringify(output[2]));assert.equal(stored.length,1);
});
