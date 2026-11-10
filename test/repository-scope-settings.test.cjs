'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createClient,ACCOUNTS}=require('../node/core.cjs');
const CATALOG={MontClip:1441621868,'MontClip-Cindy':1446532339,'montclip-rsi':1450602468,'rsi-playbooks':1450603260,'oppie-github':1451885379,'sglang-review-inbox':1451900929};
const TWO={MontClip:1441621868,'MontClip-Cindy':1446532339};
const PEM=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
const NOW=Date.parse('2026-11-10T21:00:00Z');
const rows=map=>({total_count:Object.keys(map).length,repositories:Object.entries(map).map(([name,id])=>({name,id,full_name:'good-night-oppie/'+name}))});
function fixture({account='deja',installation=CATALOG,execution=CATALOG,alterInstallation,alterExecution,repositoryPolicy,beforeCredentials}={}){
 const calls=[];let keyReads=0;
 const permissions={contents:['qq','reviewinbox'].includes(account)?'read':'write',issues:'write',pull_requests:'write',metadata:'read',...(account==='qq'?{administration:'write'}:{})};
 const client=createClient({now:()=>NOW,repositoryPolicy,credentials:async()=>{keyReads++;await beforeCredentials?.();return PEM;},fetch:async(url,init)=>{
  const path=new URL(url).pathname,body=init.body?JSON.parse(init.body):undefined;calls.push({path,body});let data;
  if(path==='/app')data={id:ACCOUNTS[account].app_id,slug:ACCOUNTS[account].app_slug,owner:{login:'good-night-oppie'}};
  else if(path==='/app/installations/'+ACCOUNTS[account].installation_id)data={id:ACCOUNTS[account].installation_id,app_id:ACCOUNTS[account].app_id,account:{login:'good-night-oppie',type:'Organization'},repository_selection:'selected',permissions:{...permissions,...(account==='pg'?{administration:'write'}:{})}};
  else if(path.endsWith('/access_tokens'))data={token:body.repository_ids?'execution-token':'probe-token',expires_at:new Date(NOW+600000).toISOString(),permissions};
  else if(path==='/installation/repositories')data=init.headers.Authorization==='Bearer probe-token'?(alterInstallation||rows(installation)):(alterExecution||rows(execution));
  else throw Error('Unexpected business request');
  return {ok:true,status:200,text:async()=>JSON.stringify(data)};
 }});
 return {client,calls,keyReads:()=>keyReads};
}
const input=(repo='MontClip',account='deja')=>({account,repo,operation:'identity',args:{}});
test('Deja can use each of the six authorized repositories with exact narrowed token IDs',async()=>{
 for(const repo of Object.keys(CATALOG)){
  const f=fixture(),r=await f.client.run(input(repo));assert.equal(r.ok,true,repo+': '+r.errorCode);
  assert.deepEqual(f.calls.filter(c=>c.path.endsWith('/access_tokens')).at(-1).body.repository_ids,Object.values(CATALOG));
  assert.equal(r.result.installationRepositories.length,6);assert.equal(r.result.repositories.length,6);assert.equal(r.receipt.scopeRevision,0);
 }
});
test('an outside repository fails before credentials',async()=>{const f=fixture(),r=await f.client.run(input('outside'));assert.equal(r.errorCode,'REPOSITORY_NOT_ALLOWED');assert.equal(f.keyReads(),0);});
test('account defaults match the authorized installation and execution matrix',async()=>{
 for(const account of Object.keys(ACCOUNTS).filter(a=>a!=='deja')){
  const installation=['video','vv'].includes(account)?TWO:CATALOG,execution=['video','vv','reviewinbox'].includes(account)?TWO:CATALOG;
  const f=fixture({account,installation,execution}),r=await f.client.run(input('MontClip',account));assert.equal(r.ok,true,account+': '+r.errorCode);
  assert.deepEqual(f.calls.filter(c=>c.path.endsWith('/access_tokens')).at(-1).body.repository_ids,Object.values(execution));
  if(['video','vv','reviewinbox'].includes(account))assert.equal((await f.client.run(input('montclip-rsi',account))).errorCode,'REPOSITORY_NOT_ALLOWED');
 }
});
test('six-repository installation still refuses wrong IDs, duplicate rows and incomplete listings',async()=>{
 const full=rows(CATALOG);
 for(const alterInstallation of [rows({...CATALOG,MontClip:1}),{...full,total_count:7},{...full,repositories:full.repositories.slice(1)},{...full,repositories:[...full.repositories.slice(1),full.repositories[1]]},{...full,repositories:[null,...full.repositories.slice(1)]}]){
  const f=fixture({alterInstallation}),r=await f.client.run(input());assert.equal(r.ok,false);assert.equal(r.execution,'not_executed');
  assert.equal(f.calls.filter(c=>c.path.endsWith('/access_tokens')).length,1);
 }
});
test('execution token with a wrong ID is rejected after installation passes',async()=>{const f=fixture({alterExecution:rows({...CATALOG,MontClip:1})});assert.equal((await f.client.run(input())).errorCode,'EXECUTION_REPOSITORY_SCOPE_MISMATCH');});
test('caller-supplied scopes, revisions and approval flags cannot widen direct core calls',async()=>{
 for(const extra of [{scopeRevision:99},{repositoryPolicy:{execution:CATALOG}},{confirmed:true},{owner:true},{configuration:{accounts:{bb:CATALOG}}}]){
  const f=fixture();const r=await f.client.run({...input(),...extra});assert.equal(r.ok,false);assert.equal(f.keyReads(),0);
 }
});
test('malformed provider configuration fails before credentials',async()=>{
 for(const repositoryPolicy of [()=>({}),()=>({revision:1,accounts:{deja:{installation:CATALOG,execution:CATALOG}}}),()=>null]){
  const f=fixture({repositoryPolicy});assert.equal((await f.client.run(input())).errorCode,'INVALID_SCOPE_CONFIGURATION');assert.equal(f.keyReads(),0);
 }
});
test('QQ authoring and ReviewInbox approval stay denied',async()=>{
 for(const [account,operation,args] of [['qq','create_issue',{title:'x'}],['reviewinbox','submit_review',{number:1,commit_id:'a'.repeat(40),event:'APPROVE'}]]){
  const f=fixture({account});assert.equal((await f.client.run({...input('MontClip',account),operation,args})).ok,false);assert.equal(f.keyReads(),0);
 }
});
test('an in-flight call keeps its snapshot; the next call sees a narrowed revision',async()=>{
 const {initialPolicy}=require('../node/repository-policy.cjs');
 let live=JSON.parse(JSON.stringify(initialPolicy())),release,started;
 const ready=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const f=fixture({repositoryPolicy:()=>live,beforeCredentials:async()=>{started();await gate;}});
 const running=f.client.run(input('oppie-github'));await ready;
 live.revision=1;live.accounts.deja.execution=TWO;release();
 const r=await running;assert.equal(r.ok,true);assert.equal(r.receipt.scopeRevision,0);
 assert.deepEqual(f.calls.filter(c=>c.path.endsWith('/access_tokens')).at(-1).body.repository_ids,Object.values(CATALOG));
 const keyReads=f.keyReads();const denied=await f.client.run(input('oppie-github'));
 assert.equal(denied.errorCode,'REPOSITORY_NOT_ALLOWED');assert.equal(f.keyReads(),keyReads);
 const narrow=fixture({repositoryPolicy:()=>live,execution:TWO}),next=await narrow.client.run(input());
 assert.equal(next.ok,true);assert.equal(next.receipt.scopeRevision,1);
 assert.deepEqual(narrow.calls.filter(c=>c.path.endsWith('/access_tokens')).at(-1).body.repository_ids,Object.values(TWO));
});
test('no execution token is cached across calls using the same client',async()=>{
 const f=fixture();await f.client.run(input());await f.client.run(input());
 assert.equal(f.keyReads(),2);assert.equal(f.calls.filter(c=>c.path.endsWith('/access_tokens')).length,4);
});
test('scope validation copies and freezes maps and refuses account/ID/role injection',()=>{
 const {initialPolicy,validatePolicy,ACCOUNT_NAMES}=require('../node/repository-policy.cjs');
 assert.deepEqual([...ACCOUNT_NAMES].sort(),Object.keys(ACCOUNTS).sort());
 const base=initialPolicy();assert.ok(Object.isFrozen(base.accounts.deja.execution));
 const mutations=[
  p=>{p.accounts.deja.execution={outside:1};},
  p=>{p.accounts.deja.execution.MontClip=1;},
  p=>{p.accounts.deja.installation=TWO;},
  p=>{p.accounts.bb.execution=TWO;p.accounts.bb.installation=TWO;},
  p=>{p.accounts.qq.permissions={administration:'write'};},
  p=>{p.accounts.reviewinbox.execution=CATALOG;},
  p=>{p.revision='1';},p=>{p.confirmed=true;},p=>{delete p.accounts.bb;},
  p=>{p.accounts.deja.execution=[];},p=>{p.accounts.deja.execution={};},
  p=>{Object.defineProperty(p.accounts.deja.execution,'MontClip',{get(){throw Error('Getter called');},enumerable:true});},
 ];
 for(const mutate of mutations){const p=JSON.parse(JSON.stringify(base));mutate(p);assert.throws(()=>validatePolicy(p),{code:'INVALID_SCOPE_CONFIGURATION'});}
 const p=JSON.parse(JSON.stringify(base)),snapshot=validatePolicy(p);p.accounts.deja.execution.MontClip=1;
 assert.equal(snapshot.accounts.deja.execution.MontClip,CATALOG.MontClip);
});
