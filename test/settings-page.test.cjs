'use strict';
// Step 2 (owner, 2026-11-15): add teammate Apps and repositories from the plugin settings page,
// effective without restart; private keys only through the settings-page secret field.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createStore,setAccountResolver}=require('../node/store.cjs');
const {validateConfig,ACCOUNT_OPERATION_CEILING,BUILTIN_APP_IDS,BUILTIN_INSTALLATION_IDS}=require('../node/scope-config.cjs');
const {createSettings}=require('../node/scope-settings.cjs');
const {createSignedLoader}=require('../node/scope-loader.cjs');
const {createClient,ACCOUNTS,OPERATION_NAMES,configuredAccount}=require('../node/core.cjs');
const pem=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
const AD={appId:5764947,installationId:182084517,appName:'ADOppieXYZ'};

async function fixture(t,{verify}={}){
 const dir=await fsp.mkdtemp(path.join(await fsp.realpath(os.tmpdir()),'ogh-settings-'));t.after(()=>fsp.rm(dir,{recursive:true,force:true}));
 const key=crypto.randomBytes(32);
 const protect=async(data,context)=>{const iv=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(context));return Buffer.concat([iv,c.update(data),c.final(),c.getAuthTag()]);};
 const unprotect=async(data,context)=>{const d=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(0,12));d.setAAD(Buffer.from(context));d.setAuthTag(data.subarray(-16));return Buffer.concat([d.update(data.subarray(12,-16)),d.final()]);};
 const root=path.join(dir,'private');
 const store=createStore({root,platform:'win32',protect,unprotect,checkAcl:async()=>{},tighten:async()=>{}});
 const loader=createSignedLoader({store});
 setAccountResolver(()=>loader.current().newAccounts);t.after(()=>setAccountResolver(()=>({})));
 const verifyCalls=[];
 const verifyKey=async(input)=>{verifyCalls.push(input);return verify?verify(input):{ok:true,result:{app_slug:'adoppiexyz',installationRepositorySelection:'all',repositories:[{full_name:'good-night-oppie/MontClip'}]}};};
 return {root,store,loader,verifyCalls,settings:createSettings({store,loader,verifyKey})};
}
const withAd=(extra={})=>({newAccounts:{ad:{...AD,...extra}}});

