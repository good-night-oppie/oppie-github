'use strict';
const crypto = require('node:crypto');
const OWNER = 'good-night-oppie';
const REPOSITORIES = Object.freeze({MontClip:1441621868, 'MontClip-Cindy':1446532339});
const REVIEW_INBOX_INSTALLATION=Object.freeze({...REPOSITORIES,'montclip-rsi':1450602468,'rsi-playbooks':1450603260,'oppie-github':1451885379,'sglang-review-inbox':1451900929});
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
const OPERATION_NAMES = Object.freeze(['identity','get_contents','list_branches','list_issues','get_issue','create_issue','update_issue','comment_issue','list_pulls','get_pull','pull_files','create_pull','update_pull','list_reviews','submit_review','create_branch','update_file','admin_get','admin_update']);
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
function repoName(x){if(typeof x!=='string')bad('REPOSITORY_REQUIRED');const n=x.startsWith(OWNER+'/')?x.slice(OWNER.length+1):x;if(!Object.hasOwn(REPOSITORIES,n))bad('REPOSITORY_NOT_ALLOWED');return n;}
function permissions(a){return {contents:a.account==='reviewinbox'?'read':'write',issues:'write',pull_requests:'write',metadata:'read',...(a.admin?{administration:'write'}:{})};}
function checkPermissions(actual,a){const expected=permissions(a);if(!obj(actual)||Object.entries(expected).some(([k,v])=>actual[k]!==v)||Object.entries(actual).some(([k,v])=>v!=='none'&&!Object.hasOwn(expected,k)))bad('PERMISSION_MISMATCH');}
function makeJwt(account,pem,now=Date.now()){
 const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
 const t=Math.floor(now/1000);const p=Buffer.from(JSON.stringify({iat:t-60,exp:t+480,iss:String(account.app_id)})).toString('base64url');
 try {const key=crypto.createPrivateKey(pem);if(key.asymmetricKeyType!=='rsa')bad('INVALID_PRIVATE_KEY');return h+'.'+p+'.'+crypto.sign('RSA-SHA256',Buffer.from(h+'.'+p),key).toString('base64url');}
 catch(_){bad('INVALID_PRIVATE_KEY');}
}
function listQuery(a,extra=[]){exact(a,['page','per_page',...extra]);const q=new URLSearchParams({page:String(a.page===undefined?1:positive(a.page)),per_page:String(a.per_page===undefined?30:positive(a.per_page))});if(Number(q.get('per_page'))>100)bad();return q;}
function labels(value){if(!Array.isArray(value)||value.length>30)bad();return value.map(x=>nonempty(x,100));}
function clean(value,secrets){if(typeof value==='string'){for(const secret of secrets)if(secret)value=value.split(secret).join('[REDACTED]');return value;}if(Array.isArray(value))return value.map(x=>clean(x,secrets));if(obj(value))return Object.fromEntries(Object.entries(value).filter(([k])=>!['token','access_token','private_key','authorization'].includes(k.toLowerCase())).map(([k,v])=>[k,clean(v,secrets)]));return value;}
function createClient({credentials,fetch:fetcher=globalThis.fetch,now=Date.now}={}){
 if(typeof credentials!=='function'||typeof fetcher!=='function')throw Error('DEPENDENCY_REQUIRED');
 async function run(input){
  let secrets=[];
  try{
   exact(input,['account','repo','operation','args']);
   if(typeof input.account!=='string'||!Object.hasOwn(ACCOUNTS,input.account))bad('ACCOUNT_REQUIRED');
   const account=ACCOUNTS[input.account];const operation=input.operation;
   if(!OPERATION_NAMES.includes(operation))bad('UNKNOWN_OPERATION');
   const repo=repoName(input.repo);const args=input.args===undefined?{}:input.args;if(!obj(args))bad();
   if(account.account==='reviewinbox'){
    if(['create_branch','update_file'].includes(operation))bad('READ_ONLY_CONTENTS');
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
    case 'update_file':exact(args,['path','branch','expected_sha','message','content_base64']);filePath(args.path);ref(args.branch);if(!Object.hasOwn(args,'expected_sha')||(args.expected_sha!==null&&!/^[a-f0-9]{40}$/i.test(args.expected_sha)))bad();if(typeof args.content_base64!=='string'||args.content_base64.length>700000||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(args.content_base64))bad();body={message:nonempty(args.message,500),content:args.content_base64,branch:args.branch,...(args.expected_sha?{sha:args.expected_sha}:{})};method='PUT';route=root+'/contents/'+filePath(args.path);preflight={kind:'file',branch:args.branch,sha:args.expected_sha,path:args.path};break;
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
   checkPermissions(installation.permissions,account);
   // An unscoped metadata-only probe verifies the INSTALLATION's repository set.
   // A narrowed execution token alone would hide unexpected extra installations.
   const probeResponse=await api('/app/installations/'+account.installation_id+'/access_tokens',jwt,'POST',{permissions:{metadata:'read'}});
   if(typeof probeResponse?.token!=='string'||!probeResponse.token)bad('INVALID_INSTALLATION_TOKEN');
   secrets.push(probeResponse.token);
   const probe=await api('/installation/repositories?per_page=100',probeResponse.token);
   function exactRepos(r,expected=REPOSITORIES){const n=Object.keys(expected).length;return r?.total_count===n&&Array.isArray(r.repositories)&&r.repositories.length===n&&r.repositories.every(x=>x.full_name===OWNER+'/'+x.name&&expected[x.name]===x.id)&&new Set(r.repositories.map(x=>x.id)).size===n;}
   if(!exactRepos(probe,account.account==='reviewinbox'?REVIEW_INBOX_INSTALLATION:REPOSITORIES))bad('REPOSITORY_SCOPE_MISMATCH');
   const tokenResponse=await api('/app/installations/'+account.installation_id+'/access_tokens',jwt,'POST',{repository_ids:Object.values(REPOSITORIES),permissions:permissions(account)});
   if(typeof tokenResponse?.token!=='string'||!tokenResponse.token||Date.parse(tokenResponse.expires_at)<=now()+30000||!Number.isFinite(Date.parse(tokenResponse.expires_at)))bad('INVALID_INSTALLATION_TOKEN');
   const token=tokenResponse.token;secrets.push(token);checkPermissions(tokenResponse.permissions,account);
   const repos=await api('/installation/repositories?per_page=100',token);
   if(!exactRepos(repos))bad('REPOSITORY_SCOPE_MISMATCH');
   if(preflight?.kind==='review'){const pr=await api(root+'/pulls/'+preflight.number,token);if(pr?.head?.sha!==preflight.sha)bad('STALE_HEAD');if(pr?.state!=='open'||pr?.draft)bad('PR_NOT_REVIEWABLE');}
   if(preflight?.kind==='branch'||preflight?.kind==='file'){
    const metadata=await api(root,token);if(metadata?.default_branch===preflight.branch)bad('DEFAULT_BRANCH_WRITE_REFUSED');
    if(preflight.kind==='file'){let current;try{current=await api(root+'/contents/'+filePath(preflight.path)+'?ref='+encodeURIComponent(preflight.branch),token);}catch(e){if(e.status!==404||preflight.sha!==null)throw e;}if((current?.sha??null)!==preflight.sha)bad('STALE_FILE');}
   }
   const result=operation==='identity'?{app_id:account.app_id,app_slug:app.slug,owner:OWNER,permissions:permissions(account),repositories:repos.repositories.map(r=>({id:r.id,full_name:r.full_name})),...(account.account==='reviewinbox'?{installationRepositories:probe.repositories.map(r=>({id:r.id,full_name:r.full_name}))}:{}),expires_at:tokenResponse.expires_at}:await api(route,token,method,body);
   return {ok:true,receipt:{account:account.account,app_slug:app.slug,installation_id:account.installation_id,repo:OWNER+'/'+repo,operation,execution:'completed',url:typeof result?.html_url==='string'?result.html_url:app.html_url},result:clean(result,secrets)};
  }catch(e){return {ok:false,errorCode:e instanceof CoreError?e.code:'INTERNAL_ERROR',execution:e instanceof CoreError?e.execution:'not_executed',...(e instanceof CoreError&&e.status?{status:e.status}:{})};}
  finally{secrets.fill('');}
 }
 return {run};
}
module.exports={createClient,makeJwt,ACCOUNTS,APP_NAMES,allowedAppSlug,knownBotLogin,REPOSITORIES,OPERATION_NAMES,CoreError};
