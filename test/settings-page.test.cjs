'use strict';
// Step 2 (owner, 2026-11-15): add teammate Apps from the plugin settings page, effective without
// restart; private keys only through the settings-page secret field. Owner 2026-11-16: only identity
// and the key are entered; installation, permissions and repositories come from GitHub.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createStore,setAccountResolver}=require('../node/store.cjs');
const {validateConfig,BUILTIN_APP_IDS}=require('../node/scope-config.cjs');
const {createSettings,summarize,describeInstallation,describeInstallationCard}=require('../node/scope-settings.cjs');
const {createSignedLoader}=require('../node/scope-loader.cjs');
const {createClient,ACCOUNTS,configuredAccount}=require('../node/core.cjs');
const pem=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
const AD={appId:5764947,appName:'ADOppieXYZ'};
const REMOTE={app_id:5764947,app_slug:'adoppiexyz',installation_id:182084517,installationRepositorySelection:'all',
 installationPermissions:{contents:'write',issues:'write',metadata:'read',pull_requests:'write'},
 installationRepositories:{complete:true,repositories:['good-night-oppie/MontClip','good-night-oppie/cindy','good-night-oppie/oppie-github']}};

async function fixture(t,{verify}={}){
 const dir=await fsp.mkdtemp(path.join(await fsp.realpath(os.tmpdir()),'ogh-settings-'));t.after(()=>fsp.rm(dir,{recursive:true,force:true}));
 const key=crypto.randomBytes(32);
 const contexts=[];
 const protect=async(data,context)=>{contexts.push(context);const iv=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(context));return Buffer.concat([iv,c.update(data),c.final(),c.getAuthTag()]);};
 const unprotect=async(data,context)=>{const d=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(0,12));d.setAAD(Buffer.from(context));d.setAuthTag(data.subarray(-16));return Buffer.concat([d.update(data.subarray(12,-16)),d.final()]);};
 const root=path.join(dir,'private');
 const store=createStore({root,platform:'win32',protect,unprotect,checkAcl:async()=>{},tighten:async()=>{}});
 const loader=createSignedLoader({store});
 setAccountResolver(()=>loader.current().newAccounts);t.after(()=>setAccountResolver(()=>({})));
 const verifyCalls=[];
 const remote={...REMOTE};
 const verifyKey=async(input)=>{verifyCalls.push(input);return verify?verify(input):{ok:true,result:{...remote}};};
 return {root,store,loader,verifyCalls,remote,contexts,settings:createSettings({store,loader,verifyKey})};
}
const withAd=(extra={})=>({newAccounts:{ad:{...AD,...extra}}});
const plus=(base,name,app)=>({...base,newAccounts:{...base.newAccounts,[name]:app},accounts:[...base.accounts,name]});
async function baseConfig(settings){const b=(await settings.read()).config;delete b.schemaVersion;delete b.revision;return b;}

