'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createClient,makeJwt,ACCOUNTS,configuredAccount,OPERATION_NAMES,OPERATION_NEEDS}=require('../node/core.cjs');
const {validateConfig}=require('../node/scope-config.cjs');
const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const PEM=privateKey.export({type:'pkcs8',format:'pem'});
const NOW=1800000000000;
const expected={contents:'write',issues:'write',pull_requests:'write',metadata:'read'};
// Owner 2026-11-16: every App is installed on all repositories of good-night-oppie (56 today).
const INSTALLED=['MontClip','MontClip-Cindy','montclip-rsi','oppie-github','cindy',...Array.from({length:51},(_,i)=>'repo-'+i)];
const installed=names=>({total_count:names.length,repositories:names.map(name=>({id:1000+INSTALLED.indexOf(name),name,full_name:'good-night-oppie/'+name}))});
const AD_CONFIG=validateConfig({newAccounts:{ad:{appId:5764947,appName:'ADOppieXYZ'}}});
const SHA='a'.repeat(40);
// options: account, config, permissions (installation), installed (repository names), installations
// (list for configured accounts), slug, wrongApp, wrongOwner, expired, repositories (execution listing), override.
function fixture(options={}){
 const calls=[];const tokenRepositories=new Map();let credentialsCalls=0;let counter=0;
 const config=options.config||(options.account==='ad'?AD_CONFIG:undefined);
 const account=configuredAccount(options.account||'bb',config||validateConfig({}));
 const remote={permissions:options.permissions||{...expected,...(['qq','pg'].includes(account.account)?{administration:'write'}:{})},installed:options.installed||INSTALLED,selection:'all'};
 const installation=()=>({id:account.installation_id||182084517,app_id:account.app_id,account:{login:options.wrongOwner?'bad':'good-night-oppie',type:'Organization'},repository_selection:remote.selection,suspended_at:null,permissions:remote.permissions});
 const fetch=async(url,init)=>{
  const path=new URL(url).pathname;calls.push({url,path,...init,parsed:init.body?JSON.parse(init.body):undefined});
  assert.equal(new URL(url).origin,'https://api.github.com');assert.equal(init.redirect,'error');
  let data,status=200;
  if(options.override){const out=await options.override(path,init,calls);if(out){if(out.throw)throw Error('secret-token '+PEM);return {ok:out.status>=200&&out.status<300,status:out.status,text:async()=>out.raw!==undefined?out.raw:JSON.stringify(out.data)};}}
  if(path==='/app'){const slug=options.slug||(account.account==='reviewinbox'?'reviewinboxoppiexyz':account.configured?account.app_slug:'oppie-agent-'+account.account);data={id:options.wrongApp?9:account.app_id,slug,owner:{login:'good-night-oppie'},html_url:'https://github.com/apps/'+slug};}
  else if(path==='/app/installations')data=options.installations?options.installations(installation()):[installation(),{...installation(),id:999,account:{login:'someone-else',type:'User'}}];
  else if(account.installation_id&&path==='/app/installations/'+account.installation_id)data=installation();
  else if(path.endsWith('/access_tokens')){
   const request=JSON.parse(init.body);
   if(request.repository_ids)request.repositories=request.repository_ids.map(id=>INSTALLED[id-1000]??'unknown-'+id);
   if(request.repositories&&request.repositories.some(n=>!remote.installed.includes(n)))return {ok:false,status:422,text:async()=>JSON.stringify({message:'There is at least one repository that does not exist or is not accessible to the parent installation.'})};
   if(Object.entries(request.permissions||{}).some(([k,v])=>!remote.permissions[k]||(remote.permissions[k]==='read'&&v==='write')))return {ok:false,status:422,text:async()=>'{}'};
   data={token:'secret-token-'+(++counter),expires_at:new Date(options.expired?NOW-1:NOW+3600000).toISOString(),permissions:request.permissions};
   tokenRepositories.set('Bearer '+data.token,{probe:!request.repository_ids,list:installed(request.repositories||remote.installed)});
  }
  else if(path==='/installation/repositories'){const t=tokenRepositories.get(init.headers.Authorization);data=options.repositories&&t&&!t.probe?options.repositories:t?.list;}
  else if(path.endsWith('/pulls/7'))data={number:7,head:{sha:options.head||SHA},state:'open',draft:!!options.draft};
  else if(/[/]pulls[/][0-9]+$/.test(path)&&init.method==='GET')return {ok:false,status:404,text:async()=>'{}'};
  else if(/^\/repos\/good-night-oppie\/[^/]+$/.test(path)){const name=path.split('/').pop();if(!INSTALLED.includes(name))return {ok:false,status:404,text:async()=>'{}'};data={id:1000+INSTALLED.indexOf(name),name,full_name:'good-night-oppie/'+name,owner:{login:'good-night-oppie'},default_branch:'main'};}
  else data={id:1,html_url:'https://github.com/good-night-oppie/MontClip/issues/1',body:'normal result'};
  return {ok:status===200,status,text:async()=>JSON.stringify(data)};
 };
 return {calls,remote,client:createClient({scopeConfig:config?()=>config:undefined,credentials:async alias=>{credentialsCalls++;assert.equal(alias,account.account);return PEM;},fetch,now:()=>NOW,authorize:options.authorize,claimAuthorization:options.claimAuthorization|| (async()=>true)}),credentialsCalls:()=>credentialsCalls};
}
const input=(operation,args={},account='bb',repo='MontClip')=>({account,repo,operation,args});
// Execution tokens are requested by repository ID (ADR 0003 section 2 step 6); shown here by name.
const executionTokens=calls=>calls.filter(c=>c.path.endsWith('/access_tokens')&&c.parsed.repository_ids).map(c=>({repositories:c.parsed.repository_ids.map(id=>INSTALLED[id-1000]),permissions:c.parsed.permissions}));
// Calls that act on a repository beyond reading its own metadata (used to resolve its ID).
const businessCalls=calls=>calls.filter(c=>/^[/]repos[/]good-night-oppie[/][^/]+[/]./.test(c.path));
const resolveTokens=calls=>calls.filter(c=>c.path.endsWith('/access_tokens')&&c.parsed.repositories).map(c=>c.parsed);

for(const variant of ['extra','missing','wrong-name','duplicate','count']){
 test(`execution scope diagnostic: ${variant} remains blocked before business execution`,async()=>{
  const actual=installed(['MontClip']);
  if(variant==='extra')actual.repositories.push({id:99,name:'other',full_name:'good-night-oppie/other'});
  if(variant==='missing')actual.repositories.shift();
  if(variant==='wrong-name')actual.repositories[0]={...actual.repositories[0],full_name:'other-org/MontClip'};
  if(variant==='duplicate')actual.repositories.push(actual.repositories[0]);
  actual.total_count=variant==='count'?99:actual.repositories.length;
  const f=fixture({repositories:actual});
  const r=await f.client.run(input('get_issue',{number:3}));
  assert.equal(r.errorCode,'EXECUTION_REPOSITORY_SCOPE_MISMATCH');
  assert.equal(r.execution,'not_executed');
  assert.deepEqual(r.diagnostics.expectedRepositories,['good-night-oppie/MontClip']);
  assert.deepEqual(r.diagnostics.actualRepositories,actual.repositories.map(x=>x.full_name));
  assert.equal(executionTokens(f.calls).length,1);
  assert.equal(businessCalls(f.calls).length,0);
  assert.ok(!JSON.stringify(r).includes('secret-token'));
  assert.ok(!JSON.stringify(r).includes('PRIVATE KEY'));
 });
}
test('scope diagnostics omit malformed names and extra response fields, and redact known secrets',async()=>{
 const f=fixture({repositories:{total_count:4,repositories:[
  {full_name:'good-night-oppie/secret-token-1',token:'secret-token-1',private_key:PEM},
  {full_name:'bad\nname/repo'}, {full_name:PEM}, null
 ]}});
 const r=await f.client.run(input('identity'));
 assert.equal(r.errorCode,'EXECUTION_REPOSITORY_SCOPE_MISMATCH');
 assert.deepEqual(r.diagnostics.actualRepositories,['good-night-oppie/[REDACTED]']);
 assert.deepEqual(Object.keys(r.diagnostics).sort(),['actualRepositories','expectedRepositories']);
 assert.ok(!JSON.stringify(r).includes('secret-token'));
 assert.ok(!JSON.stringify(r).includes('PRIVATE KEY'));
});
test('JWT is RSA signed, short lived, and names fixed app id',()=>{
 const jwt=makeJwt(ACCOUNTS.bb,PEM,NOW);const [h,p,s]=jwt.split('.');
 const payload=JSON.parse(Buffer.from(p,'base64url'));assert.equal(payload.iss,String(ACCOUNTS.bb.app_id));assert.equal(payload.exp-payload.iat,540);
 assert.equal(crypto.verify('RSA-SHA256',Buffer.from(h+'.'+p),publicKey,Buffer.from(s,'base64url')),true);
});
test('identity: token for the target repository with metadata only, whole installation reported, credentials never returned',async()=>{
 const f=fixture();const r=await f.client.run(input('identity'));
 assert.equal(r.ok,true,r.errorCode);assert.equal(r.receipt.app_slug,'oppie-agent-bb');
 assert.deepEqual(r.result.repository,{id:1000,full_name:'good-night-oppie/MontClip'});
 assert.equal(r.result.installationRepositories.complete,true);assert.equal(r.result.installationRepositories.repositories.length,56);
 assert.ok(!JSON.stringify(r).includes('secret-token'));assert.ok(!JSON.stringify(r).includes('PRIVATE KEY'));
 const grants=f.calls.filter(c=>c.path.endsWith('/access_tokens'));
 assert.deepEqual(grants[0].parsed,{repositories:['MontClip'],permissions:{metadata:'read'}},'resolve the name: metadata only');
 assert.deepEqual(grants[1].parsed,{repository_ids:[1000],permissions:{metadata:'read'}},'execution token by repository ID');
 assert.deepEqual(grants[2].parsed,{permissions:{metadata:'read'}},'listing probe: metadata only');
});
test('account mandatory and unknown account, repository escapes, operation rejected before key read',async()=>{
 const f=fixture();for(const value of [ {...input('identity'),account:undefined},{...input('identity'),account:'EdwardTang'},{...input('identity'),account:'ad'},{...input('identity'),repo:'other/MontClip'},{...input('identity'),repo:'../x'},{...input('get_pull',{number:1}),repo:undefined},{...input('identity'),operation:'raw_request'},input('get_contents',{path:'../secret'}),input('get_contents',{path:'a%2fb'}),input('create_branch',{branch:'bad..ref',sha:SHA}),input('identity',{url:'https://evil.test'})]){
  assert.equal((await f.client.run(value)).ok,false);
 }
 assert.equal(f.credentialsCalls(),0);assert.equal(f.calls.length,0);
});
test('wrong app or organization cannot mint execution token',async()=>{
 for(const option of [{wrongApp:true},{wrongOwner:true}]){const f=fixture(option);assert.equal((await f.client.run(input('identity'))).ok,false);assert.equal(f.calls.some(c=>c.path.endsWith('/access_tokens')),false);}
});

