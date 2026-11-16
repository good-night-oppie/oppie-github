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
    // Ruleset changes need the owner's written authorization and this confirmation, whichever account runs them.
    if(message.tool==='github'&&params.operation==='ruleset_update'){
      const a=params.args||{};
      if(typeof a.owner_authorization!=='string'||!a.owner_authorization)throw Error('OWNER_AUTHORIZATION_REQUIRED');
      const body='本次授权 '+params.account+' 修改 '+params.repo+' ruleset '+a.ruleset_id+' nonce:'+a.nonce+'：'+JSON.stringify(a.ruleset)+'\n引用：'+a.owner_authorization;
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

// Settings page (settings.html) → main.js → Node. Only this page can reach the settings/* Node
// methods; Agent tools above never route to them. Writes need a real host confirmation click.
// The private key never travels here: the page stores it with PUT /secrets/app_private_key and
// the host injects it only into Node's settings/import_key.
(function settingsBridge(){
  if (typeof BroadcastChannel !== 'function') return;
  const channel = new BroadcastChannel('oppie-github-settings');
  // The host does not delete a manual secret after injection, so the vault copy of an imported
  // App key is removed here (all pages of this plugin share one partition and /secrets).
  const clearKeyCopy = () => (typeof fetch === 'function' ? fetch('/secrets/app_private_key', { method: 'DELETE' }).catch(() => {}) : Promise.resolve());
  void clearKeyCopy();
  const answer = (id, result) => channel.postMessage({ type: 'settings-result', id, result });
  const fail = (code) => ({ ok: false, errorCode: code, execution: 'not_executed' });
  const node = async (method, params) => {
    const response = await cindy.node.request({ method, params, timeoutMs: 120000 });
    if (!response || !response.ok) return fail(typeof response?.errorCode === 'string' && /^[A-Z_]{1,64}$/.test(response.errorCode) ? response.errorCode : 'WORKER_UNAVAILABLE');
    return response.result;
  };
  let busy = false;
  channel.onmessage = async (event) => {
    const m = event.data;
    if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(m.id)) return;
    if (!['settings-read', 'settings-save', 'settings-import-key'].includes(m.type)) return;
    if (m.type === 'settings-read') { answer(m.id, await node('settings/read', {}).catch(() => fail('WORKER_UNAVAILABLE'))); return; }
    if (busy) { answer(m.id, fail('BUSY')); return; }
    busy = true;
    try {
      if (m.type === 'settings-save') {
        const params = { config: m.config, expectedRevision: m.expectedRevision };
        const plan = await node('settings/propose', params);
        if (!plan.ok) { answer(m.id, plan); return; }
        if (plan.summary === '无变化') { answer(m.id, fail('NO_CHANGES')); return; }
        const body = '保存伙伴 GitHub 配置 r' + plan.revision + '→r' + plan.nextRevision + '：' + plan.summary;
        // Never abbreviate what the owner approves: an oversized summary must be split into smaller saves.
        if (body.length > 300) { answer(m.id, fail('CONFIRMATION_TOO_LARGE')); return; }
        const approval = await cindy.confirm({ body, confirmText: '保存', cancelText: '取消', danger: true });
        if (!approval.ok) { answer(m.id, fail(approval.errorCode === 'BUSY' ? 'BUSY' : 'OWNER_CONFIRMATION_UNAVAILABLE')); return; }
        if (!approval.confirmed) { answer(m.id, fail('OWNER_CONFIRMATION_REQUIRED')); return; }
        answer(m.id, await node('settings/save', { ...params, hash: plan.hash }));
        return;
      }
      if (m.type === 'settings-import-key') {
        if (typeof m.account !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(m.account)) { answer(m.id, fail('INVALID_IMPORT')); return; }
        // Owner 2026-11-16: read the installation, permissions and repositories from GitHub first and
        // show them on the card; store the key only if the owner confirms exactly those facts.
        try {
          const seen = await node('settings/import_key', { account: m.account, replace: m.replace === true, phase: 'inspect' });
          if (!seen.ok) { answer(m.id, seen); return; }
          const body = '为 ' + seen.summary + '。确认后用本机 DPAPI 加密保存私钥' + (m.replace === true ? '，并替换已保存的私钥' : '') + '。';
          if (body.length > 900) { answer(m.id, fail('CONFIRMATION_TOO_LARGE')); return; }
          const approval = await cindy.confirm({ body, confirmText: '导入', cancelText: '取消', danger: true });
          if (!approval.ok) { answer(m.id, fail('OWNER_CONFIRMATION_UNAVAILABLE')); return; }
          if (!approval.confirmed) { answer(m.id, fail('OWNER_CONFIRMATION_REQUIRED')); return; }
          answer(m.id, await node('settings/import_key', { account: m.account, replace: m.replace === true, phase: 'store', hash: seen.hash }));
        } finally { await clearKeyCopy(); }
      }
    } catch (_) {
      answer(m.id, { ok: false, errorCode: 'WORKER_UNAVAILABLE', execution: 'unknown' });
    } finally { busy = false; }
  };
})();
