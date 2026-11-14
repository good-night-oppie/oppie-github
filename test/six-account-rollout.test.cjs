'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createClient,ACCOUNTS}=require('../node/core.cjs');
const {CATALOG,SIX:SIX_REPOS,CINDY_EXECUTION,reviewOnly}=require('../node/repository-policy.cjs');
const TWO={MontClip:1441621868,'MontClip-Cindy':1446532339};
const SIX=['bb','cindy','deja','dd','gg','jj','rea','pg','video','vv'];
const pem=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
const now=Date.parse('2026-11-10T22:00:00Z');
function fixture(account,options={}){
 const calls=[];let keyReads=0;const a=ACCOUNTS[account];
 const execution=account==='reviewinbox'?TWO:CINDY_EXECUTION.includes(account)?CATALOG:SIX_REPOS;
 const installation=CATALOG;
 const permissions={contents:['qq','reviewinbox'].includes(account)?'read':'write',issues:'write',pull_requests:'write',metadata:'read',...(account==='qq'?{administration:'write'}:{})};
 const installPermissions={...permissions,...(account==='pg'?{administration:'write'}:{})};
 const rows=map=>({total_count:Object.keys(map).length,repositories:Object.entries(map).map(([name,id])=>({id,name,full_name:'good-night-oppie/'+name}))});
 const client=createClient({now:()=>now,credentials:async()=>{keyReads++;return pem;},fetch:async(url,init)=>{
  const path=new URL(url).pathname,body=init.body?JSON.parse(init.body):null;calls.push({path,body,method:init.method});let data;
  if(path==='/app')data={id:a.app_id,slug:a.app_slug,owner:{login:'good-night-oppie'}};
  else if(path==='/app/installations/'+a.installation_id)data={id:a.installation_id,app_id:a.app_id,account:{login:'good-night-oppie',type:'Organization'},repository_selection:'selected',permissions:options.installPermissions||installPermissions};
  else if(path.endsWith('/access_tokens'))data={token:body.repository_ids?'exec':'probe',expires_at:new Date(now+600000).toISOString(),permissions:options.tokenPermissions||permissions};
  else if(path==='/installation/repositories')data=rows(init.headers.Authorization==='Bearer probe'?installation:execution);
  else if(path.startsWith('/repos/')&&path.endsWith('/issues'))data={number:42,html_url:'https://github.com/good-night-oppie/'+path.split('/')[3]+'/issues/42'};
  else throw Error('Unexpected request');
  return {ok:true,status:200,text:async()=>JSON.stringify(data)};
 }});return {client,calls,keyReads:()=>keyReads,permissions};
}
for(const account of SIX)test(account+' uses its execution repositories for ordinary issue writes',async()=>{
 const execution=CINDY_EXECUTION.includes(account)?CATALOG:SIX_REPOS;
 for(const repo of Object.keys(execution)){
  const f=fixture(account),result=await f.client.run({account,repo,operation:'create_issue',args:{title:'synthetic scope test'}});
  if(reviewOnly(account,repo)){assert.equal(result.errorCode,'REVIEW_ONLY_REPOSITORY');assert.equal(f.keyReads(),0);continue;}
  assert.equal(result.ok,true,repo+': '+result.errorCode);
  const request=f.calls.filter(c=>c.path.endsWith('/access_tokens')).at(-1).body;
  assert.deepEqual(request.repository_ids,Object.values(execution));assert.deepEqual(request.permissions,f.permissions);
  assert.equal(f.calls.filter(c=>c.path.startsWith('/repos/')).length,1);
 }
});
for(const account of ['qq','reviewinbox'])test(account+' retains repository and execution permission boundaries',async()=>{
 const f=fixture(account),r=await f.client.run({account,repo:'MontClip',operation:'identity'});
 assert.equal(r.ok,true,r.errorCode);
 assert.equal(r.result.repositories.length,account==='qq'?7:2);
 assert.equal(r.result.installationRepositories.length,7);
 assert.deepEqual(r.result.permissions,f.permissions);
 if(account!=='qq')assert.equal((await f.client.run({account,repo:'oppie-github',operation:'identity'})).errorCode,'REPOSITORY_NOT_ALLOWED');
});
test('PG installation admin never becomes execution admin',async()=>{
 const f=fixture('pg'),r=await f.client.run({account:'pg',repo:'oppie-github',operation:'identity'});
 assert.equal(r.ok,true,r.errorCode);assert.equal(r.result.permissions.administration,undefined);
 assert.equal(f.calls.filter(c=>c.path.endsWith('/access_tokens')).at(-1).body.permissions.administration,undefined);
 const over=fixture('pg',{tokenPermissions:{...f.permissions,administration:'write'}});
 assert.equal((await over.client.run({account:'pg',repo:'MontClip',operation:'identity'})).errorCode,'PERMISSION_MISMATCH');
});
test('PG admin and QQ-only operations fail before credentials',async()=>{
 for(const operation of ['admin_get','admin_update','list_rulesets','get_ruleset','ruleset_update','dismiss_review','enqueue_pull']){
  const f=fixture('pg'),r=await f.client.run({account:'pg',repo:'oppie-github',operation,args:operation==='admin_update'?{allow_squash_merge:true}:{}});
  assert.equal(r.ok,false);assert.equal(r.execution,'not_executed');assert.equal(f.keyReads(),0);assert.equal(f.calls.length,0);
 }
});
test('PG installation still refuses insufficient ordinary permissions',async()=>{
 const basic={contents:'write',issues:'write',pull_requests:'write',metadata:'read'};
 for(const installPermissions of [{...basic,contents:'read'},{...basic,issues:'none'},{...basic,pull_requests:'read'},{...basic,metadata:'none'}]){
  const f=fixture('pg',{installPermissions});assert.equal((await f.client.run({account:'pg',repo:'MontClip',operation:'identity'})).errorCode,'PERMISSION_MISMATCH');
  assert.equal(f.calls.some(c=>c.path.endsWith('/access_tokens')),false);
 }
});
