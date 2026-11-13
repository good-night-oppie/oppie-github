'use strict';
// #16 diagnostic for the QQ account only. Prints no tokens, keys or headers.
//   node scripts/diagnose-enqueue.cjs                      read-only: installation permissions + token grant
//   node scripts/diagnose-enqueue.cjs --enqueue <n> <sha>  also ONE real enqueue_pull on MontClip#n via this branch's core
const store=require('../node/store.cjs');
const {createClient,makeJwt,ACCOUNTS}=require('../node/core.cjs');
const {initialPolicy}=require('../node/repository-policy.cjs');
const qq=ACCOUNTS.qq;
async function call(path,token,method='GET',body){
 const r=await fetch('https://api.github.com'+path,{method,redirect:'error',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'oppie-github-diagnose-16',Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const text=await r.text();let data;try{data=JSON.parse(text);}catch(_){data=text.slice(0,500);}return {status:r.status,data};
}
(async()=>{
 const secrets=[];const redact=v=>{let s=JSON.stringify(v,null,1);for(const x of secrets)if(x)s=s.split(x).join('[REDACTED]');return s;};
 let pem=(await store.load('qq')).privateKey;secrets.push(pem);const jwt=makeJwt(qq,pem);secrets.push(jwt);pem='';
 const inst=await call('/app/installations/'+qq.installation_id,jwt);
 console.log('1) installation',qq.installation_id,'status',inst.status,'permissions =',redact(inst.data?.permissions));
 const tok=await call('/app/installations/'+qq.installation_id+'/access_tokens',jwt,'POST',{repository_ids:[1441621868],permissions:{contents:'read',issues:'write',pull_requests:'write',metadata:'read'}});
 if(typeof tok.data?.token==='string')secrets.push(tok.data.token);
 console.log('2) token as plugin requests it (contents:read): status',tok.status,'granted =',redact(tok.data?.permissions));
 const i=process.argv.indexOf('--enqueue');
 if(i>0){
  const number=Number(process.argv[i+1]),sha=process.argv[i+2];
  const logged=async(url,init)=>{const r=await fetch(url,init);if(new URL(url).pathname==='/graphql'){const text=await r.clone().text();let q='';try{q=JSON.parse(init.body).query.slice(0,40);}catch(_){}console.log('   graphql',q,'-> HTTP',r.status,redact((()=>{try{return JSON.parse(text);}catch(_){return text.slice(0,500);}})()));}return r;};
  const client=createClient({repositoryPolicy:initialPolicy,credentials:async()=>(await store.load('qq')).privateKey,fetch:logged});
  console.log('3) enqueue_pull MontClip#'+number,sha);
  console.log('   result =',redact(await client.run({account:'qq',repo:'MontClip',operation:'enqueue_pull',args:{number,commit_id:sha}})));
 }
})().catch(e=>{console.error('diagnostic failed:',e?.code||e?.message||'error');process.exit(1);});
