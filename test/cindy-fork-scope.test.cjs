'use strict';
// #22: the fork good-night-oppie/cindy in the repo enum and in each account's exact repository sets,
// following QQ's review: bb/deja write, dd read + COMMENT, qq review operations only, others left out.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createClient,ACCOUNTS}=require('../node/core.cjs');
const {initialPolicy,validatePolicy}=require('../node/repository-policy.cjs');
const {createQueue,REPOS:QUEUE_REPOS}=require('../node/review-queue.cjs');
// The reviewed design, written out independently of the policy module.
const SIX={MontClip:1441621868,'MontClip-Cindy':1446532339,'montclip-rsi':1450602468,'rsi-playbooks':1450603260,'oppie-github':1451885379,'sglang-review-inbox':1451900929};
const SEVEN={...SIX,cindy:1457433299};
const TWO={MontClip:1441621868,'MontClip-Cindy':1446532339};
const DESIGN={bb:SEVEN,deja:SEVEN,dd:SEVEN,qq:SEVEN,cindy:SIX,gg:SIX,jj:SIX,pg:SIX,rea:SIX,video:SIX,vv:SIX,reviewinbox:TWO};
const WRITERS=['bb','deja'];
// Token permissions as they were before #22; this change must not alter them.
const TOKEN_PERMISSIONS=account=>({contents:['qq','reviewinbox'].includes(account)?'read':'write',issues:'write',pull_requests:'write',metadata:'read',...(account==='qq'?{administration:'write'}:{})});
const SHA='a'.repeat(40),SHA2='b'.repeat(40);
const ASSISTED='m\n\nAssisted-by: Cindy (https://cindy.app)';
const pem=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
const now=Date.parse('2026-11-14T07:00:00Z');
const rows=map=>({total_count:Object.keys(map).length,repositories:Object.entries(map).map(([name,id])=>({id,name,full_name:'good-night-oppie/'+name}))});
function fixture(account,{installed=rows(SEVEN)}={}){
 const calls=[];let keyReads=0,requested;const a=ACCOUNTS[account];
 const permissions=TOKEN_PERMISSIONS(account),installPermissions={...permissions,...(account==='pg'?{administration:'write'}:{})};
 const client=createClient({now:()=>now,authorize:async()=>true,claimAuthorization:async()=>true,credentials:async()=>{keyReads++;return pem;},fetch:async(url,init)=>{
  const u=new URL(url),route=u.pathname,method=init.method||'GET',body=init.body?JSON.parse(init.body):null;calls.push({route,body,method});let data,status=200;
  if(route==='/app')data={id:a.app_id,slug:a.app_slug,owner:{login:'good-night-oppie'}};
  else if(route==='/app/installations/'+a.installation_id)data={id:a.installation_id,app_id:a.app_id,account:{login:'good-night-oppie',type:'Organization'},repository_selection:'selected',permissions:installPermissions};
  else if(route.endsWith('/access_tokens')){requested=body.repository_ids;data={token:body.repository_ids?'exec':'probe',expires_at:new Date(now+600000).toISOString(),permissions:body.repository_ids?permissions:{metadata:'read'}};}
  // The execution token sees exactly the catalog repositories it was minted for.
  else if(route==='/installation/repositories')data=init.headers.Authorization==='Bearer probe'?installed:rows(Object.fromEntries(Object.entries(SEVEN).filter(([,id])=>requested.includes(id))));
  else if(/^\/repos\/good-night-oppie\/[^/]+$/.test(route)&&method==='GET')data={default_branch:'main'};
  else if(route.includes('/contents/')&&method==='GET'&&u.searchParams.has('ref')){status=404;data={message:'Not Found'};}
  else if(/\/pulls\/7$/.test(route)&&method==='GET')data={number:7,head:{sha:SHA},state:'open',draft:false};
  else if(route.startsWith('/repos/good-night-oppie/'))data={id:1,number:1,html_url:'https://github.com/'+route.slice(7)};
  else throw Error('Unexpected request');
  return {ok:status>=200&&status<300,status,text:async()=>JSON.stringify(data)};
 }});
 return {client,calls,keyReads:()=>keyReads};
}
const run=(f,account,operation,args={},repo='cindy')=>f.client.run({account,repo,operation,args});
const writes=f=>f.calls.filter(c=>c.route.startsWith('/repos/')&&c.method!=='GET');
async function refusedBeforeCredentials(account,operation,args,code,repo='cindy'){
 const f=fixture(account),r=await run(f,account,operation,args,repo);
 assert.equal(r.errorCode,code,account+' '+operation);assert.equal(r.execution,'not_executed');assert.equal(f.keyReads(),0);assert.equal(f.calls.length,0);
}
const AUTHORING=[
 ['create_branch',{branch:'agy/x',sha:SHA}],
 ['update_file',{path:'a.txt',branch:'agy/x',expected_sha:null,message:ASSISTED,content_base64:'eA=='}],
 ['edit_file',{path:'a.txt',branch:'agy/x',expected_sha:SHA,expected_result_sha256:'b'.repeat(64),message:'m',edits:[{old_text:'a',new_text:'b'}]}],
 ['commit_files',{branch:'agy/x',expected_head:SHA,message:ASSISTED,changes:[{path:'a.txt',content_base64:'eA=='}]}],
 ['create_pull',{title:'t',head:'agy/x',base:'main'}],
 ['update_pull',{number:7,title:'t'}],
 ['create_issue',{title:'t'}],
 ['update_issue',{number:1,state:'closed'}],
 ['comment_issue',{number:1,body:'x'}],
];
const READS=[['identity',{}],['get_contents',{path:'README.md'}],['list_branches',{}],['list_issues',{}],['get_issue',{number:1}],['list_pulls',{}],['get_pull',{number:7}],['pull_files',{number:7}],['list_reviews',{number:7}]];

