'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);
const {ACCOUNTS,allowedAppSlug}=require('./core.cjs');

const APP_IDS = { bb:'5665927', cindy:'5665939', deja:'5665940', dd:'5665941', gg:'5665942', jj:'5665943', pg:'5665944', qq:'5665946', rea:'5665948', video:'5665949', vv:'5665951', reviewinbox:'5687106' };
const INSTALL_IDS = { bb:'179806310', cindy:'179806330', deja:'179806356', dd:'179806387', gg:'179806414', jj:'179806445', pg:'179806482', qq:'179806512', rea:'179806534', video:'179806582', vv:'179806217', reviewinbox:'180305629' };
const MAX_PEM = 32768;
const MAX_STORE = 1048576;
function failure(code) { const e = new Error(code); e.code = code; return e; }
// Legacy credential-envelope metadata is retained for DPAPI compatibility; it is NOT
// the current authorization policy. core.cjs verifies live permissions and token scopes.
function metadata(account) {
  if (typeof account !== 'string' || !Object.hasOwn(APP_IDS, account)) throw failure('UNKNOWN_ACCOUNT');
  return { account, appId:APP_IDS[account], installationId:INSTALL_IDS[account], appSlug:ACCOUNTS[account].app_slug,
    owner:'good-night-oppie', repositoryIds:[1441621868,1446532339], admin:account==='qq' };
}
function entropy(account) { const m=metadata(account); return 'oppie-github/v1/'+m.account+'/'+m.appId+'/'+m.installationId; }

// Only fixed source code is passed as a process argument; all data uses stdin.
// Errors deliberately omit stdout, stderr, arguments and supplied values.
function powershell(script, input) {
  return new Promise((resolve,reject) => {
    const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='', bytes=0, settled=false;
    const finish=(err,value)=>{if(settled)return;settled=true;clearTimeout(timer);err?reject(failure('SECURE_STORAGE_UNAVAILABLE')):resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(true);},15000);
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>MAX_STORE){child.kill();finish(true);}else output+=chunk.toString('utf8');});
    child.stderr.on('data',()=>{});
    child.on('error',()=>finish(true));
    child.on('close',code=>finish(code!==0,output.trim()));
    child.stdin.on('error',()=>finish(true));
    child.stdin.end(JSON.stringify(input));
  });
}
const DPAPI_SCRIPT = "$ErrorActionPreference='Stop'; try { $null=[Reflection.Assembly]::LoadWithPartialName('System.Security'); $r=[Console]::In.ReadToEnd() | ConvertFrom-Json; $d=[Convert]::FromBase64String($r.data); $e=[Text.Encoding]::UTF8.GetBytes($r.entropy); if($r.operation -eq 'protect') { $o=[Security.Cryptography.ProtectedData]::Protect($d,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser) } elseif($r.operation -eq 'unprotect') { $o=[Security.Cryptography.ProtectedData]::Unprotect($d,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser) } else { throw 'invalid' }; [Console]::Out.Write([Convert]::ToBase64String($o)); [Array]::Clear($d,0,$d.Length); [Array]::Clear($o,0,$o.Length) } catch { exit 1 }";
async function dpapi(operation, data, context) {
  if(process.platform!=='win32') throw failure('WINDOWS_REQUIRED');
  const result=await powershell(DPAPI_SCRIPT,{operation,data:Buffer.from(data).toString('base64'),entropy:context});
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(result))throw failure('SECURE_STORAGE_UNAVAILABLE');
  return Buffer.from(result,'base64');
}
// Directory names/traversal are not credentials. A read-only directory ACE cannot
// read protected child files or replace/delete them. Every credential file still
// requires its own protected, owner/SYSTEM-only DACL. No group-name exceptions.
const ACL_SCRIPT = "$ErrorActionPreference='Stop'; try { $r=[Console]::In.ReadToEnd() | ConvertFrom-Json; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; if($r.operation -eq 'identity'){ [Console]::Out.Write($sid); exit 0 }; $directory=[IO.Directory]::Exists($r.path); $a=if($directory){[IO.Directory]::GetAccessControl($r.path)}else{[IO.File]::GetAccessControl($r.path)}; $owner=$a.GetOwner([Security.Principal.SecurityIdentifier]).Value; if($owner -ne $sid -or -not $a.AreAccessRulesProtected){exit 1}; $readOnly=[int64]([Security.AccessControl.FileSystemRights]::ReadAndExecute -bor [Security.AccessControl.FileSystemRights]::Synchronize); $hasCurrent=$false; foreach($ace in $a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) { if($ace.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow){ $s=$ace.IdentityReference.Value; if($s -ne $sid -and $s -ne 'S-1-5-18'){ $rights=[int64]$ace.FileSystemRights; if(-not $directory -or ($rights -band (-bnot $readOnly)) -ne 0){exit 1} }; if($s -eq $sid -and (($ace.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl)){$hasCurrent=$true} } }; if(-not $hasCurrent){exit 1}; [Console]::Out.Write('ok') } catch { exit 1 }";
async function verifyWindowsAcl(target) {
  const answer=await powershell(ACL_SCRIPT,{operation:'verify',path:target});
  if(answer!=='ok')throw failure('UNSAFE_STORE_ACL');
}
async function tightenNew(target, directory) {
  const sid=await powershell(ACL_SCRIPT,{operation:'identity'});
  if(!/^S-1-5-\d+(?:-\d+)+$/.test(sid))throw failure('SECURE_STORAGE_UNAVAILABLE');
  const rights=directory?'(OI)(CI)F':'F';
  try {
    // Newly created files may inherit Administrators as owner in an elevated token.
    // Set ownership only for our new object; existing stores are verified, never repaired silently.
    await runFile('icacls.exe',[target,'/setowner','*'+sid],{windowsHide:true,timeout:15000,maxBuffer:16384});
    await runFile('icacls.exe',[target,'/inheritance:r','/grant:r','*'+sid+':'+rights,'*S-1-5-18:'+rights],{windowsHide:true,timeout:15000,maxBuffer:16384});
  }
  catch(_){throw failure('SECURE_STORAGE_UNAVAILABLE');}
  await verifyWindowsAcl(target);
}

