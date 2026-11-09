'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createClient,makeJwt,ACCOUNTS,REPOSITORIES}=require('../node/core.cjs');
const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const PEM=privateKey.export({type:'pkcs8',format:'pem'});
const NOW=1800000000000;
const expected={contents:'write',issues:'write',pull_requests:'write',metadata:'read'};
const repos={total_count:2,repositories:Object.entries(REPOSITORIES).map(([name,id])=>({id,name,full_name:'good-night-oppie/'+name}))};
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
  else if(path==='/app/installations/'+account.installation_id)data={id:account.installation_id,app_id:account.app_id,account:{login:options.wrongOwner?'bad':'good-night-oppie',type:'Organization'},repository_selection:'selected',suspended_at:null,permissions:options.permissions||perms};
  else if(path.endsWith('/access_tokens')){
   data={token:'secret-token-'+(++counter),expires_at:new Date(options.expired?NOW-1:NOW+3600000).toISOString(),permissions:perms};
   const requested=JSON.parse(init.body).repository_ids;
   const installed=account.account==='reviewinbox'?riSet(riInstall):repos;
   const selected=requested?installed.repositories.filter(r=>requested.includes(r.id)):installed.repositories;
   tokenRepositories.set('Bearer '+data.token,{total_count:selected.length,repositories:selected});
  }
  else if(path==='/installation/repositories')data=options.repositories||tokenRepositories.get(init.headers.Authorization);
  else if(path.endsWith('/pulls/7'))data={number:7,head:{sha:options.head||SHA},state:'open',draft:!!options.draft};
  else if(path==='/repos/good-night-oppie/MontClip')data={default_branch:'main'};
  else data={id:1,html_url:'https://github.com/good-night-oppie/MontClip/issues/1',body:'normal result'};
  return {ok:status===200,status,text:async()=>JSON.stringify(data)};
 };
 return {calls,client:createClient({credentials:async alias=>{credentialsCalls++;assert.equal(alias,account.account);return PEM;},fetch,now:()=>NOW}),credentialsCalls:()=>credentialsCalls};
}
const input=(operation,args={},account='bb')=>({account,repo:'MontClip',operation,args});
test('JWT is RSA signed, short lived, and names fixed app id',()=>{
 const jwt=makeJwt(ACCOUNTS.bb,PEM,NOW);const [h,p,s]=jwt.split('.');
 const payload=JSON.parse(Buffer.from(p,'base64url'));assert.equal(payload.iss,String(ACCOUNTS.bb.app_id));assert.equal(payload.exp-payload.iat,540);
 assert.equal(crypto.verify('RSA-SHA256',Buffer.from(h+'.'+p),publicKey,Buffer.from(s,'base64url')),true);
});
test('identity verifies app, installation and exact repos; credentials never returned',async()=>{
 const f=fixture();const r=await f.client.run(input('identity'));
 assert.equal(r.ok,true);assert.equal(r.receipt.app_slug,'oppie-agent-bb');assert.equal(r.result.repositories.length,2);
 assert.ok(!JSON.stringify(r).includes('secret-token'));assert.ok(!JSON.stringify(r).includes('PRIVATE KEY'));
 const grants=f.calls.filter(c=>c.path.endsWith('/access_tokens'));
 assert.deepEqual(grants[0].parsed,{permissions:{metadata:'read'}});
 assert.deepEqual(grants[1].parsed.repository_ids,[1441621868,1446532339]);assert.deepEqual(grants[1].parsed.permissions,expected);
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
 for(const option of [{permissions:{...expected,administration:'write'}},{repositories:{...repos,total_count:3}},{repositories:{total_count:2,repositories:[repos.repositories[0],repos.repositories[0]]}}]){const f=fixture(option);const r=await f.client.run(input('identity'));assert.equal(r.ok,false);assert.ok(['PERMISSION_MISMATCH','REPOSITORY_SCOPE_MISMATCH'].includes(r.errorCode));}
});
test('ordinary account cannot request admin; QQ is explicit and carries only approved permissions',async()=>{
 const f=fixture();assert.equal((await f.client.run(input('admin_get'))).errorCode,'ADMIN_ACCOUNT_REQUIRED');assert.equal(f.calls.length,0);
 const q=fixture({account:'qq'});const r=await q.client.run(input('admin_update',{allow_squash_merge:true},'qq'));assert.equal(r.ok,true);assert.equal(r.receipt.account,'qq');assert.equal(q.calls.at(-1).method,'PATCH');
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

test('ReviewInbox explicit human draft request permits COMMENT only and never forwards provenance',async()=>{
 const args={number:7,commit_id:SHA,event:'COMMENT',body:'Requested review',draft_request:'https://github.com/good-night-oppie/MontClip/issues/7#issuecomment-123'};
 const f=fixture({draft:true,account:"reviewinbox"});const r=await f.client.run(input('submit_review',args,'reviewinbox'));
 assert.equal(r.ok,true);assert.equal(f.calls.at(-1).parsed.draft_request,undefined);
 for(const [account,overrides] of [['reviewinbox',{draft_request:''}],['reviewinbox',{event:'APPROVE'}],['qq',{}],['reviewinbox',{draft_request:true}]]){
  const x=fixture({draft:true,account});const out=await x.client.run(input('submit_review',{...args,...overrides},account));
  assert.equal(out.ok,false);assert.equal(x.calls.some(c=>c.method==='POST'&&c.path.endsWith('/reviews')),false);
 }
 const stale=fixture({draft:true,account:'reviewinbox',head:'b'.repeat(40)});
 assert.equal((await stale.client.run(input('submit_review',args,'reviewinbox'))).ok,false);
});

const riInstall={MontClip:1441621868,'MontClip-Cindy':1446532339,'montclip-rsi':1450602468,'rsi-playbooks':1450603260,'oppie-github':1451885379,'sglang-review-inbox':1451900929};
const riSet=map=>({total_count:Object.keys(map).length,repositories:Object.entries(map).map(([name,id])=>({name,id,full_name:'good-night-oppie/'+name}))});
function riFixture(extra={}){let reads=0;return fixture({account:'reviewinbox',override(path){if(path==='/installation/repositories')return {status:200,data:++reads===1?(extra.install||riSet(riInstall)):(extra.execution||repos)};}});}
test('ReviewInbox validates six installation repos while minting original two-repo execution token',async()=>{
 const f=riFixture(),r=await f.client.run(input('identity',{},'reviewinbox'));assert.equal(r.ok,true);assert.equal(r.result.installationRepositories.length,6);assert.equal(r.result.repositories.length,2);
 const request=f.calls.filter(c=>c.path.endsWith('/access_tokens')).at(-1).parsed;assert.deepEqual(request.repository_ids.sort(),Object.values(REPOSITORIES).sort());assert.deepEqual(request.permissions,{contents:'read',issues:'write',pull_requests:'write',metadata:'read'});
});
test('ReviewInbox wrong/missing/duplicate installation and wider token sets fail closed',async()=>{
 const full=riSet(riInstall);
 for(const extra of [{install:repos},{install:{...full,repositories:[...full.repositories.slice(1),full.repositories[1]]}},{install:riSet({...riInstall,'oppie-github':1})},{execution:full}])assert.equal((await riFixture(extra).client.run(input('identity',{},'reviewinbox'))).ok,false);
 for(const repo of ['montclip-rsi','rsi-playbooks','oppie-github','sglang-review-inbox']){const f=riFixture();assert.equal((await f.client.run({account:'reviewinbox',repo,operation:'identity',args:{}})).ok,false);assert.equal(f.credentialsCalls(),0);}
});
