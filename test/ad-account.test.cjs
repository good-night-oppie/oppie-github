'use strict';
// #28: the AD teammate account (App ADOppieXYZ / adoppiexyz). Installation follows the shared rule
// (six repositories, or six plus the optional cindy). QQ decision on #28: in the plugin, ad only
// reads, comments on issues and PRs and submits reviews (COMMENT/APPROVE/REQUEST_CHANGES) on the six;
// no pushes, branches, issue/PR edits, merges, queueing, settings or admin; cindy not in its set.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {createClient,ACCOUNTS}=require('../node/core.cjs');
const {initialPolicy,ACCOUNT_NAMES}=require('../node/repository-policy.cjs');
const {APP_IDS,INSTALL_IDS,metadata}=require('../node/store.cjs');
// Reviewed identity, written out independently of the implementation (QQ, #28 issuecomment-6887517852).
const AD={app_id:5764947,installation_id:182084517,app_name:'ADOppieXYZ',slug:'adoppiexyz'};
const SIX={MontClip:1441621868,'MontClip-Cindy':1446532339,'montclip-rsi':1450602468,'rsi-playbooks':1450603260,'oppie-github':1451885379,'sglang-review-inbox':1451900929};
const SEVEN={...SIX,cindy:1457433299};
// Execution token for ad: no contents write.
const TOKEN={contents:'read',issues:'write',pull_requests:'write',metadata:'read'};
// The installation permissions QQ read for adoppiexyz: far broader than the plugin role.
const AD_INSTALLATION={administration:'read',metadata:'read',organization_license_policy:'read',dependabot_alerts:'write',license_compliance_alerts:'write',actions:'write',checks:'write',contents:'write',statuses:'write',repository_custom_properties:'write',deployments:'write',environments:'write',issues:'write',merge_queues:'write',packages:'write',pages:'write',pull_requests:'write',repository_advisories:'write',repository_hooks:'write',secret_scanning_alert_dismissal_requests:'write',secrets:'write',workflows:'write'};
const SHA='a'.repeat(40),SHA2='b'.repeat(40),ASSISTED='m\n\nAssisted-by: Cindy (https://cindy.app)';
const pem=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
const now=Date.parse('2026-11-15T02:00:00Z');
const rows=map=>({total_count:Object.keys(map).length,repositories:Object.entries(map).map(([name,id])=>({id,name,full_name:'good-night-oppie/'+name}))});
function fixture({installed=rows(SIX),appId=AD.app_id,slug=AD.slug,installPermissions=AD_INSTALLATION,tokenPermissions}={}){
 const calls=[];let keyReads=0,requested;
 const client=createClient({now:()=>now,credentials:async alias=>{assert.equal(alias,'ad');keyReads++;return pem;},fetch:async(url,init)=>{
  const u=new URL(url),route=u.pathname,method=init.method||'GET',body=init.body?JSON.parse(init.body):null;calls.push({route,body,method});let data,status=200;
  if(route==='/app')data={id:appId,slug,owner:{login:'good-night-oppie'}};
  else if(route==='/app/installations/'+AD.installation_id)data={id:AD.installation_id,app_id:AD.app_id,account:{login:'good-night-oppie',type:'Organization'},repository_selection:'selected',permissions:installPermissions};
  // GitHub returns exactly the requested permissions unless a test overrides them.
  else if(route.endsWith('/access_tokens')){requested=body.repository_ids;data={token:body.repository_ids?'exec':'probe',expires_at:new Date(now+600000).toISOString(),permissions:body.repository_ids?(tokenPermissions||body.permissions):{metadata:'read'}};}
  else if(route==='/installation/repositories')data=init.headers.Authorization==='Bearer probe'?installed:rows(Object.fromEntries(Object.entries(SEVEN).filter(([,id])=>requested.includes(id))));
  else if(/\/pulls\/7$/.test(route)&&method==='GET')data={number:7,head:{sha:SHA},state:'open',draft:false};
  else if(route.startsWith('/repos/good-night-oppie/'))data={id:1,number:1,html_url:'https://github.com/'+route.slice(7)};
  else throw Error('Unexpected request');
  return {ok:status>=200&&status<300,status,text:async()=>JSON.stringify(data)};
 }});
 return {client,calls,keyReads:()=>keyReads};
}
const run=(f,operation,args={},repo='MontClip')=>f.client.run({account:'ad',repo,operation,args});
const writes=f=>f.calls.filter(c=>c.route.startsWith('/repos/')&&c.method!=='GET');
const mint=f=>f.calls.filter(c=>c.route.endsWith('/access_tokens')).at(-1).body;
async function refused(operation,args,code,repo='MontClip'){
 const f=fixture(),r=await run(f,operation,args,repo);
 assert.equal(r.errorCode,code,operation);assert.equal(r.execution,'not_executed');assert.equal(f.keyReads(),0);assert.equal(f.calls.length,0);
}
const REVIEWS=['COMMENT','APPROVE','REQUEST_CHANGES'].map(event=>['submit_review',{number:7,commit_id:SHA,event,body:'review'}]);
const READS=[['identity',{}],['get_contents',{path:'README.md'}],['list_branches',{}],['list_issues',{}],['get_issue',{number:1}],['list_pulls',{}],['get_pull',{number:7}],['pull_files',{number:7}],['list_reviews',{number:7}]];
const DENIED=[
 ['create_branch',{branch:'agy/x',sha:SHA}],
 ['update_file',{path:'a.txt',branch:'agy/x',expected_sha:null,message:ASSISTED,content_base64:'eA=='}],
 ['edit_file',{path:'a.txt',branch:'agy/x',expected_sha:SHA,expected_result_sha256:'b'.repeat(64),message:'m',edits:[{old_text:'a',new_text:'b'}]}],
 ['commit_files',{branch:'agy/x',expected_head:SHA,message:ASSISTED,changes:[{path:'a.txt',content_base64:'eA=='}]}],
 ['create_pull',{title:'t',head:'agy/x',base:'main'}],
 ['update_pull',{number:7,title:'t'}],
 ['create_issue',{title:'t'}],
 ['update_issue',{number:1,state:'closed'}],
 ['admin_get',{}],
 ['admin_update',{allow_squash_merge:true}],
];

