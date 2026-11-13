'use strict';
// #19: one commit with many changes through the Git Data API. Every step before
// the final ref update only creates unreferenced objects, so failures there are
// not_executed. The ref update is the single visible write and is read back
// when its outcome is uncertain; it is never retried automatically.
const crypto=require('node:crypto');
const MAX_CHANGES=500;
const BLOB_UPLOAD_TIMEOUT_MS=110000;
// QQ decision on #19: force updates are never allowed. Only fast-forward
// updates from the checked expected_head; anything else is NOT_FAST_FORWARD.
const MODES=['100644','100755'];
const SOURCES=['content_base64','blob_sha','local_file','from','delete','gitlink_sha'];
const BASE64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const HEX40=/^[a-f0-9]{40}$/i;
function gitBlobSha(bytes){return crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');}
function assistedBy(message){return /^Assisted-by: \S.*$/m.test(message);}
// Validation is pure: it runs before credentials are read or a token is minted.
function validateCommitFiles(args,h){
 const {bad,exact,nonempty,sha,ref,filePath}=h;
 exact(args,['branch','expected_head','parent','merge_parent','message','changes']);
 const branch=ref(args.branch);
 if(!Object.hasOwn(args,'expected_head')||(args.expected_head!==null&&(typeof args.expected_head!=='string'||!HEX40.test(args.expected_head))))bad('INVALID_EXPECTED_HEAD');
 const expectedHead=args.expected_head===null?null:args.expected_head.toLowerCase();
 if(args.parent!==undefined)sha(args.parent);
 const parent=args.parent===undefined?expectedHead:args.parent.toLowerCase();
 if(!parent)bad('PARENT_REQUIRED');
 const message=nonempty(args.message,10000);
 if(!assistedBy(message))bad('ASSISTED_BY_REQUIRED');
 // An existing branch only moves forward: the new commit's first parent is its current head.
 if(expectedHead!==null&&parent!==expectedHead)bad('NOT_FAST_FORWARD');
 // A merge commit (e.g. bringing a new main into a feature branch) keeps the branch
 // head as first parent, so it is still a fast-forward and rewrites no history.
 let mergeParent=null;
 if(args.merge_parent!==undefined){if(expectedHead===null)bad('MERGE_PARENT_REQUIRES_EXISTING_BRANCH');mergeParent=sha(args.merge_parent).toLowerCase();if(mergeParent===parent)bad('INVALID_MERGE_PARENT');}
 if(!Array.isArray(args.changes)||!args.changes.length||args.changes.length>MAX_CHANGES)bad('INVALID_CHANGES');
 const changes=[],touched=new Set();
 const claim=p=>{filePath(p);if(touched.has(p))bad('DUPLICATE_PATH');touched.add(p);return p;};
 for(const c of args.changes){
  exact(c,['path',...SOURCES,'git_sha','mode']);
  const sources=SOURCES.filter(k=>c[k]!==undefined);
  if(sources.length!==1)bad('INVALID_CHANGE_SOURCE');
  const kind=sources[0];
  // QQ review on #20: reading local files is not part of this release. Large files
  // are pushed as blobs through another channel first and referenced with blob_sha.
  if(kind==='local_file')bad('LOCAL_FILE_DISABLED');
  if(c.git_sha!==undefined&&kind!=='local_file')bad('INVALID_CHANGE_SOURCE');
  if(c.mode!==undefined&&(!MODES.includes(c.mode)||['delete','gitlink_sha'].includes(kind)))bad('INVALID_MODE');
  const out={kind,path:claim(c.path),mode:c.mode};
  if(kind==='content_base64'){if(typeof c.content_base64!=='string'||!BASE64.test(c.content_base64))bad('INVALID_CONTENT');out.bytes=Buffer.from(c.content_base64,'base64');out.sha=gitBlobSha(out.bytes);}
  else if(kind==='blob_sha')out.sha=sha(c.blob_sha).toLowerCase();
  else if(kind==='gitlink_sha')out.sha=sha(c.gitlink_sha).toLowerCase();
  else if(kind==='delete'){if(c.delete!==true)bad('INVALID_CHANGE_SOURCE');}
  else if(kind==='from'){out.from=claim(c.from);}
  changes.push(out);
 }
 // A path cannot be both a file and the directory of another changed path.
 for(const p of touched)for(let i=p.indexOf('/');i>0;i=p.indexOf('/',i+1))if(touched.has(p.slice(0,i)))bad('PATH_CONFLICT');
 return {branch,expectedHead,parent,mergeParent,message,changes};
}
function encodeRef(branch){return branch.split('/').map(encodeURIComponent).join('/');}
async function commitFiles(ctx){
 let prepared;
 // Objects created before the ref update are unreferenced: any failure there,
 // including an uncertain object POST, leaves the visible repository unchanged.
 try{prepared=await prepare(ctx);}
 catch(e){if(e instanceof ctx.CoreError&&e.execution!=='not_executed')throw new ctx.CoreError(e.code==='WRITE_OUTCOME_UNKNOWN'?'OBJECT_WRITE_FAILED':e.code,'not_executed',e.status);throw e;}
 return updateRef(ctx,prepared);
}
async function prepare({plan,api,root,token,bad}){
 const {branch,expectedHead,parent,mergeParent,message,changes}=plan;
 // 2. Branch state must match expected_head exactly.
 const refRoute=root+'/git/ref/heads/'+encodeRef(branch);
 const readRef=async()=>{try{const r=await api(refRoute,token);if(r?.ref!=='refs/heads/'+branch||r?.object?.type!=='commit'||!HEX40.test(r?.object?.sha||''))bad('INVALID_REF_RESPONSE');return r.object.sha.toLowerCase();}catch(e){if(e.status===404)return null;throw e;}};
 const current=await readRef();
 if(expectedHead===null&&current!==null)bad('BRANCH_EXISTS');
 if(expectedHead!==null&&current!==expectedHead)bad('STALE_HEAD');
 // 3. Parent commit and its tree.
 const parentCommit=await api(root+'/git/commits/'+parent,token);
 if(parentCommit?.sha?.toLowerCase()!==parent||!HEX40.test(parentCommit?.tree?.sha||''))bad('INVALID_PARENT');
 const baseTree=parentCommit.tree.sha.toLowerCase();
 if(mergeParent){const mp=await api(root+'/git/commits/'+mergeParent,token);if(mp?.sha?.toLowerCase()!==mergeParent)bad('INVALID_MERGE_PARENT');}
 const parents=mergeParent?[parent,mergeParent]:[parent];
 const trees=new Map();
 const listTree=async treeSha=>{if(!trees.has(treeSha)){const t=await api(root+'/git/trees/'+treeSha,token);if(t?.sha?.toLowerCase()!==treeSha||!Array.isArray(t.tree))bad('INVALID_TREE_RESPONSE');if(t.truncated)bad('TREE_TRUNCATED');trees.set(treeSha,t.tree);}return trees.get(treeSha);};
 const lookup=async p=>{let treeSha=baseTree,entry;const parts=p.split('/');for(let i=0;i<parts.length;i++){entry=(await listTree(treeSha)).find(e=>e?.path===parts[i]);if(!entry)return null;if(i<parts.length-1){if(entry.type!=='tree')return null;treeSha=String(entry.sha).toLowerCase();}}return entry;};
 // 4. Resolve deletes and renames against the parent tree.
 const entries=[];
 for(const c of changes){
  if(c.kind==='delete'){const e=await lookup(c.path);if(!e||!['blob','commit'].includes(e.type))bad('DELETE_TARGET_MISSING');entries.push({path:c.path,mode:e.mode,type:e.type,sha:null});}
  else if(c.kind==='from'){
   const e=await lookup(c.from);if(!e||!['blob','commit'].includes(e.type)||!HEX40.test(e.sha||''))bad('RENAME_SOURCE_MISSING');
   if(await lookup(c.path))bad('RENAME_TARGET_EXISTS');
   if(c.mode&&e.type!=='blob')bad('INVALID_MODE');
   entries.push({path:c.from,mode:e.mode,type:e.type,sha:null},{path:c.path,mode:c.mode||e.mode,type:e.type,sha:e.sha.toLowerCase()});
  }
  else if(c.kind==='gitlink_sha')entries.push({path:c.path,mode:'160000',type:'commit',sha:c.sha});
 }
 // 5. Blobs: inline content is uploaded and verified by Git object ID.
 const upload=async(bytes,expected)=>{
  const created=await api(root+'/git/blobs',token,'POST',{content:bytes.toString('base64'),encoding:'base64'},undefined,BLOB_UPLOAD_TIMEOUT_MS);
  if(created?.sha?.toLowerCase()!==expected)bad('BLOB_SHA_MISMATCH');
 };
 for(const c of changes){
  if(c.kind==='content_base64'){await upload(c.bytes,c.sha);entries.push({path:c.path,mode:c.mode||'100644',type:'blob',sha:c.sha});}
  else if(c.kind==='blob_sha')entries.push({path:c.path,mode:c.mode||'100644',type:'blob',sha:c.sha});
 }
 // 6. Tree and commit. Unchanged trees are refused instead of creating empty commits.
 const tree=await api(root+'/git/trees',token,'POST',{base_tree:baseTree,tree:entries});
 const treeSha=String(tree?.sha||'').toLowerCase();if(!HEX40.test(treeSha))bad('INVALID_TREE_RESPONSE');
 // A merge may legitimately keep the first parent's tree; a plain commit may not.
 if(treeSha===baseTree&&!mergeParent)bad('NO_CHANGES');
 const commit=await api(root+'/git/commits',token,'POST',{message,tree:treeSha,parents});
 const commitSha=String(commit?.sha||'').toLowerCase();
 if(!HEX40.test(commitSha)||commit?.tree?.sha?.toLowerCase()!==treeSha||commit?.parents?.length!==parents.length||parents.some((p,i)=>commit.parents[i]?.sha?.toLowerCase()!==p))bad('INVALID_COMMIT_RESPONSE');
 return {commitSha,treeSha,readRef};
}
async function updateRef({plan,api,root,token,repoUrl,CoreError},{commitSha,treeSha,readRef}){
 const {branch,expectedHead,parent,mergeParent,changes}=plan;
 // 7. The only visible write. Fast-forward only; force is never sent.
 const result={branch,commit_sha:commitSha,tree_sha:treeSha,parent,merge_parent:mergeParent,previous_head:expectedHead,created_branch:expectedHead===null,changes:changes.length,html_url:repoUrl+'/commit/'+commitSha};
 try{
  if(expectedHead===null)await api(root+'/git/refs',token,'POST',{ref:'refs/heads/'+branch,sha:commitSha});
  else await api(root+'/git/refs/heads/'+encodeRef(branch),token,'PATCH',{sha:commitSha,force:false});
 }catch(e){
  if(!(e instanceof CoreError))throw e;
  // A definite 4xx rejection wrote nothing. GitHub answers 422 when the branch
  // moved meanwhile and the update would not be a fast-forward.
  if(e.execution==='not_executed'){if(expectedHead!==null&&e.status===422)throw new CoreError('NOT_FAST_FORWARD','not_executed',e.status);throw e;}
  let after;try{after=await readRef();}catch(_){throw new CoreError(e.code,'unknown',e.status,{readback:'unavailable'});}
  if(after===commitSha)return {...result,readback:true};
  if(after===expectedHead)throw new CoreError(e.code,'not_executed',e.status,{readback:{head:after}});
  throw new CoreError(e.code,'unknown',e.status,{readback:{head:after}});
 }
 return result;
}
module.exports={validateCommitFiles,commitFiles,gitBlobSha,MAX_CHANGES};
