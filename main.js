'use strict';
cindy.onHostMessage(async function(message) {
  if (message.type !== 'tool-call') return;
  const methods = {github_accounts:'accounts',github_import_key:'import',github:'run',github_operations:'operations',github_review_queue:'review',github_author_cue_plan:'author_cue'};
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
    const response = await cindy.node.request({method,params,callId:message.callId,cancelWithCall:true,timeoutMs:120000});
    if (!response.ok) throw Error('WORKER_UNAVAILABLE');
    await cindy.send({type:'tool-result',callId:message.callId,ok:true,result:response.result});
  } catch (_) {
    await cindy.send({type:'tool-result',callId:message.callId,ok:false,message:'GitHub 插件请求未完成。请检查插件连接状态；写操作先核对 GitHub 结果，不要直接重试。'});
  }
});
