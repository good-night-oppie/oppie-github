'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {createQueue,REPOS,LEASE_MS}=require('../node/review-queue.cjs');
const A='a'.repeat(40),B='b'.repeat(40);
const pr=(number,sha=A,user='oppie-agent-deja[bot]',draft=false)=>({number,head:{sha},user:{login:user},title:'Review '+number,state:'open',draft});
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'oppie-queue-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 let time=1800000000000;const lists=new Map(REPOS.map(r=>[r,[]]));const reviews=new Map();const calls=[];let failure=false;
 const client={run:async input=>{calls.push(input);if(failure)return {ok:false,errorCode:'NETWORK_ERROR'};let result;
  if(input.operation==='list_pulls')result=lists.get(input.repo).slice((input.args.page-1)*100,input.args.page*100);
  else if(input.operation==='get_pull')result=lists.get(input.repo).find(x=>x.number===input.args.number);
  else if(input.operation==='list_reviews')result=(reviews.get(input.repo+'#'+input.args.number)||[]).slice((input.args.page-1)*100,input.args.page*100);
  else throw Error('unexpected operation');return {ok:true,result};}};
 const statePath=path.join(root,'state.json');const q=createQueue({client,statePath,now:()=>time});
 return {q,root,statePath,lists,reviews,calls,client,tick:n=>time+=n,fail:v=>failure=v};
}
test('baseline fully paginates both repositories, skips draft, initialization never resets',async t=>{
 const f=await fixture(t);f.lists.set(REPOS[0],Array.from({length:101},(_,i)=>pr(i+1)));f.lists.set(REPOS[1],[pr(1,A,'human',true)]);
 assert.equal((await f.q.initialize()).baseline_count,101);assert.ok(f.calls.some(c=>c.args.page===2));
 f.lists.set(REPOS[0],[pr(1,B)]);const before=await fs.readFile(f.statePath,'utf8');assert.equal((await f.q.initialize()).already_initialized,true);assert.equal(await fs.readFile(f.statePath,'utf8'),before);
 const polled=await f.q.poll();assert.equal(polled.candidates.length,1);assert.equal(polled.candidates[0].head_sha,B);
});
test('failed baseline leaves no partial state',async t=>{const f=await fixture(t);f.fail(true);assert.equal((await f.q.initialize()).ok,false);await assert.rejects(fs.stat(f.statePath),{code:'ENOENT'});});
test('poll returns at most ten new heads; QQ author uses DD and drafts excluded',async t=>{
 const f=await fixture(t);await f.q.initialize();f.lists.set(REPOS[0],Array.from({length:12},(_,i)=>pr(i+1,A,i===0?'oppie-agent-qq[bot]':'human')));f.lists.set(REPOS[1],[pr(1,A,'human',true)]);
 const r=await f.q.poll();assert.equal(r.candidates.length,10);assert.equal(r.has_more,true);assert.equal(r.candidates[0].reviewer,'dd');assert.equal(r.candidates[1].reviewer,'qq');
});

test('renamed QQ author goes to DD, while substring lookalikes do not',async t=>{
 const f=await fixture(t);await f.q.initialize();f.lists.set(REPOS[0],[pr(1,A,'qqoppiexyz[bot]'),pr(2,A,'qqoppiexyz'),pr(3,A,'qqoppiexyz-other[bot]')]);
 const r=await f.q.poll();assert.deepEqual(r.candidates.map(x=>x.reviewer),['dd','dd','qq']);
});