test('all approved App renames accept legacy/new names but return live GitHub slug',async()=>{
 for(const account of Object.keys(ACCOUNTS)){
  for(const slug of ACCOUNTS[account].allowed_slugs){
   const f=fixture({account,slug});const r=await f.client.run(input('identity',{},account));
   assert.equal(r.ok,true,account+':'+slug);assert.equal(r.result.app_slug,slug);assert.equal(r.receipt.app_slug,slug);
   assert.equal(r.receipt.url,'https://github.com/apps/'+slug);
  }
 }
});
test('rename compatibility does not admit another alias, similar names or wrong numeric identity',async()=>{
 for(const options of [{slug:'ggoppiexyz'},{slug:'bboppiexyz-extra'},{slug:'bboppiexyz',wrongApp:true},{slug:'bboppiexyz',wrongOwner:true}]){
  const f=fixture(options),r=await f.client.run(input('identity'));
  assert.equal(r.ok,false);assert.equal(f.calls.some(c=>c.path.endsWith('/access_tokens')),false);
 }
});

test('normal operation receipt also names the live renamed App',async()=>{
 const f=fixture({slug:'bboppiexyz'});const r=await f.client.run(input('get_issue',{number:3}));
 assert.equal(r.ok,true);assert.equal(r.receipt.app_slug,'bboppiexyz');
});

test('ReviewInbox identity and review use the installation it has',async()=>{
 const f=fixture({account:'reviewinbox'}),r=await f.client.run(input('identity',{},'reviewinbox'));
 assert.equal(r.ok,true);assert.equal(r.result.app_id,5687106);assert.equal(r.receipt.installation_id,180305629);
 assert.equal(r.result.app_slug,'reviewinboxoppiexyz');assert.deepEqual(r.result.installationPermissions,expected);
 const posted=await f.client.run(input('submit_review',{number:7,commit_id:SHA,event:'COMMENT',body:'Finding'},'reviewinbox'));
 assert.equal(posted.ok,true);assert.equal(posted.receipt.app_slug,'reviewinboxoppiexyz');
 assert.deepEqual(executionTokens(f.calls).at(-1),{repositories:['MontClip'],permissions:{metadata:'read',pull_requests:'write'}});
});

test('administration follows the installation: missing it fails before any token, for every account',async()=>{
 const f=fixture({account:'reviewinbox',authorize:async()=>true});
 for(const operation of ['admin_get','admin_update']){
  const r=await f.client.run(input(operation,operation==='admin_update'?{allow_squash_merge:true}:{},'reviewinbox'));
  assert.equal(r.errorCode,'INSTALLATION_PERMISSION_MISSING');assert.deepEqual(r.details.missing,[{permission:'administration',required:operation==='admin_get'?'read':'write',installed:'none'}]);
 }
 assert.equal(f.calls.some(c=>c.path.endsWith('/access_tokens')),false);
 const granted=fixture({account:'bb',permissions:{...expected,administration:'read'}});
 const g=await granted.client.run(input('admin_get',{},'bb'));assert.equal(g.ok,true,g.errorCode);
 assert.deepEqual(executionTokens(granted.calls)[0].permissions,{metadata:'read',administration:'read'});
});

test('ReviewInbox does not accept an invented legacy slug',async()=>{
 const f=fixture({account:'reviewinbox',slug:'oppie-agent-reviewinbox'});const r=await f.client.run(input('identity',{},'reviewinbox'));
 assert.equal(r.ok,false);assert.equal(f.calls.some(c=>c.path.endsWith('/access_tokens')),false);
});
// Owner 2026-11-16 (via QQ): permissions follow the App's actual installation. A broader installation is
// accepted and never forwarded; a narrower one fails only for operations that need what is missing,
// naming the missing level and where to add it.
test('installation permissions: broader is accepted and not forwarded, missing fails only where needed',async()=>{
 const broad=fixture({account:'reviewinbox',permissions:{...expected,administration:'write',actions:'write'}});
 const r=await broad.client.run(input('identity',{},'reviewinbox'));assert.equal(r.ok,true,r.errorCode);
 assert.deepEqual(executionTokens(broad.calls).at(-1).permissions,{metadata:'read'});
 assert.deepEqual(r.result.installationPermissions,{...expected,administration:'write',actions:'write'});
 assert.deepEqual(r.result.availableOperations,OPERATION_NAMES);
 const narrow=fixture({account:'reviewinbox',permissions:{...expected,contents:'read'}});
 const id=await narrow.client.run(input('identity',{},'reviewinbox'));assert.equal(id.ok,true,id.errorCode);
 assert.ok(!id.result.availableOperations.includes('create_branch'));assert.ok(id.result.availableOperations.includes('get_contents'));
 const w=await narrow.client.run(input('create_branch',{branch:'x/y',sha:SHA},'reviewinbox'));
 assert.equal(w.errorCode,'INSTALLATION_PERMISSION_MISSING');assert.equal(w.execution,'not_executed');
 assert.deepEqual(w.details.missing,[{permission:'contents',required:'write',installed:'read'}]);
 assert.match(w.details.fix,/contents:write \(installed: read\)/);
 assert.equal(w.details.appPermissionsUrl,'https://github.com/organizations/good-night-oppie/settings/apps/reviewinboxoppiexyz/permissions');
 assert.equal(w.details.installationUrl,'https://github.com/organizations/good-night-oppie/settings/installations/180305629');
 // The worker adds the owner-facing Chinese message.
 const said=require('../node/messages.cjs').explain(w);
 assert.match(said.message,/的安装缺少：contents:write（现为 read）/);assert.ok(said.message.includes(w.details.appPermissionsUrl)&&said.message.includes(w.details.installationUrl));
 assert.equal(require('../node/messages.cjs').explain(r),r);
 assert.equal(executionTokens(narrow.calls).length,1,'no token minted for the refused write');
 for(const [permissions,operation,args] of [[{...expected,issues:'read'},'comment_issue',{number:1,body:'x'}],[{issues:'write',pull_requests:'write',metadata:'read'},'get_contents',{path:''}]]){
  const f=fixture({permissions});const x=await f.client.run(input(operation,args));
  assert.equal(x.errorCode,'INSTALLATION_PERMISSION_MISSING');assert.equal(f.calls.some(c=>c.path.endsWith('/access_tokens')),false);
 }
});
test('execution token: extra or stronger permissions and extra repositories fail closed',async()=>{
 for(const granted of [{metadata:'read',issues:'read',contents:'read'},{metadata:'read',issues:'write'},{metadata:'read'}]){
  const f=fixture({override(path,init){if(path.endsWith('/access_tokens'))return {status:201,data:{token:'secret-token-x',expires_at:new Date(NOW+3600000).toISOString(),permissions:granted}};}});
  const r=await f.client.run(input('get_issue',{number:3}));assert.equal(r.errorCode,'TOKEN_PERMISSION_MISMATCH',JSON.stringify(granted));assert.equal(r.execution,'not_executed');
  assert.equal(businessCalls(f.calls).length,0);assert.ok(!JSON.stringify(r).includes('secret-token'));
 }
 for(const repositories of [installed(['MontClip','cindy']),installed(['MontClip','MontClip'])]){const f=fixture({repositories});const r=await f.client.run(input('identity'));assert.equal(r.errorCode,'EXECUTION_REPOSITORY_SCOPE_MISMATCH');}
});
test('a repository outside the installation is refused by GitHub and reported as not installed',async()=>{
 const f=fixture({installed:['MontClip']});const r=await f.client.run(input('get_pull',{number:7},'bb','cindy'));
 assert.equal(r.errorCode,'REPOSITORY_NOT_INSTALLED');assert.deepEqual(r.details.repositories,['good-night-oppie/cindy']);assert.equal(r.execution,'not_executed');
 assert.equal(f.calls.some(c=>c.path.startsWith('/repos/')),false);
});
test('stale head or draft never submits a review',async()=>{
 for(const options of [{head:'b'.repeat(40)},{draft:true}]){const f=fixture(options);const r=await f.client.run(input('submit_review',{number:7,commit_id:SHA,event:'COMMENT',body:'Review'}));assert.equal(r.ok,false);assert.equal(f.calls.some(c=>c.path.endsWith('/reviews')),false);}
});
test('review submits exactly once at current explicit commit id',async()=>{
 const f=fixture();const r=await f.client.run(input('submit_review',{number:7,commit_id:SHA,event:'COMMENT',body:'Review',comments:[{path:'src/a.js',line:3,side:'RIGHT',body:'Example'}]}));
 assert.equal(r.ok,true);assert.equal(f.calls.at(-1).parsed.commit_id,SHA);assert.equal(f.calls.filter(c=>c.path.endsWith('/reviews')).length,1);
});
test('expired execution token rejected; subsequent run gets fresh token, no cache',async()=>{
 const expired=fixture({expired:true});assert.equal((await expired.client.run(input('identity'))).errorCode,'INVALID_INSTALLATION_TOKEN');
 const f=fixture();await f.client.run(input('identity'));await f.client.run(input('identity'));assert.equal(f.calls.filter(c=>c.path.endsWith('/access_tokens')).length,6);assert.equal(f.credentialsCalls(),2);
});
test('write network error is unknown, sanitized, and not replayed',async()=>{
 const f=fixture({override:(path,init)=>path.endsWith('/comments')?{throw:true}:null});
 const r=await f.client.run(input('comment_issue',{number:1,body:'Test'}));
 assert.deepEqual(r,{ok:false,errorCode:'WRITE_OUTCOME_UNKNOWN',execution:'unknown'});assert.equal(f.calls.filter(c=>c.path.endsWith('/comments')).length,1);
 assert.ok(!JSON.stringify(r).includes('secret-token'));assert.ok(!JSON.stringify(r).includes('PRIVATE KEY'));
});
test('redirect responses rejected and response body errors not exposed',async()=>{
 const f=fixture({override:path=>path==='/app'?{status:302,data:{token:'leak'}}:null});const r=await f.client.run(input('identity'));assert.equal(r.errorCode,'REDIRECT_REFUSED');assert.ok(!JSON.stringify(r).includes('leak'));
});
test('writes to default branch and stale files refused',async()=>{
 const f=fixture();assert.equal((await f.client.run(input('create_branch',{branch:'main',sha:SHA}))).errorCode,'DEFAULT_BRANCH_WRITE_REFUSED');
 const r=await f.client.run(input('update_file',{path:'a.txt',branch:'agent/test',expected_sha:SHA,message:'test',content_base64:'dGVzdA=='}));assert.equal(r.errorCode,'STALE_FILE');assert.equal(f.calls.some(c=>c.method==='PUT'),false);
});
test('failed credential provider does not expose error content',async()=>{
 const client=createClient({credentials:async()=>{throw Error('SECRET');},fetch:async()=>{throw Error('unexpected');}});
 assert.deepEqual(await client.run(input('identity')),{ok:false,errorCode:'CREDENTIAL_UNAVAILABLE',execution:'not_executed'});
});