async function plainFile(target, maxBytes) {
  const st=await fs.lstat(target,{bigint:true});
  if(!st.isFile()||st.isSymbolicLink()||st.size>maxBytes)throw failure('INVALID_FILE');
  const canonical=await fs.realpath(target);
  const equal=process.platform==='win32'?canonical.toLowerCase()===path.resolve(target).toLowerCase():canonical===path.resolve(target);
  if(!equal)throw failure('INVALID_FILE');
  const handle=await fs.open(target,'r');
  try {
    const now=await handle.stat({bigint:true});
    // Windows lstat reports dev=0 while handle.stat reports a volume ID.
    // Preserve full-width inode comparison; require device equality on POSIX.
    if(!now.isFile()||(process.platform!=='win32'&&now.dev!==st.dev)||now.ino!==st.ino||now.size>maxBytes)throw failure('INVALID_FILE');
    const data=Buffer.alloc(maxBytes+1);
    const {bytesRead}=await handle.read(data,0,data.length,0);
    if(bytesRead>maxBytes){data.fill(0);throw failure('INVALID_FILE');}
    return data.subarray(0,bytesRead);
  } finally { await handle.close(); }
}

function createStore(options={}) {
  const root=path.resolve(options.root||path.join(os.homedir(),'.oppie-github'));
  const file=path.join(root,'accounts.json');
  const platform=options.platform||process.platform;
  const linux=platform==='linux'?require('./linux-security.cjs'):null;
  const protect=options.protect||(linux?linux.protect:((data,context)=>dpapi('protect',data,context)));
  const unprotect=options.unprotect||(linux?linux.unprotect:((data,context)=>dpapi('unprotect',data,context)));
  const checkAcl=options.checkAcl||(linux?linux.verifyAcl:verifyWindowsAcl);
  const tighten=options.tighten||(linux?linux.tightenNew:tightenNew);
  let queue=Promise.resolve();
  function serial(fn){const result=queue.then(fn,fn);queue=result.catch(()=>{});return result;}
  async function ensureRoot(create=false) {
    if(!['win32','linux'].includes(platform))throw failure('UNSUPPORTED_PLATFORM');
    let st;
    try { st=await fs.lstat(root); } catch(e) {
      if(e.code!=='ENOENT')throw failure('UNSAFE_STORE');
      if(!create)return false;
      try { await fs.mkdir(root,{recursive:false});await tighten(root,true);st=await fs.lstat(root); }
      catch(_){throw failure('UNSAFE_STORE');}
    }
    if(!st.isDirectory()||st.isSymbolicLink())throw failure('UNSAFE_STORE');
    const actual=await fs.realpath(root);
    if(platform==='win32'?actual.toLowerCase()!==root.toLowerCase():actual!==root)throw failure('UNSAFE_STORE');
    try { await checkAcl(root); }catch(_){throw failure('UNSAFE_STORE_ACL');}
    return true;
  }
  function validateRow(row) {
    const fixed=metadata(row?.account);
    for(const k of Object.keys(fixed)){
      if(k==='appSlug'){if(!allowedAppSlug(fixed.account,row[k]))throw failure('INVALID_STORE');}
      else if(JSON.stringify(row[k])!==JSON.stringify(fixed[k]))throw failure('INVALID_STORE');
    }
    if(!/^[a-f0-9]{64}$/.test(row.fingerprint)||typeof row.ciphertext!=='string'||row.ciphertext.length>100000||!/^[A-Za-z0-9+/]+={0,2}$/.test(row.ciphertext))throw failure('INVALID_STORE');
    return row;
  }
  async function read() {
    if(!await ensureRoot())return {version:1,accounts:[]};
    try { await fs.lstat(file); }catch(e){if(e.code==='ENOENT')return {version:1,accounts:[]};throw failure('INVALID_STORE');}
    let bytes;
    try {
      await checkAcl(file);bytes=await plainFile(file,MAX_STORE);
      const doc=JSON.parse(bytes.toString('utf8'));
      if(doc.version!==1||!Array.isArray(doc.accounts)||doc.accounts.length>12)throw Error();
      const seen=new Set();for(const row of doc.accounts){validateRow(row);if(seen.has(row.account))throw Error();seen.add(row.account);}
      return doc;
    }catch(_){throw failure('INVALID_OR_UNSAFE_STORE');}finally{bytes?.fill(0);}
  }
  // A stored slug is historical metadata, not proof of a current GitHub name.
  // Do not rewrite ciphertext or alter entropy merely because registration renamed.
  function publicRow(row){const {ciphertext,...visible}=row;return {...visible,expectedAppSlug:ACCOUNTS[row.account].app_slug,appSlugStatus:'stored_not_live'};}
  async function save(doc) {
    await ensureRoot(true);
    const temporary=path.join(root,'.accounts-'+crypto.randomBytes(12).toString('hex')+'.tmp');
    let handle;
    try {
      handle=await fs.open(temporary,'wx',0o600);await handle.close();handle=null;
      await tighten(temporary,false);await checkAcl(root);
      handle=await fs.open(temporary,'r+');await handle.writeFile(JSON.stringify(doc));await handle.sync();await handle.close();handle=null;
      // Revalidate any existing destination before atomic replacement.
      try { await fs.lstat(file);await checkAcl(file);await plainFile(file,MAX_STORE); }catch(e){if(e.code!=='ENOENT')throw e;}
      await fs.rename(temporary,file);await checkAcl(file);
    }catch(_){throw failure('STORE_WRITE_FAILED');}
    finally { await handle?.close().catch(()=>{});await fs.unlink(temporary).catch(()=>{}); }
  }
  async function importKey(args) { return serial(async()=>{
    const fixed=metadata(args?.account);
    if(args.expected_fingerprint!==undefined&&!/^[a-f0-9]{64}$/.test(args.expected_fingerprint))throw failure('INVALID_EXPECTED_FINGERPRINT');
    const supplied=args.pem_path||args.pemPath;
    if(typeof supplied!=='string'||!path.isAbsolute(supplied)||path.extname(supplied).toLowerCase()!=='.pem')throw failure('INVALID_PEM_PATH');
    if(args.metadata)for(const [k,v] of Object.entries(args.metadata)){
      if(k==='appSlug'){if(!allowedAppSlug(fixed.account,v))throw failure('ACCOUNT_METADATA_MISMATCH');}
      else if(JSON.stringify(fixed[k])!==JSON.stringify(v))throw failure('ACCOUNT_METADATA_MISMATCH');
    }
    const doc=await read();
    const previous=doc.accounts.find(x=>x.account===fixed.account);
    if(previous&&!args.replace)throw failure('ACCOUNT_EXISTS');
    let bytes;
    try {
      bytes=await plainFile(supplied,MAX_PEM);
      const key=crypto.createPrivateKey(bytes);
      if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<2048)throw failure('INVALID_RSA_KEY');
      const pub=crypto.createPublicKey(key).export({type:'spki',format:'der'});
      const fingerprint=crypto.createHash('sha256').update(pub).digest('hex');
      // The runtime may have authenticated an earlier snapshot of this file.
      // Do not persist the reread key unless it is the same verified key.
      if(args.expected_fingerprint!==undefined&&fingerprint!==args.expected_fingerprint)throw failure('KEY_CHANGED_DURING_IMPORT');
      const sealed=await protect(bytes,entropy(fixed.account));
      const row={...fixed,appSlug:args.metadata?.appSlug||fixed.appSlug,fingerprint,importedAt:new Date().toISOString(),ciphertext:Buffer.from(sealed).toString('base64')};
      doc.accounts=doc.accounts.filter(x=>x.account!==fixed.account).concat(row);
      await save(doc);return publicRow(row);
    }catch(e){if(['STORE_WRITE_FAILED','UNSAFE_STORE','UNSAFE_STORE_ACL','WINDOWS_REQUIRED','SECURE_STORAGE_UNAVAILABLE','KEY_CHANGED_DURING_IMPORT'].includes(e.code))throw e;throw failure('KEY_IMPORT_FAILED');}
    finally {bytes?.fill(0);}
  }); }
  async function load(account) {
    metadata(account);await queue;const doc=await read();const row=doc.accounts.find(x=>x.account===account);
    if(!row)throw failure('ACCOUNT_NOT_CONNECTED');let plain;
    try {
      plain=await unprotect(Buffer.from(row.ciphertext,'base64'),entropy(account));
      const key=crypto.createPrivateKey(plain);
      if(key.asymmetricKeyType!=='rsa')throw Error();
      const fingerprint=crypto.createHash('sha256').update(crypto.createPublicKey(key).export({type:'spki',format:'der'})).digest('hex');
      if(fingerprint!==row.fingerprint)throw Error();
      return {...publicRow(row),privateKey:Buffer.from(plain).toString('utf8')};
    }catch(e){if(e.code==='SECURE_STORAGE_UNAVAILABLE')throw e;throw failure('KEY_UNAVAILABLE');}finally{plain?.fill(0);}
  }
  async function list(){await queue;return (await read()).accounts.map(publicRow);}
  return {importKey,load,list,paths:{root,file},backendName:linux?linux.backendName:'Windows DPAPI CurrentUser'};
}
const defaultStore=createStore();
module.exports={...defaultStore,createStore,metadata,APP_IDS,INSTALL_IDS};