// 1. Enum and review queue.
test('the github tool repo enum offers cindy; the review queue does not',()=>{
 const ghost=JSON.parse(fs.readFileSync(path.join(__dirname,'..','ghost.json'),'utf8'));
 assert.deepEqual(ghost.tools.find(t=>t.name==='github').parameters.properties.repo.enum,Object.keys(SEVEN));
 assert.deepEqual(ghost.tools.find(t=>t.name==='github_review_queue').parameters.properties.repo.enum,['good-night-oppie/MontClip','good-night-oppie/MontClip-Cindy']);
 for(const t of ghost.tools.filter(t=>t.name!=='github'))assert.ok(!JSON.stringify(t.parameters?.properties?.repo??null).includes('cindy"'),t.name);
 assert.deepEqual(QUEUE_REPOS,['good-night-oppie/MontClip','good-night-oppie/MontClip-Cindy']);
});
test('the review queue refuses a cindy target without calling GitHub',async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'oppie-q22-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let calls=0;const q=createQueue({client:{run:async()=>{calls++;return {ok:true,result:[]};}},statePath:path.join(root,'state.json'),now:()=>now});
 assert.equal((await q.initialize()).ok,true);const before=calls;
 for(const action of ['claim','finish']){const r=await q[action]({repo:'good-night-oppie/cindy',number:1,head_sha:SHA,claim_id:'x'});assert.equal(r.ok,false);assert.equal(r.errorCode,'INVALID_TARGET');}
 assert.equal(calls,before);
});

// 7. Every account: exact sets, positive and negative.
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
 const widen=Object.keys(DESIGN).filter(a=>!Object.hasOwn(DESIGN[a],'cindy')).map(a=>p=>{p.accounts[a].execution={...p.accounts[a].execution,cindy:1457433299};});
 // Deja keeps its pre-existing test seam that may select catalog subsets, so it is not narrowed here.
 const narrow=Object.keys(DESIGN).filter(a=>a!=='deja').map(a=>p=>{p.accounts[a].installation=SIX;delete p.accounts[a].execution.cindy;});
 for(const mutate of [...widen,...narrow,p=>{p.accounts.dd.execution.cindy=1;}]){const p=JSON.parse(JSON.stringify(base));mutate(p);assert.throws(()=>validatePolicy(p),{code:'INVALID_SCOPE_CONFIGURATION'});}
});
for(const [account,execution] of Object.entries(DESIGN)){
 test(account+' positive: identity succeeds on every execution repository with the exact token set and unchanged permissions',async()=>{
  for(const repo of Object.keys(execution)){
   const f=fixture(account),r=await run(f,account,'identity',{},repo);
   assert.equal(r.ok,true,repo+': '+r.errorCode);
   assert.equal(r.result.installationRepositories.length,7);
   assert.deepEqual(r.result.repositories.map(x=>x.id),Object.values(execution));
   const mint=f.calls.filter(c=>c.route.endsWith('/access_tokens')).at(-1).body;
   assert.deepEqual(mint,{repository_ids:Object.values(execution),permissions:TOKEN_PERMISSIONS(account)});
  }
 });
 test(account+' negative: repositories outside its set and the upstream are refused before credentials',async()=>{
  const outside=['makecindy/cindy','outside',...Object.keys(SEVEN).filter(r=>!Object.hasOwn(execution,r))];
  for(const repo of outside)for(const [operation,args] of [['identity',{}],['get_issue',{number:1}],...(account==='qq'?[]:[['create_pull',{title:'t',head:'agy/x',base:'main'}]])])
   await refusedBeforeCredentials(account,operation,args,'REPOSITORY_NOT_ALLOWED',repo);
 });
}

