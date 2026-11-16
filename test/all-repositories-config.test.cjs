'use strict';
// 2026-11-15 (owner): every App was granted "all repositories". The installation no longer has to
// equal the configured list; the target must be in the list, tokens stay narrowed to the list,
// and the scope values are configurable in scope-config.json (hot reloaded).
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createClient,ACCOUNTS,configuredAccount}=require('../node/core.cjs');
const {DEFAULT_CONFIG,validateConfig}=require('../node/scope-config.cjs');
const SEVEN={MontClip:1441621868,'MontClip-Cindy':1446532339,'montclip-rsi':1450602468,'rsi-playbooks':1450603260,'oppie-github':1451885379,'sglang-review-inbox':1451900929,cindy:1457433299};
const SHA='a'.repeat(40);
const pem=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
const now=Date.parse('2026-11-15T23:00:00Z');
const PERMS=a=>({contents:a==='qq'?'read':'write',issues:'write',pull_requests:'write',metadata:'read',...(a==='qq'?{administration:'write'}:{})});
const row=(name,id)=>({id,name,full_name:'good-night-oppie/'+name});
// An "all repositories" organisation listing: the configured seven plus many strangers.
function orgRepos(extra=243){const list=Object.entries(SEVEN).map(([n,i])=>row(n,i));for(let i=0;i<extra;i++)list.push(row('stranger-'+i,2000000000+i));return list;}
// AD's real installation is broader than its role (BB on #29: secrets, workflows, actions, hooks write).
const AD_REVIEW_INSTALL={contents:'read',issues:'write',pull_requests:'write',metadata:'read'};
const AD_BROAD_INSTALL={contents:'write',issues:'write',pull_requests:'write',metadata:'read',secrets:'write',workflows:'write',actions:'write',repository_hooks:'write',administration:'read'};
function fixture(account,{selection='all',listing=orgRepos(),pageTotal,scopeConfig,appId,installationId,slug,installPerms,tokenPerms}={}){
 const a=account==='ad'?{app_id:appId??5764947,installation_id:installationId??182084517,app_slug:slug??'adoppiexyz'}:ACCOUNTS[account];
 const calls=[];let keyReads=0,requested;
 const client=createClient({now:()=>now,scopeConfig,credentials:async()=>{keyReads++;return pem;},fetch:async(url,init)=>{
  const u=new URL(url),route=u.pathname,method=init.method||'GET',body=init.body?JSON.parse(init.body):null;calls.push({route,method,body,query:u.search});let data;
  if(route==='/app')data={id:a.app_id,slug:a.app_slug,owner:{login:'good-night-oppie'}};
  else if(route==='/app/installations/'+a.installation_id)data={id:a.installation_id,app_id:a.app_id,account:{login:'good-night-oppie',type:'Organization'},repository_selection:selection,permissions:installPerms??(account==='ad'?AD_REVIEW_INSTALL:PERMS(account))};
  else if(route.endsWith('/access_tokens')){requested=body.repository_ids;data={token:body.repository_ids?'exec':'probe',expires_at:new Date(now+600000).toISOString(),permissions:body.repository_ids?(tokenPerms??body.permissions):{metadata:'read'}};}
  else if(route==='/installation/repositories'){
   if(init.headers.Authorization==='Bearer probe'){const page=Number(u.searchParams.get('page')||1),per=Number(u.searchParams.get('per_page'));data={total_count:pageTotal?pageTotal(page):listing.length,repositories:listing.slice((page-1)*per,page*per)};}
   else{const l=listing.filter(r=>requested.includes(r.id));data={total_count:l.length,repositories:l};}
  }
  else if(/\/pulls\/320$/.test(route))data={number:320,head:{sha:SHA},state:'open',draft:false};
  else if(/^\/repos\/good-night-oppie\/[^/]+$/.test(route))data={default_branch:'main'};
  else data={id:1,html_url:'https://github.com'+route.slice(6)};
  return {ok:true,status:200,text:async()=>JSON.stringify(data)};
 }});
 return {client,calls,keyReads:()=>keyReads,tokens:()=>calls.filter(c=>c.route.endsWith('/access_tokens'))};
}
const run=(f,account,operation,args={},repo='MontClip')=>f.client.run({account,repo,operation,args});

