'use strict';
const MAX_FILE_CONTENT=700000, NATIVE_PARAMS_BUDGET=240000, UPLOAD_CHUNK=65536;
function bytes(value){return new TextEncoder().encode(JSON.stringify(value)).length;}
function localFailure(code){return {ok:false,errorCode:code,execution:'not_executed'};}
async function requestNative(method,params,callId){
 if(bytes(params)>NATIVE_PARAMS_BUDGET)return {ok:true,result:localFailure('REQUEST_TOO_LARGE')};
 return cindy.node.request({method,params,callId,cancelWithCall:true,timeoutMs:120000});
}
async function runFile(input,callId){
 const content=input.args?.content_base64;
 if(typeof content!=='string')return {ok:true,result:localFailure('INVALID_ARGUMENT')};
 if(content.length>MAX_FILE_CONTENT)return {ok:true,result:localFailure('FILE_TOO_LARGE')};
 if(bytes(input)<=NATIVE_PARAMS_BUDGET)return requestNative('run',input,callId);
 const {content_base64,...metadata}=input.args;
 const header={...input,args:metadata};
 let uploadId=null,committing=false;
 try{
  const started=await requestNative('upload_begin',{input:header,total:content.length},callId);
  if(!started.ok)return {ok:true,result:localFailure('UPLOAD_INTERRUPTED')};
  if(!started.result?.ok)return started;
  uploadId=started.result.uploadId;
  if(typeof uploadId!=='string'||!/^[a-f0-9]{32}$/.test(uploadId))return {ok:true,result:localFailure('INVALID_UPLOAD_RESPONSE')};
  for(let offset=0;offset<content.length;offset+=UPLOAD_CHUNK){
   const part=content.slice(offset,offset+UPLOAD_CHUNK);
   const response=await requestNative('upload_chunk',{uploadId,offset,content:part},callId);
   if(!response.ok)return {ok:true,result:localFailure('UPLOAD_INTERRUPTED')};
   if(!response.result?.ok)return response;
   if(response.result.received!==offset+part.length)return {ok:true,result:localFailure('INVALID_UPLOAD_RESPONSE')};
  }
  committing=true;
  const response=await requestNative('upload_finish',{uploadId},callId);
  if(!response.ok)return {ok:true,result:{ok:false,errorCode:'WRITE_OUTCOME_UNKNOWN',execution:'unknown'}};
  return response;
 }catch{
  return {ok:true,result:{ok:false,errorCode:committing?'WRITE_OUTCOME_UNKNOWN':'UPLOAD_INTERRUPTED',execution:committing?'unknown':'not_executed'}};
 }finally{
  if(uploadId&&!committing){try{await requestNative('upload_abort',{uploadId},callId);}catch{ /* Bounded temporary memory also expires; never retry the write. */ }}
 }
}
cindy.onHostMessage(async function(message) {
  if (message.type !== 'tool-call') return;
  const methods = {github_accounts:'accounts',github_import_key:'import',github:'run',github_operations:'operations',github_review_queue:'review',github_author_cue_plan:'author_cue',inbox_service:'inbox_service'};
  try {
    if (!Object.prototype.hasOwnProperty.call(methods,message.tool)) throw Error('UNKNOWN_TOOL');
    let method=methods[message.tool],params=message.args||{};
    if(message.tool==='github'&&params.account==='qq'&&params.operation==='ruleset_update'){
      const a=params.args||{};
      if(typeof a.owner_authorization!=='string'||!a.owner_authorization)throw Error('OWNER_AUTHORIZATION_REQUIRED');
      const body='本次授权 QQ 修改 '+params.repo+' ruleset '+a.ruleset_id+' nonce:'+a.nonce+'：'+JSON.stringify(a.ruleset)+'\n引用：'+a.owner_authorization;
      if(body.length>300)throw Error('CONFIRMATION_TOO_LARGE');
      const approval=await cindy.confirm({body,confirmText:'仅批准本次',cancelText:'取消',danger:true});
      if(!approval.ok||!approval.confirmed)throw Error('OWNER_CONFIRMATION_REQUIRED');
      method='run_confirmed';params={input:params,confirmation:message.callId};
    }
    const response = method==='run' && params.operation==='update_file'
      ? await runFile(params,message.callId)
      : await requestNative(method,params,message.callId);
    if (!response.ok) throw Error('WORKER_UNAVAILABLE');
    await cindy.send({type:'tool-result',callId:message.callId,ok:true,result:response.result});
  } catch (_) {
    await cindy.send({type:'tool-result',callId:message.callId,ok:false,message:'GitHub 插件请求未完成。请检查插件连接状态；写操作先核对 GitHub 结果，不要直接重试。'});
  }
});
