'use strict';
// Settings-page backend (owner request 2026-11-15): add teammate Apps and repositories from the
// Cindy plugin page, effective on the next call without a restart.
//
// Flow (see SCOPE-CONFIG.md): the page sends a proposal to main.js; main.js asks `propose` for a
// canonical summary + hash, shows the host confirmation card, and only after a real confirmation
// calls `save` with the same hash and expected revision. `save` re-validates everything, refuses a
// stale revision, writes atomically into the owner-only store and appends an audit line.
// These methods are not Agent tools: main.js exposes them only to its own settings page.
//
// Private keys never pass through here as parameters: `importKey` receives the PEM only from the
// host-injected secret binding, verifies the App against GitHub, then hands it to the DPAPI store.
const crypto=require('node:crypto');
const {validateConfig,DEFAULT_CONFIG,BUILTIN_ACCOUNTS,ACCOUNT_OPERATION_CEILING,REVIEW_OPERATION_CEILING,MAX_FILE_BYTES}=require('./scope-config.cjs');
const {repositoryRestriction}=require('./repository-policy.cjs');

const AUDIT_FILE='scope-config-audit.jsonl';
const AUDIT_MAX_BYTES=900000;
function fail(code,extra){const e=new Error(code);e.code=code;e.execution='not_executed';if(extra)e.details=extra;throw e;}
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
function sha256(text){return crypto.createHash('sha256').update(text).digest('hex');}
// Plain JSON copy of an effective (frozen) configuration, in file format.
function toFile(c){return JSON.parse(JSON.stringify({schemaVersion:1,revision:c.revision,repositories:c.repositories,optionalRepositories:c.optionalRepositories,accounts:c.accounts,newAccounts:c.newAccounts,twoRepositories:c.twoRepositories,repositoryRoles:c.repositoryRoles,reviewOperations:c.reviewOperations}));}

// Short human summary of what changes; shown verbatim on the host confirmation card.
function summarize(before,after){
 const parts=[];
 const repoAdd=Object.keys(after.repositories).filter(n=>before.repositories[n]!==after.repositories[n]).map(n=>n+'#'+after.repositories[n]);
 const repoDel=Object.keys(before.repositories).filter(n=>after.repositories[n]!==before.repositories[n]).map(n=>n+'#'+before.repositories[n]);
 // QQ review 2026-11-16: the card must show who gets write access on an added repository.
 // Accounts without an entry in repositoryRoles keep their account role on it (compiled
 // accounts: ordinary write; qq: its own read-only contents plus QQ-only management operations).
 const impact=n=>{
  const active=after.accounts;
  const writers=active.filter(a=>!repositoryRestriction(a,n,after)&&a!=='qq');
  const blocked=active.filter(a=>repositoryRestriction(a,n,after)?.none);
  const readers=active.filter(a=>{const r=repositoryRestriction(a,n,after);return r&&!r.none;});
  return n+'#'+after.repositories[n]+'（'+writers.length+' 个账号可写'+(writers.length?'：'+writers.join(','):'')+(readers.length?'；只读评审：'+readers.join(','):'')+(blocked.length?'；不可用：'+blocked.join(','):'')+(active.includes('qq')&&!repositoryRestriction('qq',n,after)?'；qq 含规则集/驳回/合并队列/仓库设置等专属操作':'')+'；未写入角色表的账号按自身角色）';
 };
 if(repoAdd.length)parts.push('加仓库 '+repoAdd.map(x=>impact(x.split('#')[0])).join(','));
 if(repoDel.length)parts.push('删仓库 '+repoDel.join(','));
 const optAdd=after.optionalRepositories.filter(n=>!before.optionalRepositories.includes(n)),optDel=before.optionalRepositories.filter(n=>!after.optionalRepositories.includes(n));
 if(optAdd.length)parts.push('设为可选 '+optAdd.join(','));
 if(optDel.length)parts.push('设为必需 '+optDel.join(','));
 const roleText={write:'可写名单内全部仓库',reviewer:'只读+评论+评审',review:'只读+评审',comment_review:'只读+仅 COMMENT'};
 // BB/Deja (#29 vs #33): the card states whether the App's broader installation is accepted and
 // which repositories the account cannot use (e.g. cindy for AD), as the owner chose them.
 const blockedFor=n=>Object.keys(after.repositoryRoles).filter(r=>after.repositoryRoles[r][n]==='none');
 const accDesc=n=>{const a=after.newAccounts[n];if(!a)return n;const b=blockedFor(n);return n+'(App '+a.appId+'/安装 '+a.installationId+'/'+a.appSlug+'/'+roleText[a.role]+(a.operations?'/'+a.operations.length+'项操作':'')+(a.allowBroaderInstallation?'/安装权限可更宽':'')+'/'+(b.length?'不可用 '+b.join(','):'全部仓库可用')+')';};
 const accAdd=after.accounts.filter(n=>!before.accounts.includes(n)),accDel=before.accounts.filter(n=>!after.accounts.includes(n));
 const accChanged=Object.keys(after.newAccounts).filter(n=>before.accounts.includes(n)&&after.accounts.includes(n)&&canonical(before.newAccounts[n]??null)!==canonical(after.newAccounts[n]));
 if(accAdd.length)parts.push('加账号 '+accAdd.map(accDesc).join(','));
 if(accDel.length)parts.push('停用账号 '+accDel.join(','));
 if(accChanged.length)parts.push('改账号 '+accChanged.map(accDesc).join(','));
 if(canonical(before.repositoryRoles)!==canonical(after.repositoryRoles))parts.push('改仓库角色表');
 if(canonical(before.reviewOperations)!==canonical(after.reviewOperations))parts.push('评审操作 '+after.reviewOperations.length+'项');
 if(canonical(before.twoRepositories)!==canonical(after.twoRepositories))parts.push('改 twoRepositories');
 return parts.length?parts.join('；'):'无变化';
}

