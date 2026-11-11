'use strict';
const crypto = require('node:crypto');
const {validateProof}=require('./owner-authorization.cjs');
const {validateEdits,applyEdits}=require('./file-edit.cjs');
const MAX_OPERATION_BYTES=261120; // Reserve 1 KiB below the host limit for the RPC envelope.
const OWNER = 'good-night-oppie';
const {initialPolicy,validatePolicy}=require('./repository-policy.cjs');
const REPOSITORIES = Object.freeze({MontClip:1441621868, 'MontClip-Cindy':1446532339});
const QQ_ONLY=['list_rulesets','get_ruleset','ruleset_update','dismiss_review','enqueue_pull'];
const QQ_ALLOWED=['identity','get_contents','list_branches','list_issues','get_issue','list_pulls','get_pull','pull_files','list_reviews','submit_review',...QQ_ONLY];
const APP_NAMES=Object.freeze({bb:'BBOppieXYZ',cindy:'CindyOppieXYZ',deja:'DejaOppieXYZ',dd:'DDOppieXYZ',gg:'GGOppieXYZ',jj:'JJOppieXYZ',pg:'PGOppieXYZ',qq:'QQOppieXYZ',rea:'ReaOppieXYZ',video:'VideoOppieXYZ',vv:'VVOppieXYZ',reviewinbox:'ReviewInboxOppieXYZ'});
const ACCOUNTS = Object.freeze(Object.fromEntries([
 ['bb',5665927,179806310],['cindy',5665939,179806330],['deja',5665940,179806356],
 ['dd',5665941,179806387],['gg',5665942,179806414],['jj',5665943,179806445],
 ['pg',5665944,179806482],['qq',5665946,179806512],['rea',5665948,179806534],
 ['video',5665949,179806582],['vv',5665951,179806217],['reviewinbox',5687106,180305629],
].map(([account,app_id,installation_id])=>[account,Object.freeze({account,app_id,installation_id,
 app_name:APP_NAMES[account],app_slug:APP_NAMES[account].toLowerCase(),app_slug_status:'expected_not_live',
 allowed_slugs:Object.freeze(account==='reviewinbox'?['reviewinboxoppiexyz']:['oppie-agent-'+account,APP_NAMES[account].toLowerCase()]),admin:account==='qq'})])));