// Owner 2026-11-16: no plugin-side role limits. QQ can comment and write when its installation allows it.
test('QQ is not boxed in: comment, branch and file writes work when its installation allows them',async()=>{
 for(const [operation,args] of [['comment_issue',{number:1,body:'QQ note'}],['create_issue',{title:'t'}],['create_branch',{branch:'qq/x',sha:SHA}],['identity',{}]]){
  const f=fixture({account:'qq'});const r=await f.client.run(input(operation,args,'qq'));assert.equal(r.ok,true,operation+' '+r.errorCode);
  assert.deepEqual(executionTokens(f.calls).at(-1),{repositories:['MontClip'],permissions:{metadata:'read',...OPERATION_NEEDS[operation]}},operation);
 }
 const narrow=fixture({account:'qq',permissions:{metadata:'read',pull_requests:'write',administration:'write'}});
 assert.equal((await narrow.client.run(input('comment_issue',{number:1,body:'x'},'qq'))).errorCode,'INSTALLATION_PERMISSION_MISSING');
 assert.equal(executionTokens(narrow.calls).length,0);
});
test('rulesets: any account whose installation administers the repository, always with owner confirmation',async()=>{
 const f=fixture();assert.equal((await f.client.run(input('list_rulesets'))).errorCode,'INSTALLATION_PERMISSION_MISSING');assert.equal(executionTokens(f.calls).length,0);
 const q=fixture({account:'qq'});const r=await q.client.run(input('list_rulesets',{},'qq'));assert.equal(r.ok,true);assert.equal(r.receipt.account,'qq');assert.equal(q.calls.at(-1).method,'GET');
 assert.equal((await q.client.run(input('admin_update',{delete_repository:true},'qq'))).ok,false);
 for(const operation of ['admin_update','ruleset_update']){const n=fixture({account:'qq'});assert.equal((await n.client.run(input(operation,{},'qq'))).ok,false);assert.equal(n.credentialsCalls(),0);}
});

const RULESET={ruleset_id:8,ruleset:{enforcement:'active'},nonce:'a'.repeat(32),owner_authorization:'https://github.com/good-night-oppie/MontClip/issues/1#issuecomment-2'};
const ownerComment=(args,extra={})=>({html_url:args.owner_authorization,user:{id:3278807,login:'EdwardTang',type:'User'},created_at:new Date(NOW-1000).toISOString(),body:require('../node/owner-authorization.cjs').requiredLine('MontClip',args),...extra});
test('ruleset mutation needs live trusted confirmation and a structured owner reference',async()=>{
 const args=RULESET;
 for(const extra of [{},{authorize:async()=>false}]){const f=fixture({account:'qq',...extra});assert.equal((await f.client.run(input('ruleset_update',args,'qq'))).ok,false);assert.equal(f.credentialsCalls(),0);}
 const seen=[];
 const f=fixture({account:'qq',authorize:async x=>{seen.push(x.account);return true;},override(path){if(path.endsWith('/issues/comments/2'))return {status:200,data:ownerComment(args)};}});const r=await f.client.run(input('ruleset_update',args,'qq'));assert.equal(r.ok,true,r.errorCode);assert.equal(f.calls.at(-1).method,'PUT');assert.deepEqual(f.calls.at(-1).parsed,{enforcement:'active'});
 assert.deepEqual(seen,['qq']);assert.deepEqual(executionTokens(f.calls)[0],{repositories:['MontClip'],permissions:{metadata:'read',administration:'write',issues:'read'}});
 // Another repository: the token covers it and the MontClip comment repository, nothing else.
 const other=fixture({account:'qq',authorize:async()=>true,override(path){if(path.endsWith('/issues/comments/2'))return {status:200,data:ownerComment(args,{body:require('../node/owner-authorization.cjs').requiredLine('cindy',args)})};}});
 await other.client.run(input('ruleset_update',args,'qq','cindy'));assert.deepEqual(executionTokens(other.calls)[0].repositories,['cindy','MontClip']);
 const scope=fixture({account:'qq',authorize:async()=>true});assert.equal((await scope.client.run(input('ruleset_update',{...args,owner_authorization:'https://github.com/good-night-oppie/repo-3/issues/1#issuecomment-2'},'qq','cindy'))).errorCode,'OWNER_REFERENCE_SCOPE');assert.equal(executionTokens(scope.calls).length,0);
 const bad=fixture({account:'qq',authorize:async()=>true});assert.equal((await bad.client.run(input('ruleset_update',{...args,nonce:'a'.repeat(32),owner_authorization:'approved'},'qq'))).ok,false);assert.equal(bad.credentialsCalls(),0);
});
test('QQ unexpected repos and insufficient permission fail closed',async()=>{
 for(const options of [{repositories:installed(['MontClip','cindy'])},{repositories:installed([])}])assert.equal((await fixture({account:'qq',...options}).client.run(input('identity',{},'qq'))).errorCode,'EXECUTION_REPOSITORY_SCOPE_MISMATCH');
 assert.equal((await fixture({account:'qq',permissions:{...expected,pull_requests:'read',administration:'write'}}).client.run(input('submit_review',{number:7,commit_id:SHA,event:'APPROVE'},'qq'))).errorCode,'INSTALLATION_PERMISSION_MISSING');
});
test('QQ dismissal is bounded to a review and enqueue binds current head',async()=>{
 const f=fixture({account:'qq'});assert.equal((await f.client.run(input('dismiss_review',{number:7,review_id:4,message:'Owner requested dismissal'},'qq'))).ok,true);assert.ok(f.calls.at(-1).path.endsWith('/pulls/7/reviews/4/dismissals'));
 const q=fixture({account:'qq',override(path){if(path.endsWith('/pulls/7'))return {status:200,data:{node_id:'PR_test',state:'open',draft:false,head:{sha:SHA}}};if(path==='/graphql')return {status:200,data:{data:{enqueuePullRequest:{mergeQueueEntry:{id:'MQ_test'}}}}};}});
 const r=await q.client.run(input('enqueue_pull',{number:7,commit_id:SHA},'qq'));assert.equal(r.ok,true);assert.deepEqual(q.calls.at(-1).parsed.variables,{id:'PR_test',head:SHA});
});

