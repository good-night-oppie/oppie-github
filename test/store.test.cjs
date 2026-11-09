'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const runFile=promisify(execFile);
const {createStore,metadata,APP_IDS}=require('../node/store.cjs');

// Synthetic test-only key. It is never uploaded or associated with a GitHub App.
const pem=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
async function fixture(t,overrides={}){
  const temporary=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'oppie-store-test-'));
  t.after(()=>fs.rm(temporary,{recursive:true,force:true}));
  const pemPath=path.join(temporary,'synthetic.pem');await fs.writeFile(pemPath,pem);
  const key=crypto.randomBytes(32);
  const protect=async(data,context)=>{const iv=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(context));return Buffer.concat([iv,c.update(data),c.final(),c.getAuthTag()]);};
  const unprotect=async(data,context)=>{const d=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(0,12));d.setAAD(Buffer.from(context));d.setAuthTag(data.subarray(-16));return Buffer.concat([d.update(data.subarray(12,-16)),d.final()]);};
  const opts={root:path.join(temporary,'private'),platform:'win32',protect,unprotect,checkAcl:async()=>{},tighten:async()=>{},...overrides};
  return {temporary,pemPath,store:createStore(opts),opts};
}
test('import persists only ciphertext and readback recovers correct native-worker credential',async t=>{
 const {store,pemPath,opts}=await fixture(t);
 const receipt=await store.importKey({account:'bb',pem_path:pemPath});
 assert.equal(receipt.appId,'5665927');assert.equal(receipt.installationId,'179806310');assert.equal(receipt.admin,false);
 assert.equal(receipt.ciphertext,undefined);assert.equal(receipt.privateKey,undefined);
 const raw=await fs.readFile(store.paths.file,'utf8');assert.ok(!raw.includes('PRIVATE KEY'));assert.ok(!raw.includes(pem.slice(40,80)));
 assert.equal((await createStore(opts).load('bb')).privateKey,pem);
 assert.equal((await store.list())[0].ciphertext,undefined);
});

test('twelfth ReviewInbox account persists with pinned identity without altering prior ciphertext',async t=>{
 const {store,pemPath}=await fixture(t);
 for(const account of Object.keys(APP_IDS).filter(a=>a!=='reviewinbox'))await store.importKey({account,pem_path:pemPath});
 const before=JSON.parse(await fs.readFile(store.paths.file,'utf8'));
 const imported=await store.importKey({account:'reviewinbox',pem_path:pemPath,metadata:{appSlug:'reviewinboxoppiexyz'}});
 assert.equal(imported.appId,'5687106');assert.equal(imported.installationId,'180305629');assert.equal(imported.admin,false);
 assert.equal((await store.list()).length,12);assert.equal((await store.load('reviewinbox')).privateKey,pem);
 const after=JSON.parse(await fs.readFile(store.paths.file,'utf8'));
 assert.deepEqual(after.accounts.filter(a=>a.account!=='reviewinbox'),before.accounts);
 await assert.rejects(store.importKey({account:'reviewinbox',pem_path:pemPath,replace:true,metadata:{appSlug:'oppie-agent-reviewinbox'}}),/ACCOUNT_METADATA_MISMATCH/);
 assert.ok(!(await fs.readFile(store.paths.file,'utf8')).includes('PRIVATE KEY'));
});
test('duplicate import requires explicit replacement',async t=>{
 const {store,pemPath}=await fixture(t);await store.importKey({account:'bb',pem_path:pemPath});
 await assert.rejects(store.importKey({account:'bb',pem_path:pemPath}),/ACCOUNT_EXISTS/);
 await store.importKey({account:'bb',pem_path:pemPath,replace:true});assert.equal((await store.list()).length,1);
});

test('legacy and renamed stored slugs remain readable without changing ciphertext or entropy',async t=>{
 const {store,pemPath,opts}=await fixture(t);await store.importKey({account:'gg',pem_path:pemPath});
 const doc=JSON.parse(await fs.readFile(store.paths.file,'utf8'));const cipher=doc.accounts[0].ciphertext;
 for(const slug of ['oppie-agent-gg','ggoppiexyz']){
  doc.accounts[0].appSlug=slug;await fs.writeFile(store.paths.file,JSON.stringify(doc));
  const before=await fs.readFile(store.paths.file,'utf8');const reloaded=createStore(opts);
  const loaded=await reloaded.load('gg');assert.equal(loaded.privateKey,pem);assert.equal(loaded.appSlug,slug);
  const visible=(await reloaded.list())[0];assert.equal(visible.expectedAppSlug,'ggoppiexyz');assert.equal(visible.appSlugStatus,'stored_not_live');
  assert.equal(await fs.readFile(store.paths.file,'utf8'),before);assert.equal(JSON.parse(before).accounts[0].ciphertext,cipher);
 }
});

