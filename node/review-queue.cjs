'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {REPOSITORIES,ACCOUNTS,knownBotLogin,allowedAppSlug}=require('./core.cjs');
const REPOS=Object.keys(REPOSITORIES).map(n=>'good-night-oppie/'+n);
const LEASE_MS=30*60*1000;
const MAX_BYTES=2*1024*1024;
class QueueError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new QueueError(code);};
function target(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_TARGET');
 if(!REPOS.includes(input.repo)||!Number.isSafeInteger(input.number)||input.number<1||typeof input.head_sha!=='string'||! /^[a-f0-9]{40}$/i.test(input.head_sha))fail('INVALID_TARGET');
 return {repo:input.repo,number:input.number,head_sha:input.head_sha.toLowerCase()};
}
const prKey=x=>x.repo+'#'+x.number;
const headKey=x=>prKey(x)+'@'+x.head_sha;
const marker=x=>'<!-- oppie-auto-review:'+x.repo+':'+x.number+':'+x.head_sha+' -->';
const reviewer=login=>knownBotLogin('qq',login)||allowedAppSlug('qq',login)?'dd':'qq';
function candidate(repo,pr){
 const t=target({repo,number:pr.number,head_sha:pr.head?.sha});
 if(typeof pr.user?.login!=='string'||typeof pr.title!=='string')fail('INVALID_PR_RESPONSE');
 return {...t,reviewer:reviewer(pr.user.login),title:pr.title.slice(0,500),author:pr.user.login,marker:marker(t)};
}
function createQueue({client,statePath,now=Date.now}={}){
 if(!client||typeof client.run!=='function'||typeof statePath!=='string'||!path.isAbsolute(statePath))throw Error('QUEUE_CONFIGURATION_INVALID');
 const dir=path.dirname(statePath);const lockPath=statePath+'.lock';
 let chain=Promise.resolve();
 async function safePath(file,allowMissing=false){
  try{const stat=await fs.lstat(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1)fail('UNSAFE_STATE_PATH');return stat;}
  catch(e){if(e.code==='ENOENT'&&allowMissing)return null;throw e;}
 }
 async function checkDirectory(){
  const st=await fs.lstat(dir);if(!st.isDirectory()||st.isSymbolicLink())fail('UNSAFE_STATE_DIRECTORY');
  const real=await fs.realpath(dir);const norm=s=>process.platform==='win32'?path.resolve(s).toLowerCase():path.resolve(s);
  if(norm(real)!==norm(dir))fail('UNSAFE_STATE_DIRECTORY');
 }
 async function read(){
  const st=await safePath(statePath,true);if(!st)return null;if(st.size>MAX_BYTES)fail('STATE_INVALID');
  let s;try{s=JSON.parse(await fs.readFile(statePath,'utf8'));}catch(_){fail('STATE_INVALID');}
  if(s.version!==1||s.initialized!==true||!s.baseline||!s.completed||!s.leases||Array.isArray(s.baseline)||Array.isArray(s.completed)||Array.isArray(s.leases))fail('STATE_INVALID');
  return s;
 }
 async function save(s){
  await safePath(statePath,true);const text=JSON.stringify(s,null,2);if(Buffer.byteLength(text)>MAX_BYTES)fail('STATE_TOO_LARGE');
  const temp=path.join(dir,'.review-queue-'+crypto.randomUUID()+'.tmp');
  let h;try{h=await fs.open(temp,'wx',0o600);await h.writeFile(text);await h.sync();await h.close();h=null;await safePath(statePath,true);await fs.rename(temp,statePath);}finally{if(h)await h.close();await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 }
 async function locked(fn){
  await checkDirectory();let h;
  try{h=await fs.open(lockPath,'wx',0o600);}catch(e){if(e.code==='EEXIST')fail('STATE_BUSY');throw e;}
  try{return await fn();}finally{await h.close();await fs.unlink(lockPath);}
 }
 function execute(fn){const task=chain.then(()=>locked(fn));chain=task.catch(()=>{});return task.catch(e=>({ok:false,errorCode:e instanceof QueueError?e.code:'QUEUE_IO_ERROR'}));}
 async function api(account,repo,operation,args){const r=await client.run({account,repo,operation,args});if(!r?.ok)fail('GITHUB_'+(typeof r?.errorCode==='string'&&/^[A-Z0-9_]+$/.test(r.errorCode)?r.errorCode:'REQUEST_FAILED'));return r.result;}
 async function pages(account,repo,operation,args={}){
  const out=[];
  for(let page=1;page<=100;page++){const rows=await api(account,repo,operation,{...args,page,per_page:100});if(!Array.isArray(rows))fail('INVALID_LIST_RESPONSE');out.push(...rows);if(rows.length<100)return out;}
  fail('PAGINATION_LIMIT');
 }
 async function current(){
  const out=[];
  for(const repo of REPOS){const rows=await pages('qq',repo,'list_pulls',{state:'open'});for(const pr of rows){if(pr.state!=='open'||pr.draft)continue;out.push(candidate(repo,pr));}}
  return out;
 }
 async function matchingReview(lease){
  target(lease);if(!['qq','dd'].includes(lease.reviewer)||lease.marker!==marker(lease))fail('STATE_INVALID');
  const rows=await pages(lease.reviewer,lease.repo,'list_reviews',{number:lease.number});
  return rows.find(r=>r.commit_id===lease.head_sha&&knownBotLogin(lease.reviewer,r.user?.login)
   &&(!r.performed_via_github_app||Number(r.performed_via_github_app.id)===ACCOUNTS[lease.reviewer].app_id)
   &&typeof r.body==='string'&&r.body.includes(lease.marker)&&['COMMENTED','APPROVED','CHANGES_REQUESTED'].includes(r.state));
 }
 function complete(s,lease,review){
  s.completed[headKey(lease)]={review_id:review.id,reviewer:lease.reviewer,completed_at:now()};
  s.baseline[prKey(lease)]=lease.head_sha;delete s.leases[headKey(lease)];
 }
 async function reconcile(s){
  for(const [key,lease]of Object.entries(s.leases)){
   if(key!==headKey(target(lease))||typeof lease.expires_at!=='number')fail('STATE_INVALID');
   const review=await matchingReview(lease);if(review)complete(s,lease,review);
   else if(lease.expires_at<=now())delete s.leases[key];
  }
 }
 return {
  initialize:()=>execute(async()=>{
   const existing=await read();if(existing)return {ok:true,initialized:true,already_initialized:true,baseline_count:Object.keys(existing.baseline).length};
   const prs=await current();const s={version:1,initialized:true,initialized_at:now(),baseline:{},completed:{},leases:{}};
   for(const pr of prs)s.baseline[prKey(pr)]=pr.head_sha;
   await save(s);return {ok:true,initialized:true,already_initialized:false,baseline_count:prs.length,repositories:REPOS};
  }),
  poll:()=>execute(async()=>{
   const s=await read();if(!s)fail('NOT_INITIALIZED');
   const prs=await current();await reconcile(s);
   const all=prs.filter(pr=>s.baseline[prKey(pr)]!==pr.head_sha&&!s.completed[headKey(pr)]&&!s.leases[headKey(pr)]);
   await save(s);return {ok:true,candidates:all.slice(0,10),has_more:all.length>10};
  }),
  claim:input=>execute(async()=>{
   const t=target(input);const s=await read();if(!s)fail('NOT_INITIALIZED');
   const pr=await api('qq',t.repo,'get_pull',{number:t.number});
   if(pr.state!=='open'||pr.draft)fail('PR_NOT_REVIEWABLE');const c=candidate(t.repo,pr);
   if(c.head_sha!==t.head_sha)fail('STALE_HEAD');
   if(s.baseline[prKey(t)]===t.head_sha||s.completed[headKey(t)])fail('ALREADY_REVIEWED');
   const old=s.leases[headKey(t)];if(old){const review=await matchingReview(old);if(review){complete(s,old,review);await save(s);fail('ALREADY_REVIEWED');}if(old.expires_at>now())fail('ALREADY_CLAIMED');}
   const lease={...c,claim_id:crypto.randomUUID(),claimed_at:now(),expires_at:now()+LEASE_MS};s.leases[headKey(t)]=lease;await save(s);
   return {ok:true,...lease};
  }),
  finish:input=>execute(async()=>{
   const t=target(input);const s=await read();if(!s)fail('NOT_INITIALIZED');
   if(s.completed[headKey(t)])return {ok:true,already_completed:true,...s.completed[headKey(t)]};
   const lease=s.leases[headKey(t)];if(!lease||typeof input.claim_id!=='string'||lease.claim_id!==input.claim_id)fail('CLAIM_MISMATCH');
   const review=await matchingReview(lease);if(!review)return {ok:false,errorCode:'REVIEW_NOT_CONFIRMED',lease_retained:true,expires_at:lease.expires_at};
   complete(s,lease,review);await save(s);return {ok:true,review_id:review.id,reviewer:lease.reviewer,head_sha:lease.head_sha};
  }),
 };
}
module.exports={createQueue,REPOS,LEASE_MS};
