'use strict';
// 2026-11-15 (owner): every App was granted "all repositories". The installation no longer has to
// equal the configured list; the target must be in the list, tokens stay narrowed to the list,
// (P0 minimal fix; configuration comes in a separate PR).
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createClient,ACCOUNTS}=require('../node/core.cjs');
const SEVEN={MontClip:1441621868,'MontClip-Cindy':1446532339,'montclip-rsi':1450602468,'rsi-playbooks':1450603260,'oppie-github':1451885379,'sglang-review-inbox':1451900929,cindy:1457433299};
const SHA='a'.repeat(40);
const pem=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
const now=Date.parse('2026-11-15T23:00:00Z');
const PERMS=a=>({contents:a==='qq'?'read':'write',issues:'write',pull_requests:'write',metadata:'read',...(a==='qq'?{administration:'write'}:{})});
const row=(name,id)=>({id,name,full_name:'good-night-oppie/'+name});
// An "all repositories" organisation listing: the configured seven plus many strangers.
function orgRepos(extra=243){const list=Object.entries(SEVEN).map(([n,i])=>row(n,i));for(let i=0;i<extra;i++)list.push(row('stranger-'+i,2000000000+i));return list;}
function fixture(account,{selection='all',listing=orgRepos(),pageTotal}={}){
 const a=ACCOUNTS[account];
 const calls=[];let keyReads=0,requested;
 const client=createClient({now:()=>now,credentials:async()=>{keyReads++;return pem;},fetch:async(url,init)=>{
  const u=new URL(url),route=u.pathname,method=init.method||'GET',body=init.body?JSON.parse(init.body):null;calls.push({route,method,body,query:u.search});let data;
  if(route==='/app')data={id:a.app_id,slug:a.app_slug,owner:{login:'good-night-oppie'}};
  else if(route==='/app/installations/'+a.installation_id)data={id:a.installation_id,app_id:a.app_id,account:{login:'good-night-oppie',type:'Organization'},repository_selection:selection,permissions:PERMS(account)};
  else if(route.endsWith('/access_tokens')){requested=body.repository_ids;data={token:body.repository_ids?'exec':'probe',expires_at:new Date(now+600000).toISOString(),permissions:body.repository_ids?PERMS(account):{metadata:'read'}};}
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
  else if(u.pathname.endsWith('/access_tokens')){const b=JSON.parse(init.body);data={token:b.repository_ids?'exec':'probe',expires_at:new Date(now+600000).toISOString(),permissions:b.repository_ids?PERMS('bb'):{metadata:'read'}};}
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