test('read: defaults and key status, no permission ceilings, no secrets',async t=>{
 const {settings}=await fixture(t);const r=await settings.read();
 assert.equal(r.ok,true);assert.equal(r.source,'default');assert.equal(r.revision,0);
 assert.ok(r.config.accounts.includes('deja'));assert.deepEqual(r.keys,[]);
 assert.deepEqual(Object.keys(r.config).sort(),['accounts','newAccounts','revision','schemaVersion']);
 assert.equal(r.accountOperationCeiling,undefined);assert.equal(r.reviewOperationCeiling,undefined);
});
test('add AD with identity only: summary, confirmation hash, atomic save, hot reload, audit',async t=>{
 const {settings,loader,root}=await fixture(t);
 assert.equal(configuredAccount('ad',await loader()),null);
 const config=plus(await baseConfig(settings),'ad',AD);
 const plan=await settings.propose({config,expectedRevision:0});
 assert.equal(plan.ok,true);assert.equal(plan.nextRevision,1);
 assert.equal(plan.summary,'加账号 ad(App ADOppieXYZ ID 5764947/adoppiexyz)；权限和仓库以 GitHub 上 App 安装为准，导入私钥时显示');
 // A different payload than the one confirmed is refused.
 await assert.rejects(settings.save({config:{...config,newAccounts:{ad:{...AD,appSlug:'other'}}},expectedRevision:0,hash:plan.hash}),{code:'PROPOSAL_CHANGED'});
 assert.equal(fs.existsSync(path.join(root,'scope-config.json')),false);
 const saved=await settings.save({config,expectedRevision:0,hash:plan.hash});
 assert.equal(saved.ok,true);assert.equal(saved.revision,1);
 // Takes effect for the next call: the loader sees AD without any restart; no installation pinned.
 const live=await loader();assert.equal(live.revision,1);const a=configuredAccount('ad',live);
 assert.equal(a.app_id,5764947);assert.equal(a.installation_id,null);assert.equal(a.role,undefined);assert.equal(a.operations,undefined);
 // Stale revision is refused.
 await assert.rejects(settings.propose({config,expectedRevision:0}),{code:'SCOPE_REVISION_CONFLICT'});
 await assert.rejects(settings.save({config,expectedRevision:1,hash:plan.hash}),{code:'PROPOSAL_CHANGED'});
 const audit=fs.readFileSync(path.join(root,'scope-config-audit.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(audit.length,1);assert.equal(audit[0].event,'save');assert.equal(audit[0].revisionAfter,1);assert.equal(audit[0].hash,plan.hash);
 assert.ok(!JSON.stringify(audit).includes(root));
});
test('invalid proposals write nothing: no installation, role, operations or repository lists accepted',async t=>{
 const {settings,root}=await fixture(t);
 const bad=[
  withAd({appId:BUILTIN_APP_IDS[2]}),withAd({installationId:182084517}),withAd({role:'write'}),withAd({operations:['identity']}),
  withAd({appSlug:'Bad Slug'}),{newAccounts:{qq:AD}},{newAccounts:{ad:AD,ae:{...AD,appName:'AE'}}},
  {repositories:{MontClip:1}},{repositoryRoles:{}},{optionalRepositories:[]},{reviewOperations:[]},{unknownKey:1},{accounts:['nobody']},
 ];
 for(const config of bad)await assert.rejects(settings.propose({config,expectedRevision:0}),{code:'INVALID_SCOPE_CONFIGURATION'},JSON.stringify(config));
 await assert.rejects(settings.save({config:{},expectedRevision:0,hash:'0'.repeat(64)}),e=>['PROPOSAL_CHANGED','NO_CHANGES'].includes(e.code));
 const same=await settings.propose({config:{},expectedRevision:0});assert.equal(same.summary,'无变化');
 await assert.rejects(settings.save({config:{},expectedRevision:0,hash:same.hash}),{code:'NO_CHANGES'});
 assert.equal(fs.existsSync(path.join(root,'scope-config.json')),false);
});
test('a broken file is reported and blocks saves until fixed',async t=>{
 const {settings,store}=await fixture(t);
 await store.writePrivate('scope-config.json','{broken');
 const r=await settings.read();assert.equal(r.source,'invalid');assert.equal(r.config,null);
 await assert.rejects(settings.propose({config:withAd(),expectedRevision:0}),{code:'INVALID_SCOPE_CONFIGURATION'});
});
test('import key: inspect reads the remote, store needs the same facts, DPAPI store, never echoed',async t=>{
 const {settings,store,verifyCalls,root,remote}=await fixture(t);
 const config=plus(await baseConfig(settings),'ad',AD);
 const plan=await settings.propose({config,expectedRevision:0});await settings.save({config,expectedRevision:0,hash:plan.hash});
 await assert.rejects(settings.importKey({account:'ad'},undefined),{code:'PRIVATE_KEY_NOT_PROVIDED'});
 await assert.rejects(settings.importKey({account:'ad',pem_path:'/x.pem'},{secrets:{app_private_key:pem}}),{code:'INVALID_IMPORT'});
 await assert.rejects(settings.importKey({account:'ad',phase:'guess'},{secrets:{app_private_key:pem}}),{code:'INVALID_IMPORT'});
 await assert.rejects(settings.importKey({account:'ad'},{secrets:{app_private_key:'not a key'}}),{code:'INVALID_PRIVATE_KEY'});
 const host={secrets:{app_private_key:pem}};
 const seen=await settings.importKey({account:'ad',phase:'inspect'},host);
 assert.equal(seen.ok,true);assert.equal(host.secrets.app_private_key,'','secret cleared after use');
 assert.equal(seen.summary,'账号 ad：App adoppiexyz（ID 5764947），安装 182084517（good-night-oppie，全部仓库 3 个：MontClip,cindy,oppie-github），权限 contents:write,issues:write,metadata:read,pull_requests:write');
 assert.match(seen.hash,/^[0-9a-f]{64}$/);assert.deepEqual(await store.list(),[],'inspect stores nothing');
 assert.equal(verifyCalls.at(-1).account,'ad');assert.equal(verifyCalls.at(-1).config.newAccounts.ad.appId,5764947);
 // Store without the confirmed hash, or after the remote changed, is refused.
 await assert.rejects(settings.importKey({account:'ad'},{secrets:{app_private_key:pem}}),{code:'PROPOSAL_CHANGED'});
 remote.installationPermissions={...remote.installationPermissions,administration:'write'};
 await assert.rejects(settings.importKey({account:'ad',phase:'store',hash:seen.hash},{secrets:{app_private_key:pem}}),{code:'PROPOSAL_CHANGED'});
 assert.deepEqual(await store.list(),[]);
 remote.installationPermissions=REMOTE.installationPermissions;
 const r=await settings.importKey({account:'ad',phase:'store',hash:seen.hash},{secrets:{app_private_key:pem}});
 assert.equal(r.ok,true,r.errorCode);assert.equal(r.installation_id,182084517);assert.equal(r.summary,seen.summary);
 assert.ok(!JSON.stringify(r).includes('PRIVATE KEY'));
 assert.equal((await store.load('ad')).privateKey,pem);
 const raw=fs.readFileSync(path.join(root,'accounts.json'),'utf8');assert.ok(!raw.includes('PRIVATE KEY'));
 const audit=fs.readFileSync(path.join(root,'scope-config-audit.jsonl'),'utf8');assert.ok(!audit.includes('PRIVATE KEY'));assert.match(audit,/"event":"import_key","account":"ad"/);
 // Second import without replace is refused.
 const again=await settings.importKey({account:'ad',phase:'inspect'},{secrets:{app_private_key:pem}});
 await assert.rejects(settings.importKey({account:'ad',phase:'store',hash:again.hash},{secrets:{app_private_key:pem}}),{code:'ACCOUNT_EXISTS'});
});
// ADR 0003 Amendment 1 (PG; Deja agreed): a renamed App (slug differs) still imports; the stored row keeps
// the configured slug, never the live one, so the key store does not start trusting the new name.
test('import key: an App whose slug changed on GitHub still imports, with the configured slug stored',async t=>{
 const {settings,store,remote}=await fixture(t);
 const config=plus(await baseConfig(settings),'ad',AD);
 const plan=await settings.propose({config,expectedRevision:0});await settings.save({config,expectedRevision:0,hash:plan.hash});
 remote.app_slug='ad-renamed';remote.warnings=[{check:'app_slug',expected:'adoppiexyz or oppie-agent-ad',actual:'ad-renamed'}];
 const seen=await settings.importKey({account:'ad',phase:'inspect'},{secrets:{app_private_key:pem}});
 const r=await settings.importKey({account:'ad',phase:'store',hash:seen.hash},{secrets:{app_private_key:pem}});
 assert.equal(r.ok,true,r.errorCode);
 const row=(await store.list()).find(x=>x.account==='ad');assert.equal(row.appSlug,'adoppiexyz');
 assert.equal((await store.load('ad')).privateKey,pem);
});
test('import key: failed GitHub verification stores nothing and passes the reason through',async t=>{
 const {settings,store}=await fixture(t,{verify:()=>({ok:false,errorCode:'INSTALLATION_NOT_FOUND',details:{owner:'good-night-oppie',found:0}})});
 for(const phase of ['inspect','store']){
  const r=await settings.importKey({account:'deja',phase,hash:'0'.repeat(64)},{secrets:{app_private_key:pem}});
  assert.equal(r.errorCode,'INSTALLATION_NOT_FOUND');assert.deepEqual(r.details,{owner:'good-night-oppie',found:0});
 }
 assert.deepEqual(await store.list(),[]);
});
test('confirmation card: selected repositories, long lists shortened, incomplete listing marked',()=>{
 const many=Array.from({length:56},(_,i)=>'good-night-oppie/r'+i);
 const s=describeInstallation('ad',{...REMOTE,installationRepositories:{complete:false,repositories:many}});
 assert.match(s,/全部仓库 56\+ 个：r0,r1,r2,r3,r4 等）/);
 assert.match(describeInstallation('ad',{...REMOTE,installationRepositorySelection:'selected'}),/选定仓库 3 个/);
 assert.ok(('为 '+s+'。确认后用本机 DPAPI 加密保存私钥，并替换已保存的私钥。').length<=900);
});
test('configured account: pinned App ID, custom slug, built-in App IDs refused',()=>{
 const cfg=validateConfig({newAccounts:{ad:{...AD,appSlug:'ad-oppie'}}});
 const a=configuredAccount('ad',cfg);assert.deepEqual([...a.allowed_slugs],['ad-oppie','oppie-agent-ad']);
 assert.deepEqual([...BUILTIN_APP_IDS].sort(),Object.values(ACCOUNTS).map(a=>a.app_id).sort());
});

// main.js bridge: page messages, host confirmation, Node calls.
function bridge({confirm=async()=>({ok:true,confirmed:true}),nodeResult}={}){
 const posted=[],nodeCalls=[],confirms=[];let onmessage;
 class BC{constructor(name){assert.equal(name,'oppie-github-settings');}set onmessage(f){onmessage=f;}postMessage(m){posted.push(m);}}
 const cindy={onHostMessage(){},confirm:async b=>{confirms.push(b);return confirm(b);},send:async()=>{},node:{request:async r=>{nodeCalls.push(r);return {ok:true,result:nodeResult?nodeResult(r):r.method==='settings/propose'?{ok:true,summary:'加账号 ad',hash:'f'.repeat(64),revision:3,nextRevision:4}:{ok:true,revision:4}};}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../main.js'),'utf8'),{cindy,BroadcastChannel:BC,TextEncoder,JSON,Error,Object});
 const send=async m=>{await onmessage({data:m});return posted.at(-1);};
 return {send,posted,nodeCalls,confirms};
}
test('main.js: save needs a confirmed host card and passes the same hash; cancel saves nothing',async()=>{
 const ok=bridge();const r=await ok.send({type:'settings-save',id:'a1',config:{x:1},expectedRevision:3});
 assert.deepEqual(ok.nodeCalls.map(c=>c.method),['settings/propose','settings/save']);
 assert.equal(ok.nodeCalls[1].params.hash,'f'.repeat(64));assert.equal(ok.nodeCalls[1].params.expectedRevision,3);
 assert.match(ok.confirms[0].body,/r3→r4：加账号 ad/);assert.equal(ok.confirms[0].danger,true);assert.equal(r.result.ok,true);
 for(const answer of [{ok:true,confirmed:false},{ok:false,errorCode:'UNAVAILABLE'}]){
  const no=bridge({confirm:async()=>answer});const res=await no.send({type:'settings-save',id:'a2',config:{},expectedRevision:3});
  assert.deepEqual(no.nodeCalls.map(c=>c.method),['settings/propose']);assert.equal(res.result.ok,false);
 }
 const big=bridge({nodeResult:r=>r.method==='settings/propose'?{ok:true,summary:'x'.repeat(400),hash:'f'.repeat(64),revision:0,nextRevision:1}:{ok:true}});
 const tooBig=await big.send({type:'settings-save',id:'a3',config:{},expectedRevision:0});
 assert.equal(tooBig.result.errorCode,'CONFIRMATION_TOO_LARGE');assert.equal(big.confirms.length,0);assert.equal(big.nodeCalls.length,1);
});
test('main.js: key import shows what GitHub reports, stores only after confirmation, no key material in params',async()=>{
 const inspectThenStore=r=>r.params.phase==='inspect'?{ok:true,account:'ad',summary:'账号 ad：App adoppiexyz（ID 5764947），安装 182084517',hash:'e'.repeat(64)}:{ok:true,account:'ad'};
 const b=bridge({nodeResult:inspectThenStore});
 await b.send({type:'settings-import-key',id:'k1',account:'ad',pem:'-----BEGIN PRIVATE KEY-----'});
 assert.equal(b.confirms.length,1);assert.match(b.confirms[0].body,/^为 账号 ad：App adoppiexyz（ID 5764947），安装 182084517。确认后/);
 assert.deepEqual(b.nodeCalls.map(c=>c.method),['settings/import_key','settings/import_key']);
 assert.equal(JSON.stringify(b.nodeCalls[0].params),JSON.stringify({account:'ad',replace:false,phase:'inspect'}));
 assert.equal(JSON.stringify(b.nodeCalls[1].params),JSON.stringify({account:'ad',replace:false,phase:'store',hash:'e'.repeat(64)}));
 const no=bridge({nodeResult:inspectThenStore,confirm:async()=>({ok:true,confirmed:false})});await no.send({type:'settings-import-key',id:'k2',account:'ad'});
 assert.deepEqual(no.nodeCalls.map(c=>c.params.phase),['inspect'],'cancel stores nothing');
 const failed=bridge({nodeResult:()=>({ok:false,errorCode:'INSTALLATION_NOT_FOUND'})});const f=await failed.send({type:'settings-import-key',id:'k5',account:'ad'});
 assert.equal(failed.confirms.length,0);assert.equal(f.result.errorCode,'INSTALLATION_NOT_FOUND');
 const junk=bridge();await junk.send({type:'settings-import-key',id:'k3',account:'../x'});assert.equal(junk.nodeCalls.length,0);
 await junk.send({type:'run',id:'k4'});await junk.send({type:'settings-save',id:'bad id!'});assert.equal(junk.nodeCalls.length,0);
});
// #38 (P1): the host opens a confirmation card only for a body of at most 300 characters. The owner's
// import of ad failed six times because the full summary (every permission) was longer.
const BROAD={actions:'read',actions_variables:'write',administration:'read',artifact_metadata:'read',checks:'read',contents:'write',deployments:'read',discussions:'write',environments:'read',installation_repositories:'write',issues:'write',merge_queues:'read',metadata:'read',pull_requests:'write',repository_hooks:'write',secrets:'write',workflows:'write'};
const MANY={complete:true,repositories:Array.from({length:56},(_,i)=>'good-night-oppie/repository-with-a-long-name-'+i)};
test('import card (#38): an App with many permissions and repositories gets a card within 300 characters',async t=>{
 const wide={...REMOTE,installationPermissions:BROAD,installationRepositories:MANY};
 assert.ok(describeInstallation('ad',wide).length>300,'the full summary is what used to overflow');
 const card=describeInstallationCard('ad',wide);
 assert.ok(card.length<=220,card.length+' '+card);assert.match(card,/全部仓库 56 个，权限 17 项，其中可写/);assert.match(card,/App adoppiexyz（ID 5764947），安装 182084517/);
 // Many write permissions are shortened with a count, never cut mid-word or over the limit.
 const writes=Object.fromEntries(Array.from({length:30},(_,i)=>['permission_number_'+i,'write']));
 const shortened=describeInstallationCard('ad',{...wide,installationPermissions:writes});
 assert.ok(shortened.length<=220,String(shortened.length));assert.match(shortened,/ 等 30 项$/);
 // Inspect returns the card next to the full summary; the store result keeps the full summary.
 const {settings,remote}=await fixture(t);Object.assign(remote,wide);
 const config=plus(await baseConfig(settings),'ad',AD);
 const plan=await settings.propose({config,expectedRevision:0});await settings.save({config,expectedRevision:0,hash:plan.hash});
 const seen=await settings.importKey({account:'ad',phase:'inspect'},{secrets:{app_private_key:pem}});
 // The card the owner confirms names the key too (#39): the same short fingerprint on both import paths.
 const fp=crypto.createHash('sha256').update(crypto.createPublicKey(crypto.createPrivateKey(pem)).export({type:'spki',format:'der'})).digest('hex');
 assert.equal(seen.card,describeInstallationCard('ad',wide,fp));assert.ok(seen.card.includes('私钥指纹 '+fp.slice(0,8)+'…'+fp.slice(-4)));assert.ok(seen.card.length<=220);
 assert.equal(seen.summary,describeInstallation('ad',wide));
 const b=bridge({nodeResult:r=>r.params.phase==='inspect'?seen:{ok:true,account:'ad',summary:seen.summary}});
 const r=await b.send({type:'settings-import-key',id:'w1',account:'ad'});
 assert.equal(b.confirms.length,1);assert.ok(b.confirms[0].body.length<=300,String(b.confirms[0].body.length));assert.ok(b.confirms[0].body.includes(seen.card));
 assert.equal(r.result.ok,true);assert.equal(r.result.summary,seen.summary,'the full summary comes back after confirming');
});
test('import card (#38): an oversized body never reaches the host; a host refusal keeps its own code',async()=>{
 const long={ok:true,account:'ad',summary:'x'.repeat(400),hash:'e'.repeat(64)};
 const big=bridge({nodeResult:r=>r.params.phase==='inspect'?long:{ok:true}});
 const tooBig=await big.send({type:'settings-import-key',id:'w2',account:'ad'});
 assert.equal(tooBig.result.errorCode,'CONFIRMATION_TOO_LARGE');assert.equal(big.confirms.length,0);assert.deepEqual(big.nodeCalls.map(c=>c.params.phase),['inspect']);
 const ok={ok:true,account:'ad',summary:'s',card:'账号 ad：App adoppiexyz',hash:'e'.repeat(64)};
 for(const [type,extra] of [['settings-import-key',{account:'ad'}],['settings-save',{config:{},expectedRevision:3}]]){
  const host=bridge({nodeResult:r=>r.method==='settings/propose'?{ok:true,summary:'加账号 ad',hash:'f'.repeat(64),revision:3,nextRevision:4}:r.params.phase==='inspect'?ok:{ok:true},confirm:async()=>({ok:false,errorCode:'BODY_TOO_LONG'})});
  const res=await host.send({type,id:'w3',...extra});
  assert.equal(res.result.errorCode,'OWNER_CONFIRMATION_UNAVAILABLE',type);assert.equal(JSON.stringify(res.result.details),JSON.stringify({hostErrorCode:'BODY_TOO_LONG'}),type);
  assert.ok(!host.nodeCalls.some(c=>c.method==='settings/save'||c.params?.phase==='store'),type+' stores nothing');
  const odd=bridge({nodeResult:r=>r.method==='settings/propose'?{ok:true,summary:'加账号 ad',hash:'f'.repeat(64),revision:3,nextRevision:4}:r.params.phase==='inspect'?ok:{ok:true},confirm:async()=>({ok:false,errorCode:'bad code <x>'})});
  assert.equal(JSON.stringify((await odd.send({type,id:'w4',...extra})).result.details),JSON.stringify({hostErrorCode:'UNKNOWN'}),type);
 }
});
// #39 (owner, via QQ in #38 6911291761): github_import_key shows the same card before anything is stored.
function toolHost({inspect,confirm=async()=>({ok:true,confirmed:true})}={}){
 const confirms=[],requests=[],sent=[];let handler;
 const card='账号 ad：App adoppiexyz（ID 5764947），私钥指纹 607fe064…a171，安装 182084517，全部仓库 56 个，权限 17 项';
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../main.js'),'utf8'),{cindy:{onHostMessage:f=>handler=f,confirm:async b=>{confirms.push(b);return confirm(b);},send:async m=>sent.push(m),node:{request:async r=>{requests.push(r);return r.params.phase==='inspect'?(inspect?inspect(r):{ok:true,result:{ok:true,account:'ad',summary:'full',card,hash:'d'.repeat(64)}}):{ok:true,result:{ok:true,stored:true}};}}},TextEncoder,JSON,Error,Object});
 const call=async args=>{await handler({type:'tool-call',tool:'github_import_key',callId:'c1',args});return sent.at(-1).result;};
 return {call,confirms,requests,card};
}
test('import by file path (#39): the owner confirms the same card first; only then is the key stored',async()=>{
 const h=toolHost();const r=await h.call({account:'ad',pem_path:'C:/keys/ad.pem'});
 assert.equal(r.ok,true);assert.equal(h.confirms.length,1);assert.ok(h.confirms[0].body.length<=300);assert.ok(h.confirms[0].body.includes(h.card));assert.equal(h.confirms[0].danger,true);
 assert.deepEqual(h.requests.map(x=>[x.method,x.params.phase]),[['import','inspect'],['import','store']]);
 assert.equal(h.requests[1].params.hash,'d'.repeat(64),'the store step carries the hash of what the owner saw');
 assert.ok(!JSON.stringify(h.confirms).includes('C:/keys'),'the card shows no key path');
});
test('import by file path (#39): cancelled, refused or unavailable cards store nothing and keep the host code',async()=>{
 const cancel=toolHost({confirm:async()=>({ok:true,confirmed:false})});
 assert.equal((await cancel.call({account:'ad',pem_path:'C:/keys/ad.pem'})).errorCode,'OWNER_CONFIRMATION_REQUIRED');
 assert.deepEqual(cancel.requests.map(x=>x.params.phase),['inspect']);
 for(const code of ['RATE_LIMITED','BUSY','UNAVAILABLE']){
  const h=toolHost({confirm:async()=>({ok:false,errorCode:code})});const r=await h.call({account:'ad',pem_path:'C:/keys/ad.pem'});
  assert.equal(r.errorCode,'OWNER_CONFIRMATION_UNAVAILABLE',code);assert.equal(r.details.hostErrorCode,code);assert.equal(r.execution,'not_executed');
  assert.deepEqual(h.requests.map(x=>x.params.phase),['inspect'],code+' stores nothing');
 }
 const long=toolHost({inspect:()=>({ok:true,result:{ok:true,card:'x'.repeat(400),hash:'d'.repeat(64)}})});
 assert.equal((await long.call({account:'ad',pem_path:'C:/keys/ad.pem'})).errorCode,'CONFIRMATION_TOO_LARGE');assert.equal(long.confirms.length,0);
 assert.deepEqual(long.requests.map(x=>x.params.phase),['inspect']);
 const failed=toolHost({inspect:()=>({ok:true,result:{ok:false,errorCode:'INSTALLATION_NOT_FOUND',execution:'not_executed'}})});
 assert.equal((await failed.call({account:'ad',pem_path:'C:/keys/ad.pem'})).errorCode,'INSTALLATION_NOT_FOUND');assert.equal(failed.confirms.length,0);
 // A caller cannot skip the card by sending its own phase or hash.
 const forged=toolHost();
 assert.equal((await forged.call({account:'ad',pem_path:'C:/keys/ad.pem',phase:'store',hash:'d'.repeat(64)})).errorCode,'INVALID_REQUEST');
 assert.equal(forged.requests.length,0);assert.equal(forged.confirms.length,0);
});
test('settings page (#38): a failed import says the key was not stored and shows the host code',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../settings.js'),'utf8');
 assert.match(src,/的私钥没有导入；Cindy 显示的「凭证已保存」只是导入用的临时副本，已经清除。/);
 assert.ok(src.includes("'确认框没有打开（Cindy 返回 ' + result.details.hostErrorCode"));
 const m=JSON.parse(fs.readFileSync(path.join(__dirname,'../ghost.json'),'utf8'));
 assert.match(m.node.secretBindings[0].hint,/不代表导入成功/);
});
test('manifest: settings page, key bound only to settings/import_key, tools not blocked by setup',()=>{
 const m=JSON.parse(fs.readFileSync(path.join(__dirname,'../ghost.json'),'utf8'));
 assert.equal(m.settingsHtml,'settings.html');assert.deepEqual(m.setup,{requires:[]});
 assert.deepEqual(m.node.secretBindings.map(b=>[b.key,b.methods]),[['app_private_key',['settings/import_key']]]);
 assert.ok(!m.tools.some(t=>/settings/.test(t.name)),'settings methods are not Agent tools');
 for(const f of ['settings.html','settings.js','settings.css'])assert.ok(fs.existsSync(path.join(__dirname,'..',f)),f);
 assert.ok(!/<script>/.test(fs.readFileSync(path.join(__dirname,'../settings.html'),'utf8')),'no inline script (CSP)');
 const js=fs.readFileSync(path.join(__dirname,'../settings.js'),'utf8');
 assert.ok(!/fetch\('\/kv'/.test(js),'no /kv writes');assert.ok(!/postMessage\([^)]*pem/.test(js),'key never posted over BroadcastChannel');
 const html=fs.readFileSync(path.join(__dirname,'../settings.html'),'utf8');
 for(const gone of ['acc-install-id','acc-role','acc-ops','repo-add'])assert.ok(!html.includes(gone),gone);
});

// QQ review 2026-11-16, item 1: the configuration is signed; hand edits never take effect.
test('signed configuration: hand edits, revision bumps, replays, legacy files and deletions all fail closed',async t=>{
 const {settings,loader,root,store}=await fixture(t);
 const file=path.join(root,'scope-config.json'),keyFile=path.join(root,'scope-config.key');
 const v1=plus(await baseConfig(settings),'ad',AD);
 const p1=await settings.propose({config:v1,expectedRevision:0});await settings.save({config:v1,expectedRevision:0,hash:p1.hash});
 const signedV1=fs.readFileSync(file,'utf8');
 assert.ok(!fs.readFileSync(keyFile,'utf8').includes(JSON.parse(signedV1).hmac),'key file holds only the sealed key');
 const v2=plus(v1,'ae',{appId:5764999,appName:'AEOppieXYZ'});
 const p2=await settings.propose({config:v2,expectedRevision:1});await settings.save({config:v2,expectedRevision:1,hash:p2.hash});
 assert.equal((await loader()).revision,2);
 const client=()=>{let keyReads=0,fetched=0;return {c:createClient({scopeConfig:loader,credentials:async()=>{keyReads++;return pem;},fetch:async()=>{fetched++;throw Error('no network');}}),keyReads:()=>keyReads,fetched:()=>fetched};};
 const refused=async(label)=>{
  for(const [account,operation,repo] of [['bb','identity','MontClip'],['deja','create_branch','second'],['ae','get_pull','MontClip']]){
   const k=client(),r=await k.c.run({account,repo,operation,args:operation==='create_branch'?{branch:'x/y',sha:'a'.repeat(40)}:operation==='get_pull'?{number:1}:{}});
   assert.equal(r.errorCode,'INVALID_SCOPE_CONFIGURATION',label+' '+account);assert.equal(r.execution,'not_executed');assert.equal(k.keyReads(),0,label);assert.equal(k.fetched(),0,label);
  }
  assert.equal((await settings.read()).source,'invalid',label);
 };
 const good=fs.readFileSync(file,'utf8');
 // 1. Edit the signed config text: add an account and bump the revision, keep the old HMAC.
 const env=JSON.parse(good),cfg=JSON.parse(env.config);
 cfg.revision=3;cfg.newAccounts={...cfg.newAccounts,evil:{appId:9999991,appName:'Evil'}};cfg.accounts=[...cfg.accounts,'evil'];
 fs.writeFileSync(file,JSON.stringify({...env,config:JSON.stringify(cfg)}));await refused('edited config + revision+1');
 // 2. Replace with a plain, unsigned (legacy-style) configuration.
 fs.writeFileSync(file,JSON.stringify(cfg));await refused('unsigned legacy file');
 // 3. Replay the older, correctly signed revision 1.
 fs.writeFileSync(file,signedV1);await refused('replayed older signed revision');
 // 4. Delete the configuration after a save.
 fs.unlinkSync(file);await refused('configuration deleted');
 // 5. Signed configuration without its sealed key.
 fs.writeFileSync(file,good);const sealed=fs.readFileSync(keyFile);fs.unlinkSync(keyFile);await refused('sealed key deleted');
 // Restoring the genuine files recovers without a restart.
 fs.writeFileSync(keyFile,sealed);const ok=await loader();assert.equal(ok.revision,2);assert.equal(ok.newAccounts.ae.appId,5764999);
 assert.equal((await settings.read()).source,'file');void store;
});
test('signed configuration: a first save interrupted before the key is sealed fails closed',async t=>{
 const {settings,loader,store}=await fixture(t);
 const v1=plus(await baseConfig(settings),'ad',AD);
 const p1=await settings.propose({config:v1,expectedRevision:0});
 const write=store.writeScopeKey;let calls=0;store.writeScopeKey=async(...a)=>{if(++calls===1)throw Object.assign(Error('crash'),{code:'STORE_WRITE_FAILED'});return write(...a);};
 await assert.rejects(settings.save({config:v1,expectedRevision:0,hash:p1.hash}));
 store.writeScopeKey=write;
 await assert.rejects(loader(),{code:'INVALID_SCOPE_CONFIGURATION'},'no sealed key yet: fail closed');
});
test('confirmation summary: disable, re-enable and change accounts; permissions are never claimed locally',()=>{
 const before=validateConfig({newAccounts:{ad:AD}});
 assert.equal(summarize(before,validateConfig({newAccounts:{ad:AD},accounts:before.accounts.filter(a=>a!=='gg'&&a!=='ad')})),'停用账号 gg,ad');
 assert.equal(summarize(before,validateConfig({newAccounts:{ad:{...AD,appSlug:'ad-new'}}})),'改账号 ad(App ADOppieXYZ ID 5764947/ad-new)；权限和仓库以 GitHub 上 App 安装为准，导入私钥时显示');
 const off=validateConfig({newAccounts:{ad:AD},accounts:before.accounts.filter(a=>a!=='gg')});
 assert.equal(summarize(off,before),'加账号 gg');
});
// QQ review 2026-11-16, item 5: the host never deletes a manual secret after injection.
test('main.js removes the vault copy of an App key at startup and after every import attempt, even when it fails',async()=>{
 const deletes=[];let onmessage;
 class BC{set onmessage(f){onmessage=f;}postMessage(){}}
 const fetch=async(url,init)=>{if(init?.method==='DELETE')deletes.push(url);return {status:204};};
 const node={request:async()=>{throw Error('worker down');}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../main.js'),'utf8'),{cindy:{onHostMessage(){},confirm:async()=>({ok:true,confirmed:true}),send:async()=>{},node},BroadcastChannel:BC,TextEncoder,JSON,Error,Object,fetch,Promise});
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(deletes,['/secrets/app_private_key'],'startup');
 await onmessage({data:{type:'settings-import-key',id:'k1',account:'ad'}});
 assert.deepEqual(deletes,['/secrets/app_private_key','/secrets/app_private_key'],'after a failed import');
});
test('settings page checks for and removes a leftover key copy before loading',()=>{
 const js=fs.readFileSync(path.join(__dirname,'../settings.js'),'utf8');
 assert.match(js,/fetch\('\/secrets'\)/);assert.match(js,/r\.key === 'app_private_key' && r\.saved/);assert.match(js,/clearLeftoverKey\(\)\.finally\(\(\) => load\(\)\)/);
});
test('manifest whenToUse states the current ReviewInbox review events (owner decision 2026-11-15)',()=>{
 const m=JSON.parse(fs.readFileSync(path.join(__dirname,'../ghost.json'),'utf8'));
 assert.ok(!m.whenToUse.includes('仅作 COMMENT'));assert.match(m.whenToUse,/APPROVE/);
});
// QQ review of #33 (scope-loader.cjs:48): deleting both files after a save must not revert to defaults.
test('signed configuration: deleting both files after a save fails closed; never saved still uses defaults',async t=>{
 const {settings,loader,root,store}=await fixture(t);
 // Never saved (only a key import in the audit): no files means the compiled defaults.
 await store.writePrivate('scope-config-audit.jsonl',JSON.stringify({event:'import_key',account:'deja'})+'\n');
 assert.equal((await loader()).revision,0);assert.equal((await settings.read()).source,'default');
 const base=(await settings.read()).config;delete base.schemaVersion;delete base.revision;
 const v1={...base,accounts:base.accounts.filter(a=>a!=='gg')};
 const p1=await settings.propose({config:v1,expectedRevision:0});await settings.save({config:v1,expectedRevision:0,hash:p1.hash});
 assert.equal((await loader()).accounts.includes('gg'),false);assert.equal((await settings.read()).source,'file');
 fs.unlinkSync(path.join(root,'scope-config.json'));fs.unlinkSync(path.join(root,'scope-config.key'));
 await assert.rejects(loader(),e=>e.code==='INVALID_SCOPE_CONFIGURATION'&&/deleted after a save/.test(e.reason));
 const r=await settings.read();assert.equal(r.source,'invalid');assert.equal(r.config,null);
 await assert.rejects(settings.propose({config:v1,expectedRevision:0}),{code:'INVALID_SCOPE_CONFIGURATION'});
 // Documented residual risk: a same-user process that also deletes the audit log gets the defaults.
 fs.unlinkSync(path.join(root,'scope-config-audit.jsonl'));
 assert.equal((await loader()).accounts.includes('gg'),true);
});

// Migration (QQ on #34 5914728822 / 5914736615): a machine that saved the settings page under
// settings.2-6 keeps working after the upgrade, and AD's key imported then stays readable.
const LEGACY_FILE={schemaVersion:1,revision:1,
 repositories:{MontClip:1441621868,'MontClip-Cindy':1446532339},optionalRepositories:['MontClip-Cindy'],twoRepositories:{MontClip:1441621868,'MontClip-Cindy':1446532339},
 repositoryRoles:{MontClip:{ad:'write',qq:'review'},'MontClip-Cindy':{ad:'none'}},reviewOperations:['identity','submit_review'],
 accounts:['bb','cindy','deja','dd','gg','jj','pg','qq','rea','video','vv','reviewinbox','ad'],
 newAccounts:{ad:{...AD,appSlug:'adoppiexyz',installationId:182084517,role:'write',operations:['identity','comment_issue']}}};
test('upgrade: a settings.4 signed configuration still loads, every account keeps working, AD key stays readable',async t=>{
 const {settings,store,loader,contexts}=await fixture(t);
 await loader.save(LEGACY_FILE);
 // The key as settings.4 stored it: DPAPI-bound to account, App ID and the configured installation ID.
 await store.importKeyText({account:'ad',pem_text:pem});
 assert.equal(contexts.at(-1),'oppie-github/v1/ad/5764947/182084517');
 const config=await loader.load();
 assert.deepEqual(Object.keys(config).sort(),['accounts','newAccounts','revision','schemaVersion']);
 assert.deepEqual(config.newAccounts.ad,{appId:5764947,appName:'ADOppieXYZ',appSlug:'adoppiexyz',installationId:182084517});
 for(const name of [...Object.keys(ACCOUNTS),'ad'])assert.ok(configuredAccount(name,config),name);
 // The installation ID never pins the installation: it is still looked up on GitHub.
 assert.equal(configuredAccount('ad',config).installation_id,null);
 assert.equal((await store.load('ad')).privateKey,pem);
 const r=await settings.read();assert.equal(r.source,'file');assert.equal(r.error,undefined);
 // Editing AD in the settings page keeps the installation ID (same App ID), so the key stays readable,
 // and the saved file is in the current format.
 const base=await baseConfig(settings);base.newAccounts.ad={...base.newAccounts.ad,appName:'ADOppieXYZ2'};
 const plan=await settings.propose({config:base,expectedRevision:1});
 await settings.save({config:base,expectedRevision:1,hash:plan.hash});
 assert.equal((await store.load('ad')).privateKey,pem);
 const saved=JSON.parse(JSON.parse(await store.readPrivate('scope-config.json')).config);
 assert.deepEqual(Object.keys(saved).sort(),['accounts','newAccounts','revision','schemaVersion']);
 assert.deepEqual(saved.newAccounts.ad,{appId:5764947,appName:'ADOppieXYZ2',appSlug:'adoppiexyz',installationId:182084517});
});
test('upgrade: the kept installation ID cannot be changed or invented from the settings page',async t=>{
 const {settings,loader}=await fixture(t);
 await loader.save(LEGACY_FILE);
 const base=await baseConfig(settings);
 for(const config of [
  {...base,newAccounts:{...base.newAccounts,ad:{...base.newAccounts.ad,installationId:999}}},
  {...base,newAccounts:{...base.newAccounts,ad:{...base.newAccounts.ad,appId:5764948}}},
  plus(base,'ae',{appId:5764950,appName:'AEOppieXYZ',installationId:182084518}),
  {...base,repositories:{MontClip:1}},
  {...base,newAccounts:{...base.newAccounts,ad:{...base.newAccounts.ad,role:'write'}}},
 ])await assert.rejects(settings.propose({config,expectedRevision:1}),{code:'INVALID_SCOPE_CONFIGURATION'},JSON.stringify(config.newAccounts));
});
test('upgrade: without the kept installation ID only AD would need a new key; nobody else stops',async t=>{
 const {store,loader}=await fixture(t);
 await loader.save(LEGACY_FILE);await store.importKeyText({account:'ad',pem_text:pem});await store.importKeyText({account:'bb',pem_text:pem});
 assert.equal((await store.load('bb')).privateKey,pem);
 const {installationId,...rest}=LEGACY_FILE.newAccounts.ad;
 await loader.save({...LEGACY_FILE,revision:2,newAccounts:{ad:rest}});
 // AD's stored row no longer matches: AD alone needs its key again (that is why the ID is kept);
 // bb keeps working.
 await assert.rejects(store.load('ad'),{code:'KEY_IMPORTED_FOR_OTHER_APP'});
 assert.equal((await store.load('bb')).privateKey,pem);
});
test('upgrade: a page that leaves the installation ID out still keeps it, so no account loses its key',async t=>{
 const {settings,store,loader}=await fixture(t);
 await loader.save(LEGACY_FILE);await store.importKeyText({account:'ad',pem_text:pem});await store.importKeyText({account:'bb',pem_text:pem});
 const base=await baseConfig(settings);const {installationId,...ad}=base.newAccounts.ad;
 const config={...base,newAccounts:{...base.newAccounts,ad:{...ad,appName:'ADOppieXYZ2'}}};
 const plan=await settings.propose({config,expectedRevision:1});await settings.save({config,expectedRevision:1,hash:plan.hash});
 assert.equal((await loader.load()).newAccounts.ad.installationId,182084517);
 assert.equal((await store.load('ad')).privateKey,pem);assert.equal((await store.load('bb')).privateKey,pem);
 // A different App ID is a different App: no installation ID is carried over (old key no longer applies).
 const other={...base,newAccounts:{...base.newAccounts,ad:{...ad,appId:5764948}}};
 const p2=await settings.propose({config:other,expectedRevision:2});await settings.save({config:other,expectedRevision:2,hash:p2.hash});
 assert.equal((await loader.load()).newAccounts.ad.installationId,undefined);
 // AD's old key belonged to the old App: only AD needs a new key; bb and the store keep working.
 assert.equal((await store.load('bb')).privateKey,pem);
 await assert.rejects(store.load('ad'),{code:'KEY_IMPORTED_FOR_OTHER_APP'});
 assert.deepEqual((await store.list()).map(r=>r.account),['bb']);
 await store.importKeyText({account:'ad',pem_text:pem});assert.equal((await store.load('ad')).privateKey,pem);
});