// 1. Writers: bb and deja.
for(const account of WRITERS)test(account+' may create branches, write files and open/update PRs on cindy',async()=>{
 for(const [operation,args] of [['create_branch',{branch:'agy/x',sha:SHA}],['update_file',{path:'a.txt',branch:'agy/x',expected_sha:null,message:ASSISTED,content_base64:'eA=='}],['create_pull',{title:'t',head:'agy/x',base:'main'}],['update_pull',{number:7,title:'t'}]]){
  const f=fixture(account),r=await run(f,account,operation,args);
  assert.equal(r.ok,true,operation+': '+r.errorCode);assert.equal(writes(f).length,1,operation);
  assert.ok(writes(f)[0].route.startsWith('/repos/good-night-oppie/cindy/'),writes(f)[0].route);
 }
});

// 6. Guardrails, reverse tests.
for(const account of WRITERS){
 test(account+' cannot write the cindy default branch by any authoring operation',async()=>{
  for(const [operation,args] of [['create_branch',{branch:'main',sha:SHA}],['update_file',{path:'a.txt',branch:'main',expected_sha:null,message:ASSISTED,content_base64:'eA=='}],['edit_file',{path:'a.txt',branch:'main',expected_sha:SHA,expected_result_sha256:'b'.repeat(64),message:'m',edits:[{old_text:'a',new_text:'b'}]}],['commit_files',{branch:'main',expected_head:SHA,message:ASSISTED,changes:[{path:'a.txt',content_base64:'eA=='}]}]]){
   const f=fixture(account),r=await run(f,account,operation,args);
   assert.equal(r.errorCode,'DEFAULT_BRANCH_WRITE_REFUSED',operation);assert.equal(writes(f).length,0,operation);
  }
 });
 test(account+' cannot force-push on cindy',async()=>{
  await refusedBeforeCredentials(account,'commit_files',{branch:'agy/x',expected_head:SHA,parent:SHA2,message:ASSISTED,changes:[{path:'a.txt',content_base64:'eA=='}]},'NOT_FAST_FORWARD');
  const f=fixture(account),r=await run(f,account,'commit_files',{branch:'agy/x',expected_head:SHA,message:ASSISTED,force:true,changes:[{path:'a.txt',content_base64:'eA=='}]});
  assert.equal(r.ok,false);assert.equal(r.execution,'not_executed');assert.equal(f.keyReads(),0);
 });
 test(account+' cannot approve automatically into a merge: no merge or queue operation on cindy',async()=>{
  await refusedBeforeCredentials(account,'enqueue_pull',{number:7,commit_id:SHA},'QQ_ACCOUNT_REQUIRED');
  for(const operation of ['merge_pull','merge','enable_auto_merge'])await refusedBeforeCredentials(account,operation,{number:7},'UNKNOWN_OPERATION');
 });
 test(account+' cannot open a PR against upstream makecindy/cindy',async()=>{
  await refusedBeforeCredentials(account,'create_pull',{title:'t',head:'agy/x',base:'main'},'REPOSITORY_NOT_ALLOWED','makecindy/cindy');
  for(const args of [{title:'t',head:'good-night-oppie:agy/x',base:'main'},{title:'t',head:'agy/x',base:'makecindy:main'}])
   await refusedBeforeCredentials(account,'create_pull',args,'INVALID_REF');
  const f=fixture(account),r=await run(f,account,'create_pull',{title:'t',head:'agy/x',base:'main'});
  assert.equal(r.ok,true,r.errorCode);assert.deepEqual(writes(f).map(c=>c.route),['/repos/good-night-oppie/cindy/pulls']);
 });
}

