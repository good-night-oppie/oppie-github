'use strict';
// DD (europa, 2026-11-16): deployment.json was loaded with require() at worker start, so edits
// only applied after a restart. The owner needs settings-page changes (accounts, repositories) and
// deployment edits to apply on the next call. This test runs the real runtime.cjs once and changes
// deployment.json and the signed scope configuration underneath the same running instance.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const vm=require('node:vm'),fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const realStore=require('../node/store.cjs');

test('same worker process: deployment.json account edits and settings saves apply to the next call without a restart; automaticReviews only at start',async t=>{
 const dir=await fsp.mkdtemp(path.join(await fsp.realpath(os.tmpdir()),'ogh-hot-'));t.after(()=>fsp.rm(dir,{recursive:true,force:true}));
 await fsp.mkdir(path.join(dir,'node'));
 const deploymentFile=path.join(dir,'deployment.json');
 const writeDeployment=value=>fs.writeFileSync(deploymentFile,typeof value==='string'?value:JSON.stringify(value));
 writeDeployment({accounts:['deja'],automaticReviews:false});
 // Real key store and signed loader; DPAPI replaced by AES-GCM for the test.
 const key=crypto.randomBytes(32);
 const protect=async(data,context)=>{const iv=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(context));return Buffer.concat([iv,c.update(data),c.final(),c.getAuthTag()]);};
 const unprotect=async(data,context)=>{const d=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(0,12));d.setAAD(Buffer.from(context));d.setAuthTag(data.subarray(-16));return Buffer.concat([d.update(data.subarray(12,-16)),d.final()]);};
 const store=realStore.createStore({root:path.join(dir,'private'),platform:'win32',protect,unprotect,checkAcl:async()=>{},tighten:async()=>{}});
 t.after(()=>realStore.setAccountResolver(()=>({})));
 // No network: every GitHub call must stop before fetch in this test.
 const realFetch=globalThis.fetch;let fetched=0;globalThis.fetch=async()=>{fetched++;throw Error('no network');};t.after(()=>{globalThis.fetch=realFetch;});

 let handler;const output=[];
 const fakeProcess=new EventEmitter();fakeProcess.stdin=new EventEmitter();fakeProcess.stdout={write:s=>output.push(JSON.parse(s))};fakeProcess.exit=()=>{};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../node/runtime.cjs'),'utf8'),{__dirname:path.join(dir,'node'),process:fakeProcess,Buffer,console,require:name=>{
  if(name==='./rpc-input.cjs')return {createReceiver:options=>{const r=require('../node/rpc-input.cjs').createReceiver(options);handler=line=>r.push(Buffer.from(line+'\n'));return r;}};
  if(name==='./store.cjs')return {...store,setAccountResolver:realStore.setAccountResolver};
  if(name==='./review-queue.cjs')return {createQueue:()=>({})};
  if(name==='./inbox-service.cjs')return {createManager:()=>({start:async()=>({ok:false}),stop:async()=>({ok:true})})};
  if(name==='./operations.cjs')return {};
  if(name==='../deployment.json')throw Error('deployment.json must not be loaded with require()');
  if(name.startsWith('./'))return require(path.join(__dirname,'../node',name));
  return require(name);
 }});
 let id=0;
 const call=async(method,params={})=>{const n=output.length;await handler(JSON.stringify({jsonrpc:'2.0',id:++id,method,params}));assert.equal(output.length,n+1);return output[n].result;};
 const accounts=async()=>(await call('accounts')).accounts.map(a=>a.account).sort();
 const run=(account,repo='MontClip')=>call('run',{account,repo,operation:'identity',args:{}});

 // 1. Only deja is deployed.
 assert.deepEqual(await accounts(),['deja']);
 assert.equal((await run('bb')).errorCode,'ACCOUNT_NOT_AVAILABLE_ON_THIS_HOST');
 // 2. Edit deployment.json: bb becomes usable on the next call.
 writeDeployment({accounts:['deja','bb'],automaticReviews:false});
 assert.deepEqual(await accounts(),['bb','deja']);
 assert.notEqual((await run('bb')).errorCode,'ACCOUNT_NOT_AVAILABLE_ON_THIS_HOST');
 // automaticReviews is an owner safety switch (QQ review of #33): read once at worker start, so
 // editing deployment.json cannot switch automatic reviews on in a running plugin.
 assert.equal((await call('review',{action:'bogus'})).errorCode,'AUTOMATION_DISABLED_BY_OWNER');
 writeDeployment({accounts:['deja','bb'],automaticReviews:true});
 assert.equal((await call('review',{action:'bogus'})).errorCode,'AUTOMATION_DISABLED_BY_OWNER');
 writeDeployment({accounts:['deja','bb'],automaticReviews:false});
 assert.equal((await call('accounts')).scopeConfig.source,'default');
 // 3. Settings page: add AD (identity only); the next call uses it. Repositories are not listed
 // locally any more (owner 2026-11-16): GitHub decides, so any well-formed name reaches the key step.
 assert.equal((await run('ad')).errorCode,'ACCOUNT_NOT_AVAILABLE_ON_THIS_HOST');
 const read=await call('settings/read');assert.equal(read.ok,true);assert.equal(read.revision,0);
 const {schemaVersion,revision,...base}=read.config;
 const config={...base,accounts:[...base.accounts,'ad'],newAccounts:{ad:{appId:5764947,appName:'ADOppieXYZ'}}};
 const plan=await call('settings/propose',{config,expectedRevision:0});assert.equal(plan.ok,true,plan.errorCode);
 const saved=await call('settings/save',{config,expectedRevision:0,hash:plan.hash});assert.equal(saved.ok,true,saved.errorCode);assert.equal(saved.revision,1);
 assert.deepEqual(await accounts(),['ad','bb','deja']);
 assert.equal((await call('accounts')).scopeConfig.source,'file');
 const ad=await run('ad');assert.ok(!['ACCOUNT_NOT_AVAILABLE_ON_THIS_HOST','ACCOUNT_REQUIRED'].includes(ad.errorCode),ad.errorCode);
 assert.notEqual((await run('deja','new-repo')).errorCode,'REPOSITORY_NOT_ALLOWED');
 // 4. Disabling an account in the settings page also applies on the next call.
 const read2=await call('settings/read');const {schemaVersion:_s,revision:_r,...base2}=read2.config;
 const config2={...base2,accounts:base2.accounts.filter(a=>a!=='ad')};
 const plan2=await call('settings/propose',{config:config2,expectedRevision:1});assert.equal(plan2.ok,true,plan2.errorCode);
 assert.equal((await call('settings/save',{config:config2,expectedRevision:1,hash:plan2.hash})).ok,true);
 assert.equal((await run('ad')).errorCode,'ACCOUNT_NOT_AVAILABLE_ON_THIS_HOST');
 // 5. A broken deployment.json fails closed on the next call and recovers when fixed.
 writeDeployment('{broken');
 assert.equal((await run('deja')).errorCode,'ACCOUNT_NOT_AVAILABLE_ON_THIS_HOST');
 assert.deepEqual(await accounts(),[]);
 writeDeployment({accounts:['deja'],automaticReviews:false});
 assert.deepEqual(await accounts(),['deja']);
 // 6. QQ review of #33: after a save, deleting both scope-config.json and scope-config.key must not
 // silently revert to the compiled defaults (which would undo the owner's restrictions).
 fs.unlinkSync(path.join(dir,'private','scope-config.json'));fs.unlinkSync(path.join(dir,'private','scope-config.key'));
 const gone=await run('deja','new-repo');assert.equal(gone.errorCode,'INVALID_SCOPE_CONFIGURATION');assert.equal(gone.execution,'not_executed');
 assert.equal((await run('deja')).errorCode,'INVALID_SCOPE_CONFIGURATION');
 assert.deepEqual((await call('accounts')).scopeConfig,{source:'invalid',error:'INVALID_SCOPE_CONFIGURATION'});
 assert.equal((await call('settings/read')).source,'invalid');
 assert.equal(fetched,0,'no GitHub request was attempted');
});

