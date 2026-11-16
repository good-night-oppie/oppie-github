'use strict';
// Signed, hot-reloaded scope configuration (QQ review of the settings page, 2026-11-16).
//
// scope-config.json is an envelope {format, config, hmac}: `config` is the configuration JSON text
// and `hmac` is HMAC-SHA256 over it with a random key that only exists sealed by DPAPI in
// scope-config.key, together with the last saved revision. Every read goes through the store's
// owner-only ACL check. Editing the JSON by hand (including bumping its revision) fails the
// signature; replaying an older signed file fails the revision check; deleting the configuration
// after a save fails closed. All of these return INVALID_SCOPE_CONFIGURATION and nothing runs.
//
// Residual risk (documented in SCOPE-CONFIG.md): a process running as the same Windows user can
// also call DPAPI, so it could unseal the key or delete both files; this is outside the boundary.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {validateConfig,DEFAULT_CONFIG,MAX_FILE_BYTES}=require('./scope-config.cjs');

const FORMAT='oppie-scope-config/v1';
const CONFIG_FILE='scope-config.json',KEY_FILE='scope-config.key',AUDIT_FILE='scope-config-audit.jsonl';
// QQ review 2026-11-16 (#33): once the owner has saved, deleting both scope-config.json and
// scope-config.key must not silently revert to the compiled defaults. The audit log records saves.
function auditHasSave(text){
 return typeof text==='string'&&text.split('\n').some(l=>{if(!l.trim())return false;try{return JSON.parse(l).event==='save';}catch(_){return /"event"\s*:\s*"save"/.test(l);}});
}
function invalid(reason){const e=new Error('INVALID_SCOPE_CONFIGURATION');e.code='INVALID_SCOPE_CONFIGURATION';e.reason=reason;throw e;}
function hmac(key,text){return crypto.createHmac('sha256',key).update(text,'utf8').digest('hex');}
function stampOf(file){try{const s=fs.statSync(file);return s.size+':'+s.mtimeMs+':'+s.ctimeMs+':'+s.ino;}catch(e){if(e.code==='ENOENT')return 'none';return 'error';}}

// Verify an envelope against the sealed key state. The config revision may equal the sealed
// revision or be exactly one ahead (a save wrote the configuration but not yet the key state).
function verify(text,state){
 if(text===null){if(state&&state.revision>0)invalid('configuration missing after a save');return DEFAULT_CONFIG;}
 if(Buffer.byteLength(text)>MAX_FILE_BYTES)invalid('too large');
 let env;try{env=JSON.parse(text.replace(/^﻿/,''));}catch(_){invalid('not JSON');}
 if(!env||env.format!==FORMAT||typeof env.config!=='string'||typeof env.hmac!=='string'||!/^[a-f0-9]{64}$/.test(env.hmac))invalid('not a signed configuration (hand-edited or legacy file)');
 if(!state)invalid('signing key missing');
 const expected=Buffer.from(hmac(state.key,env.config),'hex');
 if(!crypto.timingSafeEqual(expected,Buffer.from(env.hmac,'hex')))invalid('signature mismatch');
 let parsed;try{parsed=JSON.parse(env.config);}catch(_){invalid('config not JSON');}
 const config=validateConfig(parsed);
 if(config.revision!==state.revision&&config.revision!==state.revision+1)invalid('revision '+config.revision+' does not match the sealed revision '+state.revision);
 return config;
}

function createSignedLoader({store}){
 const root=store.paths.root,configPath=path.join(root,CONFIG_FILE),keyPath=path.join(root,KEY_FILE),auditPath=path.join(root,AUDIT_FILE);
 let cache=null,last=DEFAULT_CONFIG;
 async function load(){
  const files=stampOf(configPath)+'|'+stampOf(keyPath),stamp=files+'|'+stampOf(auditPath);
  if(stamp.includes('error'))invalid('unreadable');
  if(cache?.stamp===stamp)return cache.config;
  let config;
  if(files==='none|none'){
   let audit;try{audit=await store.readPrivate(AUDIT_FILE);}catch(_){invalid('audit log unreadable or unsafe ACL');}
   if(auditHasSave(audit))invalid('configuration and key deleted after a save');
   config=DEFAULT_CONFIG;
  }
  else{
   let text,state;
   try{text=await store.readPrivate(CONFIG_FILE);state=await store.readScopeKey();}catch(_){invalid('unreadable or unsafe ACL');}
   config=verify(text,state);
  }
  cache={stamp,config};last=config;return config;
 }
 // Last verified configuration, for synchronous consumers inside a call that already awaited load().
 function current(){return last;}
 // Write a new configuration: sign with the existing key (or a new one), write the envelope,
 // then seal the new revision. A crash between the two writes leaves revision = sealed + 1,
 // which verify() accepts; the next save seals it.
 async function save(file){
  const config=validateConfig(file);let state;
  try{state=await store.readScopeKey();}catch(_){invalid('signing key unreadable');}
  const key=state?.key??crypto.randomBytes(32);
  const text=JSON.stringify(file);
  await store.writePrivate(CONFIG_FILE,JSON.stringify({format:FORMAT,config:text,hmac:hmac(key,text)},null,1)+'\n');
  await store.writeScopeKey({key,revision:config.revision});
  cache=null;return load();
 }
 return Object.assign(load,{load,current,save,paths:{configPath,keyPath}});
}
module.exports={createSignedLoader,verify,hmac,auditHasSave,FORMAT,CONFIG_FILE,KEY_FILE,AUDIT_FILE};
