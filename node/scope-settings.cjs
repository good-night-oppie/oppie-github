'use strict';
// Settings-page backend (owner request 2026-11-15): add teammate Apps from the Cindy plugin page,
// effective on the next call without a restart. Owner 2026-11-16: only the App identity and the
// private key are entered; installation, permissions and repositories are read from GitHub and shown
// on the key-import confirmation card.
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
const {validateConfig,DEFAULT_CONFIG,BUILTIN_ACCOUNTS,MAX_FILE_BYTES}=require('./scope-config.cjs');

const AUDIT_FILE='scope-config-audit.jsonl';
const AUDIT_MAX_BYTES=900000;
function fail(code,extra){const e=new Error(code);e.code=code;e.execution='not_executed';if(extra)e.details=extra;throw e;}
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
function sha256(text){return crypto.createHash('sha256').update(text).digest('hex');}
// Plain JSON copy of an effective (frozen) configuration, in file format.
function toFile(c){return JSON.parse(JSON.stringify({schemaVersion:1,revision:c.revision,accounts:c.accounts,newAccounts:c.newAccounts}));}

// Short human summary of what changes; shown verbatim on the host confirmation card.
function summarize(before,after){
 const parts=[];
 const accDesc=n=>{const a=after.newAccounts[n];return a?n+'(App '+a.appName+' ID '+a.appId+'/'+a.appSlug+')':n;};
 const accAdd=after.accounts.filter(n=>!before.accounts.includes(n)),accDel=before.accounts.filter(n=>!after.accounts.includes(n));
 const accChanged=Object.keys(after.newAccounts).filter(n=>before.accounts.includes(n)&&after.accounts.includes(n)&&canonical(before.newAccounts[n]??null)!==canonical(after.newAccounts[n]));
 if(accAdd.length)parts.push('加账号 '+accAdd.map(accDesc).join(','));
 if(accDel.length)parts.push('停用账号 '+accDel.join(','));
 if(accChanged.length)parts.push('改账号 '+accChanged.map(accDesc).join(','));
 if(!parts.length)return '无变化';
 // Owner 2026-11-16: permissions and repositories follow the App installation on GitHub.
 if(accAdd.some(n=>after.newAccounts[n])||accChanged.length)parts.push('权限和仓库以 GitHub 上 App 安装为准，导入私钥时显示');
 return parts.join('；');
}
// Key-import confirmation card: what GitHub reports for this App right now.
function describeInstallation(account,r){
 const perms=Object.entries(r.installationPermissions||{}).map(([k,v])=>k+':'+v).join(',');
 const repos=r.installationRepositories||{repositories:[]};
 const sample=repos.repositories.slice(0,5).map(n=>String(n).replace(/^good-night-oppie[/]/,'')).join(',');
 const count=repos.repositories.length+(repos.complete?'':'+');
 return '账号 '+account+'：App '+r.app_slug+'（ID '+r.app_id+'），安装 '+r.installation_id+'（good-night-oppie，'+(r.installationRepositorySelection==='all'?'全部仓库':'选定仓库')+' '+count+' 个：'+sample+(repos.repositories.length>5?' 等':'')+'），权限 '+perms;
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
   keys:saved,builtinAccounts:BUILTIN_ACCOUNTS};
 }
 async function plan(args){
  if(!args||typeof args!=='object'||!Number.isSafeInteger(args.expectedRevision))fail('INVALID_PROPOSAL');
  const {config:before}=await current();
  if(before.revision!==args.expectedRevision)fail('SCOPE_REVISION_CONFLICT',{revision:before.revision});
  if(!args.config||typeof args.config!=='object'||Array.isArray(args.config))fail('INVALID_PROPOSAL');
  // An account saved by settings.2-6 keeps its installation ID while its App ID is unchanged, even if
  // the page leaves it out: its stored key is bound to it, and losing it would make that account
  // need its key imported again (node/store.cjs). It never selects the installation.
  const proposed={...args.config};
  if(proposed.newAccounts&&typeof proposed.newAccounts==='object'&&!Array.isArray(proposed.newAccounts)){
   proposed.newAccounts=Object.fromEntries(Object.entries(proposed.newAccounts).map(([n,a])=>{
    const b=Object.hasOwn(before.newAccounts,n)?before.newAccounts[n]:null;
    return [n,b?.installationId&&a&&typeof a==='object'&&a.appId===b.appId&&a.installationId===undefined?{...a,installationId:b.installationId}:a];
   }));
  }
  let after;try{after=validateConfig({...proposed,schemaVersion:1,revision:before.revision+1},{keep:before.newAccounts});}catch(e){fail('INVALID_SCOPE_CONFIGURATION',{reason:e.reason});}
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
 // Two phases with the same host-injected key. 'inspect' verifies the App on GitHub and returns what
 // its installation holds (shown on the confirmation card); 'store' repeats the check, requires the
 // same facts the owner confirmed (hash), then saves the key with the existing DPAPI store.
 async function importKey(args,host){
  if(!args||typeof args!=='object'||Object.keys(args).some(k=>!['account','replace','phase','hash'].includes(k))||typeof args.account!=='string'||!['inspect','store'].includes(args.phase??'store'))fail('INVALID_IMPORT');
  const pem=host?.secrets?.app_private_key;
  if(typeof pem!=='string'||!pem.trim())fail('PRIVATE_KEY_NOT_PROVIDED');
  let fingerprint,verification;
  try{
   try{fingerprint=crypto.createHash('sha256').update(crypto.createPublicKey(crypto.createPrivateKey(pem)).export({type:'spki',format:'der'})).digest('hex');}catch(_){fail('INVALID_PRIVATE_KEY');}
   const config=await loader.load();
   verification=await verifyKey({account:args.account,pem,config});
   if(!verification?.ok)return {ok:false,errorCode:verification?.errorCode||'IDENTITY_VERIFICATION_FAILED',execution:'not_executed',...(verification?.details?{details:verification.details}:{})};
   const r=verification.result,summary=describeInstallation(args.account,r);
   const hash=sha256(canonical({account:args.account,fingerprint,summary,replace:args.replace===true}));
   if((args.phase??'store')==='inspect')return {ok:true,account:args.account,summary,hash};
   if(args.hash!==hash)fail('PROPOSAL_CHANGED');
   const imported=await store.importKeyText({account:args.account,pem_text:pem,replace:args.replace===true,expected_fingerprint:fingerprint,metadata:r.warnings?.length?{}:{appSlug:r.app_slug}});
   await audit({event:'import_key',account:args.account,fingerprint:imported.fingerprint,summary});
   return {ok:true,account:args.account,fingerprint:imported.fingerprint,app_slug:r.app_slug,installation_id:r.installation_id,installationRepositorySelection:r.installationRepositorySelection,installationPermissions:r.installationPermissions,repositories:r.installationRepositories.repositories,summary};
  }finally{if(host?.secrets)host.secrets.app_private_key='';}
 }
 return {read,propose,save,importKey};
}
module.exports={createSettings,summarize,describeInstallation,canonical,AUDIT_FILE};
