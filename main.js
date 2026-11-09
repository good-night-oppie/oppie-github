'use strict';
cindy.onHostMessage(async function(message) {
  if (message.type !== 'tool-call') return;
  const methods = {github_accounts:'accounts',github_import_key:'import',github:'run',github_operations:'operations',github_review_queue:'review',github_author_cue_plan:'author_cue',inbox_service:'inbox_service'};
  try {
    if (!Object.prototype.hasOwnProperty.call(methods,message.tool)) throw Error('UNKNOWN_TOOL');
    const response = await cindy.node.request({method:methods[message.tool],params:message.args || {},callId:message.callId,cancelWithCall:true,timeoutMs:120000});
    if (!response.ok) throw Error('WORKER_UNAVAILABLE');
    await cindy.send({type:'tool-result',callId:message.callId,ok:true,result:response.result});
  } catch (_) {
    await cindy.send({type:'tool-result',callId:message.callId,ok:false,message:'GitHub 插件请求未完成。请检查插件连接状态；写操作先核对 GitHub 结果，不要直接重试。'});
  }
});
