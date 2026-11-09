'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {createLinuxSecurity,backendName}=require('../node/linux-security.cjs');
const key=crypto.randomBytes(32);
const build=extra=>createLinuxSecurity({platform:'linux',uid:()=>1000,getMasterKey:async()=>key,...extra});
test('Linux AES-GCM roundtrip binds ciphertext to account context and does not mutate caller input',async()=>{
 const api=build();const input=Buffer.from('synthetic private value');const before=Buffer.from(input);
 const first=await api.protect(input,'app/dd/123'),second=await api.protect(input,'app/dd/123');
 assert.deepEqual(input,before);assert.equal(first.includes(input),false);assert.notDeepEqual(first,second);
 assert.deepEqual(await api.unprotect(first,'app/dd/123'),input);
 await assert.rejects(api.unprotect(first,'app/gg/123'),{code:'DECRYPT_FAILED'});
 assert.equal(key.equals(Buffer.alloc(32)),false,'injected key must be copied before clearing');
});
test('tampered header/tag/body rejected and short envelope never asks keyring',async()=>{
 let lookups=0;const api=build({getMasterKey:async()=>{lookups++;return key;}});const sealed=await api.protect(Buffer.from('payload'),'ctx');
 for(const offset of [0,16,sealed.length-1]){const changed=Buffer.from(sealed);changed[offset]^=1;await assert.rejects(api.unprotect(changed,'ctx'));}
 const count=lookups;await assert.rejects(api.unprotect(Buffer.from('bad'),'ctx'),{code:'INVALID_CIPHERTEXT'});assert.equal(lookups,count);
});
test('decrypt requests existing master only; encrypt may create',async()=>{
 const calls=[];const api=build({getMasterKey:async create=>{calls.push(create);return key;}});
 const sealed=await api.protect(Buffer.from('payload'),'ctx');await api.unprotect(sealed,'ctx');assert.deepEqual(calls,[true,false]);
});
test('missing keyring fails closed with sanitized error and no fallback output',async()=>{
 const api=build({getMasterKey:async()=>{throw Error('SECRET SENTINEL');}});
 await assert.rejects(api.protect(Buffer.from('PRIVATE_SENTINEL'),'ctx'),e=>e.code==='SECURE_STORAGE_UNAVAILABLE'&&!e.message.includes('SENTINEL'));
 await assert.rejects(build({getMasterKey:async()=>Buffer.alloc(31)}).protect(Buffer.from('x'),'ctx'),{code:'SECURE_STORAGE_UNAVAILABLE'});
});
test('unsupported platform and invalid inputs rejected before keyring',async()=>{
 const api=build({platform:'win32',getMasterKey:async()=>{throw Error('must not call');}});
 await assert.rejects(api.protect(Buffer.from('x'),'ctx'),{code:'LINUX_REQUIRED'});
 await assert.rejects(build().protect(Buffer.alloc(0),'ctx'),{code:'INVALID_KEY_DATA'});
 await assert.rejects(build().protect(Buffer.alloc(32769),'ctx'),{code:'INVALID_KEY_DATA'});
 await assert.rejects(build().protect(Buffer.from('x'),'bad\0ctx'),{code:'INVALID_KEY_CONTEXT'});
 assert.throws(()=>build({namespace:'another-app'}),{code:'INVALID_KEYRING_NAMESPACE'});
 assert.match(backendName,/Secret Service/);
});
function fakeFs({directory=false,uid=1000,mode=directory?0o40700:0o100600,nlink=1,symlink=false,realpath,changed=false}={}){
 const target=path.resolve('test-linux-protected-store');let currentMode=mode;
 const st=()=>({isDirectory:()=>directory,isFile:()=>!directory,isSymbolicLink:()=>symlink,uid,nlink,mode:currentMode,ino:25,dev:1});
 let chmodCalls=0;
 return {target,chmodCalls:()=>chmodCalls,io:{lstat:async()=>st(),realpath:async()=>realpath||target,open:async()=>({stat:async()=>({...st(),ino:changed?26:25}),chmod:async value=>{chmodCalls++;currentMode=(mode&0o170000)|value;},close:async()=>{}})}};
}
test('only owned exact 0700 directories and 0600 single-link files are accepted',async()=>{
 for(const directory of [true,false]){const f=fakeFs({directory});await build({fs:f.io}).verifyAcl(f.target);}
 for(const opts of [{uid:1001},{mode:0o100640},{mode:0o100700},{nlink:2},{symlink:true},{directory:true,mode:0o40750},{directory:true,mode:0o41700},{realpath:path.resolve('different-root')}]){
  const f=fakeFs(opts);await assert.rejects(build({fs:f.io}).verifyAcl(f.target),{code:'UNSAFE_STORE_ACL'});
 }
});
test('tighten newly created owned file uses open handle and rejects changed inode or foreign owner',async()=>{
 let f=fakeFs({mode:0o100644});await build({fs:f.io}).tightenNew(f.target,false);assert.equal(f.chmodCalls(),1);await build({fs:f.io}).verifyAcl(f.target);
 for(const opts of [{changed:true},{uid:1001},{symlink:true},{nlink:2},{directory:true}]){f=fakeFs(opts);await assert.rejects(build({fs:f.io}).tightenNew(f.target,false),{code:'UNSAFE_STORE_ACL'});assert.equal(f.chmodCalls(),0);}
});
function spawnReply(response,{code=0,stderr=''}={}){
 const calls=[];
 function spawn(executable,args,opts){
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.kill=()=>{};
  child.stdin.end=input=>{calls.push({executable,args,opts,input});queueMicrotask(()=>{if(stderr)child.stderr.emit('data',Buffer.from(stderr));child.stdout.emit('data',Buffer.from(JSON.stringify(response)));child.emit('close',code);});};return child;
 }
 return {spawn,calls};
}
test('keyring child sends only operation/namespace on stdin and no secret argv or env',async()=>{
 const fake=spawnReply({ok:true,key:key.toString('base64')});const api=createLinuxSecurity({platform:'linux',spawn:fake.spawn});
 await api.protect(Buffer.from('PRIVATE_SENTINEL'),'ctx');assert.equal(fake.calls.length,1);
 assert.equal(fake.calls[0].executable,'python3');assert.deepEqual(JSON.parse(fake.calls[0].input),{operation:'get-or-create',namespace:'oppie-github-v1'});
 assert.equal(JSON.stringify(fake.calls).includes('PRIVATE_SENTINEL'),false);assert.equal(fake.calls[0].opts.env,undefined);
});
test('locked or missing collection and provider failures are sanitized and never fallback',async()=>{
 for(const errorCode of ['KEYRING_LOCKED','KEYRING_MISSING','KEYRING_KEY_MISSING','KEYRING_PROMPT_REQUIRED','KEYRING_AMBIGUOUS','PRIVATE_SENTINEL']){
  const fake=spawnReply({ok:false,errorCode},{code:1,stderr:'PRIVATE_SENTINEL'});const api=createLinuxSecurity({platform:'linux',spawn:fake.spawn});
  await assert.rejects(api.protect(Buffer.from('x'),'ctx'),e=>!e.message.includes('PRIVATE_SENTINEL')&&(e.code===errorCode||e.code==='SECURE_STORAGE_UNAVAILABLE'));assert.equal(fake.calls.length,1);
 }
});
