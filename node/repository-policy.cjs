'use strict';
const {DEFAULT_CONFIG}=require('./scope-config.cjs');

// Compiled defaults, kept as named exports for existing callers and tests. The values in
// force at run time come from scope-config.cjs (defaults, optionally replaced by the
// owner's local configuration file) and are passed to every function below.
const CATALOG=DEFAULT_CONFIG.repositories;
const SIX=Object.freeze(Object.fromEntries(Object.entries(CATALOG).filter(([n])=>n!=='cindy')));
const OPTIONAL_REPOSITORIES=DEFAULT_CONFIG.optionalRepositories;
const ACCOUNT_NAMES=DEFAULT_CONFIG.accounts;
const TWO=DEFAULT_CONFIG.twoRepositories;
const CINDY_ROLES=DEFAULT_CONFIG.repositoryRoles.cindy;
const CINDY_EXECUTION=Object.freeze(Object.keys(CINDY_ROLES));
const REVIEW_OPERATIONS=DEFAULT_CONFIG.reviewOperations;
// Per-repository operation allowlist on top of the account's existing role; null means unchanged.
// A configured new account carries its own global role; repository tables refine it.
function repositoryRestriction(account,repo,config=DEFAULT_CONFIG){
 const table=Object.hasOwn(config.repositoryRoles,repo)?config.repositoryRoles[repo]:null;
 const role=table&&Object.hasOwn(table,account)?table[account]:Object.hasOwn(config.newAccounts,account)?config.newAccounts[account].role:'write';
 if(role==='write')return null;
 return Object.freeze({operations:config.reviewOperations,commentOnly:role==='comment_review'});
}
function invalid(){const e=new Error('INVALID_SCOPE_CONFIGURATION');e.code='INVALID_SCOPE_CONFIGURATION';throw e;}
function record(value,keys){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))invalid();
 const own=Reflect.ownKeys(value);
 if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value')))invalid();
}
function repoMap(value,catalog){
 if(!value||typeof value!=='object'||Array.isArray(value))invalid();
 const names=Object.keys(value);if(!names.length||names.length>Object.keys(catalog).length)invalid();record(value,names);
 const selected={};
 for(const name of Object.keys(catalog))if(Object.hasOwn(value,name)){
  if(value[name]!==catalog[name])invalid();selected[name]=catalog[name];
 }
 if(Object.keys(selected).length!==names.length)invalid();
 return Object.freeze(selected);
}
function baseline(account,config){return {installation:config.repositories,execution:config.repositories};}
function sameMap(a,b){return Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>a[k]===b[k]);}
function validatePolicy(value,config=DEFAULT_CONFIG){
 record(value,['schemaVersion','revision','accounts']);
 if(value.schemaVersion!==1||!Number.isSafeInteger(value.revision)||value.revision<0)invalid();
 record(value.accounts,config.accounts);const accounts={};
 for(const account of config.accounts){
  const source=value.accounts[account];record(source,['installation','execution']);
  const installation=repoMap(source.installation,config.repositories),execution=repoMap(source.execution,config.repositories);
  if(!Object.keys(execution).every(k=>installation[k]===execution[k]))invalid();
  // Configured account grants stay pinned; the existing Deja test seam may only select catalog subsets.
  const original=baseline(account,config);
  if(account!=='deja'&&(!sameMap(installation,original.installation)||!sameMap(execution,original.execution)))invalid();
  accounts[account]=Object.freeze({installation,execution});
 }
 return Object.freeze({schemaVersion:1,revision:value.revision,accounts:Object.freeze(accounts)});
}
function initialPolicy(config=DEFAULT_CONFIG){return validatePolicy({schemaVersion:1,revision:0,accounts:Object.fromEntries(config.accounts.map(a=>[a,baseline(a,config)]))},config);}
module.exports={CATALOG,SIX,TWO,OPTIONAL_REPOSITORIES,CINDY_ROLES,CINDY_EXECUTION,REVIEW_OPERATIONS,repositoryRestriction,ACCOUNT_NAMES,initialPolicy,validatePolicy};
