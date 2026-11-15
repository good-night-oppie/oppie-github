'use strict';
// #30: request_reviewers adds only GoodNightOppie as a requested reviewer so team PRs pass MontClip's
// sop-pr-lint reviewer check. Implementation accounts only; one POST with the reviewers field only.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {createClient,ACCOUNTS,OPERATION_NAMES,REVIEWER_ALLOWLIST,REVIEWER_REQUEST_ACCOUNTS}=require('../node/core.cjs');
const {initialPolicy}=require('../node/repository-policy.cjs');
// The reviewed design, written out independently of core.cjs.
const SIX={MontClip:1441621868,'MontClip-Cindy':1446532339,'montclip-rsi':1450602468,'rsi-playbooks':1450603260,'oppie-github':1451885379,'sglang-review-inbox':1451900929};
const SEVEN={...SIX,cindy:1457433299};
const IMPLEMENTERS=['bb','cindy','deja','gg','jj','pg','rea','video','vv'];
const REFUSED={dd:'REVIEWER_REQUEST_ACCOUNT_REFUSED',reviewinbox:'REVIEWER_REQUEST_ACCOUNT_REFUSED',qq:'QQ_AUTHORING_REFUSED'};
// Execution-token permissions before #30; this change must not alter them for any account.
const TOKEN_PERMISSIONS=account=>({contents:['qq','reviewinbox'].includes(account)?'read':'write',issues:'write',pull_requests:'write',metadata:'read',...(account==='qq'?{administration:'write'}:{})});
const pem=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
const now=Date.parse('2026-11-15T05:00:00Z');
const rows=map=>({total_count:Object.keys(map).length,repositories:Object.entries(map).map(([name,id])=>({id,name,full_name:'good-night-oppie/'+name}))});
const GOOD={number:7,reviewers:['GoodNightOppie']};
function fixture(account,{write}={}){
 const calls=[],tokenRequests=[];let keyReads=0,requested;const a=ACCOUNTS[account];
 const permissions=TOKEN_PERMISSIONS(account),installPermissions={...permissions,...(account==='pg'?{administration:'write'}:{})};
 const client=createClient({now:()=>now,credentials:async()=>{keyReads++;return pem;},fetch:async(url,init)=>{
  const u=new URL(url),route=u.pathname,method=init.method||'GET',body=init.body?JSON.parse(init.body):null;calls.push({route,body,method});let data,status=200;
  if(route==='/app')data={id:a.app_id,slug:a.app_slug,owner:{login:'good-night-oppie'}};
  else if(route==='/app/installations/'+a.installation_id)data={id:a.installation_id,app_id:a.app_id,account:{login:'good-night-oppie',type:'Organization'},repository_selection:'selected',permissions:installPermissions};
  else if(route.endsWith('/access_tokens')){if(body.repository_ids){requested=body.repository_ids;tokenRequests.push(body.permissions);}data={token:body.repository_ids?'exec':'probe',expires_at:new Date(now+600000).toISOString(),permissions:body.repository_ids?permissions:{metadata:'read'}};}
  else if(route==='/installation/repositories')data=init.headers.Authorization==='Bearer probe'?rows(SEVEN):rows(Object.fromEntries(Object.entries(SEVEN).filter(([,id])=>requested.includes(id))));
  else if(route.startsWith('/repos/good-night-oppie/')&&method!=='GET'){
   if(write==='throw')throw Error('socket hang up');
   if(write)return {ok:false,status:write,text:async()=>JSON.stringify({message:'Reviews may only be requested from collaborators.'})};
   data={number:7,html_url:'https://github.com/good-night-oppie/'+route.split('/')[3]+'/pull/7',requested_reviewers:[{login:'GoodNightOppie'}]};
  }
  else throw Error('Unexpected request '+method+' '+route);
  return {ok:status>=200&&status<300,status,text:async()=>JSON.stringify(data)};
 }});
 return {client,calls,tokenRequests,keyReads:()=>keyReads};
}
const run=(f,account,args,repo='MontClip',operation='request_reviewers')=>f.client.run({account,repo,operation,args});
const repoCalls=f=>f.calls.filter(c=>c.route.startsWith('/repos/'));
async function refused(account,args,code,repo='MontClip',operation='request_reviewers'){
 const f=fixture(account),r=await run(f,account,args,repo,operation);
 assert.equal(r.ok,false,account+' '+JSON.stringify(args));assert.equal(r.errorCode,code,account+' '+JSON.stringify(args));
 assert.equal(r.execution,'not_executed');assert.equal(f.keyReads(),0,'private key read');assert.equal(f.calls.length,0,'network call');
}