test('QQ refuses nonexistent or non-owner authorization references even after confirmation',async()=>{const f=fixture({account:'qq',authorize:async()=>true});const r=await f.client.run(input('ruleset_update',{ruleset_id:1,ruleset:{enforcement:'active'},nonce:'a'.repeat(32),owner_authorization:'https://github.com/good-night-oppie/MontClip/issues/1#issuecomment-2'},'qq'));assert.equal(r.errorCode,'OWNER_REFERENCE_UNVERIFIED');assert.equal(f.calls.some(c=>c.method==='PUT'),false);});

test('ruleset update rejects an expired owner comment before PUT',async()=>{const args=RULESET;const f=fixture({account:'qq',authorize:async()=>true,override(path){if(path.endsWith('/issues/comments/2'))return {status:200,data:{html_url:args.owner_authorization,user:{id:3278807,type:'User'},created_at:'2000-01-01T00:00:00Z',body:'old'}};}});assert.equal((await f.client.run(input('ruleset_update',args,'qq'))).ok,false);assert.equal(f.calls.some(c=>c.method==='PUT'),false);});

test('consumed owner nonce cannot produce a second ruleset write',async()=>{const args=RULESET;const f=fixture({account:'qq',authorize:async()=>true,claimAuthorization:async()=>false,override(path){if(path.endsWith('/issues/comments/2'))return {status:200,data:ownerComment(args)};}});const r=await f.client.run(input('ruleset_update',args,'qq'));assert.equal(r.errorCode,'OWNER_AUTHORIZATION_REPLAYED');assert.equal(f.calls.some(c=>c.method==='PUT'),false);});

// Owner 2026-11-16, item 4: AD's real shape. Added in the settings page with identity only; its
// installation is broader than any single operation needs and covers every repository.
const AD_BROAD={actions:'read',administration:'read',checks:'write',contents:'write',issues:'write',metadata:'read',pull_requests:'write',statuses:'write',workflows:'write'};
test('AD real shape: identity succeeds with and without a repository',async()=>{
 const f=fixture({account:'ad',permissions:AD_BROAD});
 const all=await f.client.run({account:'ad',operation:'identity',args:{}});
 assert.equal(all.ok,true,all.errorCode);assert.equal(all.receipt.repo,null);assert.equal(all.result.installation_id,182084517);
 assert.equal(all.result.installationRepositorySelection,'all');assert.equal(all.result.installationRepositories.repositories.length,56);
 assert.deepEqual(all.result.installationPermissions,AD_BROAD);
 assert.deepEqual(f.calls.filter(c=>c.path.endsWith('/access_tokens')).map(c=>c.parsed),[{permissions:{metadata:'read'}}],'repo-less identity: one metadata-only probe');
 const one=await f.client.run(input('identity',{},'ad','oppie-github'));
 assert.equal(one.ok,true,one.errorCode);assert.equal(one.receipt.installation_id,182084517);assert.equal(one.result.repository.full_name,'good-night-oppie/oppie-github');
 assert.deepEqual(executionTokens(f.calls),[{repositories:['oppie-github'],permissions:{metadata:'read'}}]);
});
test('AD real shape: comments and reviews (COMMENT, APPROVE, REQUEST_CHANGES) with least-permission tokens',async()=>{
 const f=fixture({account:'ad',permissions:AD_BROAD});
 const c=await f.client.run(input('comment_issue',{number:8,body:'AD review note'},'ad','oppie-github'));assert.equal(c.ok,true,c.errorCode);
 for(const event of ['COMMENT','APPROVE','REQUEST_CHANGES']){
  const r=await f.client.run(input('submit_review',{number:7,commit_id:SHA,event,body:'AD '+event},'ad','MontClip'));assert.equal(r.ok,true,event+' '+r.errorCode);
 }
 assert.deepEqual(executionTokens(f.calls),[
  {repositories:['oppie-github'],permissions:{metadata:'read',pull_requests:'read'}},
  {repositories:['oppie-github'],permissions:{metadata:'read',issues:'write'}},
  ...['COMMENT','APPROVE','REQUEST_CHANGES'].map(()=>({repositories:['MontClip'],permissions:{metadata:'read',pull_requests:'write'}})),
 ]);
 assert.equal(f.calls.filter(c=>c.path.endsWith('/reviews')).length,3);
});
test('AD real shape: installation looked up on every call; remote changes apply to the next call',async()=>{
 const f=fixture({account:'ad',permissions:{...AD_BROAD}});
 assert.equal((await f.client.run(input('comment_issue',{number:8,body:'x'},'ad'))).ok,true);
 f.remote.permissions={...AD_BROAD,issues:'read'};
 const r=await f.client.run(input('comment_issue',{number:8,body:'x'},'ad'));assert.equal(r.errorCode,'INSTALLATION_PERMISSION_MISSING');
 assert.equal(r.details.installationUrl,'https://github.com/organizations/good-night-oppie/settings/installations/182084517');
 f.remote.permissions=AD_BROAD;f.remote.installed=['MontClip'];
 assert.equal((await f.client.run(input('get_pull',{number:7},'ad','cindy'))).errorCode,'REPOSITORY_NOT_INSTALLED');
 assert.equal((await f.client.run(input('get_pull',{number:7},'ad','MontClip'))).ok,true);
 assert.equal(f.calls.filter(c=>c.path==='/app/installations').length,4,'no cached installation');
});
test('AD real shape: only one good-night-oppie installation is accepted',async()=>{
 for(const [label,list,found] of [['none',()=>[],0],['other org only',i=>[{...i,account:{login:'someone-else',type:'Organization'}}],0],['two',i=>[i,{...i,id:5}],2]]){
  const f=fixture({account:'ad',installations:list});const r=await f.client.run(input('identity',{},'ad'));
  assert.equal(r.errorCode,'INSTALLATION_NOT_FOUND',label);assert.deepEqual(r.details,{owner:'good-night-oppie',found},label);
  assert.equal(f.calls.some(c=>c.path.endsWith('/access_tokens')),false,label);
 }
 const wrong=fixture({account:'ad',installations:i=>[{...i,app_id:5665940}]});assert.equal((await wrong.client.run(input('identity',{},'ad'))).errorCode,'INSTALLATION_MISMATCH');
 const suspended=fixture({account:'ad',installations:i=>[{...i,suspended_at:'2026-11-01T00:00:00Z'}]});assert.equal((await suspended.client.run(input('identity',{},'ad'))).errorCode,'INSTALLATION_MISMATCH');
});
test('AD real shape: default branch, force and administration stay refused or follow the installation',async()=>{
 const f=fixture({account:'ad',permissions:AD_BROAD});
 assert.equal((await f.client.run(input('create_branch',{branch:'main',sha:SHA},'ad'))).errorCode,'DEFAULT_BRANCH_WRITE_REFUSED');
 assert.equal((await f.client.run(input('admin_update',{allow_squash_merge:true},'ad'))).errorCode,'OWNER_CONFIRMATION_REQUIRED');
 const confirmed=fixture({account:'ad',permissions:AD_BROAD,authorize:async()=>true});
 assert.equal((await confirmed.client.run(input('admin_update',{allow_squash_merge:true},'ad'))).errorCode,'INSTALLATION_PERMISSION_MISSING');
 assert.equal((await f.client.run(input('ruleset_update',RULESET,'ad'))).errorCode,'OWNER_CONFIRMATION_REQUIRED');
 assert.ok(!OPERATION_NAMES.some(o=>/force|delete_branch|merge$/.test(o)),'no force-push, branch deletion or direct merge operation exists');
});