test('renamed review actor is reconciled and conflicting App numeric identity is rejected',async t=>{
 const f=await fixture(t);await f.q.initialize();f.lists.set(REPOS[0],[pr(1)]);const target={repo:REPOS[0],number:1,head_sha:A};const c=await f.q.claim(target);
 const valid={id:29,commit_id:A,user:{login:'qqoppiexyz[bot]'},performed_via_github_app:{id:5665946},body:c.marker,state:'COMMENTED'};
 f.reviews.set(REPOS[0]+'#1',[{...valid,performed_via_github_app:{id:5665941}}]);
 assert.equal((await f.q.finish({...target,claim_id:c.claim_id})).errorCode,'REVIEW_NOT_CONFIRMED');
 f.reviews.set(REPOS[0]+'#1',[valid]);assert.equal((await f.q.finish({...target,claim_id:c.claim_id})).review_id,29);
});
test('claim rejects stale head and duplicate concurrent claims, persists lease',async t=>{
 const f=await fixture(t);await f.q.initialize();f.lists.set(REPOS[0],[pr(7,B)]);const target={repo:REPOS[0],number:7,head_sha:B};
 assert.equal((await f.q.claim({...target,head_sha:A})).errorCode,'STALE_HEAD');
 const results=await Promise.all([f.q.claim(target),f.q.claim(target)]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).errorCode,'ALREADY_CLAIMED');
 assert.equal((await f.q.poll()).candidates.length,0);
});
test('finish only accepts matching remote actor, marker, commit and submitted state',async t=>{
 const f=await fixture(t);await f.q.initialize();f.lists.set(REPOS[0],[pr(1)]);const target={repo:REPOS[0],number:1,head_sha:A};const claim=await f.q.claim(target);
 const valid={id:23,commit_id:A,user:{login:'oppie-agent-qq[bot]'},body:claim.marker,state:'COMMENTED'};
 for(const invalid of [{...valid,user:{login:'human'}},{...valid,commit_id:B},{...valid,body:'no marker'},{...valid,state:'PENDING'}]){
  f.reviews.set(REPOS[0]+'#1',[invalid]);const r=await f.q.finish({...target,claim_id:claim.claim_id});assert.equal(r.errorCode,'REVIEW_NOT_CONFIRMED');assert.equal(r.lease_retained,true);
 }
 f.reviews.set(REPOS[0]+'#1',[valid]);assert.equal((await f.q.finish({...target,claim_id:claim.claim_id})).review_id,23);assert.equal((await f.q.poll()).candidates.length,0);
});
test('unknown delivery reconciled from remote review after lease expires, no duplicate',async t=>{
 const f=await fixture(t);await f.q.initialize();f.lists.set(REPOS[0],[pr(1)]);const target={repo:REPOS[0],number:1,head_sha:A};const c=await f.q.claim(target);f.tick(LEASE_MS+1);
 f.reviews.set(REPOS[0]+'#1',[{id:7,commit_id:A,user:{login:'oppie-agent-qq[bot]'},body:c.marker,state:'COMMENTED'}]);
 assert.equal((await f.q.poll()).candidates.length,0);assert.equal((await f.q.claim(target)).errorCode,'ALREADY_REVIEWED');
});
test('expired lease with no remote review can be reclaimed; failed remote lookup cannot release it',async t=>{
 const f=await fixture(t);await f.q.initialize();f.lists.set(REPOS[0],[pr(1)]);const target={repo:REPOS[0],number:1,head_sha:A};const c=await f.q.claim(target);f.tick(LEASE_MS+1);f.fail(true);
 assert.equal((await f.q.poll()).ok,false);let state=JSON.parse(await fs.readFile(f.statePath));assert.equal(Object.values(state.leases)[0].claim_id,c.claim_id);
 f.fail(false);assert.equal((await f.q.poll()).candidates.length,1);assert.equal((await f.q.claim(target)).ok,true);
});
test('out-of-scope and uninitialized operations fail without network',async t=>{
 const f=await fixture(t);assert.equal((await f.q.poll()).errorCode,'NOT_INITIALIZED');assert.equal((await f.q.claim({repo:'evil/repo',number:1,head_sha:A})).errorCode,'INVALID_TARGET');assert.equal(f.calls.length,0);
});
test('state hardlink rejected without modifying target',async t=>{
 const f=await fixture(t);const external=path.join(f.root,'external');await fs.writeFile(external,'sentinel');await fs.link(external,f.statePath);
 assert.equal((await f.q.initialize()).errorCode,'UNSAFE_STATE_PATH');assert.equal(await fs.readFile(external,'utf8'),'sentinel');
});
test('state symlink rejected without modifying target',async t=>{
 const f=await fixture(t);const external=path.join(f.root,'external');await fs.writeFile(external,'sentinel');
 try{await fs.symlink(external,f.statePath);}catch(e){if(e.code==='EPERM'){t.skip('symlink creation unavailable');return;}throw e;}
 assert.equal((await f.q.initialize()).errorCode,'UNSAFE_STATE_PATH');assert.equal(await fs.readFile(external,'utf8'),'sentinel');
});
test('missing state directory rejected without creating directory',async t=>{const f=await fixture(t);const absent=path.join(f.root,'absent');const q=createQueue({client:f.client,statePath:path.join(absent,'state.json')});assert.equal((await q.initialize()).ok,false);await assert.rejects(fs.stat(absent),{code:'ENOENT'});});
test('existing lock prevents cross-instance state edits',async t=>{const f=await fixture(t);await fs.writeFile(f.statePath+'.lock','');assert.equal((await f.q.initialize()).errorCode,'STATE_BUSY');assert.equal(f.calls.length,0);});