// Positive.
test('the reviewer allowlist and account list are exactly the reviewed design',()=>{
 assert.deepEqual([...REVIEWER_ALLOWLIST],['GoodNightOppie']);
 assert.deepEqual([...REVIEWER_REQUEST_ACCOUNTS].sort(),[...IMPLEMENTERS].sort());
 assert.equal(Object.isFrozen(REVIEWER_ALLOWLIST)&&Object.isFrozen(REVIEWER_REQUEST_ACCOUNTS),true);
 for(const account of Object.keys(REFUSED))assert.equal(REVIEWER_REQUEST_ACCOUNTS.includes(account),false,account);
 // The AD account proposed in #29 is a review account and is not on the list either.
 assert.equal(REVIEWER_REQUEST_ACCOUNTS.includes('ad'),false);
 assert.ok(OPERATION_NAMES.includes('request_reviewers'));
});
test('each implementation account requests GoodNightOppie with exactly one POST carrying only reviewers',async()=>{
 for(const account of IMPLEMENTERS){
  const f=fixture(account),r=await run(f,account,GOOD);
  assert.equal(r.ok,true,account+JSON.stringify(r));assert.equal(r.receipt.execution,'completed');assert.equal(r.receipt.operation,'request_reviewers');
  assert.equal(r.receipt.url,'https://github.com/good-night-oppie/MontClip/pull/7');
  assert.deepEqual(repoCalls(f),[{route:'/repos/good-night-oppie/MontClip/pulls/7/requested_reviewers',method:'POST',body:{reviewers:['GoodNightOppie']}}],account);
  assert.equal(f.keyReads(),1);
 }
});
test('the request works on each repository in the account execution set and nowhere else',async()=>{
 const policy=initialPolicy();
 for(const account of IMPLEMENTERS)for(const repo of Object.keys(SEVEN)){
  const allowed=Object.hasOwn(policy.accounts[account].execution,repo);
  if(!allowed){await refused(account,GOOD,'REPOSITORY_NOT_ALLOWED',repo);continue;}
  const f=fixture(account),r=await run(f,account,GOOD,repo);
  assert.equal(r.ok,true,account+' '+repo);
  assert.deepEqual(repoCalls(f).map(c=>c.method+' '+c.route),['POST /repos/good-night-oppie/'+repo+'/pulls/7/requested_reviewers']);
 }
 for(const repo of ['MontClip','MontClip-Cindy','montclip-rsi'])assert.ok(Object.hasOwn(policy.accounts.bb.execution,repo));
 await refused('bb',GOOD,'REPOSITORY_NOT_ALLOWED','makecindy/cindy');
});

// Negative: everything below is refused before a private key is read or any request is made.
test('names other than GoodNightOppie, including case variants, are refused before credentials',async()=>{
 for(const reviewers of [['goodnightoppie'],['GOODNIGHTOPPIE'],['goodNightOppie'],[' GoodNightOppie'],['GoodNightOppie '],['GoodNightOppie\n'],['@GoodNightOppie'],['EdwardTang'],['QQOppieXYZ'],['qqoppiexyz[bot]'],['good-night-oppie/GoodNightOppie'],[''],['GoodNightOppie','EdwardTang'],['EdwardTang','GoodNightOppie'],[null],[1],[{login:'GoodNightOppie'}],[['GoodNightOppie']]])
  await refused('bb',{number:7,reviewers},'REVIEWER_NOT_ALLOWED');
});
test('empty, missing or non-list reviewers and duplicates are refused before credentials',async()=>{
 for(const args of [{number:7,reviewers:[]},{number:7},{number:7,reviewers:'GoodNightOppie'},{number:7,reviewers:null},{number:7,reviewers:{0:'GoodNightOppie'}}])await refused('bb',args,'REVIEWERS_REQUIRED');
 await refused('bb',{number:7,reviewers:['GoodNightOppie','GoodNightOppie']},'DUPLICATE_REVIEWER');
 await refused('deja',{number:7,reviewers:['GoodNightOppie','GoodNightOppie','GoodNightOppie']},'DUPLICATE_REVIEWER');
});
test('team_reviewers and any other extra argument are refused before credentials',async()=>{
 const extras=[{team_reviewers:['reviewers']},{team_reviewers:[]},{title:'x'},{body:'x'},{state:'closed'},{base:'main'},{draft:false},{method:'DELETE'},{reviewer:'GoodNightOppie'},{assignees:['GoodNightOppie']},{labels:['x']}];
 for(const extra of extras)await refused('bb',{...GOOD,...extra},'INVALID_ARGUMENTS');
 await refused('bb',{number:7,team_reviewers:['reviewers']},'INVALID_ARGUMENTS');
 for(const number of [0,-1,1.5,'7',null,undefined])await refused('bb',{number,reviewers:['GoodNightOppie']},'INVALID_ARGUMENTS');
 for(const args of [null,[],'x'])await refused('bb',args,'INVALID_ARGUMENTS');
});
test('review accounts and reviewinbox are refused before credentials, even with valid arguments',async()=>{
 for(const [account,code] of Object.entries(REFUSED))for(const repo of ['MontClip','MontClip-Cindy','cindy'])await refused(account,GOOD,code,repo);
 // The account check comes first, so invalid arguments still report the account refusal.
 await refused('dd',{number:7,reviewers:['EdwardTang']},'REVIEWER_REQUEST_ACCOUNT_REFUSED');
 await refused('reviewinbox',{number:7,team_reviewers:['x']},'REVIEWER_REQUEST_ACCOUNT_REFUSED');
 // ad (#29, a review account) gets no request either: unknown on this base, refused once #29 adds it.
 {const f=fixture('bb'),r=await run(f,'ad',GOOD);assert.equal(r.ok,false);assert.ok(['ACCOUNT_REQUIRED','REVIEWER_REQUEST_ACCOUNT_REFUSED'].includes(r.errorCode),r.errorCode);assert.equal(r.execution,'not_executed');assert.equal(f.keyReads(),0);assert.equal(f.calls.length,0);}
});
test('there is no removal or team operation',async()=>{
 for(const operation of ['remove_reviewers','remove_requested_reviewers','request_team_reviewers','delete_requested_reviewers'])await refused('bb',GOOD,'UNKNOWN_OPERATION','MontClip',operation);
 const core=fs.readFileSync(path.join(__dirname,'..','node','core.cjs'),'utf8');
 assert.equal(/'DELETE'/.test(core),false,'core issues no DELETE requests');
 assert.equal((core.match(/requested_reviewers/g)||[]).length,1,'one requested_reviewers route');
});