test('(a) deja identity on MontClip succeeds with an all-repositories installation of 250 repositories',async()=>{
 const f=fixture('deja'),r=await run(f,'deja','identity');
 assert.equal(r.ok,true,r.errorCode);
 assert.equal(r.result.installationRepositorySelection,'all');
 assert.equal(r.result.scopeConfigSource,'default');
 assert.equal(r.result.installationRepositoryCount,250);
 assert.deepEqual(r.result.installationRepositories.map(x=>x.id).sort(),Object.values(SEVEN).sort());
 assert.deepEqual(f.tokens().at(-1).body.repository_ids,Object.values(SEVEN),'token narrowed to the configured list');
 assert.deepEqual(r.result.repositories.map(x=>x.id),Object.values(SEVEN));
 assert.equal(f.calls.filter(c=>c.route==='/installation/repositories').length,4,'three probe pages and one execution read');
});
test('every account reads MontClip#320 with an all-repositories installation',async()=>{
 for(const account of Object.keys(ACCOUNTS)){const f=fixture(account),r=await run(f,account,'get_pull',{number:320});assert.equal(r.ok,true,account+': '+r.errorCode);}
});
test('(b) a repository outside the list is refused before credentials, even when installed',async()=>{
 for(const account of Object.keys(ACCOUNTS))for(const repo of ['stranger-1','good-night-oppie/stranger-1','other','MontClip/../x']){
  const f=fixture(account),r=await run(f,account,'get_issue',{number:1},repo);
  assert.equal(r.errorCode,'REPOSITORY_NOT_ALLOWED',account+' '+repo);assert.equal(r.execution,'not_executed');
  assert.equal(f.keyReads(),0);assert.equal(f.calls.length,0);
 }
});
test('a stranger repository never reaches an execution token; a token that contains one is refused',async()=>{
 const listing=orgRepos(5);const f=fixture('bb',{listing});await run(f,'bb','identity');
 assert.ok(f.tokens().at(-1).body.repository_ids.every(id=>Object.values(SEVEN).includes(id)));
 // A wider token than requested (GitHub misbehaviour) still fails the exact execution check.
 const wide=createClient({now:()=>now,credentials:async()=>pem,fetch:async(url,init)=>{
  const u=new URL(url);if(u.pathname==='/installation/repositories'&&init.headers.Authorization==='Bearer exec')return {ok:true,status:200,text:async()=>JSON.stringify({total_count:8,repositories:[...Object.entries(SEVEN).map(([n,i])=>row(n,i)),row('stranger-0',2000000000)]})};
  const a=ACCOUNTS.bb;let data;
  if(u.pathname==='/app')data={id:a.app_id,slug:a.app_slug,owner:{login:'good-night-oppie'}};
  else if(u.pathname==='/app/installations/'+a.installation_id)data={id:a.installation_id,app_id:a.app_id,account:{login:'good-night-oppie',type:'Organization'},repository_selection:'all',permissions:PERMS('bb')};
  else if(u.pathname.endsWith('/access_tokens')){const b=JSON.parse(init.body);data={token:b.repository_ids?'exec':'probe',expires_at:new Date(now+600000).toISOString(),permissions:b.repository_ids?b.permissions:{metadata:'read'}};}
  else if(u.pathname==='/installation/repositories')data={total_count:listing.length,repositories:listing};
  return {ok:true,status:200,text:async()=>JSON.stringify(data)};
 }});
 const r=await wide.run({account:'bb',repo:'MontClip',operation:'get_issue',args:{number:1}});
 assert.equal(r.errorCode,'EXECUTION_REPOSITORY_SCOPE_MISMATCH');assert.equal(r.execution,'not_executed');
});
test('installation listing failures still fail closed',async()=>{
 const cases=[
  ['configured name with another ID',(()=>{const l=orgRepos(10);l[0]={...l[0],id:42};return {listing:l};})()],
  ['required repository missing',{listing:orgRepos(10).filter(r=>r.name!=='MontClip-Cindy')}],
  ['foreign owner entry',(()=>{const l=orgRepos(3);l.push({id:7,name:'x',full_name:'evil/x'});return {listing:l};})()],
  ['duplicate id',(()=>{const l=orgRepos(3);l.push({...l[4]});return {listing:l};})()],
  ['total changes between pages',{pageTotal:p=>p===1?250:251}],
  ['more than ten pages',{listing:orgRepos(1100)}],
 ];
 for(const [label,options] of cases){
  const f=fixture('deja',options),r=await run(f,'deja','get_pull',{number:320});
  assert.equal(r.errorCode,'INSTALLATION_REPOSITORY_SCOPE_MISMATCH',label);assert.equal(r.execution,'not_executed');assert.equal(f.tokens().length,1,label);
 }
 const odd=fixture('deja',{selection:'none'}),r=await run(odd,'deja','identity');assert.equal(r.errorCode,'INSTALLATION_MISMATCH');
 const sel=fixture('deja',{selection:'selected',listing:orgRepos(0)});assert.equal((await run(sel,'deja','identity')).ok,true);
});
test('(C) ReviewInbox review events and QQ account limits are unchanged',async()=>{
 // Owner decision 2026-11-15: ReviewInbox keeps APPROVE/REQUEST_CHANGES as installed.
 for(const event of ['COMMENT','APPROVE','REQUEST_CHANGES']){const f=fixture('reviewinbox'),r=await run(f,'reviewinbox','submit_review',{number:320,commit_id:SHA,event,body:'x'});assert.equal(r.ok,true,event+': '+r.errorCode);}
 for(const operation of ['comment_issue','create_issue','create_branch']){const q=fixture('qq'),r=await run(q,'qq',operation,operation==='comment_issue'?{number:1,body:'x'}:operation==='create_issue'?{title:'t'}:{branch:'b',sha:SHA});assert.equal(r.errorCode,'QQ_AUTHORING_REFUSED',operation);}
 for(const operation of ['admin_get','list_rulesets']){const d=fixture('deja'),r=await run(d,'deja',operation);assert.ok(['ADMIN_ACCOUNT_REQUIRED','QQ_ACCOUNT_REQUIRED'].includes(r.errorCode),operation);}
});

