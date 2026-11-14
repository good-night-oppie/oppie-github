'use strict';
// #22: the fork good-night-oppie/cindy in the repo enum and in each account's exact repository sets.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {createClient,ACCOUNTS}=require('../node/core.cjs');
const {initialPolicy,validatePolicy}=require('../node/repository-policy.cjs');
// The reviewed design, written out independently of the policy module.
const SIX={MontClip:1441621868,'MontClip-Cindy':1446532339,'montclip-rsi':1450602468,'rsi-playbooks':1450603260,'oppie-github':1451885379,'sglang-review-inbox':1451900929};
const SEVEN={...SIX,cindy:1457433299};
const TWO={MontClip:1441621868,'MontClip-Cindy':1446532339};
const DESIGN={bb:SEVEN,cindy:SEVEN,deja:SEVEN,dd:SEVEN,qq:SEVEN,gg:SIX,jj:SIX,pg:SIX,rea:SIX,video:SIX,vv:SIX,reviewinbox:TWO};
const WRITERS=['bb','cindy','deja'];
const SHA='a'.repeat(40);
const pem=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
const now=Date.parse('2026-11-14T07:00:00Z');
const rows=map=>({total_count:Object.keys(map).length,repositories:Object.entries(map).map(([name,id])=>({id,name,full_name:'good-night-oppie/'+name}))});
function fixture(account){
 const calls=[];let keyReads=0;const a=ACCOUNTS[account];
 const permissions={contents:['qq','reviewinbox'].includes(account)?'read':'write',issues:'write',pull_requests:'write',metadata:'read',...(account==='qq'?{administration:'write'}:{})};
 const client=createClient({now:()=>now,credentials:async()=>{keyReads++;return pem;},fetch:async(url,init)=>{
  const route=new URL(url).pathname,body=init.body?JSON.parse(init.body):null;calls.push({route,body,method:init.method||'GET'});let data;
  if(route==='/app')data={id:a.app_id,slug:a.app_slug,owner:{login:'good-night-oppie'}};
  else if(route==='/app/installations/'+a.installation_id)data={id:a.installation_id,app_id:a.app_id,account:{login:'good-night-oppie',type:'Organization'},repository_selection:'selected',permissions};
  else if(route.endsWith('/access_tokens'))data={token:body.repository_ids?'exec':'probe',expires_at:new Date(now+600000).toISOString(),permissions:body.repository_ids?permissions:{metadata:'read'}};
  else if(route==='/installation/repositories')data=rows(init.headers.Authorization==='Bearer probe'?SEVEN:DESIGN[account]);
  else if(route==='/repos/good-night-oppie/cindy')data={default_branch:'main'};
  else if(route==='/repos/good-night-oppie/cindy/pulls/7'&&(init.method||'GET')==='GET')data={number:7,head:{sha:SHA},state:'open',draft:false};
  else if(route.startsWith('/repos/good-night-oppie/'))data={id:1,number:1,html_url:'https://github.com/good-night-oppie/cindy/pull/1'};
  else throw Error('Unexpected request');
  return {ok:true,status:200,text:async()=>JSON.stringify(data)};
 }});
 return {client,calls,keyReads:()=>keyReads};
}
const run=(f,account,operation,args={},repo='cindy')=>f.client.run({account,repo,operation,args});
const writes=f=>f.calls.filter(c=>c.route.startsWith('/repos/')&&c.method!=='GET');

test('the github tool repo enum offers cindy',()=>{
 const ghost=JSON.parse(fs.readFileSync(path.join(__dirname,'..','ghost.json'),'utf8'));
 const tool=ghost.tools.find(t=>t.name==='github');
 assert.deepEqual(tool.parameters.properties.repo.enum,Object.keys(SEVEN));
 // Other tools' repo enums (review queue) are not widened by #22.
 for(const t of ghost.tools.filter(t=>t.name!=='github'))assert.ok(!t.parameters?.properties?.repo?.enum?.includes('cindy'),t.name);
});

test('every account has the reviewed installation and execution sets',()=>{
 const policy=initialPolicy();
 assert.deepEqual(Object.keys(policy.accounts).sort(),Object.keys(DESIGN).sort());
 for(const [account,execution] of Object.entries(DESIGN)){
  assert.deepEqual(policy.accounts[account].installation,SEVEN,account+' installation');
  assert.deepEqual(policy.accounts[account].execution,execution,account+' execution');
 }
});

test('the reviewed sets cannot be widened or narrowed through configuration',()=>{
 const base=JSON.parse(JSON.stringify(initialPolicy()));
 for(const mutate of [
  p=>{p.accounts.gg.execution=SEVEN;},p=>{p.accounts.pg.execution=SEVEN;},p=>{p.accounts.reviewinbox.execution={...TWO,cindy:1457433299};},
  p=>{p.accounts.bb.installation=SIX;},p=>{p.accounts.bb.execution=SIX;},p=>{p.accounts.dd.execution.cindy=1;},
  p=>{p.accounts.qq.installation=SIX;p.accounts.qq.execution=SIX;},
 ]){const p=JSON.parse(JSON.stringify(base));mutate(p);assert.throws(()=>validatePolicy(p),{code:'INVALID_SCOPE_CONFIGURATION'});}
});