test('ad is a known alias in the tool schemas, deployment and policy',()=>{
 const ghost=JSON.parse(fs.readFileSync(path.join(__dirname,'..','ghost.json'),'utf8'));
 for(const name of ['github','github_import_key'])assert.ok(ghost.tools.find(t=>t.name===name).parameters.properties.account.enum.includes('ad'),name);
 assert.ok(JSON.parse(fs.readFileSync(path.join(__dirname,'..','deployment.json'),'utf8')).accounts.includes('ad'));
 assert.deepEqual(Object.keys(ACCOUNTS).sort(),[...ACCOUNT_NAMES].sort());
 assert.deepEqual(Object.keys(APP_IDS).sort(),[...ACCOUNT_NAMES].sort());
 assert.deepEqual(Object.keys(INSTALL_IDS).sort(),[...ACCOUNT_NAMES].sort());
});
test('ad identity is pinned: App ID, installation ID, name, slug, no admin',()=>{
 const a=ACCOUNTS.ad;
 assert.equal(a.app_id,AD.app_id);assert.equal(a.installation_id,AD.installation_id);
 assert.equal(a.app_name,AD.app_name);assert.equal(a.app_slug,AD.slug);assert.equal(a.admin,false);
 assert.equal(APP_IDS.ad,String(AD.app_id));assert.equal(INSTALL_IDS.ad,String(AD.installation_id));
 const m=metadata('ad');assert.equal(m.appId,String(AD.app_id));assert.equal(m.installationId,String(AD.installation_id));assert.equal(m.admin,false);
});
test('ad policy: installation six or six plus cindy; execution the six without cindy',()=>{
 const p=initialPolicy().accounts.ad;
 assert.deepEqual(p.installation,SEVEN);assert.deepEqual(p.execution,SIX);
});
test('other accounts are unchanged by adding ad',()=>{
 const p=initialPolicy().accounts;
 for(const a of ['bb','deja','dd','qq'])assert.deepEqual(p[a].execution,SEVEN,a);
 for(const a of ['cindy','gg','jj','pg','rea','video','vv'])assert.deepEqual(p[a].execution,SIX,a);
 assert.deepEqual(p.reviewinbox.execution,{MontClip:1441621868,'MontClip-Cindy':1446532339});
 assert.equal(ACCOUNTS.bb.app_id,5665927);assert.equal(ACCOUNTS.qq.admin,true);assert.equal(ACCOUNTS.reviewinbox.installation_id,180305629);
});

// Three installation states.
test('six repositories installed: reads, comments and all three review events work on every repository; token has no contents write',async()=>{
 for(const repo of Object.keys(SIX)){
  const f=fixture(),r=await run(f,'identity',{},repo);
  assert.equal(r.ok,true,repo+': '+r.errorCode);assert.deepEqual(mint(f),{repository_ids:Object.values(SIX),permissions:TOKEN});
  assert.deepEqual(r.result.permissions,TOKEN);
  for(const [operation,args] of [['comment_issue',{number:1,body:'x'}],...REVIEWS]){
   const w=fixture(),c=await run(w,operation,args,repo);assert.equal(c.ok,true,repo+' '+operation+': '+c.errorCode);assert.equal(writes(w).length,1);
  }
 }
 await refused('identity',{},'REPOSITORY_NOT_ALLOWED','cindy');
});
test('six repositories plus cindy installed: identity passes; cindy stays outside the execution set',async()=>{
 const f=fixture({installed:rows(SEVEN)}),r=await run(f,'identity');
 assert.equal(r.ok,true,r.errorCode);assert.equal(r.result.installationRepositories.length,7);assert.deepEqual(r.result.repositories.map(x=>x.id),Object.values(SIX));
 for(const [operation,args] of [['identity',{}],['get_issue',{number:1}],['comment_issue',{number:1,body:'x'}]])await refused(operation,args,'REPOSITORY_NOT_ALLOWED','cindy');
});
test('six repositories plus an unknown repository, or a missing one: still a mismatch',async()=>{
 const odd=rows(SIX);odd.repositories.push({id:99,name:'other',full_name:'good-night-oppie/other'});odd.total_count++;
 const missing=rows(SIX);missing.repositories.shift();missing.total_count--;
 for(const installed of [odd,missing]){
  const f=fixture({installed}),r=await run(f,'identity');
  assert.equal(r.errorCode,'INSTALLATION_REPOSITORY_SCOPE_MISMATCH');assert.equal(r.execution,'not_executed');
  assert.equal(f.calls.filter(c=>c.route.endsWith('/access_tokens')).length,1);
 }
});