// Configuration
test('defaults equal the previously compiled values',()=>{
 assert.deepEqual({...DEFAULT_CONFIG.repositories},SEVEN);
 assert.deepEqual([...DEFAULT_CONFIG.optionalRepositories],['cindy']);
 assert.deepEqual([...DEFAULT_CONFIG.accounts],['bb','cindy','deja','dd','gg','jj','pg','qq','rea','video','vv','reviewinbox']);
 assert.deepEqual({...DEFAULT_CONFIG.twoRepositories},{MontClip:1441621868,'MontClip-Cindy':1446532339});
 assert.deepEqual({...DEFAULT_CONFIG.repositoryRoles.cindy},{bb:'write',deja:'write',dd:'write',qq:'write'});
 assert.deepEqual([...DEFAULT_CONFIG.reviewOperations],['identity','get_contents','list_branches','list_issues','get_issue','list_pulls','get_pull','pull_files','list_reviews','submit_review']);
 assert.deepEqual(validateConfig({}),DEFAULT_CONFIG);
});
test('invalid configurations are rejected',()=>{
 const bad=[
  {unknown:1},{schemaVersion:2},{repositories:{}},{repositories:{MontClip:-1}},{repositories:{'a/b':1}},{repositories:{a:1,b:1}},
  {optionalRepositories:['nope']},{repositories:{a:1},optionalRepositories:['a']},
  {accounts:['zz']},{accounts:[]},{accounts:['bb','bb']},
  {newAccounts:{qq:{appId:1,installationId:2,appName:'X'}}},{newAccounts:{ad:{appId:1,installationId:2}}},{newAccounts:{ad:{appId:1,installationId:2,appName:'X',admin:true}}},
  {newAccounts:{ad:{appId:1,installationId:2,appName:'X',role:'admin'}}},
  {repositoryRoles:{nope:{bb:'write'}}},{repositoryRoles:{MontClip:{bb:'owner'}}},{repositoryRoles:{MontClip:{zz:'write'}}},
  {reviewOperations:['identity','create_branch']},{reviewOperations:['get_pull']},{reviewOperations:['identity','ruleset_update']},
 ];
 for(const c of bad)assert.throws(()=>validateConfig(c),{code:'INVALID_SCOPE_CONFIGURATION'},JSON.stringify(c));
});
test('a configured repository with a wrong ID fails closed',async()=>{
 const cfg=validateConfig({repositories:{...SEVEN,'stranger-1':999}});
 const f=fixture('bb',{scopeConfig:()=>cfg}),r=await run(f,'bb','identity');
 assert.equal(r.errorCode,'INSTALLATION_REPOSITORY_SCOPE_MISMATCH');
});
test('a new account (AD) from configuration: pinned App identity, review-only by default',async()=>{
 const cfg=validateConfig({newAccounts:{ad:{appId:5764947,installationId:182084517,appName:'ADOppieXYZ'}}});
 assert.ok(cfg.accounts.includes('ad'));
 assert.equal(configuredAccount('ad'),null,'not known without configuration');
 assert.equal(configuredAccount('ad',cfg).admin,false);
 assert.equal((await run(fixture('ad'),'ad','identity')).errorCode,'ACCOUNT_REQUIRED');
 const f=fixture('ad',{scopeConfig:()=>cfg}),r=await run(f,'ad','identity');
 assert.equal(r.ok,true,r.errorCode);assert.equal(r.result.app_id,5764947);
 assert.equal(r.result.scopeConfigSource,'file');
 assert.equal((await run(fixture('ad',{scopeConfig:()=>cfg}),'ad','submit_review',{number:320,commit_id:SHA,event:'COMMENT',body:'x'})).ok,true);
 const w=fixture('ad',{scopeConfig:()=>cfg}),denied=await run(w,'ad','create_branch',{branch:'ad/x',sha:SHA});
 assert.equal(denied.errorCode,'REVIEW_ONLY_REPOSITORY');assert.equal(w.keyReads(),0);
 // Wrong App behind the configured installation is refused.
 const spoof=fixture('ad',{scopeConfig:()=>cfg,appId:5665940});assert.equal((await run(spoof,'ad','identity')).errorCode,'APP_IDENTITY_MISMATCH');
 const slug=fixture('ad',{scopeConfig:()=>cfg,slug:'dejaoppiexyz'});assert.equal((await run(slug,'ad','identity')).errorCode,'APP_IDENTITY_MISMATCH');
 // Explicit write role.
 const cw=validateConfig({newAccounts:{ad:{appId:5764947,installationId:182084517,appName:'ADOppieXYZ',role:'write'}}});
 assert.equal((await run(fixture('ad',{scopeConfig:()=>cw,installPerms:PERMS('bb')}),'ad','create_branch',{branch:'ad/x',sha:SHA})).ok,true);
 const cc=validateConfig({newAccounts:{ad:{appId:5764947,installationId:182084517,appName:'ADOppieXYZ',role:'comment_review'}}});
 assert.equal((await run(fixture('ad',{scopeConfig:()=>cc}),'ad','submit_review',{number:320,commit_id:SHA,event:'APPROVE',body:'x'})).errorCode,'COMMENT_ONLY_REVIEWER');
});
test('removing an account from the configured list refuses it before credentials',async()=>{
 const cfg=validateConfig({accounts:['bb','deja']});
 const f=fixture('qq',{scopeConfig:()=>cfg}),r=await run(f,'qq','identity');
 assert.equal(r.errorCode,'ACCOUNT_REQUIRED');assert.equal(f.keyReads(),0);
 assert.equal((await run(fixture('deja',{scopeConfig:()=>cfg}),'deja','identity')).ok,true);
});
test('repositoryRoles and reviewOperations from configuration are enforced',async()=>{
 const cfg=validateConfig({repositoryRoles:{MontClip:{bb:'review'}},reviewOperations:['identity','get_pull']});
 assert.equal((await run(fixture('bb',{scopeConfig:()=>cfg}),'bb','get_pull',{number:320})).ok,true);
 assert.equal((await run(fixture('bb',{scopeConfig:()=>cfg}),'bb','list_issues')).errorCode,'REVIEW_ONLY_REPOSITORY');
 assert.equal((await run(fixture('bb',{scopeConfig:()=>cfg}),'bb','create_branch',{branch:'b/x',sha:SHA},'MontClip-Cindy')).ok,true);
});