const blobHash=b=>crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function editFixture(bytes,{account='bb',record={},putStatus=200,throwPut=false}={}){
 return fixture({account,override:(p,i)=>{
  if(!p.includes('/contents/'))return null;
  if(i.method==='GET')return {status:200,data:{type:'file',encoding:'base64',sha:blobHash(bytes),size:bytes.length,content:bytes.toString('base64').replace(/.{60}/g,m=>m+'\n'),...record}};
  if(i.method==='PUT')return {status:putStatus,data:{content:{sha:'b'.repeat(40)},commit:{sha:'c'.repeat(40)}},throw:throwPut};
  return null;
 }});
}
function editArgs(bytes,result,edits=[{old_text:'OLD',new_text:'NEW'}]){return {path:'CLAUDE.md',branch:'docs/edit-test',message:'test',expected_sha:blobHash(bytes),expected_result_sha256:digest(result),edits};}
test('edit_file updates a 260876-byte existing file with one small request and one conditional PUT',async()=>{const b=Buffer.from('OLD'+'x'.repeat(260873)),result=Buffer.from('NEW'+'x'.repeat(260873)),f=editFixture(b),a=editArgs(b,result);assert.ok(Buffer.byteLength(JSON.stringify(input('edit_file',a)))<1024);const out=await f.client.run(input('edit_file',a));assert.equal(out.ok,true,JSON.stringify(out));const puts=f.calls.filter(x=>x.method==='PUT');assert.equal(puts.length,1);assert.equal(puts[0].parsed.content,result.toString('base64'));assert.equal(puts[0].parsed.sha,a.expected_sha);assert.equal(puts[0].parsed.branch,a.branch);assert.ok(f.calls.some(x=>x.url.endsWith('?ref=docs%2Fedit-test')));});
test('edit_file preserves BOM, CRLF and multibyte UTF-8 and applies edits sequentially',async()=>{const b=Buffer.from('\uFEFFOLD\r\n中文🙂\r\n'.replace('\\uFEFF','\uFEFF').replaceAll('\\r\\n','\r\n')),result=Buffer.from(b.toString('utf8').replace('OLD','FINAL'));const f=editFixture(b);const out=await f.client.run(input('edit_file',editArgs(b,result,[{old_text:'OLD',new_text:'MID'},{old_text:'MID',new_text:'FINAL'}])));assert.equal(out.ok,true);assert.deepEqual(Buffer.from(f.calls.find(x=>x.method==='PUT').parsed.content,'base64'),result);});
test('missing, repeated and overlapping matches reject atomically',async()=>{for(const [text,old] of [['abc','missing'],['OLD OLD','OLD'],['aaa','aa']]){const b=Buffer.from(text),f=editFixture(b);const out=await f.client.run(input('edit_file',editArgs(b,b,[{old_text:old,new_text:'x'}])));assert.equal(out.errorCode,'PATCH_CONFLICT');assert.equal(out.execution,'not_executed');assert.equal(f.calls.some(x=>x.method==='PUT'),false);}});
test('stale SHA, result mismatch and late conflict never write',async()=>{const b=Buffer.from('OLD');for(const change of [{expected_sha:'a'.repeat(40)},{expected_result_sha256:'0'.repeat(64)},{edits:[{old_text:'OLD',new_text:'NEW'},{old_text:'missing',new_text:'z'}]}]){const f=editFixture(b),out=await f.client.run(input('edit_file',{...editArgs(b,Buffer.from('NEW')),...change}));assert.ok(['STALE_FILE','CONTENT_SHA256_MISMATCH','PATCH_CONFLICT'].includes(out.errorCode));assert.equal(out.execution,'not_executed');assert.equal(f.calls.some(x=>x.method==='PUT'),false);}});
test('untrusted baseline type, size, encoding, bytes or Git blob hash are rejected',async()=>{const b=Buffer.from('OLD');for(const record of [{type:'symlink'},{type:'dir'},{encoding:'none'},{size:525001},{size:4},{size:-1},{content:'!!!!'},{content:'TkVX'},{sha:'a'.repeat(40)}]){const f=editFixture(b,{record}),out=await f.client.run(input('edit_file',editArgs(b,Buffer.from('NEW'))));assert.equal(out.ok,false);assert.equal(out.execution,'not_executed');assert.equal(f.calls.some(x=>x.method==='PUT'),false);}});
test('invalid UTF-8 baseline is not silently repaired',async()=>{const b=Buffer.from([255,79,76,68]),f=editFixture(b),out=await f.client.run(input('edit_file',editArgs(b,Buffer.from('NEW'))));assert.equal(out.errorCode,'INVALID_FILE_ENCODING');assert.equal(f.calls.some(x=>x.method==='PUT'),false);});
test('edit_file accepts base64 contents just above the former decoded ceiling',async()=>{for(const [size,newText,ok] of [[525000,'NEW',true],[525000,'LONG',true],[525001,'NEW',true]]){const b=Buffer.from('OLD'+'x'.repeat(size-3)),next=Buffer.from(newText+'x'.repeat(size-3)),f=editFixture(b),out=await f.client.run(input('edit_file',editArgs(b,next,[{old_text:'OLD',new_text:newText}])));assert.equal(out.ok,ok,JSON.stringify(out));assert.equal(f.calls.filter(x=>x.method==='PUT').length,ok?1:0);}});
test('edit_file requires both hashes and exact bounded edits before credentials',async()=>{const b=Buffer.from('OLD');for(const changed of [{expected_sha:null},{expected_result_sha256:null},{expected_result_sha256:'x'.repeat(64)},{edits:[]},{edits:[{old_text:'',new_text:'NEW'}]},{edits:[{old_text:'OLD',new_text:'NEW',regex:true}]},{local_path:'forbidden'},{edits:[{old_text:'OLD',new_text:String.fromCharCode(0xd800)}]}]){const f=editFixture(b),out=await f.client.run(input('edit_file',{...editArgs(b,Buffer.from('NEW')),...changed}));assert.equal(out.ok,false);assert.equal(f.credentialsCalls(),0);}});
// Owner 2026-11-16: no plugin-side roles; every account whose installation has contents:write can edit.
test('all twelve accounts can edit_file when their installation allows it',async()=>{const b=Buffer.from('OLD');for(const account of Object.keys(ACCOUNTS)){const f=editFixture(b,{account}),out=await f.client.run(input('edit_file',editArgs(b,Buffer.from('NEW')),account));assert.equal(out.ok,true,account+JSON.stringify(out));}});
test('edit_file refuses default branch and never retries a failed or uncertain PUT',async()=>{const b=Buffer.from('OLD');const f=editFixture(b),denied=await f.client.run(input('edit_file',{...editArgs(b,Buffer.from('NEW')),branch:'main'}));assert.equal(denied.errorCode,'DEFAULT_BRANCH_WRITE_REFUSED');assert.equal(f.calls.some(x=>x.path.includes('/contents/')),false);for(const options of [{putStatus:409},{throwPut:true}]){const f=editFixture(b,options),out=await f.client.run(input('edit_file',editArgs(b,Buffer.from('NEW'))));assert.equal(out.ok,false);assert.equal(out.execution,options.throwPut?'unknown':'not_executed');assert.equal(f.calls.filter(x=>x.method==='PUT').length,1);}});
test('oversized complete update_file params fail before credentials even when base64 length fits old cap',async()=>{const f=fixture(),out=await f.client.run(input('update_file',{path:'a.txt',branch:'docs/test',expected_sha:null,message:'中文🙂',content_base64:'a'.repeat(347836)}));assert.equal(out.errorCode,'REQUEST_TOO_LARGE');assert.equal(f.credentialsCalls(),0);});

test('edit_file independently verifies Git blob bytes and canonical base64, not only the advertised SHA',async()=>{const b=Buffer.from('OLD');for(const [record,code] of [[{content:'TkVX'},'CONTENT_BASELINE_MISMATCH'],[{content:'T0xE='},'INVALID_FILE_BASELINE'],[{content:'T0xE!'},'INVALID_FILE_BASELINE']]){const f=editFixture(b,{record});const r=await f.client.run(input('edit_file',editArgs(b,Buffer.from('NEW'))));assert.equal(r.errorCode,code);assert.equal(f.calls.filter(x=>x.method==='PUT').length,0);}});
test('edit_file GET 404 cannot write; PUT 5xx and malformed success responses are unknown and never retried',async()=>{const b=Buffer.from('OLD');for(const mode of ['missing','server','invalid-json']){const f=fixture({override:(p,i)=>{if(!p.includes('/contents/'))return null;if(i.method==='GET')return mode==='missing'?{status:404,data:{}}:{status:200,data:{type:'file',encoding:'base64',sha:blobHash(b),size:b.length,content:b.toString('base64')}};if(i.method==='PUT')return mode==='server'?{status:503,data:{}}:{status:200,raw:'broken JSON'};}});const r=await f.client.run(input('edit_file',editArgs(b,Buffer.from('NEW'))));assert.equal(r.ok,false);assert.equal(r.execution,mode==='missing'?'not_executed':'unknown');assert.equal(f.calls.filter(x=>x.method==='PUT').length,mode==='missing'?0:1);assert.equal(r.errorCode,mode==='missing'?'GITHUB_HTTP_404':mode==='server'?'GITHUB_HTTP_503':'INVALID_API_RESPONSE');}});

