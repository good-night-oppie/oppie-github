'use strict';
const fs=require('node:fs/promises');
const constants=require('node:fs').constants;
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const MAGIC=Buffer.from('OPG1');
const backendName='Linux Secret Service + AES-256-GCM';
function error(code){const e=new Error(code);e.code=code;return e;}
function createLinuxSecurity(options={}){
 const platform=options.platform||process.platform;
 const io=options.fs||fs;
 const uid=options.uid||(()=>process.getuid());
 const namespace=options.namespace||'oppie-github-v1';
 if(!/^(oppie-github-v1|oppie-github-test-[a-f0-9]{8,64})$/.test(namespace))throw error('INVALID_KEYRING_NAMESPACE');
 function linux(){if(platform!=='linux')throw error('LINUX_REQUIRED');}
 async function master(create){
  linux();
  if(options.getMasterKey){try{const key=Buffer.from(await options.getMasterKey(create));if(key.length!==32){key.fill(0);throw Error();}return key;}catch(_){throw error('SECURE_STORAGE_UNAVAILABLE');}}
  return new Promise((resolve,reject)=>{
   const child=(options.spawn||spawn)('python3',[path.join(__dirname,'secret-service.py')],{stdio:['pipe','pipe','pipe'],windowsHide:true});
   let text='',size=0,done=false;
   const finish=(failure,value)=>{if(done)return;done=true;clearTimeout(timer);text='';failure?reject(error(failure)):resolve(value);};
   const timer=setTimeout(()=>{child.kill();finish('SECURE_STORAGE_UNAVAILABLE');},12000);
   child.on('error',()=>finish('SECURE_STORAGE_UNAVAILABLE'));
   child.stdout.on('data',part=>{size+=part.length;if(size>4096){child.kill();finish('SECURE_STORAGE_UNAVAILABLE');}else text+=part.toString('utf8');});
   child.stderr.on('data',()=>{});
   child.stdin.on('error',()=>finish('SECURE_STORAGE_UNAVAILABLE'));
   child.on('close',code=>{
    if(done)return;
    try{
     const data=JSON.parse(text);if(code!==0||data.ok!==true)throw error(['KEYRING_LOCKED','KEYRING_MISSING','KEYRING_KEY_MISSING','KEYRING_BUSY','KEYRING_AMBIGUOUS','KEYRING_PROMPT_REQUIRED'].includes(data.errorCode)?data.errorCode:'SECURE_STORAGE_UNAVAILABLE');
     if(typeof data.key!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(data.key))throw error('SECURE_STORAGE_UNAVAILABLE');
     const key=Buffer.from(data.key,'base64');data.key='';if(key.length!==32){key.fill(0);throw error('SECURE_STORAGE_UNAVAILABLE');}finish(null,key);
    }catch(e){finish(e.code||'SECURE_STORAGE_UNAVAILABLE');}
   });
   child.stdin.end(JSON.stringify({operation:create?'get-or-create':'get',namespace}));
  });
 }
 function contextBytes(context){if(typeof context!=='string'||!context||context.length>1024||context.includes('\0'))throw error('INVALID_KEY_CONTEXT');return Buffer.from(context,'utf8');}
 async function protect(data,context){
  linux();const aad=contextBytes(context);const plain=Buffer.from(data);if(!plain.length||plain.length>32768){plain.fill(0);throw error('INVALID_KEY_DATA');}
  let key;
  try{key=await master(true);const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad);const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);return Buffer.concat([MAGIC,iv,cipher.getAuthTag(),encrypted]);}
  finally{key?.fill(0);plain.fill(0);}
 }
 async function unprotect(data,context){
  linux();const aad=contextBytes(context);const sealed=Buffer.from(data);if(sealed.length<33||sealed.length>32800||!sealed.subarray(0,4).equals(MAGIC))throw error('INVALID_CIPHERTEXT');
  let key;
  try{key=await master(false);const decipher=crypto.createDecipheriv('aes-256-gcm',key,sealed.subarray(4,16));decipher.setAAD(aad);decipher.setAuthTag(sealed.subarray(16,32));return Buffer.concat([decipher.update(sealed.subarray(32)),decipher.final()]);}
  catch(e){if(e.code&&/^(KEYRING_|SECURE_STORAGE_)/.test(e.code))throw e;throw error('DECRYPT_FAILED');}
  finally{key?.fill(0);}
 }
 async function identity(target){
  linux();if(typeof target!=='string'||!path.isAbsolute(target))throw error('UNSAFE_STORE_ACL');
  const st=await io.lstat(target);const directory=st.isDirectory();
  if(st.isSymbolicLink()||(!directory&&!st.isFile())||st.uid!==uid()||(!directory&&st.nlink!==1))throw error('UNSAFE_STORE_ACL');
  if(await io.realpath(target)!==path.resolve(target))throw error('UNSAFE_STORE_ACL');
  return {st,directory};
 }
 async function verifyAcl(target){
  try{const {st,directory}=await identity(target);if((st.mode&0o7777)!==(directory?0o700:0o600))throw error('UNSAFE_STORE_ACL');}
  catch(e){if(e.code==='LINUX_REQUIRED')throw e;throw error('UNSAFE_STORE_ACL');}
 }
 async function tightenNew(target,directory){
  let handle;
  try{
   const before=await identity(target);if(before.directory!==!!directory)throw error('UNSAFE_STORE_ACL');
   handle=await io.open(target,constants.O_RDONLY|constants.O_NOFOLLOW);const st=await handle.stat();
   if(st.ino!==before.st.ino||st.dev!==before.st.dev||st.uid!==uid())throw error('UNSAFE_STORE_ACL');
   await handle.chmod(directory?0o700:0o600);await handle.close();handle=null;await verifyAcl(target);
  }catch(e){if(e.code==='LINUX_REQUIRED')throw e;throw error('UNSAFE_STORE_ACL');}finally{await handle?.close().catch(()=>{});}
 }
 return {protect,unprotect,verifyAcl,tightenNew,backendName};
}
module.exports={...createLinuxSecurity(),createLinuxSecurity,backendName};