// Role (QQ decision on #28) and guardrails.
test('ad may read every repository',async()=>{
 for(const [operation,args] of READS){const f=fixture(),r=await run(f,operation,args);assert.equal(r.ok,true,operation+': '+r.errorCode);assert.equal(writes(f).length,0);}
});
test('ad cannot push, branch, edit files, create or edit issues and PRs, or use admin operations',async()=>{
 for(const [operation,args] of DENIED)await refused(operation,args,'REVIEW_ONLY_ACCOUNT');
});
test('ad cannot use QQ-only operations: no merge queue, rulesets or dismissals',async()=>{
 for(const [operation,args] of [['list_rulesets',{}],['get_ruleset',{ruleset_id:1}],['dismiss_review',{number:7,review_id:1,message:'x'}],['enqueue_pull',{number:7,commit_id:SHA}],['ruleset_update',{ruleset_id:1,ruleset:{enforcement:'active'},owner_authorization:'https://github.com/good-night-oppie/MontClip/issues/1#issuecomment-2',nonce:'a'.repeat(32)}]])
  await refused(operation,args,'QQ_ACCOUNT_REQUIRED');
 for(const operation of ['merge_pull','merge','enable_auto_merge'])await refused(operation,{number:7},'UNKNOWN_OPERATION');
});
test('ad cannot write the default branch or force-push',async()=>{
 for(const [operation,args] of [['create_branch',{branch:'main',sha:SHA}],['update_file',{path:'a.txt',branch:'main',expected_sha:null,message:ASSISTED,content_base64:'eA=='}],['commit_files',{branch:'main',expected_head:SHA,message:ASSISTED,changes:[{path:'a.txt',content_base64:'eA=='}]}],['commit_files',{branch:'agy/x',expected_head:SHA,parent:SHA2,message:ASSISTED,changes:[{path:'a.txt',content_base64:'eA=='}]}]])
  await refused(operation,args,'REVIEW_ONLY_ACCOUNT');
 const f=fixture(),r=await run(f,'commit_files',{branch:'agy/x',expected_head:SHA,message:ASSISTED,force:true,changes:[{path:'a.txt',content_base64:'eA=='}]});
 assert.equal(r.ok,false);assert.equal(r.execution,'not_executed');assert.equal(f.keyReads(),0);assert.equal(writes(f).length,0);
});
test('ad installation may be broader than its role, but must include the four required levels',async()=>{
 const basic={contents:'write',issues:'write',pull_requests:'write',metadata:'read'};
 for(const installPermissions of [AD_INSTALLATION,basic,{...basic,contents:'read'}]){const f=fixture({installPermissions}),r=await run(f,'identity');assert.equal(r.ok,true,JSON.stringify(installPermissions)+': '+r.errorCode);}
 const {contents:_,...noContents}=AD_INSTALLATION;
 for(const installPermissions of [{...AD_INSTALLATION,issues:'read'},{...AD_INSTALLATION,pull_requests:'none'},noContents,{...AD_INSTALLATION,metadata:'unknown'}]){
  const f=fixture({installPermissions}),r=await run(f,'identity');assert.equal(r.errorCode,'PERMISSION_MISMATCH',JSON.stringify(installPermissions));
 }
});
test('ad execution token is checked exactly: extra or stronger grants fail closed before any business call',async()=>{
 for(const tokenPermissions of [{...TOKEN,contents:'write'},{...TOKEN,workflows:'write'},{...TOKEN,secrets:'write'},{...TOKEN,administration:'read'},{...TOKEN,issues:'read'}]){
  const f=fixture({tokenPermissions}),r=await run(f,'comment_issue',{number:1,body:'x'});
  assert.equal(r.errorCode,'PERMISSION_MISMATCH',JSON.stringify(tokenPermissions));assert.equal(writes(f).length,0);
 }
});
test('ad fails closed on a different App or slug',async()=>{
 for(const opts of [{appId:5665927},{slug:'bboppiexyz'}]){
  const f=fixture(opts),r=await run(f,'identity');assert.equal(r.ok,false,JSON.stringify(opts));assert.equal(r.execution,'not_executed');
 }
});
