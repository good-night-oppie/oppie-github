'use strict';
// PG design review #8 step 1: every error code has a plain reason and who should do what next;
// INSTALLATION_MISMATCH / APP_IDENTITY_MISMATCH say which check failed; configuration failures keep
// their reason. No security decision changes, and no text carries keys, key paths or tokens.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {explain,CATALOG,entryFor}=require('../node/messages.cjs');
const {createClient,ACCOUNTS}=require('../node/core.cjs');
const {createReceiver}=require('../node/rpc-input.cjs');
const root=path.join(__dirname,'..');
// Upper-case literals that are not plugin error results: review events, an environment variable,
// the GITHUB_HTTP_ prefix (covered by its own test) and the Inbox preview server's own HTTP answers.
const NOT_RESULT_CODES=new Set(['REQUEST_CHANGES','CHANGES_REQUESTED','DBUS_SESSION_BUS_ADDRESS','GITHUB_HTTP_','PREVIEW_REQUIRED','HOST_DENIED','READ_ONLY_PREVIEW']);
function sourceCodes(){
 const files=fs.readdirSync(path.join(root,'node')).filter(f=>f.endsWith('.cjs')||f.endsWith('.py')).map(f=>path.join(root,'node',f)).concat([path.join(root,'main.js')]);
 const codes=new Set();
 for(const f of files)for(const m of fs.readFileSync(f,'utf8').matchAll(/['"]([A-Z][A-Z0-9]*_[A-Z0-9_]+)['"]/g))if(!NOT_RESULT_CODES.has(m[1]))codes.add(m[1]);
 return [...codes].sort();
}
// Secrets never appear: no PEM text, no token-like strings, no local paths.
const SECRETISH=new RegExp(['BEGIN [A-Z ]*PRIVATE KEY','gh[pousr]_[A-Za-z0-9]{10,}','[A-Za-z]:'+String.fromCharCode(92,92),'/home/','[.]pem'].join('|'));
test('every error code in the plugin source has a plain reason and a next step',()=>{
 const codes=sourceCodes();assert.ok(codes.length>150,codes.length);
 const missing=codes.filter(c=>!Object.hasOwn(CATALOG,c));
 assert.deepEqual(missing,[],'codes without plain text: '+missing.join(' '));
 for(const code of codes){
  const r=explain({ok:false,errorCode:code,execution:'not_executed'});
  assert.ok(typeof r.message==='string'&&r.message.length>=4,code);
  assert.ok(r.next&&typeof r.next.who==='string'&&r.next.who&&typeof r.next.action==='string'&&r.next.action.length>=2,code);
  assert.doesNotMatch(r.message+r.next.action,SECRETISH,code);
  assert.equal(r.errorCode,code);assert.equal(r.execution,'not_executed');
 }
});
test('catalog entries name one of the known people',()=>{
 for(const [code,e] of Object.entries(CATALOG))assert.ok(['主人','发起这次调用的伙伴','插件维护者（Deja）','QQ'].includes(e.who),code+': '+e.who);
});
test('GitHub HTTP codes and unknown codes still get a reason and next step',()=>{
 for(const status of [401,403,404,409,422,429,500,502,418]){
  const r=explain({ok:false,errorCode:'GITHUB_HTTP_'+status,execution:'not_executed',status});
  assert.match(r.message,new RegExp(String(status===418?418:status)));assert.ok(r.next.who&&r.next.action);
 }
 const u=explain({ok:false,errorCode:'SOMETHING_NEW',execution:'unknown'});assert.ok(u.message&&u.next.action.includes('读回'));
 assert.equal(entryFor('SOMETHING_NEW').who,'发起这次调用的伙伴');
 // Success results are untouched.
 const ok={ok:true,result:{x:1}};assert.equal(explain(ok),ok);
});

// --- Core: which check failed --------------------------------------------------------------------
const pem=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
const NOW=Date.parse('2026-11-16T04:00:00Z');
const BASIC={contents:'write',issues:'write',pull_requests:'write',metadata:'read'};
function fixture(account,{app={},installation={}}={}){
 const a=ACCOUNTS[account],calls=[];
 const client=createClient({now:()=>NOW,credentials:async()=>pem,fetch:async(url,init)=>{
  const route=new URL(url).pathname;calls.push(route);let data;
  if(route==='/app')data={id:a.app_id,slug:a.app_slug,owner:{login:'good-night-oppie'},...app};
  else if(route==='/app/installations/'+a.installation_id)data={id:a.installation_id,app_id:a.app_id,account:{login:'good-night-oppie',type:'Organization'},repository_selection:'selected',suspended_at:null,permissions:BASIC,...installation};
  else throw Error('no further request expected');
  return {ok:true,status:200,text:async()=>JSON.stringify(data)};
 }});
 return {client,calls};
}
const run=(f,account)=>f.client.run({account,repo:'MontClip',operation:'identity',args:{}});
test('INSTALLATION_MISMATCH names each failed check with expected and actual values',async()=>{
 const a=ACCOUNTS.bb;
 const cases=[
  [{id:a.installation_id+1},'installation_id',String(a.installation_id+1)],
  [{app_id:a.app_id+1},'installation_app_id',String(a.app_id+1)],
  [{account:{login:'someone-else',type:'Organization'}},'installation_owner','someone-else'],
  [{account:{login:'good-night-oppie',type:'User'}},'installation_owner_type','User'],
  [{repository_selection:'none'},'repository_selection','none'],
  [{suspended_at:'2026-11-16T00:00:00Z'},'suspended','suspended'],
 ];
 for(const [installation,check,actual] of cases){
  const f=fixture('bb',{installation}),r=await run(f,'bb');
  assert.equal(r.errorCode,'INSTALLATION_MISMATCH',check);assert.equal(r.execution,'not_executed');
  assert.deepEqual(r.details.failed.map(x=>x.check),[check]);assert.equal(r.details.failed[0].actual,actual);
  assert.equal(f.calls.some(c=>c.endsWith('/access_tokens')),false,'no token before the checks pass');
  const said=explain(r);assert.match(said.message,/没对上的项：/);assert.equal(said.next.who,'主人');
 }
 const both=await run(fixture('bb',{installation:{id:1,suspended_at:'x'}}),'bb');
 assert.deepEqual(both.details.failed.map(x=>x.check),['installation_id','suspended']);
 assert.match(explain(both).message,/安装 ID（应为 [0-9]+，GitHub 返回 1）；安装是否被暂停/);
});
test('APP_IDENTITY_MISMATCH names the failed check',async()=>{
 for(const [app,check] of [[{id:1},'app_id'],[{slug:'other-app'},'app_slug'],[{owner:{login:'x'}},'app_owner']]){
  const r=await run(fixture('bb',{app}),'bb');
  assert.equal(r.errorCode,'APP_IDENTITY_MISMATCH');assert.deepEqual(r.details.failed.map(x=>x.check),[check]);
  assert.doesNotMatch(JSON.stringify(explain(r)),SECRETISH);
 }
});
test('a configuration failure keeps its reason through core and the worker reply',async()=>{
 const failing=()=>{const e=new Error('INVALID_SCOPE_CONFIGURATION');e.code='INVALID_SCOPE_CONFIGURATION';e.reason='signature mismatch'+String.fromCharCode(10)+'second line';throw e;};
 const c=createClient({now:()=>NOW,scopeConfig:failing,credentials:async()=>{throw Error('must not read keys');},fetch:async()=>{throw Error('no network');}});
 const r=await c.run({account:'bb',repo:'MontClip',operation:'identity',args:{}});
 assert.equal(r.errorCode,'INVALID_SCOPE_CONFIGURATION');assert.equal(r.details.reason,'signature mismatch second line');
 assert.match(explain(r).message,/原因：signature mismatch second line/);
 // A thrown failure in the worker keeps the reason too; the exception message itself is never sent.
 const replies=[];const rx=createReceiver({dispatch:async()=>{failing();},reply:x=>replies.push(x),describe:explain});
 const NL=String.fromCharCode(10);
 await rx.push(Buffer.from(JSON.stringify({id:1,method:'import',params:{}})+NL));
 const out=replies[0].result;assert.equal(out.errorCode,'INVALID_SCOPE_CONFIGURATION');assert.equal(out.details.reason,'signature mismatch second line');
 assert.match(out.message,/原因：signature mismatch/);assert.equal(out.next.who,'主人');
 // An arbitrary exception keeps the generic code and no text from the exception.
 const r2=[];await createReceiver({dispatch:async()=>{throw Error(['C:','Users','x','key.pem secret'].join(String.fromCharCode(92)));},reply:x=>r2.push(x),describe:explain}).push(Buffer.from(JSON.stringify({id:2,method:'run',params:{}})+NL));
 assert.equal(r2[0].result.errorCode,'REQUEST_FAILED');assert.equal(r2[0].result.details,undefined);assert.ok(!JSON.stringify(r2[0].result).includes('key.pem')&&!JSON.stringify(r2[0].result).includes('secret'));
});
test('the installation-permission message keeps what is missing and where to add it',()=>{
 const r=explain({ok:false,errorCode:'INSTALLATION_PERMISSION_MISSING',execution:'not_executed',details:{app:'ADOppieXYZ',missing:[{permission:'issues',required:'write',installed:'read'}],appPermissionsUrl:'https://github.com/organizations/good-night-oppie/settings/apps/adoppiexyz/permissions',installationUrl:'https://github.com/organizations/good-night-oppie/settings/installations/182084517'}});
 assert.match(r.message,/ADOppieXYZ 的安装缺少：issues:write（现为 read）/);assert.ok(r.message.includes('installations/182084517'));assert.equal(r.next.who,'主人');
});
test('main.js host-side failures carry a reason and next step',()=>{
 const src=fs.readFileSync(path.join(root,'main.js'),'utf8');
 const hostCodes=src.split(String.fromCharCode(10)).filter(l=>/^ [A-Z_]+:[[]/.test(l)).map(l=>l.trim().split(':')[0]);
 for(const c of ['UNKNOWN_TOOL','OWNER_AUTHORIZATION_REQUIRED','CONFIRMATION_TOO_LARGE','OWNER_CONFIRMATION_REQUIRED','REQUEST_TOO_LARGE','WORKER_UNAVAILABLE','INVALID_REQUEST','PROCESS_START_FAILED','RATE_LIMITED'])assert.ok(hostCodes.includes(c),c);
});
// settings.7 codes (owner 2026-11-16: the remote decides).
test('settings.7 codes say what GitHub reported and who acts next, without secrets',()=>{
 const nf=explain({ok:false,errorCode:'INSTALLATION_NOT_FOUND',execution:'not_executed',details:{owner:'good-night-oppie',found:2}});
 assert.match(nf.message,/在 good-night-oppie 找到 2 个安装/);assert.equal(nf.next.who,'主人');
 const ni=explain({ok:false,errorCode:'REPOSITORY_NOT_INSTALLED',execution:'not_executed',details:{repositories:['good-night-oppie/cindy']}});
 assert.match(ni.message,/涉及的仓库：good-night-oppie\/cindy/);assert.equal(ni.next.who,'主人');
 const tm=explain({ok:false,errorCode:'TOKEN_PERMISSION_MISMATCH',execution:'not_executed',details:{requested:{metadata:'read',issues:'write'},granted:{metadata:'read',issues:'read'}}});
 assert.match(tm.message,/申请：metadata:read,issues:write；GitHub 给的：metadata:read,issues:read/);
 for(const r of [nf,ni,tm])assert.doesNotMatch(JSON.stringify(r),SECRETISH);
 for(const gone of ['QQ_AUTHORING_REFUSED','OPERATION_NOT_ALLOWED_FOR_ACCOUNT','PERMISSION_MISMATCH','INSTALLATION_REPOSITORY_SCOPE_MISMATCH'])assert.equal(Object.hasOwn(CATALOG,gone),false,gone);
});
// Configured accounts look the installation up; a wrong one still names the failed check.
test('INSTALLATION_MISMATCH for a settings-page account names the failed check',async()=>{
 const {validateConfig}=require('../node/scope-config.cjs');
 const config=validateConfig({newAccounts:{ad:{appId:5764947,appName:'ADOppieXYZ'}}});
 const client=createClient({now:()=>NOW,scopeConfig:()=>config,credentials:async()=>pem,fetch:async(url)=>{
  const route=new URL(url).pathname;let data;
  if(route==='/app')data={id:5764947,slug:'adoppiexyz',owner:{login:'good-night-oppie'}};
  else if(route==='/app/installations')data=[{id:182084517,app_id:5764947,account:{login:'good-night-oppie',type:'Organization'},repository_selection:'all',suspended_at:'2026-11-16T00:00:00Z',permissions:BASIC}];
  else throw Error('no further request expected');
  return {ok:true,status:200,text:async()=>JSON.stringify(data)};
 }});
 const r=await client.run({account:'ad',repo:'MontClip',operation:'identity',args:{}});
 assert.equal(r.errorCode,'INSTALLATION_MISMATCH');assert.deepEqual(r.details.failed.map(x=>x.check),['suspended']);
});
// settings.8-11 codes (#33 e8c1be06): repository ID resolution, keys imported for another App, workflow files.
test('settings.8-11 codes say what happened and who acts next, without secrets',()=>{
 const rr=explain({ok:false,errorCode:'REPOSITORY_RESOLUTION_FAILED',execution:'not_executed'});
 assert.ok(rr.message.includes('仓库 ID')&&rr.message.includes('没有执行'));assert.equal(rr.next.who,'发起这次调用的伙伴');
 const ko=explain({ok:false,errorCode:'KEY_IMPORTED_FOR_OTHER_APP',execution:'not_executed'});
 assert.ok(ko.message.includes('只停这一个账号'));assert.equal(ko.next.who,'主人');assert.ok(ko.next.action.includes('重新导入'));
 const wf=explain({ok:false,errorCode:'INSTALLATION_PERMISSION_MISSING',execution:'not_executed',details:{app:'DejaOppieXYZ',missing:[{permission:'workflows',required:'write',installed:'none'}],workflowFiles:['.github/workflows/test.yml'],appPermissionsUrl:'https://github.com/organizations/good-night-oppie/settings/apps/dejaoppiexyz/permissions',installationUrl:'https://github.com/organizations/good-night-oppie/settings/installations/179806356'}});
 assert.ok(wf.message.includes('workflows:write（现为 none）'));assert.ok(wf.message.includes('.github/workflows/test.yml 在 .github/workflows/ 下'));assert.ok(wf.message.includes('installations/179806356'));assert.equal(wf.next.who,'主人');
 const oc=explain({ok:false,errorCode:'OWNER_CONFIRMATION_REQUIRED',execution:'not_executed'});assert.equal(oc.next.who,'主人');
 for(const r of [rr,ko,wf,oc])assert.doesNotMatch(JSON.stringify(r),SECRETISH);
});
