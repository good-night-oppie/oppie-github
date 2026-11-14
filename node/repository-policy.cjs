'use strict';

// Non-secret, reviewed repository identities. Discovery never changes this catalog.
const SIX=Object.freeze({MontClip:1441621868,'MontClip-Cindy':1446532339,'montclip-rsi':1450602468,'rsi-playbooks':1450603260,'oppie-github':1451885379,'sglang-review-inbox':1451900929});
// #22: the fork good-night-oppie/cindy is part of every App installation (DD adds it to all 12).
const CATALOG=Object.freeze({...SIX,cindy:1457433299});
const ACCOUNT_NAMES=Object.freeze(['bb','cindy','deja','dd','gg','jj','pg','qq','rea','video','vv','reviewinbox']);
const TWO=Object.freeze({MontClip:1441621868,'MontClip-Cindy':1446532339});
// #22 (QQ review): roles on the cindy fork. bb/deja write (branches, files, PRs); dd reads and
// posts COMMENT reviews only; qq uses review operations only (no admin, ruleset, dismissal or
// merge queue). Every other account is left out of cindy execution until a separate small PR.
const CINDY_ROLES=Object.freeze({bb:'write',deja:'write',dd:'comment_review',qq:'review'});
const CINDY_EXECUTION=Object.freeze(Object.keys(CINDY_ROLES));
const REVIEW_OPERATIONS=Object.freeze(['identity','get_contents','list_branches','list_issues','get_issue','list_pulls','get_pull','pull_files','list_reviews','submit_review']);
// Per-repository operation allowlist on top of the account's existing role; null means unchanged.
function repositoryRestriction(account,repo){
 if(repo!=='cindy'||!Object.hasOwn(CINDY_ROLES,account)||CINDY_ROLES[account]==='write')return null;
 return Object.freeze({operations:REVIEW_OPERATIONS,commentOnly:CINDY_ROLES[account]==='comment_review'});
}
function invalid(){const e=new Error('INVALID_SCOPE_CONFIGURATION');e.code='INVALID_SCOPE_CONFIGURATION';throw e;}
function record(value,keys){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))invalid();
 const own=Reflect.ownKeys(value);
 if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value')))invalid();
}
function repoMap(value){
 if(!value||typeof value!=='object'||Array.isArray(value))invalid();
 const names=Object.keys(value);if(!names.length||names.length>Object.keys(CATALOG).length)invalid();record(value,names);
 const selected={};
 for(const name of Object.keys(CATALOG))if(Object.hasOwn(value,name)){
  if(value[name]!==CATALOG[name])invalid();selected[name]=CATALOG[name];
 }
 if(Object.keys(selected).length!==names.length)invalid();
 return Object.freeze(selected);
}
function baseline(account){return {installation:CATALOG,execution:account==='reviewinbox'?TWO:CINDY_EXECUTION.includes(account)?CATALOG:SIX};}
function sameMap(a,b){return Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>a[k]===b[k]);}
function validatePolicy(value){
 record(value,['schemaVersion','revision','accounts']);
 if(value.schemaVersion!==1||!Number.isSafeInteger(value.revision)||value.revision<0)invalid();
 record(value.accounts,ACCOUNT_NAMES);const accounts={};
 for(const account of ACCOUNT_NAMES){
  const source=value.accounts[account];record(source,['installation','execution']);
  const installation=repoMap(source.installation),execution=repoMap(source.execution);
  if(!Object.keys(execution).every(k=>installation[k]===execution[k]))invalid();
  // Compiled account grants stay pinned; the existing Deja test seam may only select catalog subsets.
  const original=baseline(account);
  if(account!=='deja'&&(!sameMap(installation,original.installation)||!sameMap(execution,original.execution)))invalid();
  accounts[account]=Object.freeze({installation,execution});
 }
 return Object.freeze({schemaVersion:1,revision:value.revision,accounts:Object.freeze(accounts)});
}
function initialPolicy(){return validatePolicy({schemaVersion:1,revision:0,accounts:Object.fromEntries(ACCOUNT_NAMES.map(a=>[a,baseline(a)]))});}
module.exports={CATALOG,SIX,TWO,CINDY_ROLES,CINDY_EXECUTION,REVIEW_OPERATIONS,repositoryRestriction,ACCOUNT_NAMES,initialPolicy,validatePolicy};