function createSettings({store,loader,verifyKey}){
 async function current(){
  // Same signed, ACL-checked loader the GitHub calls use; a broken or hand-edited file is reported.
  let config;try{config=await loader.load();}catch(e){fail('INVALID_SCOPE_CONFIGURATION',{reason:e.reason});}
  return {config,source:config===DEFAULT_CONFIG?'default':'file'};
 }
 async function read(){
  let state,error;try{state=await current();}catch(e){error={code:e.code,reason:e.details?.reason};}
  let saved=[];try{saved=(await store.list()).map(r=>r.account);}catch(_){}
  return {ok:true,source:state?.source??'invalid',error,revision:state?.config.revision??null,config:state?toFile(state.config):null,
   keys:saved,builtinAccounts:BUILTIN_ACCOUNTS,accountOperationCeiling:ACCOUNT_OPERATION_CEILING,reviewOperationCeiling:REVIEW_OPERATION_CEILING};
 }
 async function plan(args){
  if(!args||typeof args!=='object'||!Number.isSafeInteger(args.expectedRevision))fail('INVALID_PROPOSAL');
  const {config:before}=await current();
  if(before.revision!==args.expectedRevision)fail('SCOPE_REVISION_CONFLICT',{revision:before.revision});
  if(!args.config||typeof args.config!=='object'||Array.isArray(args.config))fail('INVALID_PROPOSAL');
  let after;try{after=validateConfig({...args.config,schemaVersion:1,revision:before.revision+1});}catch(e){fail('INVALID_SCOPE_CONFIGURATION',{reason:e.reason});}
  const file=toFile(after),text=JSON.stringify(file,null,2)+'\n';
  if(Buffer.byteLength(text)>MAX_FILE_BYTES)fail('INVALID_SCOPE_CONFIGURATION',{reason:'too large'});
  const summary=summarize(before,after);
  return {before,after,file,text,summary,hash:sha256(canonical(file))};
 }
 async function propose(args){const p=await plan(args);return {ok:true,summary:p.summary,hash:p.hash,revision:p.before.revision,nextRevision:p.after.revision};}
 async function save(args){
  if(typeof args?.hash!=='string'||!/^[a-f0-9]{64}$/.test(args.hash))fail('INVALID_PROPOSAL');
  const p=await plan(args);
  // The confirmed summary must describe exactly what is written now.
  if(p.hash!==args.hash)fail('PROPOSAL_CHANGED');
  if(p.summary==='无变化')fail('NO_CHANGES');
  // Signed write (HMAC key sealed by DPAPI) and read back through the same verifying loader.
  let effective;try{effective=await loader.save(p.file);}catch(e){fail(e.code==='INVALID_SCOPE_CONFIGURATION'?e.code:'STORE_WRITE_FAILED',{reason:e.reason});}
  await audit({event:'save',revisionBefore:p.before.revision,revisionAfter:p.after.revision,hash:p.hash,summary:p.summary,confirmed:'host-confirm-card'});
  return {ok:true,revision:effective.revision,summary:p.summary,hash:p.hash};
 }
 async function audit(entry){
  // Redacted: no keys, tokens, local paths or GitHub responses.
  const line=JSON.stringify({time:new Date().toISOString(),...entry})+'\n';
  let previous='';try{previous=(await store.readPrivate(AUDIT_FILE))??'';}catch(_){previous='';}
  let text=previous+line;
  while(Buffer.byteLength(text)>AUDIT_MAX_BYTES){const cut=text.indexOf('\n');if(cut<0){text=line;break;}text=text.slice(cut+1);}
  await store.writePrivate(AUDIT_FILE,text);
 }
 async function importKey(args,host){
  if(!args||typeof args!=='object'||Object.keys(args).some(k=>!['account','replace'].includes(k))||typeof args.account!=='string')fail('INVALID_IMPORT');
  const pem=host?.secrets?.app_private_key;
  if(typeof pem!=='string'||!pem.trim())fail('PRIVATE_KEY_NOT_PROVIDED');
  let fingerprint,verification;
  try{
   try{fingerprint=crypto.createHash('sha256').update(crypto.createPublicKey(crypto.createPrivateKey(pem)).export({type:'spki',format:'der'})).digest('hex');}catch(_){fail('INVALID_PRIVATE_KEY');}
   const config=await loader.load();
   verification=await verifyKey({account:args.account,pem,config});
   if(!verification?.ok)return {ok:false,errorCode:verification?.errorCode||'IDENTITY_VERIFICATION_FAILED',execution:'not_executed'};
   const imported=await store.importKeyText({account:args.account,pem_text:pem,replace:args.replace===true,expected_fingerprint:fingerprint,metadata:{appSlug:verification.result.app_slug}});
   await audit({event:'import_key',account:args.account,fingerprint:imported.fingerprint});
   return {ok:true,account:args.account,fingerprint:imported.fingerprint,app_slug:verification.result.app_slug,installationRepositorySelection:verification.result.installationRepositorySelection,repositories:verification.result.repositories.map(r=>r.full_name)};
  }finally{if(host?.secrets)host.secrets.app_private_key='';}
 }
 return {read,propose,save,importKey};
}
module.exports={createSettings,summarize,canonical,AUDIT_FILE};
