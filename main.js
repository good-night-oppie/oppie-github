'use strict';
const MAX_OPERATION_BYTES=261120; // Operation budget stays below the host params limit; worker bounds the envelope separately.
const READ_ONLY_OPERATIONS=new Set(['identity','get_contents','list_branches','list_issues','get_issue','list_pulls','get_pull','pull_files','list_reviews','admin_get','list_rulesets','get_ruleset']);
const HOST_PRE_DISPATCH_CODES=new Set(['INVALID_REQUEST','PROCESS_START_FAILED','RATE_LIMITED']);
const safeFailure=(code,execution)=>({ok:false,errorCode:code,execution,message:'GitHub 操作未完成；请查看错误码。写入结果未知时，先读回确认再决定是否重试。'});
cindy.onHostMessage(async function(message) {
  if (message.type !== 'tool-call') return;
  const methods = {github_accounts:'accounts',github_import_key:'import',github:'run',github_operations:'operations',github_review_queue:'review',github_author_cue_plan:'author_cue',inbox_service:'inbox_service'};
  let sent=false,readOnly=false;
  try {
    if (!Object.prototype.hasOwnProperty.call(methods,message.tool)) throw Error('UNKNOWN_TOOL');
    let method=methods[message.tool],params=message.args||{};
    readOnly=['accounts','operations','author_cue'].includes(method)||(method==='run'&&READ_ONLY_OPERATIONS.has(params.operation))||(method==='inbox_service'&&params.action==='status');
    if(message.tool==='github'&&params.account==='qq'&&params.operation==='ruleset_update'){
      const a=params.args||{};
      if(typeof a.owner_authorization!=='string'||!a.owner_authorization)throw Error('OWNER_AUTHORIZATION_REQUIRED');
      const body='本次授权 QQ 修改 '+params.repo+' ruleset '+a.ruleset_id+' nonce:'+a.nonce+'：'+JSON.stringify(a.ruleset)+'\n引用：'+a.owner_authorization;
      if(body.length>300)throw Error('CONFIRMATION_TOO_LARGE');
      const approval=await cindy.confirm({body,confirmText:'仅批准本次',cancelText:'取消',danger:true});
      if(!approval.ok||!approval.confirmed)throw Error('OWNER_CONFIRMATION_REQUIRED');
      method='run_confirmed';params={input:params,confirmation:message.callId};
    }
    if(new TextEncoder().encode(JSON.stringify(params)).length>MAX_OPERATION_BYTES){await cindy.send({type:'tool-result',callId:message.callId,ok:true,result:safeFailure('REQUEST_TOO_LARGE','not_executed')});return;}
    sent=true;
    const response = await cindy.node.request({method,params,callId:message.callId,cancelWithCall:true,timeoutMs:120000});
    if(!response.ok){
      const code=typeof response.errorCode==='string'&&/^[A-Z_]{1,64}$/.test(response.errorCode)?response.errorCode:'WORKER_UNAVAILABLE';
      await cindy.send({type:'tool-result',callId:message.callId,ok:true,result:safeFailure(code,HOST_PRE_DISPATCH_CODES.has(code)||readOnly?'not_executed':'unknown')});return;
    }
    await cindy.send({type:'tool-result',callId:message.callId,ok:true,result:response.result});
  } catch (error) {
    const before=['UNKNOWN_TOOL','OWNER_AUTHORIZATION_REQUIRED','CONFIRMATION_TOO_LARGE','OWNER_CONFIRMATION_REQUIRED'];
    const code=!sent&&before.includes(error?.message)?error.message:'WORKER_UNAVAILABLE';
    await cindy.send({type:'tool-result',callId:message.callId,ok:true,result:safeFailure(code,sent&&!readOnly?'unknown':'not_executed')});
  }
});