function blobEditFixture(bytes, options={}) {
 const expectedSha=blobHash(bytes);
 const encoded=bytes.toString('base64').match(/.{1,60}/g)?.join('\n')||'';
 return fixture({override:(p,i)=>{
  if(p.includes('/contents/')){
   if(i.method==='GET')return {status:200,data:{type:'file',sha:expectedSha,size:bytes.length,encoding:'none',content:'',...options.contents}};
   if(i.method==='PUT')return {status:200,data:{commit:{sha:SHA}}};
  }
  if(p.includes('/git/blobs/')){assert.equal(p.split('/').at(-1),expectedSha);const data={sha:expectedSha,size:bytes.length,encoding:'base64',content:encoded,...options.blob};return {status:200,...(options.rawBlob?{raw:options.rawBlob}:{data})};}
  if(options.otherRaw && p.endsWith('/issues/42'))return {status:200,raw:options.otherRaw};
  return null;
 }});
}
const blobCalls=f=>f.calls.filter(c=>c.path.includes('/git/blobs/'));
const puts=f=>f.calls.filter(c=>c.method==='PUT');
test('2MiB: consumer and maximum files use contents then same-SHA blob then one conditional PUT',async()=>{
 for(const size of [1376011,2097152]){
 const bytes=Buffer.from('OLD'+'x'.repeat(size-3)),next=Buffer.from('NEW'+'x'.repeat(size-3));
 const f=blobEditFixture(bytes),r=await f.client.run(input('edit_file',editArgs(bytes,next)));
 assert.equal(r.ok,true,JSON.stringify(r));assert.equal(blobCalls(f).length,1);assert.equal(puts(f).length,1);
 assert.equal(puts(f)[0].parsed.content,next.toString('base64'));assert.equal(puts(f)[0].parsed.sha,blobHash(bytes));
 const business=f.calls.filter(c=>c.path.includes('/contents/')||c.path.includes('/git/blobs/'));assert.deepEqual(business.map(c=>c.method),['GET','GET','PUT']);
 assert.ok(JSON.stringify(r).length<3000,'large baseline must not return to Agent');
 }
});
test('2MiB: stale and invalid/oversize contents stop before blob and PUT',async()=>{
 const bytes=Buffer.from('OLD');for(const contents of [{sha:'b'.repeat(40)},{size:2097153},{size:-1},{size:1.5},{type:'symlink'},{type:'dir'}]){
 const f=blobEditFixture(bytes,{contents}),r=await f.client.run(input('edit_file',editArgs(bytes,Buffer.from('NEW'))));
 assert.equal(r.ok,false);assert.equal(r.errorCode,contents.sha?'STALE_FILE':contents.size===2097153?'FILE_TOO_LARGE':'INVALID_FILE_BASELINE');assert.equal(blobCalls(f).length,0);assert.equal(puts(f).length,0);
 }
});
test('2MiB: fallback requires none encoding, empty content and positive size',async()=>{
 const bytes=Buffer.from('OLD');for(const contents of [{content:'x'},{size:0},{encoding:'utf8'},{encoding:null},{content:null}]){
 const f=blobEditFixture(bytes,{contents}),r=await f.client.run(input('edit_file',editArgs(bytes,Buffer.from('NEW'))));assert.equal(r.ok,false);assert.equal(blobCalls(f).length,0);assert.equal(puts(f).length,0);
 }
 const f=blobEditFixture(bytes,{contents:{encoding:'base64',content:bytes.toString('base64')}});assert.equal((await f.client.run(input('edit_file',editArgs(bytes,Buffer.from('NEW'))))).ok,true);assert.equal(blobCalls(f).length,0);
});
test('2MiB: inconsistent blob metadata or SHA1 never PUT',async()=>{
 const bytes=Buffer.from('OLD');for(const [blob,errorCode] of [[{sha:'b'.repeat(40)},'INVALID_FILE_BASELINE'],[{size:4},'INVALID_FILE_BASELINE'],[{encoding:'none'},'INVALID_FILE_BASELINE'],[{content:null},'INVALID_FILE_BASELINE'],[{content:Buffer.from('BAD').toString('base64')},'CONTENT_BASELINE_MISMATCH']]){
 const f=blobEditFixture(bytes,{blob}),r=await f.client.run(input('edit_file',editArgs(bytes,Buffer.from('NEW'))));assert.equal(r.errorCode,errorCode);assert.equal(blobCalls(f).length,1);assert.equal(puts(f).length,0);
 }
});
test('2MiB: intermediate/result overflow and result hash mismatch never PUT',async()=>{
 const bytes=Buffer.from('OLD'+'x'.repeat(2097152-3));for(const edits of [[{old_text:'OLD',new_text:'LONG'}],[{old_text:'OLD',new_text:'LONG'},{old_text:'LONG',new_text:'NEW'}],[{old_text:'OLD',new_text:'NEW'}]]){
 const f=blobEditFixture(bytes),r=await f.client.run(input('edit_file',editArgs(bytes,bytes,edits)));assert.equal(r.errorCode,edits[0].new_text==='LONG'?'FILE_TOO_LARGE':'CONTENT_SHA256_MISMATCH');assert.equal(puts(f).length,0);
 }
});
test('2MiB: 3200000 response allowance applies only to internal blob read',async()=>{
 const bytes=Buffer.from('OLD');const data={sha:blobHash(bytes),size:3,encoding:'base64',content:bytes.toString('base64')};const raw=JSON.stringify(data);for(const n of [3200000,3200001]){
 const f=blobEditFixture(bytes,{rawBlob:raw+' '.repeat(n-Buffer.byteLength(raw))}),r=await f.client.run(input('edit_file',editArgs(bytes,Buffer.from('NEW'))));assert.equal(r.ok,n===3200000,JSON.stringify(r));assert.equal(puts(f).length,n===3200000?1:0);if(n>3200000)assert.equal(r.errorCode,'INVALID_API_RESPONSE');
 }
 const f=blobEditFixture(bytes,{otherRaw:'{}'+' '.repeat(2500001-2)}),r=await f.client.run(input('get_issue',{number:42}));assert.equal(r.errorCode,'INVALID_API_RESPONSE');assert.equal(blobCalls(f).length,0);
});