// 2. DD: read-only, COMMENT reviews only.
test('DD on cindy may read and post COMMENT reviews',async()=>{
 for(const [operation,args] of [...READS,['submit_review',{number:7,commit_id:SHA,event:'COMMENT',body:'review'}]]){
  const f=fixture('dd'),r=await run(f,'dd',operation,args);assert.equal(r.ok,true,operation+': '+r.errorCode);
 }
});
test('DD on cindy is refused every write, including issue comments, and non-COMMENT reviews',async()=>{
 for(const [operation,args] of AUTHORING)await refusedBeforeCredentials('dd',operation,args,'REVIEW_ONLY_REPOSITORY');
 for(const event of ['APPROVE','REQUEST_CHANGES'])await refusedBeforeCredentials('dd','submit_review',{number:7,commit_id:SHA,event,body:'x'},'COMMENT_ONLY_REVIEWER');
});
test('DD keeps its ordinary role on the original six repositories',async()=>{
 const f=fixture('dd'),r=await run(f,'dd','create_issue',{title:'t'},'MontClip');
 assert.equal(r.ok,true,r.errorCode);assert.equal(writes(f).length,1);
});

// 3. QQ: review operations only on cindy.
test('QQ on cindy may read and review',async()=>{
 for(const [operation,args] of [...READS,['submit_review',{number:7,commit_id:SHA,event:'COMMENT',body:'review'}]]){
  const f=fixture('qq'),r=await run(f,'qq',operation,args);assert.equal(r.ok,true,operation+': '+r.errorCode);
 }
});
test('QQ admin, ruleset, dismissal and merge-queue operations do not extend to cindy',async()=>{
 const owner='https://github.com/good-night-oppie/cindy/issues/1#issuecomment-2';
 for(const [operation,args] of [['list_rulesets',{}],['get_ruleset',{ruleset_id:1}],['ruleset_update',{ruleset_id:1,ruleset:{enforcement:'active'},owner_authorization:owner,nonce:'a'.repeat(32)}],['dismiss_review',{number:7,review_id:1,message:'x'}],['enqueue_pull',{number:7,commit_id:SHA}]])
  await refusedBeforeCredentials('qq',operation,args,'REVIEW_ONLY_REPOSITORY');
 for(const [operation,args] of [['admin_get',{}],['admin_update',{allow_squash_merge:true}],...AUTHORING])await refusedBeforeCredentials('qq',operation,args,'QQ_AUTHORING_REFUSED');
});
test('QQ keeps its existing operations on the original repositories',async()=>{
 const f=fixture('qq'),r=await run(f,'qq','list_rulesets',{},'MontClip');assert.equal(r.ok,true,r.errorCode);
});