test('import may persist verified legacy/new slug but rejects cross-account slug or changed App id',async t=>{
 const {store,pemPath}=await fixture(t);
 await store.importKey({account:'gg',pem_path:pemPath,metadata:{appSlug:'oppie-agent-gg'}});
 assert.equal((await store.list())[0].appSlug,'oppie-agent-gg');
 await store.importKey({account:'gg',pem_path:pemPath,replace:true,metadata:{appSlug:'ggoppiexyz'}});
 assert.equal((await store.list())[0].appSlug,'ggoppiexyz');
 for(const metadata of [{appSlug:'qqoppiexyz'},{appSlug:'ggoppiexyz',appId:'5665946'}])await assert.rejects(store.importKey({account:'gg',pem_path:pemPath,replace:true,metadata}),/ACCOUNT_METADATA_MISMATCH/);
 const doc=JSON.parse(await fs.readFile(store.paths.file,'utf8'));doc.accounts[0].appSlug='qqoppiexyz';await fs.writeFile(store.paths.file,JSON.stringify(doc));
 await assert.rejects(store.load('gg'),/INVALID_OR_UNSAFE_STORE/);
});
test('changed verified key is rejected before encryption and preserves existing row',async t=>{
 const {store,pemPath,opts}=await fixture(t);
 const original=await store.importKey({account:'bb',pem_path:pemPath});
 const before=await fs.readFile(store.paths.file,'utf8');
 let protections=0;
 const guarded=createStore({...opts,protect:async(...args)=>{protections++;return opts.protect(...args);}});
 await assert.rejects(guarded.importKey({account:'bb',pem_path:pemPath,replace:true,expected_fingerprint:'0'.repeat(64)}),/KEY_CHANGED_DURING_IMPORT/);
 assert.equal(protections,0);assert.equal(await fs.readFile(store.paths.file,'utf8'),before);
 assert.equal((await guarded.list())[0].fingerprint,original.fingerprint);
 await guarded.importKey({account:'bb',pem_path:pemPath,replace:true,expected_fingerprint:original.fingerprint});
 assert.equal(protections,1);
});
test('serial concurrent imports preserve both accounts and QQ-only metadata',async t=>{
 const {store,pemPath}=await fixture(t);
 await Promise.all(['bb','qq'].map(account=>store.importKey({account,pem_path:pemPath})));
 const list=await store.list();assert.equal(list.length,2);assert.deepEqual(list.filter(x=>x.admin).map(x=>x.account),['qq']);
});
test('wrong account, metadata, extension, relative path and oversized PEM fail before protecting',async t=>{
 let protectedCount=0;const {store,pemPath,temporary}=await fixture(t,{protect:async()=>{protectedCount++;throw Error('should not protect');}});
 await assert.rejects(store.importKey({account:'attacker',pem_path:pemPath}),/UNKNOWN_ACCOUNT/);
 await assert.rejects(store.importKey({account:'bb',pem_path:pemPath,metadata:{appId:'1'}}),/ACCOUNT_METADATA_MISMATCH/);
 await assert.rejects(store.importKey({account:'bb',pem_path:'relative.pem'}),/INVALID_PEM_PATH/);
 await assert.rejects(store.importKey({account:'bb',pem_path:path.join(temporary,'key.txt')}),/INVALID_PEM_PATH/);
 const large=path.join(temporary,'large.pem');await fs.writeFile(large,Buffer.alloc(32769));
 await assert.rejects(store.importKey({account:'bb',pem_path:large}),/KEY_IMPORT_FAILED/);
 assert.equal(protectedCount,0);
});
test('unsupported OS fails closed without creating a store',async t=>{
 const {store,pemPath}=await fixture(t,{platform:'darwin'});
 await assert.rejects(store.importKey({account:'bb',pem_path:pemPath}),/UNSUPPORTED_PLATFORM/);
 await assert.rejects(fs.stat(store.paths.root),e=>e.code==='ENOENT');
});
test('foreign or broad existing ACL rejected before credential read/encryption',async t=>{
 let protectedCount=0;const {store,pemPath}=await fixture(t,{checkAcl:async()=>{throw Error('foreign principal');},protect:async()=>{protectedCount++;throw Error();}});
 await fs.mkdir(store.paths.root);
 await assert.rejects(store.importKey({account:'bb',pem_path:pemPath}),/UNSAFE_STORE_ACL/);
 assert.equal(protectedCount,0);await assert.rejects(fs.stat(store.paths.file),e=>e.code==='ENOENT');
});
test('tampering account identity and moving ciphertext across accounts are detected',async t=>{
 const {store,pemPath}=await fixture(t);await store.importKey({account:'bb',pem_path:pemPath});
 const doc=JSON.parse(await fs.readFile(store.paths.file,'utf8'));
 doc.accounts[0].appId='5665946';await fs.writeFile(store.paths.file,JSON.stringify(doc));
 await assert.rejects(store.load('bb'),/INVALID_OR_UNSAFE_STORE/);
 Object.assign(doc.accounts[0],metadata('qq'));await fs.writeFile(store.paths.file,JSON.stringify(doc));
 await assert.rejects(store.load('qq'),/KEY_UNAVAILABLE/);
});
test('malformed PEM and protector errors never echo sensitive contents',async t=>{
 const {store,pemPath}=await fixture(t);const secret='SYNTHETIC-SECRET-DO-NOT-ECHO';await fs.writeFile(pemPath,secret);
 try{await store.importKey({account:'bb',pem_path:pemPath});assert.fail('expected rejection');}catch(e){assert.equal(e.message,'KEY_IMPORT_FAILED');assert.ok(!e.stack.includes(secret));}
});
test('PEM symlinks are rejected',async t=>{
 const {store,pemPath,temporary}=await fixture(t);const link=path.join(temporary,'link.pem');
 try{await fs.symlink(pemPath,link);}catch(e){if(['EPERM','EACCES','ENOTSUP'].includes(e.code)){t.skip('OS does not permit synthetic symlink creation');return;}throw e;}
 await assert.rejects(store.importKey({account:'bb',pem_path:link}),/KEY_IMPORT_FAILED/);
});
test('Windows directory read/traverse ACL is allowed, file reads and directory writes are refused', {skip:process.platform!=='win32'}, async t=>{
 const temporary=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'oppie-real-acl-test-'));
 t.after(()=>fs.rm(temporary,{recursive:true,force:true}));
 const pemPath=path.join(temporary,'synthetic.pem');await fs.writeFile(pemPath,pem);
 const store=createStore({root:path.join(temporary,'private')});
 try { await store.importKey({account:'bb',pem_path:pemPath}); }
 catch(error) {
  // Synthetic fixture only: expose ACL diagnostics, never PEM/ciphertext contents.
  const inspect=await runFile('icacls.exe',[store.paths.root],{windowsHide:true,timeout:15000,maxBuffer:16384}).catch(e=>({stdout:'icacls unavailable',stderr:''}));
  console.error('Synthetic fixture ACL:',inspect.stdout);
  throw error;
 }
 // Builtin Users is a portable synthetic non-owner group. No real store is touched.
 const group='*S-1-5-32-545';
 const acl=(target,...args)=>runFile('icacls.exe',[target,...args],{windowsHide:true,timeout:15000,maxBuffer:16384});
 await acl(store.paths.root,'/grant:r',group+':(OI)(CI)(RX)');
 assert.equal((await store.list()).length,1);
 assert.equal((await store.load('bb')).privateKey,pem);
 // Even read-only access by that group must be rejected on the ciphertext file.
 await acl(store.paths.file,'/grant:r',group+':(RX)');
 await assert.rejects(store.list(),/INVALID_OR_UNSAFE_STORE/);
 await assert.rejects(store.load('bb'),/INVALID_OR_UNSAFE_STORE/);
 await acl(store.paths.file,'/remove:g',group);
 await acl(store.paths.root,'/grant:r',group+':(OI)(CI)(M)');
 await assert.rejects(store.list(),/UNSAFE_STORE_ACL/);
 await assert.rejects(store.load('bb'),/UNSAFE_STORE_ACL/);
});