// BB's comparison of #29 and #33 (2026-11-16): what AD needs to work when the owner adds it in the settings page.
const AD={appId:5764947,installationId:182084517,appName:'ADOppieXYZ'};
const adCfg=(extra={},rest={})=>validateConfig({newAccounts:{ad:{...AD,...extra}},...rest});
const tokenRequest=f=>f.calls.filter(c=>c.route.endsWith('/access_tokens')&&c.body.repository_ids).at(-1).body;
// Owner 2026-11-16 (via QQ): no per-account switch; permissions follow the actual installation.
test('AD item 1: a broader installation is accepted automatically; the execution token stays exact',async()=>{
 const broad=adCfg({role:'reviewer'});
 const f=fixture('ad',{scopeConfig:()=>broad,installPerms:AD_BROAD_INSTALL}),r=await run(f,'ad','identity');
 assert.equal(r.ok,true,r.errorCode);assert.deepEqual(r.result.missingInstallationPermissions,[]);
 assert.deepEqual(tokenRequest(f).permissions,{contents:'read',issues:'write',pull_requests:'write',metadata:'read'});
 // The minted token must equal the request: any extra or stronger permission is refused.
 for(const extra of [{contents:'write'},{secrets:'write'},{workflows:'write'},{administration:'read'},{issues:'read'}]){
  const g=fixture('ad',{scopeConfig:()=>broad,installPerms:AD_BROAD_INSTALL,tokenPerms:{contents:'read',issues:'write',pull_requests:'write',metadata:'read',...extra}});
  assert.equal((await run(g,'ad','get_pull',{number:320})).errorCode,'PERMISSION_MISMATCH',JSON.stringify(extra));
 }
 // An installation lacking a needed level fails with what is missing and where to add it.
 const missing=fixture('ad',{scopeConfig:()=>broad,installPerms:{...AD_BROAD_INSTALL,issues:'read'}}),m=await run(missing,'ad','identity');
 assert.equal(m.errorCode,'INSTALLATION_PERMISSION_MISSING');assert.deepEqual(m.details.missing,[{permission:'issues',required:'write',installed:'read'}]);
 assert.equal(m.details.app,'ADOppieXYZ');assert.match(m.details.installationUrl,/settings\/installations\/182084517$/);
 // The removed switch is not accepted in the configuration.
 assert.throws(()=>adCfg({allowBroaderInstallation:true}),{code:'INVALID_SCOPE_CONFIGURATION'});
});
test('AD item 2: a configured account that cannot write contents requests contents:read',async()=>{
 for(const role of ['review','reviewer','comment_review']){
  const f=fixture('ad',{scopeConfig:()=>adCfg({role})});assert.equal((await run(f,'ad','get_pull',{number:320})).ok,true,role);
  assert.equal(tokenRequest(f).permissions.contents,'read',role);
 }
 // A write role asks for contents:write only on a content write; its reads stay contents:read.
 const w=fixture('ad',{scopeConfig:()=>adCfg({role:'write'}),installPerms:PERMS('bb')});await run(w,'ad','get_pull',{number:320});
 assert.equal(tokenRequest(w).permissions.contents,'read');
 assert.equal((await run(w,'ad','create_branch',{branch:'ad/x',sha:SHA})).ok,true);assert.equal(tokenRequest(w).permissions.contents,'write');
 // Write role limited to operations that never touch contents: still contents:read.
 const ops=fixture('ad',{scopeConfig:()=>adCfg({role:'write',operations:['identity','get_pull','comment_issue','create_pull']})});
 assert.equal((await run(ops,'ad','get_pull',{number:320})).ok,true);assert.equal(tokenRequest(ops).permissions.contents,'read');
 // A reviewer given write on one repository by the owner needs contents:write.
 const perRepo=fixture('ad',{scopeConfig:()=>adCfg({role:'reviewer'},{repositoryRoles:{cindy:{bb:'write',deja:'write',dd:'write',qq:'write'},MontClip:{ad:'write'}}}),installPerms:PERMS('bb')});
 assert.equal((await run(perRepo,'ad','create_branch',{branch:'ad/x',sha:SHA})).ok,true);assert.equal(tokenRequest(perRepo).permissions.contents,'write');
});
test('AD item 3: the reviewer role reads, comments and submits any review event, and nothing else',async()=>{
 const cfg=adCfg({role:'reviewer'});
 assert.equal((await run(fixture('ad',{scopeConfig:()=>cfg}),'ad','comment_issue',{number:320,body:'x'})).ok,true);
 for(const event of ['COMMENT','APPROVE','REQUEST_CHANGES'])assert.equal((await run(fixture('ad',{scopeConfig:()=>cfg}),'ad','submit_review',{number:320,commit_id:SHA,event,body:'x'})).ok,true,event);
 for(const [operation,args] of [['create_branch',{branch:'ad/x',sha:SHA}],['create_issue',{title:'t'}],['update_pull',{number:320,title:'t'}],['create_pull',{title:'t',head:'a',base:'main'}]]){
  const f=fixture('ad',{scopeConfig:()=>cfg});const r=await run(f,'ad',operation,args);
  assert.equal(r.errorCode,'REVIEW_ONLY_REPOSITORY',operation);assert.equal(f.keyReads(),0);
 }
 // The plain review role still cannot comment.
 assert.equal((await run(fixture('ad',{scopeConfig:()=>adCfg({role:'review'})}),'ad','comment_issue',{number:320,body:'x'})).errorCode,'REVIEW_ONLY_REPOSITORY');
});
test('AD item 4: whether AD may use cindy is the owner setting (repository role none), not code',async()=>{
 const roles={cindy:{bb:'write',deja:'write',dd:'write',qq:'write'}};
 const allowed=fixture('ad',{scopeConfig:()=>adCfg({role:'reviewer'},{repositoryRoles:roles})});
 assert.equal((await run(allowed,'ad','get_pull',{number:320},'cindy')).ok,true);
 assert.ok(tokenRequest(allowed).repository_ids.includes(SEVEN.cindy));
 const blockedCfg=adCfg({role:'reviewer'},{repositoryRoles:{cindy:{...roles.cindy,ad:'none'}}});
 const blocked=fixture('ad',{scopeConfig:()=>blockedCfg});const r=await run(blocked,'ad','get_pull',{number:320},'cindy');
 assert.equal(r.errorCode,'REPOSITORY_NOT_ALLOWED');assert.equal(blocked.keyReads(),0);
 const other=fixture('ad',{scopeConfig:()=>blockedCfg});assert.equal((await run(other,'ad','get_pull',{number:320})).ok,true);
 assert.ok(!tokenRequest(other).repository_ids.includes(SEVEN.cindy),'cindy never reaches AD tokens');
 // 'none' is only a repository role, and an account must keep at least one repository.
 assert.throws(()=>adCfg({role:'none'}),{code:'INVALID_SCOPE_CONFIGURATION'});
 const all=Object.fromEntries(Object.keys(SEVEN).map(n=>[n,{ad:'none'}]));
 assert.throws(()=>adCfg({role:'reviewer'},{repositoryRoles:all}),{code:'INVALID_SCOPE_CONFIGURATION'});
});
