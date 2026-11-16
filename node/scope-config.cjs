'use strict';
// Owner-editable scope configuration (2026-11-15, owner request on oppie-github#8).
// Every value defaults to the reviewed compiled value. A local JSON file may replace
// any of them; it is re-read on every call (hot reload) and validated strictly.
// An unreadable or invalid file never falls back silently: callers get
// INVALID_SCOPE_CONFIGURATION and nothing executes.
//
// What the file can NOT change (kept in code): the owner organisation, App/installation
// pins of the twelve built-in accounts, token permission sets, QQ-only and admin rules,
// default-branch refusal and every per-call check.

const OWNER='good-night-oppie';
const DEFAULTS=Object.freeze({
 repositories:Object.freeze({MontClip:1441621868,'MontClip-Cindy':1446532339,'montclip-rsi':1450602468,'rsi-playbooks':1450603260,'oppie-github':1451885379,'sglang-review-inbox':1451900929,cindy:1457433299}),
 optionalRepositories:Object.freeze(['cindy']),
 accounts:Object.freeze(['bb','cindy','deja','dd','gg','jj','pg','qq','rea','video','vv','reviewinbox']),
 twoRepositories:Object.freeze({MontClip:1441621868,'MontClip-Cindy':1446532339}),
 // Per-repository role tables (formerly CINDY_ROLES for the cindy fork).
 repositoryRoles:Object.freeze({cindy:Object.freeze({bb:'write',deja:'write',dd:'write',qq:'write'})}),
 reviewOperations:Object.freeze(['identity','get_contents','list_branches','list_issues','get_issue','list_pulls','get_pull','pull_files','list_reviews','submit_review']),
 newAccounts:Object.freeze({}),
});
const BUILTIN_ACCOUNTS=Object.freeze(['bb','cindy','deja','dd','gg','jj','pg','qq','rea','video','vv','reviewinbox']);
// Account roles. 'reviewer' (BB/QQ, #28/#29): read, comment_issue and submit_review with any event.
const ROLES=Object.freeze(['write','reviewer','review','comment_review']);
// Per-repository roles also accept 'none': the repository is not usable by that account (owner decides
// in the settings page, e.g. whether AD may use cindy); it is left out of the account's execution token.
const REPOSITORY_ROLES=Object.freeze([...ROLES,'none']);
const KEYS=Object.freeze(['schemaVersion','revision','repositories','optionalRepositories','accounts','twoRepositories','repositoryRoles','reviewOperations','newAccounts']);
const REPO_NAME=/^[A-Za-z0-9._-]{1,100}$/;
const ACCOUNT_NAME=/^[a-z][a-z0-9-]{0,31}$/;
const APP_NAME=/^[A-Za-z0-9-]{1,34}$/;
const APP_SLUG=/^[a-z0-9][a-z0-9-]{0,39}$/;
// App and installation IDs of the twelve compiled accounts; a configured account may not reuse them.
const BUILTIN_APP_IDS=Object.freeze([5665927,5665939,5665940,5665941,5665942,5665943,5665944,5665946,5665948,5665949,5665951,5687106]);
const BUILTIN_INSTALLATION_IDS=Object.freeze([179806310,179806330,179806356,179806387,179806414,179806445,179806482,179806512,179806534,179806582,179806217,180305629]);
// Operations a configured (non-compiled) account may ever be given. Admin and QQ-only operations
// (rulesets, dismissals, merge queue) are never available to configured accounts.
const ACCOUNT_OPERATION_CEILING=Object.freeze(['identity','get_contents','list_branches','list_issues','get_issue','create_issue','update_issue','comment_issue','list_pulls','get_pull','pull_files','create_pull','update_pull','list_reviews','submit_review','create_branch','update_file','edit_file','commit_files']);
const MAX_FILE_BYTES=65536;

function invalid(reason){const e=new Error('INVALID_SCOPE_CONFIGURATION');e.code='INVALID_SCOPE_CONFIGURATION';e.reason=reason;throw e;}
function plain(x){return !!x&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));}
function id(x,what){if(!Number.isSafeInteger(x)||x<1)invalid(what);return x;}
function names(list,what,pattern=REPO_NAME,max=200){
 if(!Array.isArray(list)||list.length>max)invalid(what);
 for(const n of list)if(typeof n!=='string'||!pattern.test(n)||n==='.'||n==='..')invalid(what);
 if(new Set(list).size!==list.length)invalid(what+' duplicate');
 return Object.freeze([...list]);
}
function repoMap(map,what,allowEmpty=false){
 if(!plain(map))invalid(what);
 const entries=Object.entries(map);if((!allowEmpty&&!entries.length)||entries.length>100)invalid(what); // execution listing is one page of 100
 const out={},ids=new Set();
 for(const [n,v] of entries){if(!REPO_NAME.test(n)||n==='.'||n==='..')invalid(what+' name');id(v,what+' id');if(ids.has(v))invalid(what+' duplicate id');ids.add(v);out[n]=v;}
 return Object.freeze(out);
}

// Built-in operation names that a review-only role may be limited to. Write, admin and
// QQ-only operations can never be added to the review allowlist through configuration.
const REVIEW_OPERATION_CEILING=DEFAULTS.reviewOperations;

