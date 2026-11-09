'use strict';
// Bounded stdin adapter for the existing Review Inbox publisher. No token output or environment mutation.
const {createClient}=require('../node/core.cjs');
const store=require('../node/store.cjs');
const deployment=require('../deployment.json');
let input='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{input+=chunk;if(Buffer.byteLength(input)>262144){process.stdout.write(JSON.stringify({ok:false,errorCode:'INPUT_TOO_LARGE'})+'\n');process.exit(1);}});
process.stdin.on('end',async()=>{
 try{
  const r=JSON.parse(input);
  if(!r||Array.isArray(r)||Object.keys(r).some(k=>!['repo','operation','args'].includes(k)))throw Error();
  if(!deployment.accounts.includes('reviewinbox')||!['identity','get_pull','pull_files','list_reviews','submit_review'].includes(r.operation))throw Error();
  if(r.operation==='submit_review'&&r.args?.event!=='COMMENT')throw Error();
  const result=await createClient({credentials:async()=>(await store.load('reviewinbox')).privateKey}).run({account:'reviewinbox',...r});
  process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=result.ok?0:1;
 }catch(_){process.stdout.write(JSON.stringify({ok:false,errorCode:'REVIEW_REQUEST_REFUSED'})+'\n');process.exitCode=1;}
});