// Write outcomes.
test('GitHub rejections are reported once without retry; an unknown outcome is not retried',async()=>{
 for(const status of [422,403,404]){
  const f=fixture('bb',{write:status}),r=await run(f,'bb',GOOD);
  assert.equal(r.errorCode,'GITHUB_HTTP_'+status);assert.equal(r.execution,'not_executed');assert.equal(repoCalls(f).length,1);
 }
 const f=fixture('bb',{write:503}),r=await run(f,'bb',GOOD);assert.equal(r.execution,'unknown');assert.equal(repoCalls(f).length,1);
 const g=fixture('bb',{write:'throw'}),u=await run(g,'bb',GOOD);
 assert.equal(u.errorCode,'WRITE_OUTCOME_UNKNOWN');assert.equal(u.execution,'unknown');assert.equal(repoCalls(g).length,1);
 const main=fs.readFileSync(path.join(__dirname,'..','main.js'),'utf8');
 assert.equal(/READ_ONLY_OPERATIONS=new Set\([^)]*request_reviewers/.test(main),false,'host treats it as a write');
});

// Permissions: no App or token permission changes.
test('permission declarations are unchanged: execution tokens match the pre-#30 table and create_pull',async()=>{
 for(const account of IMPLEMENTERS){
  const f=fixture(account);assert.equal((await run(f,account,GOOD)).ok,true);
  const g=fixture(account);assert.equal((await run(g,account,{title:'t',head:'x',base:'main'},'MontClip','create_pull')).ok,true);
  assert.deepEqual(f.tokenRequests,[TOKEN_PERMISSIONS(account)],account);
  assert.deepEqual(f.tokenRequests,g.tokenRequests,account);
 }
 const root=path.join(__dirname,'..');
 const deployment=JSON.parse(fs.readFileSync(path.join(root,'deployment.json'),'utf8'));
 // Accounts and deployment profile are not touched by #30; they follow the compiled account table.
 assert.deepEqual(deployment,{accounts:Object.keys(ACCOUNTS),automaticReviews:false});
 const ghost=JSON.parse(fs.readFileSync(path.join(root,'ghost.json'),'utf8'));
 assert.equal(JSON.stringify(ghost).includes('"permissions"'),false,'no permission block in the manifest');
 const github=ghost.tools.find(t=>t.name==='github');
 assert.deepEqual(github.parameters.properties.account.enum,Object.keys(ACCOUNTS));
 assert.deepEqual(github.parameters.properties.operation,{type:'string'});
});
test('request_reviewers is advertised with its limits',()=>{
 const operations=require('../node/operations.cjs');
 assert.match(operations.request_reviewers,/GoodNightOppie/);
 assert.match(operations.request_reviewers,/no team_reviewers/);
 assert.match(operations.request_reviewers,/dd, qq and reviewinbox are refused/);
});