// 10. QQ (production incident): the same package works before and after DD adds cindy to an installation.
const without=(map,name)=>Object.fromEntries(Object.entries(map).filter(([n])=>n!==name));
const tokens=f=>f.calls.filter(c=>c.route.endsWith('/access_tokens'));
for(const [account,execution] of Object.entries(DESIGN)){
 test(account+' identity passes whether or not cindy is installed, and the token covers only installed repositories',async()=>{
  for(const [state,installed] of [['with cindy',SEVEN],['without cindy',SIX]]){
   const repo=Object.keys(execution)[0],f=fixture(account,{installed:rows(installed)}),r=await run(f,account,'identity',{},repo);
   assert.equal(r.ok,true,state+': '+r.errorCode);
   assert.equal(r.result.installationRepositories.length,Object.keys(installed).length,state);
   const effective=Object.values(execution).filter(id=>Object.values(installed).includes(id));
   assert.deepEqual(tokens(f).at(-1).body.repository_ids,effective,state);
   assert.deepEqual(r.result.repositories.map(x=>x.id),effective,state);
  }
 });
 test(account+' still refuses an extra non-cindy repository and a missing required repository',async()=>{
  const extra={id:99,name:'other',full_name:'good-night-oppie/other'};
  const cases=[];
  for(const base of [SEVEN,SIX]){
   const r=rows(base);r.repositories.push(extra);r.total_count++;cases.push(['extra',r]);
   for(const name of Object.keys(SIX))cases.push(['missing '+name,rows(without(base,name))]);
  }
  const wrongId=rows(SEVEN);wrongId.repositories.at(-1).id=1;cases.push(['wrong cindy id',wrongId]);
  const duplicate=rows(SEVEN);duplicate.repositories.push(duplicate.repositories.at(-1));duplicate.total_count++;cases.push(['duplicate cindy',duplicate]);
  const truncated=rows(SEVEN);truncated.repositories.pop();cases.push(['incomplete listing',truncated]);
  for(const [label,installed] of cases){
   const f=fixture(account,{installed}),r=await run(f,account,'identity',{},Object.keys(execution)[0]);
   assert.equal(r.errorCode,'INSTALLATION_REPOSITORY_SCOPE_MISMATCH',label);assert.equal(r.execution,'not_executed',label);
   assert.equal(tokens(f).length,1,label);
  }
 });
}
for(const account of Object.keys(DESIGN).filter(a=>Object.hasOwn(DESIGN[a],'cindy')))test(account+' without cindy installed: cindy fails on its own and the other repositories keep working',async()=>{
 for(const [operation,args] of [['identity',{}],['get_issue',{number:1}]]){
  const f=fixture(account,{installed:rows(SIX)}),r=await run(f,account,operation,args);
  assert.equal(r.errorCode,'REPOSITORY_NOT_INSTALLED',operation);assert.equal(r.execution,'not_executed');
  assert.equal(tokens(f).length,1,'no execution token is minted');assert.equal(writes(f).length,0);
 }
 for(const repo of Object.keys(SIX).filter(r=>Object.hasOwn(DESIGN[account],r))){
  const f=fixture(account,{installed:rows(SIX)}),r=await run(f,account,'get_issue',{number:1},repo);
  assert.equal(r.ok,true,repo+': '+r.errorCode);
 }
});

// 11. QQ (#23): every account across the three installation states.
const STRANGER={id:99,name:'other',full_name:'good-night-oppie/other'};
const ROLE_PROBE={bb:['create_branch',{branch:'agy/x',sha:SHA},null],deja:['create_branch',{branch:'agy/x',sha:SHA},null],dd:['create_branch',{branch:'agy/x',sha:SHA},'REVIEW_ONLY_REPOSITORY'],qq:['enqueue_pull',{number:7,commit_id:SHA},'REVIEW_ONLY_REPOSITORY']};
for(const [account,execution] of Object.entries(DESIGN))test(account+' across six, six+cindy and six+stranger installations',async()=>{
 // Six repositories: existing operations work on every original execution repository; cindy is not installed.
 for(const repo of Object.keys(execution).filter(r=>r!=='cindy')){
  const f=fixture(account,{installed:rows(SIX)}),r=await run(f,account,'get_issue',{number:1},repo);assert.equal(r.ok,true,'six '+repo+': '+r.errorCode);
 }
 const six=fixture(account,{installed:rows(SIX)}),c6=await run(six,account,'get_issue',{number:1});
 assert.equal(c6.errorCode,Object.hasOwn(execution,'cindy')?'REPOSITORY_NOT_INSTALLED':'REPOSITORY_NOT_ALLOWED');assert.equal(c6.execution,'not_executed');
 // Six plus cindy: the role table applies on cindy.
 const seven=fixture(account,{installed:rows(SEVEN)});
 if(Object.hasOwn(ROLE_PROBE,account)){
  const [operation,args,code]=ROLE_PROBE[account],r=await run(seven,account,operation,args);
  if(code)assert.equal(r.errorCode,code);else{assert.equal(r.ok,true,r.errorCode);assert.equal(writes(seven).length,1);}
 }else assert.equal((await run(seven,account,'get_issue',{number:1})).errorCode,'REPOSITORY_NOT_ALLOWED');
 // Six plus an unknown repository: still a mismatch, before any execution token.
 const odd=rows(SIX);odd.repositories.push(STRANGER);odd.total_count++;
 const f=fixture(account,{installed:odd}),r=await run(f,account,'identity',{},Object.keys(execution)[0]);
 assert.equal(r.errorCode,'INSTALLATION_REPOSITORY_SCOPE_MISMATCH');assert.equal(r.execution,'not_executed');assert.equal(tokens(f).length,1);
});