function validateConfig(raw){
 if(raw===undefined||raw===null)raw={};
 if(!plain(raw))invalid('root');
 for(const k of Object.keys(raw))if(!KEYS.includes(k))invalid('unknown key '+k);
 if(raw.schemaVersion!==undefined&&raw.schemaVersion!==1)invalid('schemaVersion');
 const revision=raw.revision===undefined?0:raw.revision;if(!Number.isSafeInteger(revision)||revision<0)invalid('revision');
 const repositories=raw.repositories===undefined?DEFAULTS.repositories:repoMap(raw.repositories,'repositories');
 const optionalRepositories=raw.optionalRepositories===undefined?DEFAULTS.optionalRepositories:names(raw.optionalRepositories,'optionalRepositories');
 if(optionalRepositories.some(n=>!Object.hasOwn(repositories,n)))invalid('optionalRepositories not in repositories');
 if(optionalRepositories.length===Object.keys(repositories).length)invalid('at least one required repository');
 const twoRepositories=raw.twoRepositories===undefined?DEFAULTS.twoRepositories:repoMap(raw.twoRepositories,'twoRepositories',true);
 for(const [n,v] of Object.entries(twoRepositories))if(repositories[n]!==v)invalid('twoRepositories not in repositories');
 // New accounts: App identity is pinned in the file exactly like the compiled accounts.
 const newAccounts={};
 if(raw.newAccounts!==undefined){
  if(!plain(raw.newAccounts)||Object.keys(raw.newAccounts).length>50)invalid('newAccounts');
  const seenApps=new Set(),seenInstalls=new Set();
  for(const [name,a] of Object.entries(raw.newAccounts)){
   if(!ACCOUNT_NAME.test(name)||BUILTIN_ACCOUNTS.includes(name))invalid('newAccounts name '+name);
   if(!plain(a)||Object.keys(a).some(k=>!['appId','installationId','appName','appSlug','role','operations'].includes(k)))invalid('newAccounts '+name);
   id(a.appId,'appId');id(a.installationId,'installationId');
   if(BUILTIN_APP_IDS.includes(a.appId)||BUILTIN_INSTALLATION_IDS.includes(a.installationId))invalid('newAccounts '+name+' reuses a compiled App or installation');
   if(typeof a.appName!=='string'||!APP_NAME.test(a.appName))invalid('appName');
   const appSlug=a.appSlug===undefined?a.appName.toLowerCase():a.appSlug;if(typeof appSlug!=='string'||!APP_SLUG.test(appSlug))invalid('appSlug');
   let operations=null;
   if(a.operations!==undefined){operations=names(a.operations,'operations',/^[a-z_]{1,40}$/,40);if(!operations.includes('identity')||operations.some(o=>!ACCOUNT_OPERATION_CEILING.includes(o)))invalid('operations must include identity and stay within the configured-account ceiling');}
   // Default role for a new account is review-only; 'write' must be stated explicitly.
   const role=a.role===undefined?'review':a.role;if(!ROLES.includes(role))invalid('role');
   if(seenApps.has(a.appId)||seenInstalls.has(a.installationId))invalid('newAccounts duplicate id');
   seenApps.add(a.appId);seenInstalls.add(a.installationId);
   newAccounts[name]=Object.freeze({appId:a.appId,installationId:a.installationId,appName:a.appName,appSlug,role,...(operations?{operations}:{})});
  }
 }
 const known=[...BUILTIN_ACCOUNTS,...Object.keys(newAccounts)];
 const accounts=raw.accounts===undefined?Object.freeze([...DEFAULTS.accounts,...Object.keys(newAccounts)]):names(raw.accounts,'accounts',ACCOUNT_NAME,64);
 if(!accounts.length||accounts.some(a=>!known.includes(a)))invalid('accounts must be built-in or listed in newAccounts');
 const repositoryRoles={};
 const rolesSource=raw.repositoryRoles===undefined?DEFAULTS.repositoryRoles:raw.repositoryRoles;
 if(!plain(rolesSource))invalid('repositoryRoles');
 for(const [repo,table] of Object.entries(rolesSource)){
  if(!Object.hasOwn(repositories,repo)||!plain(table))invalid('repositoryRoles '+repo);
  const t={};for(const [acct,role] of Object.entries(table)){if(!known.includes(acct)||!REPOSITORY_ROLES.includes(role))invalid('repositoryRoles '+repo+'.'+acct);t[acct]=role;}
  repositoryRoles[repo]=Object.freeze(t);
 }
 // Every enabled account must keep at least one usable repository.
 for(const acct of accounts)if(Object.keys(repositories).every(r=>repositoryRoles[r]?.[acct]==='none'))invalid('account '+acct+' has no usable repository');
 const reviewOperations=raw.reviewOperations===undefined?DEFAULTS.reviewOperations:names(raw.reviewOperations,'reviewOperations',/^[a-z_]{1,40}$/,40);
 if(!reviewOperations.includes('identity')||reviewOperations.some(o=>!REVIEW_OPERATION_CEILING.includes(o)))invalid('reviewOperations must be a subset of the compiled review operations and include identity');
 return Object.freeze({schemaVersion:1,revision,repositories,optionalRepositories,accounts,twoRepositories,repositoryRoles:Object.freeze(repositoryRoles),reviewOperations,newAccounts:Object.freeze(newAccounts)});
}
const DEFAULT_CONFIG=validateConfig({});

module.exports={OWNER,DEFAULTS,DEFAULT_CONFIG,BUILTIN_ACCOUNTS,BUILTIN_APP_IDS,BUILTIN_INSTALLATION_IDS,ACCOUNT_OPERATION_CEILING,REVIEW_OPERATION_CEILING,MAX_FILE_BYTES,ROLES,REPOSITORY_ROLES,validateConfig};
