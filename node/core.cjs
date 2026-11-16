'use strict';
const crypto = require('node:crypto');
const {validateProof}=require('./owner-authorization.cjs');
const {validateEdits,applyEdits,MAX_FILE_BYTES}=require('./file-edit.cjs');
const commitFilesModule=require('./commit-files.cjs');
const MAX_OPERATION_BYTES=261120; // Reserve 1 KiB below the host limit for the RPC envelope.
const MAX_INSTALLATION_PAGES=10; // 1000 repositories; a larger listing fails closed as incomplete.
const OWNER = 'good-night-oppie';
const {DEFAULT_CONFIG}=require('./scope-config.cjs');
const REPOSITORIES = Object.freeze({MontClip:1441621868, 'MontClip-Cindy':1446532339});
const APP_NAMES=Object.freeze({bb:'BBOppieXYZ',cindy:'CindyOppieXYZ',deja:'DejaOppieXYZ',dd:'DDOppieXYZ',gg:'GGOppieXYZ',jj:'JJOppieXYZ',pg:'PGOppieXYZ',qq:'QQOppieXYZ',rea:'ReaOppieXYZ',video:'VideoOppieXYZ',vv:'VVOppieXYZ',reviewinbox:'ReviewInboxOppieXYZ'});
const ACCOUNTS = Object.freeze(Object.fromEntries([
 ['bb',5665927,179806310],['cindy',5665939,179806330],['deja',5665940,179806356],
 ['dd',5665941,179806387],['gg',5665942,179806414],['jj',5665943,179806445],
 ['pg',5665944,179806482],['qq',5665946,179806512],['rea',5665948,179806534],
 ['video',5665949,179806582],['vv',5665951,179806217],['reviewinbox',5687106,180305629],
].map(([account,app_id,installation_id])=>[account,Object.freeze({account,app_id,installation_id,
 app_name:APP_NAMES[account],app_slug:APP_NAMES[account].toLowerCase(),app_slug_status:'expected_not_live',
 allowed_slugs:Object.freeze(account==='reviewinbox'?['reviewinboxoppiexyz']:['oppie-agent-'+account,APP_NAMES[account].toLowerCase()])})])));
