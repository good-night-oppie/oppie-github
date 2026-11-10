'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createClient,ACCOUNTS}=require('../node/core.cjs');
const {CATALOG}=require('../node/repository-policy.cjs');
const BASIC={contents:'write',issues:'write',pull_requests:'write',metadata:'read'};
const pem=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
const NOW=Date.parse('2026-11-10T23:00:00Z');
const rows=()=>({total_count:6,repositories:Object.entries(CATALOG).map(([name,id])=>({id,name,full_name:'good-night-oppie/'+name}))});
function fixture(account,{installationPermissions=BASIC,executionPermissions=BASIC,installationRows=rows(),executionRows=rows()}={}){
 const calls=[];let keyReads=0;const a=ACCOUNTS[account];
 const client=createClient({now:()=>NOW,credentials:async()=>{keyReads++;return pem;},fetch:async(url,init)=>{
  const route=new URL(url).pathname,body=init.body?JSON.parse(init.body):null;calls.push({route,body});let data;
  if(route==='/app')data={id:a.app_id,slug:a.app_slug,owner:{login:'good-night-oppie'}};
  else if(route==='/app/installations/'+a.installation_id)data={id:a.installation_id,app_id:a.app_id,account:{login:'good-night-oppie',type:'Organization'},repository_selection:'selected',permissions:installationPermissions};
  else if(route.endsWith('/access_tokens'))data={token:body.repository_ids?'exec':'probe',expires_at:new Date(NOW+600000).toISOString(),permissions:body.repository_ids?executionPermissions:{metadata:'read'}};
  else if(route==='/installation/repositories')data=init.headers.Authorization==='Bearer probe'?installationRows:executionRows;
  else if(route.startsWith('/repos/')&&route.endsWith('/issues'))data={number:1};
  else throw Error('Unexpected mock request');
  return {ok:true,status:200,text:async()=>JSON.stringify(data)};
 }});
 return {client,calls,keyReads:()=>keyReads};
}
for(const account of ['video','vv']){
 test(account+' supports ordinary writes in every reviewed repository',async()=>{
  for(const repo of Object.keys(CATALOG)){
   const f=fixture(account),r=await f.client.run({account,repo,operation:'create_issue',args:{title:'synthetic test'}});
   assert.equal(r.ok,true,repo+': '+r.errorCode);
   const mint=f.calls.filter(c=>c.route.endsWith('/access_tokens')).at(-1);
   assert.deepEqual(mint.body,{repository_ids:Object.values(CATALOG),permissions:BASIC});
   assert.equal(f.calls.filter(c=>c.route.startsWith('/repos/')).length,1);
  }
 });
 test(account+' rejects outside targets before credentials',async()=>{
  const f=fixture(account),r=await f.client.run({account,repo:'outside',operation:'identity'});
  assert.equal(r.errorCode,'REPOSITORY_NOT_ALLOWED');assert.equal(f.keyReads(),0);
 });
 test(account+' rejects incomplete installations and wrong IDs before business calls',async()=>{
  const missing=rows();missing.repositories.pop();
  const wrong=rows();wrong.repositories[0].id=1;
  for(const installationRows of [missing,wrong]){
   const f=fixture(account,{installationRows}),r=await f.client.run({account,repo:'MontClip',operation:'create_issue',args:{title:'synthetic test'}});
   assert.equal(r.errorCode,'INSTALLATION_REPOSITORY_SCOPE_MISMATCH');assert.equal(r.execution,'not_executed');
   assert.equal(f.calls.some(c=>c.route.startsWith('/repos/')),false);
  }
 });
 test(account+' rejects an execution token with a wrong repository ID',async()=>{
  const executionRows=rows();executionRows.repositories[0].id=1;
  const f=fixture(account,{executionRows}),r=await f.client.run({account,repo:'MontClip',operation:'identity'});
  assert.equal(r.errorCode,'EXECUTION_REPOSITORY_SCOPE_MISMATCH');
 });
}
test('PG installation accepts sufficient ordinary permissions and additional grants without forwarding them',async()=>{
 for(const installationPermissions of [BASIC,{...BASIC,metadata:'write'},{...BASIC,administration:'write',actions:'write',checks:'read'}]){
  const f=fixture('pg',{installationPermissions}),r=await f.client.run({account:'pg',repo:'oppie-github',operation:'identity'});
  assert.equal(r.ok,true,r.errorCode);assert.deepEqual(r.result.permissions,BASIC);
  const mints=f.calls.filter(c=>c.route.endsWith('/access_tokens'));
  assert.deepEqual(mints[0].body.permissions,{metadata:'read'});
  assert.deepEqual(mints[1].body.permissions,BASIC);
 }
});
test('PG installation refuses missing, weak and unknown required permission levels',async()=>{
 for(const key of Object.keys(BASIC))for(const value of [undefined,'none','unknown',...(BASIC[key]==='write'?['read']:[])]){
  const installationPermissions={...BASIC,administration:'write',actions:'write'};
  if(value===undefined)delete installationPermissions[key];else installationPermissions[key]=value;
  const f=fixture('pg',{installationPermissions}),r=await f.client.run({account:'pg',repo:'MontClip',operation:'identity'});
  assert.equal(r.errorCode,'PERMISSION_MISMATCH',key+': '+value);
  assert.equal(f.calls.some(c=>c.route.endsWith('/access_tokens')),false);
 }
});
test('PG execution rejects additional grants, missing permissions and stronger metadata',async()=>{
 for(const executionPermissions of [{...BASIC,administration:'write'},{...BASIC,actions:'read'},{...BASIC,metadata:'write'},{...BASIC,contents:'read'},{contents:'write',issues:'write',metadata:'read'}]){
  const f=fixture('pg',{installationPermissions:{...BASIC,administration:'write',actions:'write'},executionPermissions});
  const r=await f.client.run({account:'pg',repo:'MontClip',operation:'create_issue',args:{title:'synthetic test'}});
  assert.equal(r.errorCode,'PERMISSION_MISMATCH');
  assert.equal(f.calls.filter(c=>c.route.endsWith('/access_tokens')).length,2);
  assert.equal(f.calls.some(c=>c.route.startsWith('/repos/')),false);
 }
});
test('PG installation superset does not grant administrative operations',async()=>{
 for(const operation of ['admin_get','admin_update','list_rulesets','get_ruleset','ruleset_update','dismiss_review','enqueue_pull']){
  const f=fixture('pg',{installationPermissions:{...BASIC,administration:'write',actions:'write'}});
  const r=await f.client.run({account:'pg',repo:'MontClip',operation,args:{}});
  assert.equal(r.ok,false);assert.equal(r.execution,'not_executed');assert.equal(f.keyReads(),0);assert.equal(f.calls.length,0);
 }
});
test('ordinary accounts other than PG still refuse unexpected installation privileges',async()=>{
 for(const account of ['bb','cindy','deja','dd','gg','jj','rea','video','vv']){
  const f=fixture(account,{installationPermissions:{...BASIC,actions:'write'}});
  const r=await f.client.run({account,repo:'MontClip',operation:'identity'});
  assert.equal(r.errorCode,'PERMISSION_MISMATCH');assert.equal(f.calls.some(c=>c.route.endsWith('/access_tokens')),false);
 }
});

test('PG installation rejects prototype names and non-string required permission values',async()=>{
 for(const value of ['__proto__','constructor','toString',['write'],{},null,2]){
  const f=fixture('pg',{installationPermissions:{...BASIC,contents:value}});
  const r=await f.client.run({account:'pg',repo:'MontClip',operation:'identity'});
  assert.equal(r.errorCode,'PERMISSION_MISMATCH',JSON.stringify(value));
  assert.equal(f.calls.some(c=>c.route.endsWith('/access_tokens')),false);
 }
});
