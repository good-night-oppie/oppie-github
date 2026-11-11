'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {EventEmitter}=require('node:events');
const policyModule=require('../node/repository-policy.cjs');
function fixture({invalid=false}={}){
 let handler,saves=0,reads=0;const outputs=[],calls=[],clients=[];
 const policy=structuredClone(policyModule.initialPolicy());policy.revision=9;policy.accounts.deja.execution={'oppie-github':1451885379};
 const validated=invalid?{}:policyModule.validatePolicy(policy);
 const provider=()=>{reads++;return validated;};
 const proc=new EventEmitter();proc.stdin=new EventEmitter();proc.stdout={write:s=>outputs.push(JSON.parse(s))};proc.exit=()=>{};
 const imports=[];
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../node/runtime.cjs'),'utf8'),{__dirname:path.join(__dirname,'../node'),process:proc,Buffer,console,require:name=>{
  if(name==='./rpc-input.cjs')return {createReceiver:options=>{const r=require('../node/rpc-input.cjs').createReceiver(options);handler=line=>r.push(Buffer.from(line+'\n'));return r;}};
  if(name==='./repository-policy.cjs')return {...policyModule,initialPolicy:provider};
  if(name==='node:fs/promises')return {lstat:async()=>({isFile:()=>true,isSymbolicLink:()=>false,size:10}),readFile:async()=>Buffer.from('synthetic')};
  if(name==='node:crypto')return {createPrivateKey:()=>({}),createPublicKey:()=>({export:()=>Buffer.from('public')}),createHash:()=>({update:()=>({digest:()=> 'fingerprint'})})};
  if(name==='./store.cjs')return {paths:{root:'synthetic-store'},list:async()=>[],load:async()=>({privateKey:'synthetic'}),importKey:async input=>{saves++;imports.push(input);return {fingerprint:'fingerprint'};}};
  if(name==='./core.cjs')return {ACCOUNTS:{deja:{},qq:{}},createClient:options=>{clients.push(options);return {run:async input=>{const snapshot=options.repositoryPolicy?.();calls.push({input,snapshot});if(!snapshot?.accounts?.[input.account]?.execution?.[input.repo])return {ok:false,errorCode:'WRONG_RUNTIME_POLICY'};return {ok:true,result:{app_slug:'synthetic'}};}};}};
  if(name==='./review-queue.cjs')return {createQueue:()=>({})};
  if(name==='./inbox-service.cjs')return {createManager:()=>({start:async()=>({ok:false}),stop:async()=>({ok:true})})};
  if(name==='../deployment.json')return {accounts:['deja','qq']};
  if(name==='./operations.cjs')return {};
  return require(name);
 }});
 return {clients,calls,outputs,provider,saves:()=>saves,reads:()=>reads,send:async(method,params)=>handler(JSON.stringify({id:1,method,params}))};
}
test('normal and confirmed clients use the same compiled policy provider',async()=>{
 const f=fixture();await f.send('run',{account:'deja',repo:'oppie-github',operation:'identity',args:{}});
 await f.send('run_confirmed',{input:{account:'qq',repo:'oppie-github',operation:'ruleset_update',args:{}},confirmation:'synthetic'});
 assert.equal(f.outputs.length,2);assert.ok(f.outputs.every(r=>r.result.ok));assert.equal(f.clients[0].repositoryPolicy,f.provider);assert.equal(f.clients[1].repositoryPolicy,f.provider);
});
test('import selects an allowed repository and pins one validated policy snapshot',async()=>{
 const f=fixture();await f.send('import',{account:'deja',pem_path:path.resolve('synthetic.pem')});
 assert.equal(f.outputs[0].result.ok,true);assert.equal(f.calls[0].input.repo,'oppie-github');assert.equal(f.calls[0].snapshot.revision,9);assert.ok(Object.isFrozen(f.calls[0].snapshot));assert.equal(f.reads(),1);assert.equal(f.saves(),1);
});
test('invalid import policy fails closed before credentials are persisted',async()=>{
 const f=fixture({invalid:true});await f.send('import',{account:'deja',pem_path:path.resolve('synthetic.pem')});assert.equal(f.outputs[0].result.ok,false);assert.equal(f.outputs[0].result.errorCode,'INVALID_SCOPE_CONFIGURATION');assert.equal(f.saves(),0);
});