for(const account of Object.keys(DESIGN))test(account+' identity on its first execution repository verifies all seven installed repositories',async()=>{
 const repo=Object.keys(DESIGN[account])[0],f=fixture(account),r=await run(f,account,'identity',{},repo);
 assert.equal(r.ok,true,r.errorCode);
 assert.equal(r.result.installationRepositories.length,7);
 assert.deepEqual(r.result.repositories.map(x=>x.id),Object.values(DESIGN[account]));
 assert.deepEqual(f.calls.filter(c=>c.route.endsWith('/access_tokens')).at(-1).body.repository_ids,Object.values(DESIGN[account]));
});

for(const account of Object.keys(DESIGN).filter(a=>!Object.hasOwn(DESIGN[a],'cindy')))test(account+' cannot reach cindy at all; refused before credentials',async()=>{
 for(const [operation,args] of [['identity',{}],['get_issue',{number:1}],['comment_issue',{number:1,body:'x'}],['create_branch',{branch:'agy/x',sha:SHA}]]){
  const f=fixture(account),r=await run(f,account,operation,args);
  assert.equal(r.errorCode,'REPOSITORY_NOT_ALLOWED',operation);assert.equal(r.execution,'not_executed');assert.equal(f.keyReads(),0);assert.equal(f.calls.length,0);
 }
});

for(const account of WRITERS)test(account+' may write branches and PRs on cindy',async()=>{
 for(const [operation,args] of [['create_branch',{branch:'agy/native-runtime-x',sha:SHA}],['create_pull',{title:'t',head:'agy/x',base:'main'}],['comment_issue',{number:1,body:'x'}],['submit_review',{number:7,commit_id:SHA,event:'COMMENT',body:'ok'}]]){
  const f=fixture(account),r=await run(f,account,operation,args);
  assert.equal(r.ok,true,operation+': '+r.errorCode);assert.equal(writes(f).length,1,operation);
 }
});

for(const account of WRITERS)test(account+' still cannot write the cindy default branch',async()=>{
 const f=fixture(account),r=await run(f,account,'create_branch',{branch:'main',sha:SHA});
 assert.equal(r.errorCode,'DEFAULT_BRANCH_WRITE_REFUSED');assert.equal(writes(f).length,0);
});

test('DD on cindy is COMMENT-only: authoring, issue edits and non-COMMENT reviews are refused before credentials',async()=>{
 const refused=[
  ['create_branch',{branch:'agy/x',sha:SHA}],
  ['update_file',{path:'a.txt',branch:'agy/x',expected_sha:null,message:'m\n\nAssisted-by: Cindy (https://cindy.app)',content_base64:'eA=='}],
  ['edit_file',{path:'a.txt',branch:'agy/x',expected_sha:SHA,expected_result_sha256:'b'.repeat(64),message:'m',edits:[{old_text:'a',new_text:'b'}]}],
  ['commit_files',{branch:'agy/x',expected_head:SHA,message:'m\n\nAssisted-by: Cindy (https://cindy.app)',changes:[{path:'a.txt',content_base64:'eA=='}]}],
  ['create_pull',{title:'t',head:'agy/x',base:'main'}],
  ['update_pull',{number:7,title:'t'}],
  ['create_issue',{title:'t'}],
  ['update_issue',{number:1,state:'closed'}],
 ];
 for(const [operation,args] of refused){
  const f=fixture('dd'),r=await run(f,'dd',operation,args);
  assert.equal(r.errorCode,'REVIEW_ONLY_REPOSITORY',operation);assert.equal(r.execution,'not_executed');assert.equal(f.keyReads(),0);assert.equal(f.calls.length,0);
 }
 for(const event of ['APPROVE','REQUEST_CHANGES']){
  const f=fixture('dd'),r=await run(f,'dd','submit_review',{number:7,commit_id:SHA,event,body:'x'});
  assert.equal(r.errorCode,'COMMENT_ONLY_REVIEWER',event);assert.equal(f.keyReads(),0);
 }
});

test('DD on cindy may read, comment on issues and post COMMENT reviews',async()=>{
 for(const [operation,args] of [['get_contents',{path:'README.md'}],['get_pull',{number:7}],['comment_issue',{number:1,body:'x'}],['submit_review',{number:7,commit_id:SHA,event:'COMMENT',body:'review'}]]){
  const f=fixture('dd'),r=await run(f,'dd',operation,args);assert.equal(r.ok,true,operation+': '+r.errorCode);
 }
});

test('DD keeps its ordinary role on the original six repositories',async()=>{
 const f=fixture('dd'),r=await run(f,'dd','create_issue',{title:'t'},'MontClip');
 assert.equal(r.ok,true,r.errorCode);assert.equal(writes(f).length,1);
});

test('QQ on cindy keeps its existing restrictions',async()=>{
 for(const [operation,args] of [['create_branch',{branch:'agy/x',sha:SHA}],['create_pull',{title:'t',head:'agy/x',base:'main'}],['commit_files',{branch:'agy/x',expected_head:SHA,message:'m\n\nAssisted-by: x',changes:[{path:'a',content_base64:'eA=='}]}],['comment_issue',{number:1,body:'x'}]]){
  const f=fixture('qq'),r=await run(f,'qq',operation,args);
  assert.equal(r.errorCode,'QQ_AUTHORING_REFUSED',operation);assert.equal(f.keyReads(),0);
 }
 const f=fixture('qq'),r=await run(f,'qq','submit_review',{number:7,commit_id:SHA,event:'COMMENT',body:'review'});
 assert.equal(r.ok,true,r.errorCode);
});
