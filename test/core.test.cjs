'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createClient,makeJwt,ACCOUNTS,REPOSITORIES}=require('../node/core.cjs');
const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const PEM=privateKey.export({type:'pkcs8',format:'pem'});
const NOW=1800000000000;
const expected={contents:'write',issues:'write',pull_requests:'write',metadata:'read'};
const {CATALOG}=require('../node/repository-policy.cjs');
const repos={total_count:6,repositories:Object.entries(CATALOG).map(([name,id])=>({id,name,full_name:'good-night-oppie/'+name}))};
const twoRepos={total_count:2,repositories:repos.repositories.filter(r=>Object.hasOwn(REPOSITORIES,r.name))};
const SHA='a'.repeat(40);
function fixture(options={}){
 const calls=[];const tokenRepositories=new Map();let credentialsCalls=0;let counter=0;
 const account=ACCOUNTS[options.account||'bb']||(options.account==='reviewinbox'?{account:'reviewinbox',app_id:5687106,installation_id:180305629,admin:false}:undefined);
 const perms={...expected,...(account.account==='reviewinbox'?{contents:'read'}:{}),...(account.admin?{administration:'write'}:{})};
 const fetch=async(url,init)=>{
  const path=new URL(url).pathname;calls.push({url,path,...init,parsed:init.body?JSON.parse(init.body):undefined});
  assert.equal(new URL(url).origin,'https://api.github.com');assert.equal(init.redirect,'error');
  let data,status=200;
  if(options.override){const out=await options.override(path,init,calls);if(out){if(out.throw)throw Error('secret-token '+PEM);return {ok:out.status>=200&&out.status<300,status:out.status,text:async()=>JSON.stringify(out.data)};}}
  if(path==='/app'){const slug=options.slug||(account.account==='reviewinbox'?'reviewinboxoppiexyz':'oppie-agent-'+account.account);data={id:options.wrongApp?9:account.app_id,slug,owner:{login:'good-night-oppie'},html_url:'https://github.com/apps/'+slug};}
  else if(path==='/app/installations/'+account.installation_id)data={id:account.installation_id,app_id:account.app_id,account:{login:options.wrongOwner?'bad':'good-night-oppie',type:'Organization'},repository_selection:'selected',suspended_at:null,permissions:options.permissions||{...perms,...(account.account==='pg'?{administration:'write'}:{})}};
  else if(path.endsWith('/access_tokens')){
   data={token:'secret-token-'+(++counter),expires_at:new Date(options.expired?NOW-1:NOW+3600000).toISOString(),permissions:perms};
   const requested=JSON.parse(init.body).repository_ids;
   const installed=['video','vv'].includes(account.account)?twoRepos:repos;
   const selected=requested?installed.repositories.filter(r=>requested.includes(r.id)):installed.repositories;
   tokenRepositories.set('Bearer '+data.token,{total_count:selected.length,repositories:selected});
  }
  else if(path==='/installation/repositories')data=options.repositories||tokenRepositories.get(init.headers.Authorization);
  else if(path.endsWith('/pulls/7'))data={number:7,head:{sha:options.head||SHA},state:'open',draft:!!options.draft};
  else if(path==='/repos/good-night-oppie/MontClip')data={default_branch:'main'};
  else data={id:1,html_url:'https://github.com/good-night-oppie/MontClip/issues/1',body:'normal result'};
  return {ok:status===200,status,text:async()=>JSON.stringify(data)};
 };
 return {calls,client:createClient({credentials:async alias=>{credentialsCalls++;assert.equal(alias,account.account);return PEM;},fetch,now:()=>NOW,authorize:options.authorize,claimAuthorization:options.claimAuthorization|| (async()=>true)}),credentialsCalls:()=>credentialsCalls};
}
const input=(operation,args={},account='bb')=>({account,repo:'MontClip',operation,args});

