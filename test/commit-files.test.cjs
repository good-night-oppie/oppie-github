'use strict';
// #19 commit_files: one Git Data API commit with many changes, against an
// in-memory GitHub that applies base_tree semantics like the real API.
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createClient,ACCOUNTS}=require('../node/core.cjs');
const {CATALOG}=require('../node/repository-policy.cjs');
const {gitBlobSha,readLocalFile,MAX_LOCAL_FILE_BYTES}=require('../node/commit-files.cjs');
const {privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const PEM=privateKey.export({type:'pkcs8',format:'pem'});
const NOW=1800000000000;
const repos={total_count:6,repositories:Object.entries(CATALOG).map(([name,id])=>({id,name,full_name:'good-night-oppie/'+name}))};
const ROOT='/repos/good-night-oppie/MontClip';
const MSG='Change files\n\nAssisted-by: Cindy (https://cindy.app)';
const fakeSha=x=>crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex');

function makeGit(){
 const blobs=new Map(),trees=new Map(),commits=new Map(),refs=new Map();
 const putTree=entries=>{const sorted=[...entries].sort((a,b)=>a.path<b.path?-1:1);const sha=fakeSha(['tree',sorted]);trees.set(sha,sorted);return sha;};
 const putBlob=bytes=>{const sha=gitBlobSha(bytes);blobs.set(sha,bytes);return sha;};
 // Build a nested tree from {path: {sha,mode,type}}.
 const build=files=>{
  const top=new Map();
  for(const [p,e] of Object.entries(files)){const [head,...rest]=p.split('/');if(rest.length){if(!top.has(head))top.set(head,{dir:{}});top.get(head).dir[rest.join('/')]=e;}else top.set(head,e);}
  return putTree([...top].map(([name,e])=>e.dir?{path:name,mode:'040000',type:'tree',sha:build(e.dir)}:{path:name,...e}));
 };
 const flatten=(sha,prefix='')=>{const out={};for(const e of trees.get(sha)){const p=prefix+e.path;if(e.type==='tree')Object.assign(out,flatten(e.sha,p+'/'));else out[p]={mode:e.mode,type:e.type,sha:e.sha};}return out;};
 const commit=(tree,parents,message='seed')=>{const sha=fakeSha(['commit',tree,parents,message]);commits.set(sha,{sha,tree:{sha:tree},parents:parents.map(sha=>({sha})),message});return sha;};
 return {blobs,trees,commits,refs,putBlob,putTree,build,flatten,commit};
}

function seed(){
 const git=makeGit();
 const files={
  'README.md':{mode:'100644',type:'blob',sha:git.putBlob(Buffer.from('readme\n'))},
  'src/old.js':{mode:'100755',type:'blob',sha:git.putBlob(Buffer.from('#!/usr/bin/env node\n'))},
  'src/keep.js':{mode:'100644',type:'blob',sha:git.putBlob(Buffer.from('keep\n'))},
  'docs/gone.md':{mode:'100644',type:'blob',sha:git.putBlob(Buffer.from('gone\n'))},
  'vendor/lib':{mode:'160000',type:'commit',sha:'c'.repeat(40)},
 };
 const tree=git.build(files);
 const head=git.commit(tree,[]);
 git.refs.set('main',head);git.refs.set('feature/x',head);
 return {git,head};
}

function fixture(options={}){
 const {git,head}=options.seeded||seed();
 const account=ACCOUNTS[options.account||'deja'];
 const perms={contents:account.account==='qq'?'read':'write',issues:'write',pull_requests:'write',metadata:'read'};
 const calls=[];let counter=0;const tokenRepositories=new Map();
 const reply=(data,status=200)=>({ok:status>=200&&status<300,status,text:async()=>JSON.stringify(data)});
 const fetch=async(url,init)=>{
  const u=new URL(url),p=decodeURIComponent(u.pathname),body=init.body?JSON.parse(init.body):undefined;
  calls.push({path:p,method:init.method,body,signal:init.signal});
  if(options.override){const out=await options.override(p,init,body,git);if(out){if(out.throw)throw Error('network');return reply(out.data,out.status);}}
  if(p==='/app')return reply({id:account.app_id,slug:'oppie-agent-'+account.account,owner:{login:'good-night-oppie'},html_url:'https://github.com/apps/x'});
  if(p==='/app/installations/'+account.installation_id)return reply({id:account.installation_id,app_id:account.app_id,account:{login:'good-night-oppie',type:'Organization'},repository_selection:'selected',suspended_at:null,permissions:{...perms,...(account.admin?{administration:'write'}:{})}});
  if(p.endsWith('/access_tokens')){const t={token:'secret-token-'+(++counter),expires_at:new Date(NOW+3600000).toISOString(),permissions:{...perms,...(account.admin?{administration:'write'}:{})}};const ids=body.repository_ids;tokenRepositories.set('Bearer '+t.token,ids?{total_count:ids.length,repositories:repos.repositories.filter(r=>ids.includes(r.id))}:repos);return reply(t);}
  if(p==='/installation/repositories')return reply(tokenRepositories.get(init.headers.Authorization));
  if(p===ROOT)return reply({default_branch:'main'});
  if(p.startsWith(ROOT+'/git/ref/heads/')){const b=p.slice((ROOT+'/git/ref/heads/').length);return git.refs.has(b)?reply({ref:'refs/heads/'+b,object:{type:'commit',sha:git.refs.get(b)}}):reply({message:'Not Found'},404);}
  if(p.startsWith(ROOT+'/git/commits/')){const c=git.commits.get(p.split('/').pop());return c?reply(c):reply({},404);}
  if(p.startsWith(ROOT+'/git/trees/')&&init.method==='GET'){const sha=p.split('/').pop(),t=git.trees.get(sha);return t?reply({sha,tree:t,truncated:false}):reply({},404);}
  if(p===ROOT+'/git/blobs'&&init.method==='POST'){const bytes=Buffer.from(body.content,'base64');return reply({sha:git.putBlob(bytes)},201);}
  if(p===ROOT+'/git/trees'&&init.method==='POST'){
   const files=git.flatten(body.base_tree);
   for(const e of body.tree){
    if(e.sha===null){if(!files[e.path])return reply({message:'missing'},422);delete files[e.path];continue;}
    if(e.type==='blob'&&!git.blobs.has(e.sha))return reply({message:'bad blob'},422);
    files[e.path]={mode:e.mode,type:e.type,sha:e.sha};
   }
   return reply({sha:git.build(files)},201);
  }
  if(p===ROOT+'/git/commits'&&init.method==='POST'){const sha=git.commit(body.tree,body.parents,body.message);return reply(git.commits.get(sha),201);}
  if(p===ROOT+'/git/refs'&&init.method==='POST'){const b=body.ref.slice('refs/heads/'.length);if(git.refs.has(b))return reply({message:'exists'},422);git.refs.set(b,body.sha);return reply({ref:body.ref,object:{sha:body.sha,type:'commit'}},201);}
  if(p.startsWith(ROOT+'/git/refs/heads/')&&init.method==='PATCH'){
   const b=p.slice((ROOT+'/git/refs/heads/').length),cur=git.refs.get(b),next=git.commits.get(body.sha);
   if(!next||(!body.force&&next.parents[0]?.sha!==cur))return reply({message:'Update is not a fast forward'},422);
   git.refs.set(b,body.sha);return reply({ref:'refs/heads/'+b,object:{sha:body.sha,type:'commit'}});
  }
  return reply({message:'unexpected '+p},500);
 };
 let credentialsCalls=0;
 const client=createClient({credentials:async()=>{credentialsCalls++;return PEM;},fetch,now:()=>NOW,local:options.local});
 return {git,head,calls,client,credentialsCalls:()=>credentialsCalls,writes:()=>calls.filter(c=>c.method!=='GET'&&c.path.includes('/git/'))};
}
const run=(f,args,account='deja')=>f.client.run({account,repo:'MontClip',operation:'commit_files',args});
const base=(f,extra={})=>({branch:'feature/x',expected_head:f.head,message:MSG,...extra});
const b64=s=>Buffer.from(s).toString('base64');

test('several files, a delete, a rename and a gitlink land in exactly one fast-forward commit',async()=>{
 const f=fixture();
 const r=await run(f,base(f,{changes:[
  {path:'README.md',content_base64:b64('new readme\n')},
  {path:'src/added.txt',content_base64:b64('added\n')},
  {path:'docs/gone.md',delete:true},
  {path:'app/old.js',from:'src/old.js'},
  {path:'vendor/lib',gitlink_sha:'d'.repeat(40)},
 ]}));
 assert.equal(r.ok,true,JSON.stringify(r));
 const head=f.git.refs.get('feature/x');assert.equal(r.result.commit_sha,head);
 const c=f.git.commits.get(head);assert.deepEqual(c.parents,[{sha:f.head}]);assert.match(c.message,/Assisted-by:/);
 const files=f.git.flatten(c.tree.sha);
 assert.equal(f.git.blobs.get(files['README.md'].sha).toString(),'new readme\n');
 assert.equal(f.git.blobs.get(files['src/added.txt'].sha).toString(),'added\n');
 assert.equal(files['docs/gone.md'],undefined);
 assert.equal(files['src/old.js'],undefined);
 assert.equal(files['app/old.js'].mode,'100755','rename keeps the executable bit');
 assert.equal(f.git.blobs.get(files['app/old.js'].sha).toString(),'#!/usr/bin/env node\n');
 assert.deepEqual(files['vendor/lib'],{mode:'160000',type:'commit',sha:'d'.repeat(40)});
 assert.ok(files['src/keep.js'],'untouched files survive via base_tree');
 assert.equal(f.git.refs.get('main'),f.head,'default branch untouched');
 assert.equal(f.calls.filter(c=>c.method==='PATCH').length,1);
 assert.equal(f.calls.find(c=>c.method==='PATCH').body.force,false);
 assert.equal(r.receipt.url,'https://github.com/good-night-oppie/MontClip/commit/'+head);
});

test('a file larger than 2 MB uploads from a local file after its Git blob SHA is verified',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'commit-files-'));
 try{
  const big=crypto.randomBytes(3*1024*1024+17),file=path.join(dir,'big.bin');fs.writeFileSync(file,big);
  const f=fixture();
  const r=await run(f,base(f,{changes:[{path:'assets/big.bin',local_file:file,git_sha:gitBlobSha(big)}]}));
  assert.equal(r.ok,true,JSON.stringify(r));
  const files=f.git.flatten(f.git.commits.get(f.git.refs.get('feature/x')).tree.sha);
  assert.ok(f.git.blobs.get(files['assets/big.bin'].sha).equals(big));
  assert.ok(Buffer.byteLength(JSON.stringify({account:'deja',repo:'MontClip',operation:'commit_files',args:base(f,{changes:[{path:'assets/big.bin',local_file:file,git_sha:gitBlobSha(big)}]})}))<2048,'the request stays tiny');
  // Wrong SHA: nothing uploaded, nothing visible.
  const g=fixture();
  const bad=await run(g,base(g,{changes:[{path:'assets/big.bin',local_file:file,git_sha:'0'.repeat(40)}]}));
  assert.equal(bad.errorCode,'LOCAL_FILE_SHA_MISMATCH');assert.equal(bad.execution,'not_executed');
  assert.equal(g.calls.some(c=>c.path.endsWith('/git/blobs')),false);assert.equal(g.git.refs.get('feature/x'),g.head);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('local_file refuses symlinks, directories, oversized files and relative paths',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'commit-files-'));
 try{
  const real=path.join(dir,'real.txt');fs.writeFileSync(real,'x');
  await assert.rejects(readLocalFile(dir),{code:'LOCAL_FILE_NOT_REGULAR'});
  await assert.rejects(readLocalFile(real,0),{code:'LOCAL_FILE_TOO_LARGE'});
  await assert.rejects(readLocalFile(path.join(dir,'missing')),{code:'LOCAL_FILE_UNAVAILABLE'});
  let linked=false;try{fs.symlinkSync(real,path.join(dir,'link.txt'));linked=true;}catch(_){/* Windows without symlink privilege */}
  if(linked)await assert.rejects(readLocalFile(path.join(dir,'link.txt')),{code:'LOCAL_FILE_NOT_REGULAR'});
  const f=fixture();
  const rel=await run(f,base(f,{changes:[{path:'a',local_file:'relative/a',git_sha:'a'.repeat(40)}]}));
  assert.equal(rel.errorCode,'INVALID_LOCAL_FILE');assert.equal(f.credentialsCalls(),0);
  const huge=fixture({local:{stat:async()=>({regular:true,size:MAX_LOCAL_FILE_BYTES+1}),read:async()=>assert.fail('must not read')}});
  const r=await run(huge,base(huge,{changes:[{path:'a',local_file:real,git_sha:'a'.repeat(40)}]}));
  assert.equal(r.errorCode,'LOCAL_FILE_TOO_LARGE');assert.equal(huge.writes().length,0);
  const total=fixture({local:{stat:async()=>({regular:true,size:MAX_LOCAL_FILE_BYTES}),read:async()=>assert.fail('must not read')}});
  const t=await run(total,base(total,{changes:[1,2,3,4,5].map(i=>({path:'f'+i,local_file:real,git_sha:'a'.repeat(40)}))}));
  assert.equal(t.errorCode,'LOCAL_TOTAL_TOO_LARGE');assert.equal(total.writes().length,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('the default branch is refused before any Git object is created',async()=>{
 const f=fixture();
 const r=await run(f,{branch:'main',expected_head:f.head,message:MSG,changes:[{path:'README.md',content_base64:b64('x')}]});
 assert.equal(r.errorCode,'DEFAULT_BRANCH_WRITE_REFUSED');assert.equal(r.execution,'not_executed');
 assert.equal(f.calls.some(c=>c.path.includes('/git/')),false);assert.equal(f.git.refs.get('main'),f.head);
});

test('a stale expected_head is refused without writing anything',async()=>{
 const f=fixture();
 const r=await run(f,base(f,{expected_head:'e'.repeat(40),changes:[{path:'README.md',content_base64:b64('x')}]}));
 assert.equal(r.errorCode,'STALE_HEAD');assert.equal(r.execution,'not_executed');assert.equal(f.writes().length,0);assert.equal(f.git.refs.get('feature/x'),f.head);
});

test('a concurrent push between object creation and ref update is not overwritten',async()=>{
 const f=fixture({override:(p,init,body,git)=>{
  if(p===ROOT+'/git/commits'&&init.method==='POST'&&!git.raced){git.raced=true;const other=git.commit(git.commits.get(git.refs.get('feature/x')).tree.sha,[git.refs.get('feature/x')],'someone else');git.refs.set('feature/x',other);}
 }});
 const r=await run(f,base(f,{changes:[{path:'README.md',content_base64:b64('mine')}]}));
 assert.equal(r.ok,false);assert.equal(r.errorCode,'GITHUB_HTTP_422');assert.equal(r.execution,'not_executed');
 assert.notEqual(f.git.refs.get('feature/x'),f.head);assert.equal(f.git.commits.get(f.git.refs.get('feature/x')).message,'someone else');
 assert.equal(f.calls.filter(c=>c.method==='PATCH').length,1,'never retried');
});

test('expected_head null creates a new branch from parent and refuses an existing branch',async()=>{
 const f=fixture();
 const r=await run(f,{branch:'deja/284-rebased',expected_head:null,parent:f.head,message:MSG,changes:[{path:'README.md',content_base64:b64('rebased')}]});
 assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.result.created_branch,true);
 assert.equal(f.git.commits.get(f.git.refs.get('deja/284-rebased')).parents[0].sha,f.head);
 const again=await run(f,{branch:'deja/284-rebased',expected_head:null,parent:f.head,message:MSG,changes:[{path:'README.md',content_base64:b64('again')}]});
 assert.equal(again.errorCode,'BRANCH_EXISTS');assert.equal(again.execution,'not_executed');
 const missing=await run(f,{branch:'x/y',expected_head:null,message:MSG,changes:[{path:'a',content_base64:b64('a')}]});
 assert.equal(missing.errorCode,'PARENT_REQUIRED');
});

test('force update is held closed pending QQ and a rewrite without force is refused',async()=>{
 const f=fixture();
 for(const [extra,code] of [[{parent:'b'.repeat(40)},'FORCE_REQUIRED'],[{parent:'b'.repeat(40),force:true},'FORCE_UPDATE_DISABLED'],[{force:true},'FORCE_UPDATE_DISABLED']]){
  const r=await run(f,base(f,{...extra,changes:[{path:'README.md',content_base64:b64('x')}]}));
  assert.equal(r.errorCode,code);assert.equal(r.execution,'not_executed');
 }
 assert.equal(f.credentialsCalls(),0);assert.equal(f.calls.length,0);
});

test('bad change lists are refused before credentials',async()=>{
 const f=fixture();
 const cases=[
  [{message:'no trailer',changes:[{path:'a',content_base64:b64('a')}]},'ASSISTED_BY_REQUIRED'],
  [{changes:[]},'INVALID_CHANGES'],
  [{changes:[{path:'a',content_base64:b64('a'),blob_sha:'a'.repeat(40)}]},'INVALID_CHANGE_SOURCE'],
  [{changes:[{path:'a'}]},'INVALID_CHANGE_SOURCE'],
  [{changes:[{path:'a',delete:false}]},'INVALID_CHANGE_SOURCE'],
  [{changes:[{path:'a',content_base64:b64('a')},{path:'a',delete:true}]},'DUPLICATE_PATH'],
  [{changes:[{path:'a',from:'b'},{path:'b',delete:true}]},'DUPLICATE_PATH'],
  [{changes:[{path:'a',content_base64:b64('a')},{path:'a/b',content_base64:b64('b')}]},'PATH_CONFLICT'],
  [{changes:[{path:'a',content_base64:b64('a'),mode:'120000'}]},'INVALID_MODE'],
  [{changes:[{path:'a',gitlink_sha:'a'.repeat(40),mode:'100644'}]},'INVALID_MODE'],
  [{changes:[{path:'../a',content_base64:b64('a')}]},'INVALID_PATH'],
  [{changes:[{path:'a',content_base64:'!!'}]},'INVALID_CONTENT'],
  [{changes:[{path:'a',content_base64:b64('a'),extra:1}]},'INVALID_ARGUMENTS'],
  [{changes:Array.from({length:501},(_,i)=>({path:'f'+i,delete:true}))},'INVALID_CHANGES'],
 ];
 for(const [extra,code] of cases){const r=await run(f,base(f,extra));assert.equal(r.errorCode,code,JSON.stringify(extra).slice(0,80));assert.equal(r.execution,'not_executed');}
 assert.equal(f.credentialsCalls(),0);
});

test('deleting or renaming a missing path, or renaming onto an existing file, writes nothing',async()=>{
 for(const [change,code] of [[{path:'nope.md',delete:true},'DELETE_TARGET_MISSING'],[{path:'src',delete:true},'DELETE_TARGET_MISSING'],[{path:'x.js',from:'src/nope.js'},'RENAME_SOURCE_MISSING'],[{path:'src/keep.js',from:'src/old.js'},'RENAME_TARGET_EXISTS']]){
  const f=fixture();const r=await run(f,base(f,{changes:[change]}));
  assert.equal(r.errorCode,code);assert.equal(r.execution,'not_executed');assert.equal(f.writes().length,0);
 }
});

test('an unchanged tree is refused instead of creating an empty commit',async()=>{
 const f=fixture();
 const r=await run(f,base(f,{changes:[{path:'README.md',content_base64:b64('readme\n')}]}));
 assert.equal(r.errorCode,'NO_CHANGES');assert.equal(r.execution,'not_executed');assert.equal(f.calls.some(c=>c.method==='PATCH'),false);
});

test('a blob SHA that GitHub disagrees with stops before the tree',async()=>{
 const f=fixture({override:(p,init)=>p===ROOT+'/git/blobs'?{status:201,data:{sha:'f'.repeat(40)}}:null});
 const r=await run(f,base(f,{changes:[{path:'a',content_base64:b64('a')}]}));
 assert.equal(r.errorCode,'BLOB_SHA_MISMATCH');assert.equal(r.execution,'not_executed');assert.equal(f.calls.some(c=>c.path===ROOT+'/git/trees'),false);
});

test('uncertain object writes before the ref update stay not_executed',async()=>{
 for(const failing of ['/git/blobs','/git/trees','/git/commits']){
  const f=fixture({override:(p,init)=>p===ROOT+failing&&init.method==='POST'?{throw:true}:null});
  const r=await run(f,base(f,{changes:[{path:'a',content_base64:b64('a')}]}));
  assert.equal(r.ok,false);assert.equal(r.execution,'not_executed');assert.equal(r.errorCode,'OBJECT_WRITE_FAILED');assert.equal(f.git.refs.get('feature/x'),f.head);
 }
});

test('an uncertain ref update is read back once and never retried',async()=>{
 // Landed despite a dropped response: success with readback.
 const landed=fixture({override:(p,init,body,git)=>{if(init.method==='PATCH'){git.refs.set('feature/x',body.sha);return {throw:true};}}});
 const a=await run(landed,base(landed,{changes:[{path:'a',content_base64:b64('a')}]}));
 assert.equal(a.ok,true,JSON.stringify(a));assert.equal(a.result.readback,true);assert.equal(landed.calls.filter(c=>c.method==='PATCH').length,1);
 // Did not land: not_executed.
 const lost=fixture({override:(p,init)=>init.method==='PATCH'?{throw:true}:null});
 const b=await run(lost,base(lost,{changes:[{path:'a',content_base64:b64('a')}]}));
 assert.equal(b.ok,false);assert.equal(b.execution,'not_executed');assert.equal(lost.calls.filter(c=>c.method==='PATCH').length,1);
 // Read-back unavailable: unknown.
 let patched=false;
 const dark=fixture({override:(p,init)=>{if(init.method==='PATCH'){patched=true;return {throw:true};}if(patched&&p.includes('/git/ref/'))return {throw:true};}});
 const c=await run(dark,base(dark,{changes:[{path:'a',content_base64:b64('a')}]}));
 assert.equal(c.ok,false);assert.equal(c.execution,'unknown');assert.equal(dark.calls.filter(x=>x.method==='PATCH').length,1);
});

test('QQ and ReviewInbox cannot author commits; other teammates can',async()=>{
 for(const account of Object.keys(ACCOUNTS)){
  const f=fixture({account});
  const r=await run(f,base(f,{changes:[{path:'a',content_base64:b64('a')}]}),account);
  if(['qq','reviewinbox'].includes(account)){assert.equal(r.ok,false,account);assert.equal(f.credentialsCalls(),0);}
  else assert.equal(r.ok,true,account+JSON.stringify(r));
 }
});

test('commit_files is advertised and treated as a write by the host bridge',()=>{
 const operations=require('../node/operations.cjs');
 assert.match(operations.commit_files,/expected_head/);
 const main=fs.readFileSync(path.join(__dirname,'..','main.js'),'utf8');
 assert.equal(/READ_ONLY_OPERATIONS=new Set\([^)]*commit_files/.test(main),false);
});