// #16: enqueue_pull must classify GraphQL errors[] and read back isInMergeQueue.
function queueFixture({before={isInMergeQueue:false,headRefOid:SHA,mergeQueueEntry:null},mutation,after=before,restHead=SHA}={}){
 let reads=0; return fixture({account:'qq',override(path,init){
  if(path.endsWith('/pulls/7'))return {status:200,data:{node_id:'PR_test',state:'open',draft:false,head:{sha:restHead}}};
  if(path!=='/graphql')return;
  const q=JSON.parse(init.body).query;
  if(q.startsWith('mutation'))return typeof mutation==='function'?mutation():mutation;
  reads++;
  const node=reads===1?before:after;return node instanceof Error?{status:502,data:{message:'bad gateway'}}:{status:200,data:{data:{node}}};
 }});
}
const mutations=calls=>calls.filter(c=>c.path==='/graphql'&&c.parsed.query.startsWith('mutation'));
const FORBIDDEN={status:200,data:{data:{enqueuePullRequest:null},errors:[{type:'FORBIDDEN',path:['enqueuePullRequest'],locations:[{line:1,column:46}],message:'Resource not accessible by integration'}]}};
test('#16 enqueue permission denied is a definite not_executed failure with sanitized GitHub error',async()=>{
 const f=queueFixture({mutation:FORBIDDEN});
 const r=await f.client.run(input('enqueue_pull',{number:7,commit_id:SHA},'qq'));
 assert.equal(r.ok,false);assert.equal(r.errorCode,'QUEUE_PERMISSION_DENIED');assert.equal(r.execution,'not_executed');
 assert.deepEqual(r.details.githubErrors,[{type:'FORBIDDEN',message:'Resource not accessible by integration',path:['enqueuePullRequest']}]);
 assert.equal(r.details.readback.isInMergeQueue,false);assert.equal(mutations(f.calls).length,1);
 assert.equal(JSON.stringify(r).includes('secret-token'),false);assert.equal(JSON.stringify(r).includes('PRIVATE KEY'),false);
});
test('#16 enqueue head mismatch fails before or after the mutation without retrying',async()=>{
 const stale=queueFixture({restHead:'b'.repeat(40)});
 const s=await stale.client.run(input('enqueue_pull',{number:7,commit_id:SHA},'qq'));
 assert.equal(s.errorCode,'STALE_OR_UNQUEUEABLE_HEAD');assert.equal(s.execution,'not_executed');assert.equal(stale.calls.some(c=>c.path==='/graphql'),false);
 const moved=queueFixture({mutation:{status:200,data:{data:{enqueuePullRequest:null},errors:[{type:'UNPROCESSABLE',path:['enqueuePullRequest'],message:'Expected head oid does not match the pull request head'}]}},after:{isInMergeQueue:false,headRefOid:'c'.repeat(40),mergeQueueEntry:null}});
 const m=await moved.client.run(input('enqueue_pull',{number:7,commit_id:SHA},'qq'));
 assert.equal(m.ok,false);assert.equal(m.errorCode,'QUEUE_HEAD_MISMATCH');assert.equal(m.execution,'not_executed');assert.equal(mutations(moved.calls).length,1);
});
test('#16 enqueue of a PR already in the merge queue sends no mutation',async()=>{
 const f=queueFixture({before:{isInMergeQueue:true,headRefOid:SHA,mergeQueueEntry:{id:'MQ_1',state:'QUEUED'}}});
 const r=await f.client.run(input('enqueue_pull',{number:7,commit_id:SHA},'qq'));
 assert.equal(r.ok,false);assert.equal(r.errorCode,'ALREADY_IN_MERGE_QUEUE');assert.equal(r.execution,'not_executed');
 assert.deepEqual(r.details.mergeQueueEntry,{id:'MQ_1',state:'QUEUED'});assert.equal(mutations(f.calls).length,0);
});
test('#16 normal enqueue completes with one mutation bound to the head',async()=>{
 const f=queueFixture({mutation:{status:200,data:{data:{enqueuePullRequest:{mergeQueueEntry:{id:'MQ_ok'}}}}}});
 const r=await f.client.run(input('enqueue_pull',{number:7,commit_id:SHA},'qq'));
 assert.equal(r.ok,true);assert.equal(r.receipt.execution,'completed');assert.equal(r.result.data.enqueuePullRequest.mergeQueueEntry.id,'MQ_ok');
 const sent=mutations(f.calls);assert.equal(sent.length,1);assert.deepEqual(sent[0].parsed.variables,{id:'PR_test',head:SHA});
});
test('#16 transport-unknown enqueue reads back once before deciding',async()=>{
 const queued=queueFixture({mutation:{status:502,data:{message:'bad gateway'}},after:{isInMergeQueue:true,headRefOid:SHA,mergeQueueEntry:{id:'MQ_2',state:'QUEUED'}}});
 const q=await queued.client.run(input('enqueue_pull',{number:7,commit_id:SHA},'qq'));assert.equal(q.ok,true);assert.equal(q.result.readback.isInMergeQueue,true);
 const missing=queueFixture({mutation:{status:502,data:{message:'bad gateway'}}});
 const n=await missing.client.run(input('enqueue_pull',{number:7,commit_id:SHA},'qq'));assert.equal(n.errorCode,'QUEUE_NOT_QUEUED_AFTER_UNKNOWN_WRITE');assert.equal(n.execution,'not_executed');
 const blind=queueFixture({mutation:{status:502,data:{message:'bad gateway'}},after:new Error('down')});
 const b=await blind.client.run(input('enqueue_pull',{number:7,commit_id:SHA},'qq'));assert.equal(b.errorCode,'QUEUE_RESULT_UNCONFIRMED');assert.equal(b.execution,'unknown');assert.equal(mutations(blind.calls).length,1);
});
test('#16 every call requests exactly its operation permissions for the target repository only',async()=>{
 const tokenRequests=calls=>executionTokens(calls).map(c=>c.permissions);
 const enq=queueFixture({mutation:{status:200,data:{data:{enqueuePullRequest:{mergeQueueEntry:{id:'MQ_w'}}}}}});
 assert.equal((await enq.client.run(input('enqueue_pull',{number:7,commit_id:SHA},'qq'))).ok,true);assert.deepEqual(tokenRequests(enq.calls),[{metadata:'read',contents:'write',pull_requests:'write'}]);
 const qqOps=[['identity',{}],['get_pull',{number:7}],['list_rulesets',{}],['submit_review',{number:7,commit_id:SHA,event:'COMMENT',body:'ok'}],['dismiss_review',{number:7,review_id:4,message:'m'}]];
 for(const [operation,args] of qqOps){const f=fixture({account:'qq'});await f.client.run(input(operation,args,'qq'));assert.deepEqual(executionTokens(f.calls),[{repositories:['MontClip'],permissions:{metadata:'read',...OPERATION_NEEDS[operation]}}],operation);}
 const ri=fixture({account:'reviewinbox'});await ri.client.run(input('get_pull',{number:7},'reviewinbox'));assert.deepEqual(tokenRequests(ri.calls),[{metadata:'read',pull_requests:'read'}]);
 const bb=fixture();await bb.client.run(input('get_contents',{path:''}));assert.deepEqual(tokenRequests(bb.calls),[{metadata:'read',contents:'read'}]);
});
test('#16 enqueue_pull refuses a token GitHub narrowed below contents:write before any GraphQL call',async()=>{
 const f=fixture({account:'qq',override(path,init){if(path.endsWith('/access_tokens')&&JSON.parse(init.body).repositories)return {status:201,data:{token:'secret-token-narrow',expires_at:new Date(NOW+3600000).toISOString(),permissions:{contents:'read',pull_requests:'write',metadata:'read'}}};}});
 const r=await f.client.run(input('enqueue_pull',{number:7,commit_id:SHA},'qq'));
 assert.equal(r.errorCode,'TOKEN_PERMISSION_MISMATCH');assert.equal(r.execution,'not_executed');assert.equal(f.calls.some(c=>c.path==='/graphql'),false);
});

// Deja 2026-11-16 (#33): the owner adds workflows:write to DejaOppieXYZ for the merge_group change.
const WORKFLOWS={...expected,workflows:'write'};
const wfFile=(path='.github/workflows/test.yml')=>({path,branch:'deja/merge-group',expected_sha:null,message:'ci',content_base64:'dGVzdA=='});
test('an installation that also holds workflows:write still passes identity, with and without repo',async()=>{
 const f=fixture({account:'deja',permissions:WORKFLOWS});
 const all=await f.client.run({account:'deja',operation:'identity'});
 assert.equal(all.ok,true,JSON.stringify(all));assert.equal(all.result.installationPermissions.workflows,'write');
 const one=await f.client.run(input('identity',{},'deja','oppie-github'));
 assert.equal(one.ok,true,JSON.stringify(one));
 assert.deepEqual(executionTokens(f.calls),[{repositories:['oppie-github'],permissions:{metadata:'read'}}]);
});
test('update_file and edit_file under .github/workflows/ request workflows:write only when they touch it',async()=>{
 const f=fixture({account:'deja',permissions:WORKFLOWS});
 const w=await f.client.run(input('update_file',wfFile(),'deja','oppie-github'));
 assert.equal(w.ok,true,JSON.stringify(w));
 const n=await f.client.run(input('update_file',wfFile('docs/workflows.md'),'deja','oppie-github'));
 assert.equal(n.ok,true,JSON.stringify(n));
 assert.deepEqual(executionTokens(f.calls).map(t=>t.permissions),[{metadata:'read',contents:'write',workflows:'write'},{metadata:'read',contents:'write'}]);
 const b=Buffer.from('OLD'),e=fixture({account:'deja',permissions:WORKFLOWS,override:(p,i)=>{
  if(!p.includes('/contents/'))return null;
  if(i.method==='GET')return {status:200,data:{type:'file',encoding:'base64',sha:blobHash(b),size:b.length,content:b.toString('base64')}};
  return {status:200,data:{content:{sha:'b'.repeat(40)},commit:{sha:'c'.repeat(40)}}};
 }});
 const r=await e.client.run(input('edit_file',{...editArgs(b,Buffer.from('NEW')),path:'.github/workflows/test.yml'},'deja','oppie-github'));
 assert.equal(r.ok,true,JSON.stringify(r));
 assert.deepEqual(executionTokens(e.calls).map(t=>t.permissions),[{metadata:'read',contents:'write',workflows:'write'}]);
});
test('a workflow file change without the workflows permission says what is missing and where to add it',async()=>{
 const f=fixture({account:'deja'});
 const r=await f.client.run(input('update_file',wfFile(),'deja','oppie-github'));
 assert.equal(r.errorCode,'INSTALLATION_PERMISSION_MISSING');assert.equal(r.execution,'not_executed');
 assert.deepEqual(r.details.missing,[{permission:'workflows',required:'write',installed:'none'}]);
 assert.deepEqual(r.details.workflowFiles,['.github/workflows/test.yml']);
 assert.equal(executionTokens(f.calls).length,0);assert.equal(f.calls.some(c=>c.method==='PUT'),false);
 const said=require('../node/messages.cjs').explain(r).message;
 assert.ok(said.includes('workflows:write（现为 none）'));assert.ok(said.includes('.github/workflows/test.yml'));
 assert.ok(said.includes('https://github.com/organizations/good-night-oppie/settings/apps/'+ACCOUNTS.deja.app_slug+'/permissions'));
 assert.ok(!JSON.stringify(r).includes('secret-token'));
});
test('a token that GitHub returns without the workflows:write that was requested is discarded',async()=>{
 const f=fixture({account:'deja',permissions:WORKFLOWS,override:async(p,i)=>{
  if(!p.endsWith('/access_tokens')||!JSON.parse(i.body).repositories)return null;
  return {status:201,data:{token:'secret-token-x',expires_at:new Date(NOW+3600000).toISOString(),permissions:{metadata:'read',contents:'write'}}};
 }});
 const r=await f.client.run(input('update_file',wfFile(),'deja','oppie-github'));
 assert.equal(r.errorCode,'TOKEN_PERMISSION_MISMATCH');assert.equal(f.calls.some(c=>c.method==='PUT'),false);
});