for(const stage of ['installation','execution']){
 for(const variant of ['extra','missing','wrong-id','duplicate','count']){
  test(`${stage} scope diagnostic: ${variant} remains blocked before business execution`,async()=>{
   const actual=structuredClone(repos);
   if(variant==='extra')actual.repositories.push({id:99,name:'other',full_name:'good-night-oppie/other'});
   if(variant==='missing')actual.repositories.pop();
   if(variant==='wrong-id')actual.repositories[0].id=99;
   if(variant==='duplicate')actual.repositories[1]=actual.repositories[0];
   actual.total_count=variant==='count'?99:actual.repositories.length;
   let reads=0;
   const f=fixture({override:(path)=>{
    if(path==='/installation/repositories'&&++reads===(stage==='installation'?1:2))return {status:200,data:actual};
   }});
   const r=await f.client.run(input('get_issue',{number:3}));
   assert.equal(r.errorCode,stage==='installation'?'INSTALLATION_REPOSITORY_SCOPE_MISMATCH':'EXECUTION_REPOSITORY_SCOPE_MISMATCH');
   assert.equal(r.execution,'not_executed');
   assert.deepEqual(r.diagnostics.expectedRepositories,repos.repositories.map(x=>x.full_name));
   assert.deepEqual(r.diagnostics.actualRepositories,actual.repositories.map(x=>x.full_name));
   assert.equal(f.calls.filter(c=>c.path.endsWith('/access_tokens')).length,stage==='installation'?1:2);
   assert.equal(f.calls.some(c=>c.path.startsWith('/repos/')),false);
   assert.ok(!JSON.stringify(r).includes('secret-token'));
   assert.ok(!JSON.stringify(r).includes('PRIVATE KEY'));
  });
 }
}
test('scope diagnostics omit malformed names and extra response fields, and redact known secrets',async()=>{
 const f=fixture({repositories:{total_count:4,repositories:[
  {full_name:'good-night-oppie/secret-token-1',token:'secret-token-1',private_key:PEM},
  {full_name:'bad\nname/repo'}, {full_name:PEM}, null
 ]}});
 const r=await f.client.run(input('identity'));
 assert.equal(r.errorCode,'INSTALLATION_REPOSITORY_SCOPE_MISMATCH');
 assert.deepEqual(r.diagnostics.actualRepositories,['good-night-oppie/[REDACTED]']);
 assert.equal(r.diagnostics.actualRepositoriesComplete,false);
 assert.deepEqual(Object.keys(r.diagnostics).sort(),['actualRepositories','actualRepositoriesComplete','expectedRepositories']);
 assert.ok(!JSON.stringify(r).includes('secret-token'));
 assert.ok(!JSON.stringify(r).includes('PRIVATE KEY'));
});
test('scope diagnostics distinguish absent list from a verified empty list',async()=>{
 for(const value of [{total_count:0},{total_count:0,repositories:[]}]){
  const f=fixture({repositories:value}),r=await f.client.run(input('identity'));
  assert.equal(r.errorCode,'INSTALLATION_REPOSITORY_SCOPE_MISMATCH');
  assert.deepEqual(r.diagnostics.actualRepositories,[]);
  assert.equal(r.diagnostics.actualRepositoriesComplete,Array.isArray(value.repositories));
 }
});
test('JWT is RSA signed, short lived, and names fixed app id',()=>{
 const jwt=makeJwt(ACCOUNTS.bb,PEM,NOW);const [h,p,s]=jwt.split('.');
 const payload=JSON.parse(Buffer.from(p,'base64url'));assert.equal(payload.iss,String(ACCOUNTS.bb.app_id));assert.equal(payload.exp-payload.iat,540);
 assert.equal(crypto.verify('RSA-SHA256',Buffer.from(h+'.'+p),publicKey,Buffer.from(s,'base64url')),true);
});
test('identity verifies app, installation and exact repos; credentials never returned',async()=>{
 const f=fixture();const r=await f.client.run(input('identity'));
 assert.equal(r.ok,true);assert.equal(r.receipt.app_slug,'oppie-agent-bb');assert.equal(r.result.repositories.length,6);
 assert.ok(!JSON.stringify(r).includes('secret-token'));assert.ok(!JSON.stringify(r).includes('PRIVATE KEY'));
 const grants=f.calls.filter(c=>c.path.endsWith('/access_tokens'));
 assert.deepEqual(grants[0].parsed,{permissions:{metadata:'read'}});
 assert.deepEqual(grants[1].parsed.repository_ids,Object.values(CATALOG));assert.deepEqual(grants[1].parsed.permissions,expected);
});
test('account mandatory and unknown account, repository escapes, operation rejected before key read',async()=>{
 const f=fixture();for(const value of [ {...input('identity'),account:undefined},{...input('identity'),account:'EdwardTang'},{...input('identity'),repo:'other/MontClip'},{...input('identity'),operation:'raw_request'},input('get_contents',{path:'../secret'}),input('get_contents',{path:'a%2fb'}),input('create_branch',{branch:'bad..ref',sha:SHA}),input('identity',{url:'https://evil.test'})]){
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

test('ReviewInbox actual App identity uses read-only code and comment-capable review permissions',async()=>{
 const f=fixture({account:'reviewinbox'}),r=await f.client.run(input('identity',{},'reviewinbox'));
 assert.equal(r.ok,true);assert.equal(r.result.app_id,5687106);assert.equal(r.receipt.installation_id,180305629);
 assert.equal(r.result.app_slug,'reviewinboxoppiexyz');
 assert.deepEqual(r.result.permissions,{contents:'read',issues:'write',pull_requests:'write',metadata:'read'});
 assert.deepEqual(f.calls.filter(c=>c.path.endsWith('/access_tokens'))[1].parsed.permissions,r.result.permissions);
 const posted=await f.client.run(input('submit_review',{number:7,commit_id:SHA,event:'COMMENT',body:'Finding'},'reviewinbox'));
 assert.equal(posted.ok,true);assert.equal(posted.receipt.app_slug,'reviewinboxoppiexyz');
});

test('ReviewInbox code/admin writes and formal review decisions fail before key access',async()=>{
 const f=fixture({account:'reviewinbox'});
 for(const [operation,args] of [
  ['create_branch',{branch:'agent/test',sha:SHA}],
  ['update_file',{path:'a.txt',branch:'agent/test',expected_sha:null,message:'test',content_base64:'dGVzdA=='}],
  ['admin_get',{}],['admin_update',{allow_squash_merge:true}],
  ['submit_review',{number:7,commit_id:SHA,event:'APPROVE',body:'ok'}],
  ['submit_review',{number:7,commit_id:SHA,event:'REQUEST_CHANGES',body:'fix'}],
 ]) assert.equal((await f.client.run(input(operation,args,'reviewinbox'))).ok,false,operation);
 assert.equal(f.credentialsCalls(),0);assert.equal(f.calls.length,0);
});

test('ReviewInbox does not accept invented legacy slug or elevated installation permissions',async()=>{
 for(const options of [{slug:'oppie-agent-reviewinbox'},{permissions:{...expected}},{permissions:{...expected,contents:'read',administration:'write'}}]){
  const f=fixture({account:'reviewinbox',...options});const r=await f.client.run(input('identity',{},'reviewinbox'));
  assert.equal(r.ok,false);assert.equal(f.calls.some(c=>c.path.endsWith('/access_tokens')),false);
 }
});
test('extra permissions, extra repositories and duplicate repos fail closed',async()=>{
 for(const option of [{permissions:{...expected,administration:'write'}},{repositories:{...repos,total_count:3}},{repositories:{total_count:2,repositories:[repos.repositories[0],repos.repositories[0]]}}]){const f=fixture(option);const r=await f.client.run(input('identity'));assert.equal(r.ok,false);assert.ok(['PERMISSION_MISMATCH','INSTALLATION_REPOSITORY_SCOPE_MISMATCH'].includes(r.errorCode));}
});
test('ordinary account cannot request admin; QQ uses ruleset-only administration',async()=>{
 const f=fixture();assert.equal((await f.client.run(input('admin_get'))).errorCode,'ADMIN_ACCOUNT_REQUIRED');assert.equal(f.calls.length,0);
 const q=fixture({account:'qq'});const r=await q.client.run(input('list_rulesets',{},'qq'));assert.equal(r.ok,true);assert.equal(r.receipt.account,'qq');assert.equal(q.calls.at(-1).method,'GET');
 assert.equal((await q.client.run(input('admin_update',{delete_repository:true},'qq'))).ok,false);
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
 const f=fixture();await f.client.run(input('identity'));await f.client.run(input('identity'));assert.equal(f.calls.filter(c=>c.path.endsWith('/access_tokens')).length,4);assert.equal(f.credentialsCalls(),2);
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

const qqRepos={MontClip:1441621868,'MontClip-Cindy':1446532339,'montclip-rsi':1450602468,'rsi-playbooks':1450603260,'oppie-github':1451885379,'sglang-review-inbox':1451900929};
const qqRepoSet={total_count:6,repositories:Object.entries(qqRepos).map(([name,id])=>({name,id,full_name:'good-night-oppie/'+name}))};
test('QQ six-repo identity narrows contents permission and permits permission supersets',async()=>{const f=fixture({account:'qq',repositories:qqRepoSet,permissions:{...expected,administration:'write',checks:'write'}});const r=await f.client.run({...input('identity',{},'qq'),repo:'oppie-github'});assert.equal(r.ok,true);const p=f.calls.filter(c=>c.path.endsWith('/access_tokens')).at(-1).parsed;assert.equal(p.permissions.contents,'read');assert.deepEqual(p.repository_ids.sort(),Object.values(qqRepos).sort());});
test('QQ denies authoring and unconfirmed admin before credentials, other aliases cannot use QQ operations',async()=>{for(const operation of ['create_pull','update_pull','update_file','create_branch','create_issue','comment_issue','admin_update','ruleset_update']){const f=fixture({account:'qq'});assert.equal((await f.client.run(input(operation,{},'qq'))).ok,false);assert.equal(f.credentialsCalls(),0);}const f=fixture();assert.equal((await f.client.run(input('list_rulesets'))).ok,false);assert.equal(f.credentialsCalls(),0);});

test('QQ ruleset mutation needs live trusted confirmation and a structured owner reference',async()=>{
 const args={ruleset_id:8,ruleset:{enforcement:'active'},nonce:'a'.repeat(32),owner_authorization:'https://github.com/good-night-oppie/MontClip/issues/1#issuecomment-2'};
 for(const extra of [{},{authorize:async()=>false}]){const f=fixture({account:'qq',...extra});assert.equal((await f.client.run(input('ruleset_update',args,'qq'))).ok,false);assert.equal(f.credentialsCalls(),0);}
 const f=fixture({account:'qq',authorize:async()=>true,override(path){if(path.endsWith('/issues/comments/2'))return {status:200,data:{html_url:args.owner_authorization,user:{id:3278807,login:'EdwardTang',type:'User'},created_at:new Date(NOW-1000).toISOString(),body:require('../node/owner-authorization.cjs').requiredLine('MontClip',args)}};}});const r=await f.client.run(input('ruleset_update',args,'qq'));assert.equal(r.ok,true);assert.equal(f.calls.at(-1).method,'PUT');assert.deepEqual(f.calls.at(-1).parsed,{enforcement:'active'});
 const bad=fixture({account:'qq',authorize:async()=>true});assert.equal((await bad.client.run(input('ruleset_update',{...args,nonce:'a'.repeat(32),owner_authorization:'approved'},'qq'))).ok,false);assert.equal(bad.credentialsCalls(),0);
});
test('QQ unexpected repos and insufficient permission fail closed',async()=>{
 for(const options of [{repositories:twoRepos},{repositories:{...qqRepoSet,repositories:[...qqRepoSet.repositories.slice(1),qqRepoSet.repositories[1]]}},{permissions:{...expected,pull_requests:'read',administration:'write'}}])assert.equal((await fixture({account:'qq',...options}).client.run(input('identity',{},'qq'))).ok,false);
});
test('QQ dismissal is bounded to a review and enqueue binds current head',async()=>{
 const f=fixture({account:'qq'});assert.equal((await f.client.run(input('dismiss_review',{number:7,review_id:4,message:'Owner requested dismissal'},'qq'))).ok,true);assert.ok(f.calls.at(-1).path.endsWith('/pulls/7/reviews/4/dismissals'));
 const q=fixture({account:'qq',override(path){if(path.endsWith('/pulls/7'))return {status:200,data:{node_id:'PR_test',state:'open',draft:false,head:{sha:SHA}}};if(path==='/graphql')return {status:200,data:{data:{enqueuePullRequest:{mergeQueueEntry:{id:'MQ_test'}}}}};}});
 const r=await q.client.run(input('enqueue_pull',{number:7,commit_id:SHA},'qq'));assert.equal(r.ok,true);assert.deepEqual(q.calls.at(-1).parsed.variables,{id:'PR_test',head:SHA});
});

test('QQ refuses nonexistent or non-owner authorization references even after confirmation',async()=>{const f=fixture({account:'qq',authorize:async()=>true});const r=await f.client.run(input('ruleset_update',{ruleset_id:1,ruleset:{enforcement:'active'},nonce:'a'.repeat(32),owner_authorization:'https://github.com/good-night-oppie/MontClip/issues/1#issuecomment-2'},'qq'));assert.equal(r.errorCode,'OWNER_REFERENCE_UNVERIFIED');assert.equal(f.calls.some(c=>c.method==='PUT'),false);});

test('ruleset update rejects an expired owner comment before PUT',async()=>{const args={ruleset_id:8,ruleset:{enforcement:'active'},nonce:'a'.repeat(32),owner_authorization:'https://github.com/good-night-oppie/MontClip/issues/1#issuecomment-2'};const f=fixture({account:'qq',authorize:async()=>true,override(path){if(path.endsWith('/issues/comments/2'))return {status:200,data:{html_url:args.owner_authorization,user:{id:3278807,type:'User'},created_at:'2000-01-01T00:00:00Z',body:'old'}};}});assert.equal((await f.client.run(input('ruleset_update',args,'qq'))).ok,false);assert.equal(f.calls.some(c=>c.method==='PUT'),false);});

test('consumed owner nonce cannot produce a second ruleset write',async()=>{const args={ruleset_id:8,ruleset:{enforcement:'active'},nonce:'a'.repeat(32),owner_authorization:'https://github.com/good-night-oppie/MontClip/issues/1#issuecomment-2'};const f=fixture({account:'qq',authorize:async()=>true,claimAuthorization:async()=>false,override(path){if(path.endsWith('/issues/comments/2'))return {status:200,data:{html_url:args.owner_authorization,user:{login:'EdwardTang',id:3278807,type:'User'},created_at:new Date(NOW-1000).toISOString(),body:require('../node/owner-authorization.cjs').requiredLine('MontClip',args)}};}});const r=await f.client.run(input('ruleset_update',args,'qq'));assert.equal(r.errorCode,'OWNER_AUTHORIZATION_REPLAYED');assert.equal(f.calls.some(c=>c.method==='PUT'),false);});
const riInstall={MontClip:1441621868,'MontClip-Cindy':1446532339,'montclip-rsi':1450602468,'rsi-playbooks':1450603260,'oppie-github':1451885379,'sglang-review-inbox':1451900929};
const riSet=map=>({total_count:Object.keys(map).length,repositories:Object.entries(map).map(([name,id])=>({name,id,full_name:'good-night-oppie/'+name}))});
function riFixture(extra={}){let reads=0;return fixture({account:'reviewinbox',override(path){if(path==='/installation/repositories')return {status:200,data:++reads===1?(extra.install||riSet(riInstall)):(extra.execution||twoRepos)};}});}
test('ReviewInbox validates six installation repos while minting original two-repo execution token',async()=>{
 const f=riFixture(),r=await f.client.run(input('identity',{},'reviewinbox'));assert.equal(r.ok,true);assert.equal(r.result.installationRepositories.length,6);assert.equal(r.result.repositories.length,2);
 const request=f.calls.filter(c=>c.path.endsWith('/access_tokens')).at(-1).parsed;assert.deepEqual(request.repository_ids.sort(),Object.values(REPOSITORIES).sort());assert.deepEqual(request.permissions,{contents:'read',issues:'write',pull_requests:'write',metadata:'read'});
});
test('ReviewInbox wrong/missing/duplicate installation and wider token sets fail closed',async()=>{
 const full=riSet(riInstall);
 for(const extra of [{install:twoRepos},{install:{...full,repositories:[...full.repositories.slice(1),full.repositories[1]]}},{install:riSet({...riInstall,'oppie-github':1})},{execution:full}])assert.equal((await riFixture(extra).client.run(input('identity',{},'reviewinbox'))).ok,false);
 for(const repo of ['montclip-rsi','rsi-playbooks','oppie-github','sglang-review-inbox']){const f=riFixture();assert.equal((await f.client.run({account:'reviewinbox',repo,operation:'identity',args:{}})).ok,false);assert.equal(f.credentialsCalls(),0);}
});