// Owner decision 2026-11-16 (oppie-github#8): what an account can do and which repositories it can
// use follow its GitHub App installation, not lists in this plugin. Accounts added in the settings
// page carry only their App identity (App ID pinned, name, slug); the installation is looked up on
// GitHub on every call and must belong to good-night-oppie. Compiled accounts keep their pins.
function configuredAccount(name,config=DEFAULT_CONFIG){
 if(typeof name!=='string'||!config.accounts.includes(name))return null;
 if(Object.hasOwn(ACCOUNTS,name))return ACCOUNTS[name];
 const a=Object.hasOwn(config.newAccounts,name)?config.newAccounts[name]:null;if(!a)return null;
 const slug=a.appSlug||a.appName.toLowerCase();
 return Object.freeze({account:name,app_id:a.appId,installation_id:null,app_name:a.appName,app_slug:slug,app_slug_status:'expected_not_live',allowed_slugs:Object.freeze([...new Set([slug,'oppie-agent-'+name])]),configured:true});
}
function allowedAppSlug(account,slug){return typeof slug==='string'&&Object.hasOwn(ACCOUNTS,account)&&ACCOUNTS[account].allowed_slugs.includes(slug);}
function knownBotLogin(account,login){return typeof login==='string'&&Object.hasOwn(ACCOUNTS,account)&&ACCOUNTS[account].allowed_slugs.some(slug=>login===slug+'[bot]');}
// Least permissions each operation needs on its execution token (metadata:read is always included).
// The installation must hold at least these; the token is requested with exactly these.
const OPERATION_NEEDS=Object.freeze({
 identity:{},get_contents:{contents:'read'},list_branches:{contents:'read'},
 list_issues:{issues:'read'},get_issue:{issues:'read'},create_issue:{issues:'write'},update_issue:{issues:'write'},comment_issue:{issues:'write'},
 list_pulls:{pull_requests:'read'},get_pull:{pull_requests:'read'},pull_files:{pull_requests:'read'},list_reviews:{pull_requests:'read'},
 create_pull:{contents:'read',pull_requests:'write'},update_pull:{pull_requests:'write'},submit_review:{pull_requests:'write'},dismiss_review:{pull_requests:'write'},
 create_branch:{contents:'write'},update_file:{contents:'write'},edit_file:{contents:'write'},commit_files:{contents:'write'},
 enqueue_pull:{contents:'write',pull_requests:'write'},
 list_rulesets:{administration:'read'},get_ruleset:{administration:'read'},ruleset_update:{administration:'write',issues:'read'},
 admin_get:{administration:'read'},admin_update:{administration:'write'},
});
const OPERATION_NAMES = Object.freeze(Object.keys(OPERATION_NEEDS));
class CoreError extends Error { constructor(code,execution='not_executed',status,details){super(code);this.code=code;this.execution=execution;if(status)this.status=status;if(details)this.details=details;} }
function bad(code='INVALID_ARGUMENTS'){throw new CoreError(code);}
function configDigest(c){return crypto.createHash('sha256').update(JSON.stringify(c)).digest('hex').slice(0,16);}
function obj(x){return !!x&&typeof x==='object'&&!Array.isArray(x);}
function exact(x,keys){if(!obj(x)||Object.keys(x).some(k=>!keys.includes(k)))bad();}
function str(x,max=10000){if(typeof x!=='string'||x.length>max||x.includes('\0'))bad();return x;}
function nonempty(x,max=200){if(!str(x,max).trim())bad();return x;}
function positive(x){if(!Number.isSafeInteger(x)||x<1)bad();return x;}
function sha(x){if(typeof x!=='string'||! /^[a-f0-9]{40}$/i.test(x))bad();return x;}
function ref(x){nonempty(x,200);if(/[\s~^:?*\[\\%\x00-\x1f]/.test(x)||x.includes('..')||x.includes('@{')||x.includes('//')||x.startsWith('/')||x.endsWith('/')||x.endsWith('.')||x.split('/').some(s=>s.startsWith('.')||s.endsWith('.lock')))bad('INVALID_REF');return x;}
function filePath(x,empty=false){str(x,1000);if(!x&&empty)return '';if(!x||x.startsWith('/')||/[\\%?#\x00-\x1f]/.test(x)||x.split('/').some(s=>!s||s==='.'||s==='..'))bad('INVALID_PATH');return x.split('/').map(encodeURIComponent).join('/');}
// Any repository of the owner organisation; whether the App can use it is decided by its installation.
function repoName(x){if(typeof x!=='string')bad('REPOSITORY_REQUIRED');const n=x.startsWith(OWNER+'/')?x.slice(OWNER.length+1):x;if(!/^[A-Za-z0-9._-]{1,100}$/.test(n)||n==='.'||n==='..')bad('REPOSITORY_NOT_ALLOWED');return n;}
function permissions(operation){return {metadata:'read',...OPERATION_NEEDS[operation]};}
// GitHub refuses App changes under .github/workflows/ unless the token holds workflows:write.
// Only file writes that touch such a path ask for it; nothing else ever does.
const WORKFLOW_DIR='.github/workflows/';
function workflowPaths(preflight){
 const paths=['file','edit'].includes(preflight?.kind)?[preflight.path]:preflight?.kind==='commit'?preflight.plan.changes.flatMap(c=>c.from?[c.from,c.path]:[c.path]):[];
 return paths.filter(p=>p.startsWith(WORKFLOW_DIR));
}
const PERMISSION_RANK=Object.freeze({none:0,read:1,write:2});
// Levels the installation lacks for these needs (an installation may hold more than needed).
function missingPermissions(actual,needed){
 const level=k=>obj(actual)&&typeof actual[k]==='string'&&Object.hasOwn(PERMISSION_RANK,actual[k])?actual[k]:'none';
 return Object.entries(needed).filter(([k,v])=>PERMISSION_RANK[level(k)]<PERMISSION_RANK[v]).map(([permission,required])=>({permission,required,installed:level(permission)}));
}
// Installation: only an installation that lacks something this operation needs fails, and the
// error says what is missing and where the owner adds it. Extra installation permissions are fine.
function checkInstallation(actual,a,operation,installationId,needed=permissions(operation),workflowFiles=[]){
 const missing=missingPermissions(actual,needed);if(!missing.length)return;
 const appPermissionsUrl='https://github.com/organizations/'+OWNER+'/settings/apps/'+a.app_slug+'/permissions',installationUrl='https://github.com/organizations/'+OWNER+'/settings/installations/'+installationId;
 throw new CoreError('INSTALLATION_PERMISSION_MISSING','not_executed',undefined,{account:a.account,app:a.app_name,operation,missing,...(workflowFiles.length?{workflowFiles:workflowFiles.slice(0,10)}:{}),appPermissionsUrl,installationUrl,
  fix:'Add '+missing.map(m=>m.permission+':'+m.required+' (installed: '+m.installed+')').join(', ')+' in the App permissions ('+appPermissionsUrl+') and accept the update on the installation page ('+installationUrl+').'});
}
// Execution token: exactly what was requested for this operation (nothing extra, nothing stronger,
// nothing missing). The installation may hold more; the token never does.
function checkTokenPermissions(actual,requested){
 const granted=obj(actual)?Object.fromEntries(Object.entries(actual).filter(([,v])=>v!=='none')):null;
 if(!granted||Object.keys(granted).length!==Object.keys(requested).length||Object.entries(requested).some(([k,v])=>granted[k]!==v))
  throw new CoreError('TOKEN_PERMISSION_MISMATCH','not_executed',undefined,{requested,granted:granted?Object.fromEntries(Object.entries(granted).filter(([k,v])=>/^[a-z_]{1,40}$/.test(k)&&typeof v==='string').slice(0,60)):null});
}
function makeJwt(account,pem,now=Date.now()){
 const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
 const t=Math.floor(now/1000);const p=Buffer.from(JSON.stringify({iat:t-60,exp:t+480,iss:String(account.app_id)})).toString('base64url');
 try {const key=crypto.createPrivateKey(pem);if(key.asymmetricKeyType!=='rsa')bad('INVALID_PRIVATE_KEY');return h+'.'+p+'.'+crypto.sign('RSA-SHA256',Buffer.from(h+'.'+p),key).toString('base64url');}
 catch(_){bad('INVALID_PRIVATE_KEY');}
}
function listQuery(a,extra=[]){exact(a,['page','per_page',...extra]);const q=new URLSearchParams({page:String(a.page===undefined?1:positive(a.page)),per_page:String(a.per_page===undefined?30:positive(a.per_page))});if(Number(q.get('per_page'))>100)bad();return q;}
function labels(value){if(!Array.isArray(value)||value.length>30)bad();return value.map(x=>nonempty(x,100));}
function clean(value,secrets){if(typeof value==='string'){for(const secret of secrets)if(secret)value=value.split(secret).join('[REDACTED]');return value;}if(Array.isArray(value))return value.map(x=>clean(x,secrets));if(obj(value))return Object.fromEntries(Object.entries(value).filter(([k])=>!['token','access_token','private_key','authorization'].includes(k.toLowerCase())).map(([k,v])=>[k,clean(v,secrets)]));return value;}
// enqueue_pull (#16): GraphQL reports failures as HTTP 200 + errors[]. Keep a
// bounded, credential-free copy and classify it; never echo raw response objects.
const QUEUE_STATE_QUERY='query($id:ID!){node(id:$id){... on PullRequest{isInMergeQueue headRefOid mergeQueueEntry{id state}}}}';
function graphqlErrors(errors){return (Array.isArray(errors)?errors:[]).slice(0,5).map(e=>({type:typeof e?.type==='string'?e.type.slice(0,60):null,message:typeof e?.message==='string'?e.message.slice(0,300):null,path:Array.isArray(e?.path)?e.path.slice(0,5).map(String):null}));}
function classifyQueueErrors(list){
 const text=list.map(e=>(e.type||'')+' '+(e.message||'')).join(' | ');
 if(list.some(e=>e.type==='FORBIDDEN')||/not accessible by integration|must have (?:write|push|admin)|permission|forbidden/i.test(text))return 'QUEUE_PERMISSION_DENIED';
 if(/already (?:queued|enqueued|in (?:the )?merge queue)/i.test(text))return 'ALREADY_IN_MERGE_QUEUE';
 if(/head (?:oid|sha|ref|commit)|expected ?head|expectedHeadOid/i.test(text))return 'QUEUE_HEAD_MISMATCH';
 return 'QUEUE_REJECTED';
}
function createClient({credentials,fetch:fetcher=globalThis.fetch,now=Date.now,authorize=async()=>false,claimAuthorization=async()=>false,scopeConfig=()=>DEFAULT_CONFIG}={}){
 if(typeof credentials!=='function'||typeof fetcher!=='function')throw Error('DEPENDENCY_REQUIRED');
 async function run(input){
  let secrets=[],scopeDiagnostics;
  try{
   if(Buffer.byteLength(JSON.stringify(input??null),'utf8')>MAX_OPERATION_BYTES)bad('REQUEST_TOO_LARGE');
   exact(input,['account','repo','operation','args']);
   let config;try{config=await scopeConfig();}catch(_){bad('INVALID_SCOPE_CONFIGURATION');}
   const account=configuredAccount(input.account,config);if(!account)bad('ACCOUNT_REQUIRED');const operation=input.operation;
   if(!OPERATION_NAMES.includes(operation))bad('UNKNOWN_OPERATION');
   // Owner 2026-11-16: no role, operation or repository list in the plugin. Any repository of the
   // organisation may be named; the installation decides below, before any execution token.
   // identity without repo reports the whole installation (used by the settings page before saving a key).
   const repo=input.repo===undefined&&operation==='identity'?null:repoName(input.repo);const args=input.args===undefined?{}:input.args;if(!obj(args))bad();
   const root='/repos/'+OWNER+'/'+repo;
   // Validate the entire operation before reading a private key or obtaining a token.
   let method='GET',route,body,preflight;
   const number=()=>positive(args.number);
   const issuePayload=(creating)=>{exact(args,creating?['title','body','labels']:['number','title','body','labels','state']);const v={};if(creating||args.title!==undefined)v.title=nonempty(args.title,256);if(args.body!==undefined)v.body=str(args.body,65000);if(args.labels!==undefined)v.labels=labels(args.labels);if(args.state!==undefined){if(!['open','closed'].includes(args.state))bad();v.state=args.state;}if(!Object.keys(v).length)bad();return v;};
   switch(operation){
    case 'identity':exact(args,[]);break;
    case 'get_contents':exact(args,['path','ref']);route=root+'/contents/'+filePath(args.path??'',true)+(args.ref?'?ref='+encodeURIComponent(ref(args.ref)):'');break;
    case 'list_branches':route=root+'/branches?'+listQuery(args);break;
    case 'list_issues':case 'list_pulls':{const q=listQuery(args,['state']);if(args.state!==undefined){if(!['open','closed','all'].includes(args.state))bad();q.set('state',args.state);}route=root+(operation==='list_issues'?'/issues?':'/pulls?')+q;break;}
    case 'get_issue':exact(args,['number']);route=root+'/issues/'+number();break;
    case 'create_issue':body=issuePayload(true);method='POST';route=root+'/issues';break;
    case 'update_issue':body=issuePayload(false);method='PATCH';route=root+'/issues/'+number();break;
    case 'comment_issue':exact(args,['number','body']);body={body:nonempty(args.body,65000)};method='POST';route=root+'/issues/'+number()+'/comments';break;
    case 'get_pull':exact(args,['number']);route=root+'/pulls/'+number();break;
    case 'pull_files':case 'list_reviews':{const q=listQuery(args,['number']);route=root+'/pulls/'+number()+(operation==='pull_files'?'/files?':'/reviews?')+q;break;}
    case 'create_pull':exact(args,['title','body','head','base','draft']);body={title:nonempty(args.title,256),body:str(args.body??'',65000),head:ref(args.head),base:ref(args.base),draft:args.draft===undefined?true:args.draft};if(typeof body.draft!=='boolean'||body.head===body.base)bad();method='POST';route=root+'/pulls';break;
    case 'update_pull':exact(args,['number','title','body','state']);body={};if(args.title!==undefined)body.title=nonempty(args.title,256);if(args.body!==undefined)body.body=str(args.body,65000);if(args.state!==undefined){if(!['open','closed'].includes(args.state))bad();body.state=args.state;}if(!Object.keys(body).length)bad();method='PATCH';route=root+'/pulls/'+number();break;
    case 'submit_review':{
     exact(args,['number','commit_id','event','body','comments']);if(!['COMMENT','APPROVE','REQUEST_CHANGES'].includes(args.event))bad();
     body={commit_id:sha(args.commit_id),event:args.event,body:str(args.body??'',65000)};
     if(args.comments!==undefined){if(!Array.isArray(args.comments)||args.comments.length>30)bad();body.comments=args.comments.map(c=>{exact(c,['path','line','side','body','start_line','start_side']);filePath(c.path);if(!['LEFT','RIGHT'].includes(c.side))bad();const v={path:c.path,line:positive(c.line),side:c.side,body:nonempty(c.body,10000)};if(c.start_line!==undefined){v.start_line=positive(c.start_line);if(!['LEFT','RIGHT'].includes(c.start_side)||v.start_line>v.line)bad();v.start_side=c.start_side;}return v;});}
     if(args.event!=='APPROVE'&&!body.body.trim()&&!body.comments?.length)bad();
     method='POST';route=root+'/pulls/'+number()+'/reviews';preflight={kind:'review',number:number(),sha:body.commit_id};break;
    }
    case 'create_branch':exact(args,['branch','sha']);body={ref:'refs/heads/'+ref(args.branch),sha:sha(args.sha)};method='POST';route=root+'/git/refs';preflight={kind:'branch',branch:args.branch};break;
    case 'update_file':exact(args,['path','branch','expected_sha','message','content_base64']);filePath(args.path);ref(args.branch);if(!Object.hasOwn(args,'expected_sha')||(args.expected_sha!==null&&!/^[a-f0-9]{40}$/i.test(args.expected_sha)))bad();if(typeof args.content_base64!=='string'||args.content_base64.length>MAX_OPERATION_BYTES||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(args.content_base64))bad();body={message:nonempty(args.message,500),content:args.content_base64,branch:args.branch,...(args.expected_sha?{sha:args.expected_sha}:{})};method='PUT';route=root+'/contents/'+filePath(args.path);preflight={kind:'file',branch:args.branch,sha:args.expected_sha,path:args.path};break;
    case 'edit_file':{
     exact(args,['path','branch','expected_sha','expected_result_sha256','message','edits']);filePath(args.path);ref(args.branch);sha(args.expected_sha);nonempty(args.message,500);
     if(typeof args.expected_result_sha256!=='string'||! /^[a-f0-9]{64}$/i.test(args.expected_result_sha256))bad('INVALID_RESULT_SHA256');
     validateEdits(args.edits,bad);
     body={message:args.message,branch:args.branch,sha:args.expected_sha.toLowerCase()};method='PUT';route=root+'/contents/'+filePath(args.path);
     preflight={kind:'edit',branch:args.branch,sha:body.sha,path:args.path,editArgs:{...args,expected_sha:body.sha,expected_result_sha256:args.expected_result_sha256.toLowerCase()}};break;
    }
    case 'commit_files':{
     // #19: validated completely before credentials; see node/commit-files.cjs.
     const plan=commitFilesModule.validateCommitFiles(args,{bad,exact,nonempty,sha,ref,filePath});
     preflight={kind:'commit',branch:plan.branch,plan};break;
    }
    case 'list_rulesets':exact(args,[]);route=root+'/rulesets?includes_parents=true';break;
    case 'get_ruleset':exact(args,['ruleset_id']);route=root+'/rulesets/'+positive(args.ruleset_id);break;
    case 'ruleset_update':{
     exact(args,['ruleset_id','ruleset','owner_authorization','nonce']);positive(args.ruleset_id);if(typeof args.nonce!=='string'||!/^([a-f0-9]{32})$/.test(args.nonce))bad('INVALID_AUTHORIZATION_NONCE');
     if(typeof args.owner_authorization!=='string'||!/^https:\/\/github\.com\/good-night-oppie\/[A-Za-z0-9_.-]+\/(issues|pull)\/[0-9]+#issuecomment-[0-9]+$/.test(args.owner_authorization))bad('OWNER_AUTHORIZATION_REQUIRED');
     exact(args.ruleset,['name','target','enforcement','bypass_actors','conditions','rules']);if(!Object.keys(args.ruleset).length||JSON.stringify(args.ruleset).length>160)bad('RULESET_CHANGE_TOO_LARGE');
     if(!await authorize({account:account.account,repo,operation,args}))bad('OWNER_CONFIRMATION_REQUIRED');
     method='PUT';route=root+'/rulesets/'+args.ruleset_id;body=args.ruleset;preflight={kind:'owner_reference',url:args.owner_authorization};break;
    }
    case 'dismiss_review':exact(args,['number','review_id','message']);method='PUT';route=root+'/pulls/'+number()+'/reviews/'+positive(args.review_id)+'/dismissals';body={message:nonempty(args.message,1000)};break;
    case 'enqueue_pull':exact(args,['number','commit_id']);preflight={kind:'enqueue',number:number(),sha:sha(args.commit_id)};method='POST';route='/graphql';break;
    case 'admin_get':exact(args,[]);route=root;break;
    case 'admin_update':exact(args,['allow_squash_merge','allow_merge_commit','allow_rebase_merge','delete_branch_on_merge']);if(!Object.keys(args).length||Object.values(args).some(x=>typeof x!=='boolean'))bad();
     // ADR 0003 section 4 (Deja 2026-11-16): repository merge settings need a host confirmation each
     // time, whichever account runs them; checked before the private key is read.
     if(!await authorize({account:account.account,repo,operation,args}))bad('OWNER_CONFIRMATION_REQUIRED');
     method='PATCH';route=root;body={...args};break;
   }
   async function api(path,token,method='GET',payload,maxResponseBytes=2500000,timeoutMs=30000){
    if(!path.startsWith('/')||path.startsWith('//')||/[\r\n\\]/.test(path))bad('INVALID_API_ROUTE');
    let response;
    try{response=await fetcher('https://api.github.com'+path,{method,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'oppie-github-agent-plugin',Authorization:'Bearer '+token,...(payload?{'Content-Type':'application/json'}:{})},redirect:'error',signal:AbortSignal.timeout(timeoutMs),...(payload?{body:JSON.stringify(payload)}:{})});}
    catch(_){throw new CoreError(method==='GET'?'NETWORK_ERROR':'WRITE_OUTCOME_UNKNOWN',method==='GET'?'not_executed':'unknown');}
    if(response.status>=300&&response.status<400)throw new CoreError('REDIRECT_REFUSED',method==='GET'?'not_executed':'unknown',response.status);
    if(!response.ok)throw new CoreError('GITHUB_HTTP_'+response.status,method!=='GET'&&response.status>=500?'unknown':'not_executed',response.status);
    let data;try{const text=await response.text();if(Buffer.byteLength(text)>maxResponseBytes)throw Error();data=text?JSON.parse(text):null;}catch(_){throw new CoreError('INVALID_API_RESPONSE',method==='GET'?'not_executed':'unknown');}return data;
   }
   let pem;try{pem=await credentials(account.account);}catch(_){bad('CREDENTIAL_UNAVAILABLE');}if(typeof pem!=='string')bad('CREDENTIAL_UNAVAILABLE');
   secrets.push(pem);const jwt=makeJwt(account,pem,now());secrets.push(jwt);pem=null;
   const app=await api('/app',jwt);
   // Identity never follows a matching name alone: App ID and owner stay pinned.
   if(Number(app?.id)!==account.app_id||typeof app?.slug!=='string'||!account.allowed_slugs.includes(app.slug)||app?.owner?.login!==OWNER)bad('APP_IDENTITY_MISMATCH');
   // Compiled accounts keep their pinned installation; accounts added in the settings page use the
   // App's single installation in good-night-oppie, looked up now (follows GitHub on every call).
   let installation;
   if(account.installation_id)installation=await api('/app/installations/'+account.installation_id,jwt);
   else{
    const list=await api('/app/installations?per_page=100',jwt);
    const mine=Array.isArray(list)?list.filter(i=>obj(i)&&i.account?.login===OWNER):[];
    if(mine.length!==1)throw new CoreError('INSTALLATION_NOT_FOUND','not_executed',undefined,{owner:OWNER,found:mine.length});
    installation=mine[0];
   }
   const installationId=account.installation_id||Number(installation?.id);
   if(!Number.isSafeInteger(installationId)||Number(installation?.id)!==installationId||Number(installation?.app_id)!==account.app_id||installation?.account?.login!==OWNER||installation?.account?.type!=='Organization'||!['selected','all'].includes(installation?.repository_selection)||installation?.suspended_at)bad('INSTALLATION_MISMATCH');
   // The installation may hold more than this operation needs (and usually does); only a lack fails.
   const workflowFiles=workflowPaths(preflight),needed=workflowFiles.length?{...permissions(operation),workflows:'write'}:permissions(operation);
   checkInstallation(installation.permissions,account,operation,installationId,needed,workflowFiles);
   // identity also reports the whole installation (an unscoped metadata-only token, bounded listing).
   async function listInstallation(){
    const probe=await api('/app/installations/'+installationId+'/access_tokens',jwt,'POST',{permissions:{metadata:'read'}});
    if(typeof probe?.token!=='string'||!probe.token)bad('INVALID_INSTALLATION_TOKEN');secrets.push(probe.token);
    const repositories=[];let total=null;
    for(let page=1;page<=MAX_INSTALLATION_PAGES;page++){
     const r=await api('/installation/repositories?per_page=100'+(page>1?'&page='+page:''),probe.token);
     if(!obj(r)||!Number.isSafeInteger(r.total_count)||!Array.isArray(r.repositories)||(total!==null&&r.total_count!==total))return {complete:false,repositories};
     total=r.total_count;repositories.push(...r.repositories.filter(x=>obj(x)&&typeof x.full_name==='string').map(x=>x.full_name));
     if(repositories.length>=total||!r.repositories.length)break;
    }
    return {complete:repositories.length===total,repositories};
   }
   const installationPermissions=Object.fromEntries(Object.entries(obj(installation.permissions)?installation.permissions:{}).filter(([k,v])=>/^[a-z_]{1,40}$/.test(k)&&Object.hasOwn(PERMISSION_RANK,v)).slice(0,60));
   const installationSummary=()=>({app_id:account.app_id,app_slug:app.slug,owner:OWNER,installation_id:installationId,installationRepositorySelection:installation.repository_selection,installationPermissions,
    availableOperations:OPERATION_NAMES.filter(o=>!missingPermissions(installation.permissions,permissions(o)).length),scopeRevision:config.revision,scopeConfigSource:config===DEFAULT_CONFIG?'default':'file',scopeConfigDigest:configDigest(config)});
   if(repo===null)return {ok:true,receipt:{scopeRevision:config.revision,account:account.account,app_slug:app.slug,installation_id:installationId,repo:null,operation,execution:'completed',url:app.html_url},result:clean({...installationSummary(),installationRepositories:await listInstallation()},secrets)};
   // The execution token covers only the target repository (plus the owner's authorization comment
   // repository for ruleset_update) and only this operation's permissions.
   const proofRepo=preflight?.kind==='owner_reference'?preflight.url.match(/^https:\/\/github\.com\/good-night-oppie\/([^/]+)\//)?.[1]:null;
   if(preflight?.kind==='owner_reference'&&(!proofRepo||![repo,'MontClip'].includes(proofRepo)))bad('OWNER_REFERENCE_SCOPE');
   const tokenRepos=[...new Set([repo,...(proofRepo?[proofRepo]:[])])];
   const notInstalled=e=>{if(e instanceof CoreError&&[404,422].includes(e.status))throw new CoreError('REPOSITORY_NOT_INSTALLED','not_executed',e.status,{repositories:tokenRepos.map(n=>OWNER+'/'+n)});throw e;};
   const validToken=r=>{if(typeof r?.token!=='string'||!r.token||Date.parse(r.expires_at)<=now()+30000||!Number.isFinite(Date.parse(r.expires_at)))bad('INVALID_INSTALLATION_TOKEN');secrets.push(r.token);return r.token;};
   // ADR 0003 section 2 step 6 (QQ 5914736615 point 2): resolve each repository name to its numeric
   // ID first, with a metadata-only token limited to those names, then request the execution token by
   // repository_ids so it covers exactly those repositories even if a name changes in between.
   let resolveResponse;
   try{resolveResponse=await api('/app/installations/'+installationId+'/access_tokens',jwt,'POST',{repositories:tokenRepos,permissions:{metadata:'read'}});}catch(e){notInstalled(e);}
   const resolveToken=validToken(resolveResponse);checkTokenPermissions(resolveResponse.permissions,{metadata:'read'});
   const resolved=new Map();
   for(const n of tokenRepos){
    let r;try{r=await api('/repos/'+OWNER+'/'+n,resolveToken);}catch(e){notInstalled(e);}
    if(!obj(r)||!Number.isSafeInteger(r.id)||r.id<1||typeof r.name!=='string'||r.name.toLowerCase()!==n.toLowerCase()||r.owner?.login!==OWNER||r.full_name!==OWNER+'/'+r.name)bad('REPOSITORY_RESOLUTION_FAILED');
    resolved.set(n,r);
   }
   const tokenIds=[...new Set([...resolved.values()].map(r=>r.id))];
   // Default branch (QQ 5914736615 point 3): refused here, before the execution token and any write.
   if(['branch','file','edit','commit'].includes(preflight?.kind)&&(typeof resolved.get(repo).default_branch!=='string'||resolved.get(repo).default_branch===preflight.branch))bad('DEFAULT_BRANCH_WRITE_REFUSED');
   let tokenResponse;
   try{tokenResponse=await api('/app/installations/'+installationId+'/access_tokens',jwt,'POST',{repository_ids:tokenIds,permissions:needed});}catch(e){notInstalled(e);}
   const token=validToken(tokenResponse);checkTokenPermissions(tokenResponse.permissions,needed);
   const repos=await api('/installation/repositories?per_page=100',token);
   const exactRepos=r=>r?.total_count===tokenIds.length&&Array.isArray(r.repositories)&&r.repositories.length===tokenIds.length&&r.repositories.every(x=>obj(x)&&tokenIds.includes(x.id)&&x.full_name===OWNER+'/'+x.name&&[...resolved.values()].some(v=>v.id===x.id&&v.full_name===x.full_name))&&new Set(r.repositories.map(x=>x.id)).size===tokenIds.length;
   if(!exactRepos(repos)){
    // Diagnostics never include raw API objects or credentials.
    const list=Array.isArray(repos?.repositories)?repos.repositories:[];
    scopeDiagnostics={expectedRepositories:tokenRepos.map(n=>OWNER+'/'+n),actualRepositories:list.slice(0,100).map(r=>r?.full_name).filter(n=>typeof n==='string'&&/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(n))};
    bad('EXECUTION_REPOSITORY_SCOPE_MISMATCH');
   }
   const target=repos.repositories.find(x=>x.id===resolved.get(repo).id);
   if(preflight?.kind==='owner_reference'){
    const match=preflight.url.match(/^https:\/\/github\.com\/good-night-oppie\/([^/]+)\/(?:issues|pull)\/[0-9]+#issuecomment-([0-9]+)$/);
    if(!match||match[1]!==proofRepo)bad('OWNER_REFERENCE_SCOPE');
    const proof=await api('/repos/'+OWNER+'/'+match[1]+'/issues/comments/'+match[2],token);
    if(!validateProof(proof,repo,args,now()))bad('OWNER_REFERENCE_UNVERIFIED');
    if(!await claimAuthorization(args.nonce))bad('OWNER_AUTHORIZATION_REPLAYED');
   }
   if(preflight?.kind==='enqueue'){const pr=await api(root+'/pulls/'+preflight.number,token);if(pr?.head?.sha!==preflight.sha||pr?.state!=='open'||pr?.draft||typeof pr.node_id!=='string')bad('STALE_OR_UNQUEUEABLE_HEAD');preflight.nodeId=pr.node_id;
    let before;try{before=(await api('/graphql',token,'POST',{query:QUEUE_STATE_QUERY,variables:{id:pr.node_id}}))?.data?.node;}catch(_){/* read-only probe; the mutation path re-reads */}
    if(before?.isInMergeQueue===true)throw new CoreError('ALREADY_IN_MERGE_QUEUE','not_executed',undefined,{isInMergeQueue:true,mergeQueueEntry:before.mergeQueueEntry?{id:before.mergeQueueEntry.id,state:before.mergeQueueEntry.state}:null});
    body={query:'mutation($id:ID!,$head:GitObjectID!){enqueuePullRequest(input:{pullRequestId:$id,expectedHeadOid:$head}){mergeQueueEntry{id}}}',variables:{id:pr.node_id,head:preflight.sha}};}
   if(preflight?.kind==='review'){const pr=await api(root+'/pulls/'+preflight.number,token);if(pr?.head?.sha!==preflight.sha)bad('STALE_HEAD');if(pr?.state!=='open'||pr?.draft)bad('PR_NOT_REVIEWABLE');}
   if(['branch','file','edit','commit'].includes(preflight?.kind)){
    if(['file','edit'].includes(preflight.kind)){let current;try{current=await api(root+'/contents/'+filePath(preflight.path)+'?ref='+encodeURIComponent(preflight.branch),token);}catch(e){if(e.status!==404||preflight.sha!==null)throw e;}if((current?.sha??null)!==preflight.sha)bad('STALE_FILE');if(preflight.kind==='edit'){
      // Reject stale/oversized metadata before spending a blob request.
      if(current.type!=='file'||!Number.isSafeInteger(current.size)||current.size<0)bad('INVALID_FILE_BASELINE');
      if(current.size>MAX_FILE_BYTES)bad('FILE_TOO_LARGE');
      if(current.encoding==='none'&&current.content===''&&current.size>0){
       // Only this bounded internal read gets the larger response allowance.
       const blob=await api(root+'/git/blobs/'+preflight.sha,token,'GET',undefined,3200000);
       if(blob?.sha!==preflight.sha||blob.size!==current.size||blob.encoding!=='base64'||typeof blob.content!=='string')bad('INVALID_FILE_BASELINE');
       current={...current,encoding:blob.encoding,content:blob.content};
      }
      body.content=applyEdits(current,preflight.editArgs,bad);
     }}
   }
   async function enqueue(){
    // A GraphQL errors[] response is a definitive rejection only when a read-back
    // confirms the PR is not queued; anything unreadable stays "unknown".
    let response,transport;
    try{response=await api(route,token,method,body);}catch(e){if(!(e instanceof CoreError)||e.execution!=='unknown')throw e;transport=e;}
    if(!transport&&typeof response?.data?.enqueuePullRequest?.mergeQueueEntry?.id==='string'&&!response.errors)return response;
    const errors=graphqlErrors(response?.errors);
    let after;try{after=(await api('/graphql',token,'POST',{query:QUEUE_STATE_QUERY,variables:{id:preflight.nodeId}}))?.data?.node;}catch(_){after=undefined;}
    const state=typeof after?.isInMergeQueue==='boolean'?{isInMergeQueue:after.isInMergeQueue,headRefOid:typeof after.headRefOid==='string'?after.headRefOid:null,mergeQueueEntry:after.mergeQueueEntry?{id:after.mergeQueueEntry.id,state:after.mergeQueueEntry.state}:null}:null;
    if(state?.isInMergeQueue===true&&state.headRefOid===preflight.sha)return {data:{enqueuePullRequest:{mergeQueueEntry:state.mergeQueueEntry}},readback:state};
    if(!state)throw new CoreError('QUEUE_RESULT_UNCONFIRMED','unknown',transport?.status,{githubErrors:errors,readback:'unavailable'});
    if(state.isInMergeQueue===true||(state.headRefOid&&state.headRefOid!==preflight.sha))throw new CoreError('QUEUE_HEAD_MISMATCH','not_executed',undefined,{githubErrors:errors,readback:state});
    if(transport)throw new CoreError('QUEUE_NOT_QUEUED_AFTER_UNKNOWN_WRITE','not_executed',transport.status,{githubErrors:errors,readback:state});
    if(!errors.length)throw new CoreError('QUEUE_REJECTED','not_executed',undefined,{githubErrors:errors,readback:state,reason:'no mergeQueueEntry in response'});
    throw new CoreError(classifyQueueErrors(errors),'not_executed',undefined,{githubErrors:errors,readback:state});
   }
   const result=operation==='identity'?{...installationSummary(),repository:{id:target.id,full_name:target.full_name},installationRepositories:await listInstallation(),expires_at:tokenResponse.expires_at}:operation==='enqueue_pull'?await enqueue():operation==='commit_files'?await commitFilesModule.commitFiles({plan:preflight.plan,api,root,token,repoUrl:'https://github.com/'+OWNER+'/'+repo,bad,CoreError}):await api(route,token,method,body);
   return {ok:true,receipt:{scopeRevision:config.revision,account:account.account,app_slug:app.slug,installation_id:installationId,repo:OWNER+'/'+repo,operation,execution:'completed',url:typeof result?.html_url==='string'?result.html_url:app.html_url},result:clean(result,secrets)};
  }catch(e){return {ok:false,errorCode:e instanceof CoreError?e.code:'INTERNAL_ERROR',execution:e instanceof CoreError?e.execution:'not_executed',...(e instanceof CoreError&&e.status?{status:e.status}:{}),...(e instanceof CoreError&&e.details?{details:clean(e.details,secrets)}:{}),...(scopeDiagnostics?{diagnostics:clean(scopeDiagnostics,secrets)}:{})};}
  finally{secrets.fill('');}
 }
 return {run};
}
module.exports={createClient,makeJwt,ACCOUNTS,configuredAccount,APP_NAMES,allowedAppSlug,knownBotLogin,REPOSITORIES,OPERATION_NAMES,OPERATION_NEEDS,permissions,CoreError};