// QQ on #34 (5914728822 point 2): nothing is cached; narrowing the installation applies to the next
// call and no earlier token is reused.
test('no cache: narrowing the installation on GitHub applies to the very next call, with a new token each time',async()=>{
 const f=fixture({account:'deja'});
 assert.equal((await f.client.run(input('get_issue',{number:1},'deja','MontClip'))).ok,true);
 f.remote.installed=INSTALLED.filter(n=>n!=='MontClip');
 const gone=await f.client.run(input('get_issue',{number:1},'deja','MontClip'));
 assert.equal(gone.errorCode,'REPOSITORY_NOT_INSTALLED');assert.equal(gone.execution,'not_executed');
 f.remote.installed=INSTALLED;f.remote.permissions={...expected,issues:'read'};
 const narrowed=await f.client.run(input('comment_issue',{number:1,body:'x'},'deja','MontClip'));
 assert.equal(narrowed.errorCode,'INSTALLATION_PERMISSION_MISSING');
 const business=f.calls.filter(c=>c.path.includes('/issues/'));
 assert.equal(business.length,1,'only the first call reached the repository');
 const tokens=f.calls.filter(c=>c.path.endsWith('/access_tokens')).map(c=>c.parsed);
 assert.equal(tokens.length,3,'first call: resolve + execution token; second: resolve refused; third: none (permission checked first)');
 assert.equal(f.calls.filter(c=>c.path==='/app').length,3,'the App is read again on every call');
});
test('update_file to the default branch is refused before any file read or write',async()=>{
 const f=fixture();
 const r=await f.client.run(input('update_file',{path:'a.txt',branch:'main',expected_sha:null,message:'x',content_base64:'dGVzdA=='}));
 assert.equal(r.errorCode,'DEFAULT_BRANCH_WRITE_REFUSED');assert.equal(r.execution,'not_executed');
 assert.equal(f.calls.some(c=>c.path.includes('/contents/')),false);assert.equal(f.calls.some(c=>c.method==='PUT'),false);
});
// QQ on ADR #34 (5914736615 point 2): the name is resolved to its repository ID first; the execution
// token is requested by that ID and must cover exactly that repository.
test('repository ID: the name is resolved with a metadata-only token, the execution token is requested by ID only',async()=>{
 const f=fixture({account:'deja'});
 const r=await f.client.run(input('create_issue',{title:'x'},'deja','oppie-github'));
 assert.equal(r.ok,true,JSON.stringify(r));
 const grants=f.calls.filter(c=>c.path.endsWith('/access_tokens')).map(c=>c.parsed);
 assert.deepEqual(grants,[{repositories:['oppie-github'],permissions:{metadata:'read'}},{repository_ids:[1000+INSTALLED.indexOf('oppie-github')],permissions:{metadata:'read',issues:'write'}}]);
 assert.ok(f.calls.findIndex(c=>c.path==='/repos/good-night-oppie/oppie-github')<f.calls.findIndex(c=>c.parsed?.repository_ids),'resolved before the execution token');
});
test('repository ID: a token covering another repository with the same name is refused before any business call',async()=>{
 const f=fixture({repositories:{total_count:1,repositories:[{id:999999,name:'MontClip',full_name:'good-night-oppie/MontClip'}]}});
 const r=await f.client.run(input('get_issue',{number:3}));
 assert.equal(r.errorCode,'EXECUTION_REPOSITORY_SCOPE_MISMATCH');assert.equal(businessCalls(f.calls).length,0);
});
test('repository ID: a name that resolves outside good-night-oppie or to a malformed record is refused before the execution token',async()=>{
 for(const data of [{id:1000,name:'MontClip',full_name:'other/MontClip',owner:{login:'other'},default_branch:'main'},{id:'1000',name:'MontClip',full_name:'good-night-oppie/MontClip',owner:{login:'good-night-oppie'}},{id:1000,name:'cindy',full_name:'good-night-oppie/cindy',owner:{login:'good-night-oppie'}}]){
  const f=fixture({override:(p,i)=>p==='/repos/good-night-oppie/MontClip'&&i.method==='GET'?{status:200,data}:null});
  const r=await f.client.run(input('get_issue',{number:3}));
  assert.equal(r.errorCode,'REPOSITORY_RESOLUTION_FAILED',JSON.stringify(data));assert.equal(executionTokens(f.calls).length,0);
 }
});
// QQ on ADR #34 (5914736615 point 3): writes to the default branch are refused before any request
// that could write, and before the execution token.
test('default branch: create_branch, update_file, edit_file and commit_files to main stop before the execution token',async()=>{
 const b=Buffer.from('OLD'),msg=['x','','Assisted-by: Cindy (https://cindy.app)'].join(String.fromCharCode(10));
 for(const [operation,args] of [
  ['create_branch',{branch:'main',sha:SHA}],
  ['update_file',{path:'a.txt',branch:'main',expected_sha:null,message:'x',content_base64:'dGVzdA=='}],
  ['edit_file',{...editArgs(b,Buffer.from('NEW')),branch:'main'}],
  ['commit_files',{branch:'main',expected_head:SHA,message:msg,changes:[{path:'a.txt',content_base64:'dGVzdA=='}]}],
 ]){
  const f=fixture({account:'deja'});
  const r=await f.client.run(input(operation,args,'deja'));
  assert.equal(r.errorCode,'DEFAULT_BRANCH_WRITE_REFUSED',operation+JSON.stringify(r));assert.equal(r.execution,'not_executed');
  assert.equal(executionTokens(f.calls).length,0,operation);assert.equal(businessCalls(f.calls).length,0,operation);
  assert.equal(f.calls.some(c=>c.method&&c.method!=='GET'&&!c.path.endsWith('/access_tokens')),false,operation);
 }
});
// ADR 0003 section 4 (Deja 2026-11-16): admin_update needs a host confirmation each time, for every
// account, checked before the private key is read.
test('admin_update without a host confirmation is refused before the key, for every account',async()=>{
 for(const account of ['qq','deja','bb']){
  const f=fixture({account,permissions:{...expected,administration:'write'}});
  const r=await f.client.run(input('admin_update',{allow_squash_merge:true},account));
  assert.equal(r.errorCode,'OWNER_CONFIRMATION_REQUIRED',account);assert.equal(r.execution,'not_executed');
  assert.equal(f.credentialsCalls(),0,account);assert.equal(f.calls.length,0,account);
 }
 const ok=fixture({account:'deja',permissions:{...expected,administration:'write'},authorize:async()=>true});
 const r=await ok.client.run(input('admin_update',{allow_squash_merge:true},'deja'));
 assert.equal(r.ok,true,JSON.stringify(r));
 assert.deepEqual(executionTokens(ok.calls).map(t=>t.permissions),[{metadata:'read',administration:'write'}]);
 assert.equal(ok.calls.filter(c=>c.method==='PATCH').length,1);
});
// ADR 0003 Amendment 1 (PG): a comment on a pull request needs pull_requests:write; GitHub answers 403
// to a token holding issues:write only (seen on #33 and #36 with settings.8-11).
test('comment on a pull request: the token adds pull_requests:write; on an issue it stays issues:write',async()=>{
 const pr=fixture({account:'deja',override:(path,init)=>path==='/repos/good-night-oppie/oppie-github/pulls/33'&&init.method==='GET'?{status:200,data:{number:33}}:null});
 const r=await pr.client.run(input('comment_issue',{number:33,body:'x'},'deja','oppie-github'));assert.equal(r.ok,true,JSON.stringify(r));
 assert.deepEqual(executionTokens(pr.calls),[{repositories:['oppie-github'],permissions:{metadata:'read',pull_requests:'read'}},{repositories:['oppie-github'],permissions:{metadata:'read',issues:'write',pull_requests:'write'}}]);
 assert.ok(pr.calls.findIndex(c=>c.path.endsWith('/pulls/33'))<pr.calls.findIndex(c=>c.method==='POST'&&c.path.endsWith('/issues/33/comments')),'checked before the comment');
 const issue=fixture({account:'deja'});
 assert.equal((await issue.client.run(input('comment_issue',{number:8,body:'x'},'deja','oppie-github'))).ok,true);
 assert.deepEqual(executionTokens(issue.calls).at(-1),{repositories:['oppie-github'],permissions:{metadata:'read',issues:'write'}});
});
test('comment on a pull request without pull_requests:write in the installation says what is missing, before the execution token',async()=>{
 const f=fixture({account:'deja',permissions:{metadata:'read',issues:'write',pull_requests:'read'},override:(path,init)=>path.endsWith('/pulls/33')&&init.method==='GET'?{status:200,data:{number:33}}:null});
 const r=await f.client.run(input('comment_issue',{number:33,body:'x'},'deja','oppie-github'));
 assert.equal(r.errorCode,'INSTALLATION_PERMISSION_MISSING');assert.deepEqual(r.details.missing,[{permission:'pull_requests',required:'write',installed:'read'}]);
 assert.equal(executionTokens(f.calls).some(t=>t.permissions.issues),false);assert.equal(f.calls.some(c=>c.method==='POST'&&c.path.includes('/comments')),false);
});
test('comment: no pull request check when the installation cannot read pull requests; a malformed answer is refused',async()=>{
 const f=fixture({account:'deja',permissions:{metadata:'read',issues:'write'}});
 assert.equal((await f.client.run(input('comment_issue',{number:8,body:'x'},'deja','oppie-github'))).ok,true);
 assert.equal(f.calls.some(c=>c.path.includes('/pulls/')),false);assert.deepEqual(executionTokens(f.calls),[{repositories:['oppie-github'],permissions:{metadata:'read',issues:'write'}}]);
 const bad=fixture({account:'deja',override:(path,init)=>path.endsWith('/pulls/9')&&init.method==='GET'?{status:200,data:{number:10}}:null});
 const r=await bad.client.run(input('comment_issue',{number:9,body:'x'},'deja','oppie-github'));
 assert.equal(r.errorCode,'INVALID_API_RESPONSE');assert.equal(bad.calls.some(c=>c.method==='POST'&&c.path.includes('/comments')),false);
});