test('read: defaults, ceilings and key status, no secrets',async t=>{
 const {settings}=await fixture(t);const r=await settings.read();
 assert.equal(r.ok,true);assert.equal(r.source,'default');assert.equal(r.revision,0);
 assert.ok(r.config.accounts.includes('deja'));assert.deepEqual(r.keys,[]);
 assert.deepEqual(r.accountOperationCeiling,[...ACCOUNT_OPERATION_CEILING]);
});
test('add AD and a repository: summary, confirmation hash, atomic save, hot reload, audit',async t=>{
 const {settings,loader,root}=await fixture(t);
 assert.equal(configuredAccount('ad',await loader()),null);
 const base=(await settings.read()).config;delete base.schemaVersion;delete base.revision;
 const config={...base,newAccounts:{ad:{...AD,role:'review'}},accounts:[...base.accounts,'ad'],repositories:{...base.repositories,'new-repo':1999999999},optionalRepositories:[...base.optionalRepositories,'new-repo']};
 const plan=await settings.propose({config,expectedRevision:0});
 assert.equal(plan.ok,true);assert.equal(plan.nextRevision,1);
 assert.match(plan.summary,/加仓库 new-repo#1999999999（11 个账号可写：bb,cindy,deja,dd,gg,jj,pg,rea,video,vv,reviewinbox；只读评审：ad；qq 含规则集\/驳回\/合并队列\/仓库设置等专属操作；未写入角色表的账号按自身角色）/);
 assert.match(plan.summary,/加账号 ad\(App 5764947\/安装 182084517\/adoppiexyz\/只读\+评审\)/);
 assert.ok(('保存伙伴 GitHub 配置 r0→r1：'+plan.summary).length<=300);
 // A different payload than the one confirmed is refused.
 await assert.rejects(settings.save({config:{...config,repositories:{...config.repositories,'x':1888888888}},expectedRevision:0,hash:plan.hash}),{code:'PROPOSAL_CHANGED'});
 assert.equal(fs.existsSync(path.join(root,'scope-config.json')),false);
 const saved=await settings.save({config,expectedRevision:0,hash:plan.hash});
 assert.equal(saved.ok,true);assert.equal(saved.revision,1);
 // Takes effect for the next call: the loader sees AD without any restart.
 const live=await loader();assert.equal(live.revision,1);assert.equal(configuredAccount('ad',live).app_id,5764947);assert.equal(live.repositories['new-repo'],1999999999);
 // Stale revision is refused.
 await assert.rejects(settings.propose({config,expectedRevision:0}),{code:'SCOPE_REVISION_CONFLICT'});
 await assert.rejects(settings.save({config,expectedRevision:1,hash:plan.hash}),{code:'PROPOSAL_CHANGED'});
 const audit=fs.readFileSync(path.join(root,'scope-config-audit.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(audit.length,1);assert.equal(audit[0].event,'save');assert.equal(audit[0].revisionAfter,1);assert.equal(audit[0].hash,plan.hash);
 assert.ok(!JSON.stringify(audit).includes(root));
});
test('invalid proposals write nothing',async t=>{
 const {settings,root}=await fixture(t);
 const bad=[
  withAd({appId:BUILTIN_APP_IDS[2]}),withAd({installationId:BUILTIN_INSTALLATION_IDS[0]}),
  withAd({operations:['identity','admin_get']}),withAd({operations:['identity','enqueue_pull']}),withAd({operations:['get_pull']}),
  withAd({role:'admin'}),withAd({appSlug:'Bad Slug'}),{newAccounts:{qq:AD}},{repositories:{}},{unknownKey:1},
 ];
 for(const config of bad)await assert.rejects(settings.propose({config,expectedRevision:0}),{code:'INVALID_SCOPE_CONFIGURATION'},JSON.stringify(config));
 await assert.rejects(settings.save({config:{},expectedRevision:0,hash:'0'.repeat(64)}),e=>['PROPOSAL_CHANGED','NO_CHANGES'].includes(e.code));
 const same=await settings.propose({config:{},expectedRevision:0});assert.equal(same.summary,'无变化');
 await assert.rejects(settings.save({config:{},expectedRevision:0,hash:same.hash}),{code:'NO_CHANGES'});
 assert.equal(fs.existsSync(path.join(root,'scope-config.json')),false);
});
test('a broken file is reported and blocks saves until fixed',async t=>{
 const {settings,root,store}=await fixture(t);
 await store.writePrivate('scope-config.json','{broken');
 const r=await settings.read();assert.equal(r.source,'invalid');assert.equal(r.config,null);
 await assert.rejects(settings.propose({config:withAd(),expectedRevision:0}),{code:'INVALID_SCOPE_CONFIGURATION'});
 void root;
});
test('import key: only from the host-injected secret, verified first, stored with the DPAPI store, never echoed',async t=>{
 const {settings,store,verifyCalls,root}=await fixture(t);
 const plan=await settings.propose({config:{...withAd(),accounts:[...validateConfig({}).accounts,'ad']},expectedRevision:0});
 await settings.save({config:{...withAd(),accounts:[...validateConfig({}).accounts,'ad']},expectedRevision:0,hash:plan.hash});
 await assert.rejects(settings.importKey({account:'ad'},undefined),{code:'PRIVATE_KEY_NOT_PROVIDED'});
 await assert.rejects(settings.importKey({account:'ad',pem_path:'/x.pem'},{secrets:{app_private_key:pem}}),{code:'INVALID_IMPORT'});
 await assert.rejects(settings.importKey({account:'ad'},{secrets:{app_private_key:'not a key'}}),{code:'INVALID_PRIVATE_KEY'});
 const host={secrets:{app_private_key:pem}};
 const r=await settings.importKey({account:'ad'},host);
 assert.equal(r.ok,true,r.errorCode);assert.equal(host.secrets.app_private_key,'','secret cleared after use');
 assert.equal(verifyCalls.at(-1).account,'ad');assert.equal(verifyCalls.at(-1).config.newAccounts.ad.appId,5764947);
 assert.ok(!JSON.stringify(r).includes('PRIVATE KEY'));
 assert.equal((await store.load('ad')).privateKey,pem);
 const raw=fs.readFileSync(path.join(root,'accounts.json'),'utf8');assert.ok(!raw.includes('PRIVATE KEY'));
 const audit=fs.readFileSync(path.join(root,'scope-config-audit.jsonl'),'utf8');assert.ok(!audit.includes('PRIVATE KEY'));assert.match(audit,/"event":"import_key","account":"ad"/);
 // Second import without replace is refused; failed GitHub verification stores nothing.
 await assert.rejects(settings.importKey({account:'ad'},{secrets:{app_private_key:pem}}),{code:'ACCOUNT_EXISTS'});
});
test('import key: failed GitHub verification stores nothing',async t=>{
 const {settings,store}=await fixture(t,{verify:()=>({ok:false,errorCode:'APP_IDENTITY_MISMATCH'})});
 const r=await settings.importKey({account:'deja'},{secrets:{app_private_key:pem}});
 assert.equal(r.errorCode,'APP_IDENTITY_MISMATCH');assert.deepEqual(await store.list(),[]);
});
test('configured account ceiling equals all operations minus admin and QQ-only',()=>{
 const forbidden=['admin_get','admin_update','list_rulesets','get_ruleset','ruleset_update','dismiss_review','enqueue_pull'];
 assert.deepEqual([...ACCOUNT_OPERATION_CEILING].sort(),OPERATION_NAMES.filter(o=>!forbidden.includes(o)).sort());
 assert.deepEqual([...BUILTIN_APP_IDS].sort(),Object.values(ACCOUNTS).map(a=>a.app_id).sort());
 assert.deepEqual([...BUILTIN_INSTALLATION_IDS].sort(),Object.values(ACCOUNTS).map(a=>a.installation_id).sort());
});
test('configured account: operations allowlist, custom slug, never admin or QQ-only',async()=>{
 const cfg=validateConfig({newAccounts:{ad:{...AD,appSlug:'ad-oppie',role:'write',operations:['identity','get_pull','create_branch']}}});
 const a=configuredAccount('ad',cfg);assert.deepEqual([...a.allowed_slugs],['ad-oppie','oppie-agent-ad']);
 let fetched=0;
 const client=createClient({scopeConfig:()=>cfg,credentials:async()=>{throw Error('no key read');},fetch:async()=>{fetched++;throw Error('no network');}});
 for(const [operation,args] of [['list_issues',{}],['admin_get',{}],['enqueue_pull',{number:1,commit_id:'a'.repeat(40)}],['comment_issue',{number:1,body:'x'}]]){
  const r=await client.run({account:'ad',repo:'MontClip',operation,args});
  assert.ok(['OPERATION_NOT_ALLOWED_FOR_ACCOUNT','QQ_ACCOUNT_REQUIRED'].includes(r.errorCode),operation+' '+r.errorCode);assert.equal(r.execution,'not_executed');
 }
 assert.equal(fetched,0);
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
test('main.js: key import is confirmed and carries no key material in params',async()=>{
 const b=bridge({nodeResult:()=>({ok:true,account:'ad'})});
 await b.send({type:'settings-import-key',id:'k1',account:'ad',pem:'-----BEGIN PRIVATE KEY-----'});
 assert.equal(b.confirms.length,1);assert.deepEqual(b.nodeCalls.map(c=>c.method),['settings/import_key']);
 assert.equal(JSON.stringify(b.nodeCalls[0].params),JSON.stringify({account:'ad',replace:false}));
 const no=bridge({confirm:async()=>({ok:true,confirmed:false})});await no.send({type:'settings-import-key',id:'k2',account:'ad'});assert.equal(no.nodeCalls.length,0);
 const junk=bridge();await junk.send({type:'settings-import-key',id:'k3',account:'../x'});assert.equal(junk.nodeCalls.length,0);
 await junk.send({type:'run',id:'k4'});await junk.send({type:'settings-save',id:'bad id!'});assert.equal(junk.nodeCalls.length,0);
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
});

// QQ review 2026-11-16, item 1: the configuration is signed; hand edits never take effect.
test('signed configuration: hand edits, revision bumps, replays, legacy files and deletions all fail closed',async t=>{
 const {settings,loader,root,store}=await fixture(t);
 const file=path.join(root,'scope-config.json'),keyFile=path.join(root,'scope-config.key');
 const base=(await settings.read()).config;delete base.schemaVersion;delete base.revision;
 const v1={...base,repositories:{...base.repositories,'new-repo':1999999999},optionalRepositories:[...base.optionalRepositories,'new-repo']};
 const p1=await settings.propose({config:v1,expectedRevision:0});await settings.save({config:v1,expectedRevision:0,hash:p1.hash});
 const signedV1=fs.readFileSync(file,'utf8');
 assert.ok(!fs.readFileSync(keyFile,'utf8').includes(JSON.parse(signedV1).hmac),'key file holds only the sealed key');
 const v2={...v1,repositories:{...v1.repositories,'second':1888888888},optionalRepositories:[...v1.optionalRepositories,'second']};
 const p2=await settings.propose({config:v2,expectedRevision:1});await settings.save({config:v2,expectedRevision:1,hash:p2.hash});
 assert.equal((await loader()).revision,2);
 const client=()=>{let keyReads=0,fetched=0;return {c:createClient({scopeConfig:loader,credentials:async()=>{keyReads++;return pem;},fetch:async()=>{fetched++;throw Error('no network');}}),keyReads:()=>keyReads,fetched:()=>fetched};};
 const refused=async(label)=>{
  for(const [account,operation,repo] of [['bb','identity','MontClip'],['deja','create_branch','second'],['qq','get_pull','MontClip']]){
   const k=client(),r=await k.c.run({account,repo,operation,args:operation==='create_branch'?{branch:'x/y',sha:'a'.repeat(40)}:operation==='get_pull'?{number:1}:{}});
   assert.equal(r.errorCode,'INVALID_SCOPE_CONFIGURATION',label+' '+account);assert.equal(r.execution,'not_executed');assert.equal(k.keyReads(),0,label);assert.equal(k.fetched(),0,label);
  }
  assert.equal((await settings.read()).source,'invalid',label);
 };
 const good=fs.readFileSync(file,'utf8');
 // 1. Edit the signed config text: add a write account and bump the revision, keep the old HMAC.
 const env=JSON.parse(good),cfg=JSON.parse(env.config);
 cfg.revision=3;cfg.newAccounts={evil:{appId:9999991,installationId:9999992,appName:'Evil',role:'write'}};cfg.accounts=[...cfg.accounts,'evil'];
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
 fs.writeFileSync(keyFile,sealed);const ok=await loader();assert.equal(ok.revision,2);assert.equal(ok.repositories.second,1888888888);
 assert.equal((await settings.read()).source,'file');void store;
});
test('signed configuration: a first save interrupted before the key is sealed fails closed',async t=>{
 const {settings,loader,store}=await fixture(t);
 const base=(await settings.read()).config;delete base.schemaVersion;delete base.revision;
 const v1={...base,repositories:{...base.repositories,'new-repo':1999999999},optionalRepositories:[...base.optionalRepositories,'new-repo']};
 const p1=await settings.propose({config:v1,expectedRevision:0});
 const write=store.writeScopeKey;let calls=0;store.writeScopeKey=async(...a)=>{if(++calls===1)throw Object.assign(Error('crash'),{code:'STORE_WRITE_FAILED'});return write(...a);};
 await assert.rejects(settings.save({config:v1,expectedRevision:0,hash:p1.hash}));
 store.writeScopeKey=write;
 await assert.rejects(loader(),{code:'INVALID_SCOPE_CONFIGURATION'},'no sealed key yet: fail closed');
});
test('confirmation summary names who can write an added repository and which accounts get a write role',async()=>{
 const {summarize}=require('../node/scope-settings.cjs');
 const before=validateConfig({});
 const after=validateConfig({repositories:{...before.repositories,'x-repo':1777777777},optionalRepositories:['cindy','x-repo'],repositoryRoles:{...before.repositoryRoles,'x-repo':{dd:'comment_review'}},newAccounts:{ad:{...AD,role:'write'}}});
 const s=summarize(before,after);
 assert.match(s,/x-repo#1777777777（11 个账号可写：bb,cindy,deja,gg,jj,pg,rea,video,vv,reviewinbox,ad；只读评审：dd；qq 含/);
 assert.match(s,/ad\(App 5764947\/安装 182084517\/adoppiexyz\/可写名单内全部仓库\)/);
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
