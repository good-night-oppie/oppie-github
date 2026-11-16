'use strict';
// Owner-signed account configuration (settings page, oppie-github#8).
// Owner decision 2026-11-16: "plugin code must not box in teammates' permissions; the remote always
// wins". What an account can do and which repositories it can use come from its GitHub App
// installation. This file only says which accounts are enabled and, for accounts added in the
// settings page, their App identity (App ID is the pinned anchor; name and slug for display/checks).
// An unreadable or invalid file never falls back silently: callers get INVALID_SCOPE_CONFIGURATION.
//
// Kept in code: the owner organisation, App/installation pins of the twelve built-in accounts,
// per-operation token permissions, default-branch refusal, owner authorization for rulesets.

const OWNER='good-night-oppie';
const BUILTIN_ACCOUNTS=Object.freeze(['bb','cindy','deja','dd','gg','jj','pg','qq','rea','video','vv','reviewinbox']);
const DEFAULTS=Object.freeze({accounts:BUILTIN_ACCOUNTS,newAccounts:Object.freeze({})});
const KEYS=Object.freeze(['schemaVersion','revision','accounts','newAccounts']);
const ACCOUNT_NAME=/^[a-z][a-z0-9-]{0,31}$/;
const APP_NAME=/^[A-Za-z0-9-]{1,34}$/;
const APP_SLUG=/^[a-z0-9][a-z0-9-]{0,39}$/;
// App IDs of the twelve compiled accounts; a configured account may not reuse them.
const BUILTIN_APP_IDS=Object.freeze([5665927,5665939,5665940,5665941,5665942,5665943,5665944,5665946,5665948,5665949,5665951,5687106]);
const MAX_FILE_BYTES=65536;

function invalid(reason){const e=new Error('INVALID_SCOPE_CONFIGURATION');e.code='INVALID_SCOPE_CONFIGURATION';e.reason=reason;throw e;}
function plain(x){return !!x&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));}
function id(x,what){if(!Number.isSafeInteger(x)||x<1)invalid(what);return x;}
function names(list,what,pattern=ACCOUNT_NAME,max=200){
 if(!Array.isArray(list)||list.length>max)invalid(what);
 for(const n of list)if(typeof n!=='string'||!pattern.test(n)||n==='.'||n==='..')invalid(what);
 if(new Set(list).size!==list.length)invalid(what+' duplicate');
 return Object.freeze([...list]);
}
function validateConfig(raw){
 if(raw===undefined||raw===null)raw={};
 if(!plain(raw))invalid('root');
 for(const k of Object.keys(raw))if(!KEYS.includes(k))invalid('unknown key '+k);
 if(raw.schemaVersion!==undefined&&raw.schemaVersion!==1)invalid('schemaVersion');
 const revision=raw.revision===undefined?0:raw.revision;if(!Number.isSafeInteger(revision)||revision<0)invalid('revision');
 // New accounts: only the App identity. Installation, permissions and repositories come from GitHub.
 const newAccounts={};
 if(raw.newAccounts!==undefined){
  if(!plain(raw.newAccounts)||Object.keys(raw.newAccounts).length>50)invalid('newAccounts');
  const seenApps=new Set();
  for(const [name,a] of Object.entries(raw.newAccounts)){
   if(!ACCOUNT_NAME.test(name)||BUILTIN_ACCOUNTS.includes(name))invalid('newAccounts name '+name);
   if(!plain(a)||Object.keys(a).some(k=>!['appId','appName','appSlug'].includes(k)))invalid('newAccounts '+name);
   id(a.appId,'appId');
   if(BUILTIN_APP_IDS.includes(a.appId))invalid('newAccounts '+name+' reuses a compiled App');
   if(typeof a.appName!=='string'||!APP_NAME.test(a.appName))invalid('appName');
   const appSlug=a.appSlug===undefined?a.appName.toLowerCase():a.appSlug;if(typeof appSlug!=='string'||!APP_SLUG.test(appSlug))invalid('appSlug');
   if(seenApps.has(a.appId))invalid('newAccounts duplicate App ID');
   seenApps.add(a.appId);
   newAccounts[name]=Object.freeze({appId:a.appId,appName:a.appName,appSlug});
  }
 }
 const known=[...BUILTIN_ACCOUNTS,...Object.keys(newAccounts)];
 const accounts=raw.accounts===undefined?Object.freeze([...DEFAULTS.accounts,...Object.keys(newAccounts)]):names(raw.accounts,'accounts',ACCOUNT_NAME,64);
 if(!accounts.length||accounts.some(a=>!known.includes(a)))invalid('accounts must be built-in or listed in newAccounts');
 return Object.freeze({schemaVersion:1,revision,accounts,newAccounts:Object.freeze(newAccounts)});
}
const DEFAULT_CONFIG=validateConfig({});

module.exports={OWNER,DEFAULTS,DEFAULT_CONFIG,BUILTIN_ACCOUNTS,BUILTIN_APP_IDS,MAX_FILE_BYTES,validateConfig};