function allowedAppSlug(account,slug){return typeof slug==='string'&&Object.hasOwn(ACCOUNTS,account)&&ACCOUNTS[account].allowed_slugs.includes(slug);}
function knownBotLogin(account,login){return typeof login==='string'&&Object.hasOwn(ACCOUNTS,account)&&ACCOUNTS[account].allowed_slugs.some(slug=>login===slug+'[bot]');}
const OPERATION_NAMES = Object.freeze(['identity','get_contents','list_branches','list_issues','get_issue','create_issue','update_issue','comment_issue','list_pulls','get_pull','pull_files','create_pull','update_pull','list_reviews','submit_review','create_branch','update_file','edit_file','admin_get','admin_update',...QQ_ONLY]);
class CoreError extends Error { constructor(code,execution='not_executed',status){super(code);this.code=code;this.execution=execution;if(status)this.status=status;} }
function bad(code='INVALID_ARGUMENTS'){throw new CoreError(code);}
function obj(x){return !!x&&typeof x==='object'&&!Array.isArray(x);}
function exact(x,keys){if(!obj(x)||Object.keys(x).some(k=>!keys.includes(k)))bad();}
function str(x,max=10000){if(typeof x!=='string'||x.length>max||x.includes('\0'))bad();return x;}
function nonempty(x,max=200){if(!str(x,max).trim())bad();return x;}
function positive(x){if(!Number.isSafeInteger(x)||x<1)bad();return x;}
function sha(x){if(typeof x!=='string'||! /^[a-f0-9]{40}$/i.test(x))bad();return x;}
function ref(x){nonempty(x,200);if(/[\s~^:?*\[\\%\x00-\x1f]/.test(x)||x.includes('..')||x.includes('@{')||x.includes('//')||x.startsWith('/')||x.endsWith('/')||x.endsWith('.')||x.split('/').some(s=>s.startsWith('.')||s.endsWith('.lock')))bad('INVALID_REF');return x;}
function filePath(x,empty=false){str(x,1000);if(!x&&empty)return '';if(!x||x.startsWith('/')||/[\\%?#\x00-\x1f]/.test(x)||x.split('/').some(s=>!s||s==='.'||s==='..'))bad('INVALID_PATH');return x.split('/').map(encodeURIComponent).join('/');}
function repoName(x,allowed=REPOSITORIES){if(typeof x!=='string')bad('REPOSITORY_REQUIRED');const n=x.startsWith(OWNER+'/')?x.slice(OWNER.length+1):x;if(!Object.hasOwn(allowed,n))bad('REPOSITORY_NOT_ALLOWED');return n;}
function permissions(a){return {contents:['reviewinbox','qq'].includes(a.account)?'read':'write',issues:'write',pull_requests:'write',metadata:'read',...(a.admin?{administration:'write'}:{})};}
function checkPermissions(actual,a,phase='execution'){
 const expected=permissions(a),rank={none:0,read:1,write:2};
 // PG may have additional owner-granted installation permissions. Never request
 // or accept them on its ordinary execution token; QQ's existing rules stay unchanged.
 const pgInstallation=phase==='installation'&&a.account==='pg';
 const allowSuperset=a.account==='qq'||pgInstallation;
 if(pgInstallation&&(!obj(actual)||Object.keys(expected).some(k=>typeof actual[k]!=='string'||!Object.hasOwn(rank,actual[k]))))bad('PERMISSION_MISMATCH');
 if(!obj(actual)||Object.entries(expected).some(([k,v])=>allowSuperset?(rank[actual[k]]??-1)<rank[v]:actual[k]!==v)||(!allowSuperset&&Object.entries(actual).some(([k,v])=>v!=='none'&&!Object.hasOwn(expected,k))))bad('PERMISSION_MISMATCH');
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
function createClient({credentials,fetch:fetcher=globalThis.fetch,now=Date.now,authorize=async()=>false,claimAuthorization=async()=>false,repositoryPolicy=initialPolicy}={}){
 if(typeof credentials!=='function'||typeof fetcher!=='function')throw Error('DEPENDENCY_REQUIRED');
 async function run(input){
  let secrets=[],scopeDiagnostics;
  try{
   if(Buffer.byteLength(JSON.stringify(input??null),'utf8')>MAX_OPERATION_BYTES)bad('REQUEST_TOO_LARGE');
   exact(input,['account','repo','operation','args']);
   if(typeof input.account!=='string'||!Object.hasOwn(ACCOUNTS,input.account))bad('ACCOUNT_REQUIRED');
   const account=ACCOUNTS[input.account];const operation=input.operation;
   if(!OPERATION_NAMES.includes(operation))bad('UNKNOWN_OPERATION');
   if(account.account==='qq'&&!QQ_ALLOWED.includes(operation))bad('QQ_AUTHORING_REFUSED');if(QQ_ONLY.includes(operation)&&account.account!=='qq')bad('QQ_ACCOUNT_REQUIRED');
   let policy;try{policy=validatePolicy(repositoryPolicy());}catch(_){bad('INVALID_SCOPE_CONFIGURATION');}
   const scope=policy.accounts[account.account];const expectedRepos=scope.execution;const repo=repoName(input.repo,expectedRepos);const args=input.args===undefined?{}:input.args;if(!obj(args))bad();
   if(account.account==='reviewinbox'){
    if(['create_branch','update_file','edit_file'].includes(operation))bad('READ_ONLY_CONTENTS');
    if(['admin_get','admin_update'].includes(operation))bad('ADMIN_ACCOUNT_REQUIRED');
    if(operation==='submit_review'&&args.event!=='COMMENT')bad('COMMENT_ONLY_REVIEWER');
   }
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
    case 'list_rulesets':exact(args,[]);route=root+'/rulesets?includes_parents=true';break;
    case 'get_ruleset':exact(args,['ruleset_id']);route=root+'/rulesets/'+positive(args.ruleset_id);break;
    case 'ruleset_update':{
     exact(args,['ruleset_id','ruleset','owner_authorization','nonce']);positive(args.ruleset_id);if(typeof args.nonce!=='string'||!/^([a-f0-9]{32})$/.test(args.nonce))bad('INVALID_AUTHORIZATION_NONCE');
     if(typeof args.owner_authorization!=='string'||!/^https:\/\/github\.com\/good-night-oppie\/[A-Za-z0-9_.-]+\/(issues|pull)\/[0-9]+#issuecomment-[0-9]+$/.test(args.owner_authorization))bad('OWNER_AUTHORIZATION_REQUIRED');
     exact(args.ruleset,['name','target','enforcement','bypass_actors','conditions','rules']);if(!Object.keys(args.ruleset).length||JSON.stringify(args.ruleset).length>160)bad('RULESET_CHANGE_TOO_LARGE');
     if(!await authorize({account:'qq',repo,operation,args}))bad('OWNER_CONFIRMATION_REQUIRED');
     method='PUT';route=root+'/rulesets/'+args.ruleset_id;body=args.ruleset;preflight={kind:'owner_reference',url:args.owner_authorization};break;
    }
    case 'dismiss_review':exact(args,['number','review_id','message']);method='PUT';route=root+'/pulls/'+number()+'/reviews/'+positive(args.review_id)+'/dismissals';body={message:nonempty(args.message,1000)};break;
    case 'enqueue_pull':exact(args,['number','commit_id']);preflight={kind:'enqueue',number:number(),sha:sha(args.commit_id)};method='POST';route='/graphql';break;
    case 'admin_get':exact(args,[]);if(!account.admin)bad('ADMIN_ACCOUNT_REQUIRED');route=root;break;
    case 'admin_update':exact(args,['allow_squash_merge','allow_merge_commit','allow_rebase_merge','delete_branch_on_merge']);if(!account.admin)bad('ADMIN_ACCOUNT_REQUIRED');if(!Object.keys(args).length||Object.values(args).some(x=>typeof x!=='boolean'))bad();method='PATCH';route=root;body={...args};break;
   }
   async function api(path,token,method='GET',payload){
    if(!path.startsWith('/')||path.startsWith('//')||/[\r\n\\]/.test(path))bad('INVALID_API_ROUTE');
    let response;
    try{response=await fetcher('https://api.github.com'+path,{method,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'oppie-github-agent-plugin',Authorization:'Bearer '+token,...(payload?{'Content-Type':'application/json'}:{})},redirect:'error',signal:AbortSignal.timeout(30000),...(payload?{body:JSON.stringify(payload)}:{})});}
    catch(_){throw new CoreError(method==='GET'?'NETWORK_ERROR':'WRITE_OUTCOME_UNKNOWN',method==='GET'?'not_executed':'unknown');}
    if(response.status>=300&&response.status<400)throw new CoreError('REDIRECT_REFUSED',method==='GET'?'not_executed':'unknown',response.status);
    if(!response.ok)throw new CoreError('GITHUB_HTTP_'+response.status,method!=='GET'&&response.status>=500?'unknown':'not_executed',response.status);
    let data;try{const text=await response.text();if(Buffer.byteLength(text)>2500000)throw Error();data=text?JSON.parse(text):null;}catch(_){throw new CoreError('INVALID_API_RESPONSE',method==='GET'?'not_executed':'unknown');}return data;
   }
   let pem;try{pem=await credentials(account.account);}catch(_){bad('CREDENTIAL_UNAVAILABLE');}if(typeof pem!=='string')bad('CREDENTIAL_UNAVAILABLE');
   secrets.push(pem);const jwt=makeJwt(account,pem,now());secrets.push(jwt);pem=null;
   const app=await api('/app',jwt);
   // Names may change during the controlled rollout. Identity never follows a
   // matching name alone: App ID, owner and installation remain pinned below.
   if(Number(app?.id)!==account.app_id||!allowedAppSlug(account.account,app?.slug)||app?.owner?.login!==OWNER)bad('APP_IDENTITY_MISMATCH');
   const installation=await api('/app/installations/'+account.installation_id,jwt);
   if(Number(installation?.id)!==account.installation_id||Number(installation?.app_id)!==account.app_id||installation?.account?.login!==OWNER||installation?.account?.type!=='Organization'||installation?.repository_selection!=='selected'||installation?.suspended_at)bad('INSTALLATION_MISMATCH');
   // PG's installed App has administration permission; ordinary execution never requests it.
   checkPermissions(installation.permissions,account,'installation');
   // An unscoped metadata-only probe verifies the INSTALLATION's repository set.
   // A narrowed execution token alone would hide unexpected extra installations.
   const probeResponse=await api('/app/installations/'+account.installation_id+'/access_tokens',jwt,'POST',{permissions:{metadata:'read'}});
   if(typeof probeResponse?.token!=='string'||!probeResponse.token)bad('INVALID_INSTALLATION_TOKEN');
   secrets.push(probeResponse.token);
   const probe=await api('/installation/repositories?per_page=100',probeResponse.token);
   function exactRepos(r,expected=expectedRepos){const count=Object.keys(expected).length;return r?.total_count===count&&Array.isArray(r.repositories)&&r.repositories.length===count&&r.repositories.every(x=>obj(x)&&x.full_name===OWNER+'/'+x.name&&expected[x.name]===x.id)&&new Set(r.repositories.map(x=>x.id)).size===count;}
   function scopeMismatch(code,observed,expected){
    // Diagnostics never include raw API objects, IDs or credentials. A partial
    // or malformed list must not be mistaken for a verified empty installation.
    const list=Array.isArray(observed?.repositories)?observed.repositories:[];
    const names=list.slice(0,100).map(r=>r?.full_name).filter(n=>typeof n==='string'&&/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(n));
    scopeDiagnostics={expectedRepositories:Object.keys(expected).map(n=>OWNER+'/'+n),actualRepositories:names,
     actualRepositoriesComplete:Array.isArray(observed?.repositories)&&names.length===list.length&&observed.total_count===list.length};
    bad(code);
   }
   if(!exactRepos(probe,scope.installation))scopeMismatch('INSTALLATION_REPOSITORY_SCOPE_MISMATCH',probe,scope.installation);
   const tokenResponse=await api('/app/installations/'+account.installation_id+'/access_tokens',jwt,'POST',{repository_ids:Object.values(expectedRepos),permissions:permissions(account)});
   if(typeof tokenResponse?.token!=='string'||!tokenResponse.token||Date.parse(tokenResponse.expires_at)<=now()+30000||!Number.isFinite(Date.parse(tokenResponse.expires_at)))bad('INVALID_INSTALLATION_TOKEN');
   const token=tokenResponse.token;secrets.push(token);checkPermissions(tokenResponse.permissions,account);
   const repos=await api('/installation/repositories?per_page=100',token);
   if(!exactRepos(repos))scopeMismatch('EXECUTION_REPOSITORY_SCOPE_MISMATCH',repos,expectedRepos);
   if(preflight?.kind==='owner_reference'){
    const match=preflight.url.match(/^https:\/\/github\.com\/good-night-oppie\/([^/]+)\/(?:issues|pull)\/[0-9]+#issuecomment-([0-9]+)$/);
    if(!match||!Object.hasOwn(expectedRepos,match[1])||![repo,'MontClip'].includes(match[1]))bad('OWNER_REFERENCE_SCOPE');
    const proof=await api('/repos/'+OWNER+'/'+match[1]+'/issues/comments/'+match[2],token);
    if(!validateProof(proof,repo,args,now()))bad('OWNER_REFERENCE_UNVERIFIED');
    if(!await claimAuthorization(args.nonce))bad('OWNER_AUTHORIZATION_REPLAYED');
   }
   if(preflight?.kind==='enqueue'){const pr=await api(root+'/pulls/'+preflight.number,token);if(pr?.head?.sha!==preflight.sha||pr?.state!=='open'||pr?.draft||typeof pr.node_id!=='string')bad('STALE_OR_UNQUEUEABLE_HEAD');body={query:'mutation($id:ID!,$head:GitObjectID!){enqueuePullRequest(input:{pullRequestId:$id,expectedHeadOid:$head}){mergeQueueEntry{id}}}',variables:{id:pr.node_id,head:preflight.sha}};}
   if(preflight?.kind==='review'){const pr=await api(root+'/pulls/'+preflight.number,token);if(pr?.head?.sha!==preflight.sha)bad('STALE_HEAD');if(pr?.state!=='open'||pr?.draft)bad('PR_NOT_REVIEWABLE');}
   if(preflight?.kind==='branch'||preflight?.kind==='file'||preflight?.kind==='edit'){
    const metadata=await api(root,token);if(metadata?.default_branch===preflight.branch)bad('DEFAULT_BRANCH_WRITE_REFUSED');
    if(['file','edit'].includes(preflight.kind)){let current;try{current=await api(root+'/contents/'+filePath(preflight.path)+'?ref='+encodeURIComponent(preflight.branch),token);}catch(e){if(e.status!==404||preflight.sha!==null)throw e;}if((current?.sha??null)!==preflight.sha)bad('STALE_FILE');if(preflight.kind==='edit')body.content=applyEdits(current,preflight.editArgs,bad);}
   }
   const result=operation==='identity'?{app_id:account.app_id,app_slug:app.slug,owner:OWNER,permissions:permissions(account),repositories:repos.repositories.map(r=>({id:r.id,full_name:r.full_name})),installationRepositories:probe.repositories.map(r=>({id:r.id,full_name:r.full_name})),scopeRevision:policy.revision,expires_at:tokenResponse.expires_at}:await api(route,token,method,body);
   if(operation==='enqueue_pull'&&(result?.errors||!result?.data?.enqueuePullRequest?.mergeQueueEntry?.id))throw new CoreError('QUEUE_RESULT_UNCONFIRMED','unknown');
   return {ok:true,receipt:{scopeRevision:policy.revision,account:account.account,app_slug:app.slug,installation_id:account.installation_id,repo:OWNER+'/'+repo,operation,execution:'completed',url:typeof result?.html_url==='string'?result.html_url:app.html_url},result:clean(result,secrets)};
  }catch(e){return {ok:false,errorCode:e instanceof CoreError?e.code:'INTERNAL_ERROR',execution:e instanceof CoreError?e.execution:'not_executed',...(e instanceof CoreError&&e.status?{status:e.status}:{}),...(scopeDiagnostics?{diagnostics:clean(scopeDiagnostics,secrets)}:{})};}
  finally{secrets.fill('');}
 }
 return {run};
}
module.exports={createClient,makeJwt,ACCOUNTS,APP_NAMES,allowedAppSlug,knownBotLogin,REPOSITORIES,OPERATION_NAMES,CoreError};
