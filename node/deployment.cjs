'use strict';
// deployment.json (accounts allowed on this host, automaticReviews) is read from disk on every
// call. It used to be loaded with require() at worker start, so an edit (DD, europa) only took
// effect after the plugin process restarted. The file is a few hundred bytes; re-reading it is
// cheaper than any cache that could serve a stale list.
// An unreadable or invalid file fails closed: no account is usable on this host and automatic
// reviews stay off, until the file is fixed (no restart needed).
const fs=require('node:fs/promises');

const ACCOUNT=/^[a-z][a-z0-9-]{0,31}$/;
const MAX_BYTES=16384;
const CLOSED=Object.freeze({accounts:Object.freeze([]),automaticReviews:false,error:'INVALID_DEPLOYMENT'});

function parse(text){
 const doc=JSON.parse(text.replace(/^﻿/,''));
 if(!doc||typeof doc!=='object'||Array.isArray(doc))throw Error('root');
 const {accounts,automaticReviews=false}=doc;
 if(!Array.isArray(accounts)||accounts.length>64||accounts.some(a=>typeof a!=='string'||!ACCOUNT.test(a))||new Set(accounts).size!==accounts.length)throw Error('accounts');
 if(typeof automaticReviews!=='boolean')throw Error('automaticReviews');
 return Object.freeze({accounts:Object.freeze([...accounts]),automaticReviews});
}

function createDeploymentReader(file,{readFile=fs.readFile}={}){
 return async function readDeployment(){
  try{
   const bytes=await readFile(file);
   if(bytes.length>MAX_BYTES)return CLOSED;
   return parse(bytes.toString('utf8'));
  }catch(_){return CLOSED;}
 };
}
module.exports={createDeploymentReader,parse,CLOSED};