test('deployment reader validates every read and never caches',async t=>{
 const {createDeploymentReader,parse}=require('../node/deployment.cjs');
 let reads=0;const files=[JSON.stringify({accounts:['bb']}),JSON.stringify({accounts:['bb','qq'],automaticReviews:true})];
 const read=createDeploymentReader('x',{readFile:async()=>Buffer.from(files[Math.min(reads++,1)])});
 assert.deepEqual([...(await read()).accounts],['bb']);
 assert.deepEqual([...(await read()).accounts],['bb','qq']);assert.equal(reads,2);
 for(const bad of ['[]','{}','{"accounts":"bb"}','{"accounts":["BB"]}','{"accounts":["bb","bb"]}','{"accounts":["bb"],"automaticReviews":"yes"}'])assert.throws(()=>parse(bad),bad);
 const missing=createDeploymentReader(path.join(os.tmpdir(),'ogh-missing-'+crypto.randomUUID()+'.json'));
 assert.deepEqual({...(await missing())},{accounts:[],automaticReviews:false,error:'INVALID_DEPLOYMENT'});
});

test('automaticReviews is taken from deployment.json as it was when the worker started',async t=>{
 const dir=await fsp.mkdtemp(path.join(await fsp.realpath(os.tmpdir()),'ogh-auto-'));t.after(()=>fsp.rm(dir,{recursive:true,force:true}));
 await fsp.mkdir(path.join(dir,'node'));
 const file=path.join(dir,'deployment.json');fs.writeFileSync(file,JSON.stringify({accounts:['deja'],automaticReviews:true}));
 let handler;const output=[];
 const fakeProcess=new EventEmitter();fakeProcess.stdin=new EventEmitter();fakeProcess.stdout={write:s=>output.push(JSON.parse(s))};fakeProcess.exit=()=>{};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../node/runtime.cjs'),'utf8'),{__dirname:path.join(dir,'node'),process:fakeProcess,Buffer,console,require:name=>{
  if(name==='./rpc-input.cjs')return {createReceiver:options=>{const r=require('../node/rpc-input.cjs').createReceiver(options);handler=line=>r.push(Buffer.from(line+'\n'));return r;}};
  if(name==='./store.cjs')return {setAccountResolver:()=>{},paths:{root:path.join(dir,'private')},list:async()=>[],load:async()=>{throw Error('no key');}};
  if(name==='./review-queue.cjs')return {createQueue:()=>({})};
  if(name==='./inbox-service.cjs')return {createManager:()=>({start:async()=>({ok:false}),stop:async()=>({ok:true})})};
  if(name==='./operations.cjs')return {};
  if(name.startsWith('./'))return require(path.join(__dirname,'../node',name));
  return require(name);
 }});
 const review=async()=>{const n=output.length;await handler(JSON.stringify({jsonrpc:'2.0',id:n+1,method:'review',params:{action:'bogus'}}));return output[n].result.errorCode;};
 assert.equal(await review(),'INVALID_REVIEW_ACTION','enabled at start: reaches the action check');
 fs.writeFileSync(file,JSON.stringify({accounts:['deja'],automaticReviews:false}));
 assert.equal(await review(),'INVALID_REVIEW_ACTION','a later edit does not change the running worker');
});
