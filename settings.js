'use strict';
// Settings page for 伙伴 GitHub. Talks only to this plugin's main.js over BroadcastChannel.
// The private key goes straight to the host vault (PUT /secrets/app_private_key) and is never put
// into /kv, BroadcastChannel messages, page state or logs.
const $ = (s) => document.querySelector(s);
const channel = new BroadcastChannel('oppie-github-settings');
const waiting = new Map();
let seq = 0;
let state = null;   // last read from Node
let draft = null;   // edited copy of state.config (file format)

channel.onmessage = (event) => {
  const m = event.data;
  if (!m || m.type !== 'settings-result' || !waiting.has(m.id)) return;
  const resolve = waiting.get(m.id); waiting.delete(m.id); resolve(m.result);
};
function ask(message) {
  const id = 'p' + Date.now().toString(36) + (seq++);
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    setTimeout(() => { if (waiting.delete(id)) resolve({ ok: false, errorCode: 'NO_RESPONSE' }); }, 150000);
    channel.postMessage({ ...message, id });
  });
}
const ERRORS = {
  SCOPE_REVISION_CONFLICT: '配置已被别处修改，已重新读取，请再改一次。',
  OWNER_CONFIRMATION_REQUIRED: '已取消，没有保存。',
  OWNER_CONFIRMATION_UNAVAILABLE: '确认框没有打开，没有保存。',
  CONFIRMATION_TOO_LARGE: '一次改动太多，确认框放不下。请分几次保存。',
  NO_CHANGES: '没有改动。',
  INVALID_SCOPE_CONFIGURATION: '配置不合法，没有保存。',
  PROPOSAL_CHANGED: '保存时配置已变化，没有保存。请重新读取。',
  PRIVATE_KEY_NOT_PROVIDED: '没有收到私钥。',
  INVALID_PRIVATE_KEY: '私钥格式不对。',
  ACCOUNT_NOT_CONFIGURED: '这个账号还没保存到配置里，请先保存账号。',
  APP_IDENTITY_MISMATCH: 'GitHub 返回的 App 与配置的 App ID 或 slug 不一致，私钥没有保存。',
  INSTALLATION_MISMATCH: '安装 ID 与这个 App 不匹配，私钥没有保存。',
  PERMISSION_MISMATCH: 'App 权限与要求不一致，私钥没有保存。',
  ACCOUNT_EXISTS: '这个账号已经有私钥；如需替换请勾选「替换已保存的私钥」。',
  BUSY: '另一个确认正在进行，请稍后再试。',
  NO_RESPONSE: '插件后台没有响应。',
};
function say(text, isError) { const el = $('#message'); el.textContent = text || ''; el.className = isError ? 'error' : 'muted'; }
function explain(result) {
  if (result?.ok) return '';
  const reason = result?.details?.reason ? '（' + result.details.reason + '）' : '';
  return (ERRORS[result?.errorCode] || ('未完成：' + (result?.errorCode || '未知错误'))) + reason;
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const isBuiltin = (name) => state.builtinAccounts.includes(name);
function td(text, cls) { const c = document.createElement('td'); c.textContent = text; if (cls) c.className = cls; return c; }
function button(label, onClick) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = onClick; return b; }

function changed() { return draft && state?.config && JSON.stringify(draft) !== JSON.stringify(state.config); }
function render() {
  if (!state) return;
  $('#status').textContent = state.source === 'invalid'
    ? '当前配置文件无效（' + (state.error?.reason || state.error?.code || '') + '），所有 GitHub 调用都会被拒绝。请修好或删除插件存储目录里的 scope-config.json。'
    : '配置修订号 r' + state.revision + (state.source === 'default' ? '（使用内置默认值）' : '') + '。保存后下一次调用立即生效，不用重启。';
  $('#status').className = state.source === 'invalid' ? 'error' : 'muted';
  if (!draft) return;
  const roleText = { write: '读写', reviewer: '只读+评论+评审', review: '只读+评审', comment_review: '仅 COMMENT 评审' };
  const names = [...new Set([...state.builtinAccounts, ...Object.keys(draft.newAccounts)])];
  const tbody = $('#accounts tbody'); tbody.replaceChildren();
  for (const name of names) {
    const tr = document.createElement('tr');
    const enabled = draft.accounts.includes(name);
    const a = draft.newAccounts[name];
    tr.append(td(name + (enabled ? '' : '（停用）')));
    tr.append(td(a ? a.appName + ' · ' + a.appSlug + ' · App ' + a.appId + ' · 安装 ' + a.installationId : '内置'));
    const blocked = Object.keys(draft.repositoryRoles).filter((r) => draft.repositoryRoles[r][name] === 'none');
    tr.append(td((a ? roleText[a.role] + (a.operations ? '，' + a.operations.length + ' 项操作' : '') : '按代码')
      + (blocked.length ? '，不可用：' + blocked.join('、') : '')));
    tr.append(td(state.keys.includes(name) ? '已保存' : '未导入'));
    const actions = document.createElement('td');
    actions.append(button(enabled ? '停用' : '启用', () => {
      draft.accounts = enabled ? draft.accounts.filter((x) => x !== name) : [...draft.accounts, name]; render();
    }));
    if (a) {
      actions.append(button('修改', () => fillAccount(name)));
      actions.append(button('删除', () => {
        delete draft.newAccounts[name];
        draft.accounts = draft.accounts.filter((x) => x !== name);
        for (const table of Object.values(draft.repositoryRoles)) delete table[name];
        render();
      }));
    }
    tr.append(actions); tbody.append(tr);
  }
  const rbody = $('#repos tbody'); rbody.replaceChildren();
  for (const [name, id] of Object.entries(draft.repositories)) {
    const tr = document.createElement('tr');
    tr.append(td(name), td(String(id)));
    const opt = document.createElement('td'); const box = document.createElement('input'); box.type = 'checkbox';
    box.checked = draft.optionalRepositories.includes(name);
    box.onchange = () => { draft.optionalRepositories = box.checked ? [...draft.optionalRepositories, name] : draft.optionalRepositories.filter((x) => x !== name); render(); };
    opt.append(box); tr.append(opt);
    const actions = document.createElement('td');
    actions.append(button('删除', () => {
      delete draft.repositories[name];
      draft.optionalRepositories = draft.optionalRepositories.filter((x) => x !== name);
      delete draft.twoRepositories[name]; delete draft.repositoryRoles[name];
      render();
    }));
    tr.append(actions); rbody.append(tr);
  }
  renderAccountRepos();
  const select = $('#key-account'); const keep = select.value; select.replaceChildren();
  for (const name of state.config.accounts) { const o = document.createElement('option'); o.value = name; o.textContent = name; select.append(o); }
  if (state.config.accounts.includes(keep)) select.value = keep;
  $('#pending').textContent = changed() ? '有未保存的修改。保存时会弹出确认框，列出全部改动。' : '';
  $('#save').disabled = !changed();
}
function renderOps() {
  const box = $('#acc-ops'); box.replaceChildren();
  for (const op of state.accountOperationCeiling) {
    const l = document.createElement('label'); const c = document.createElement('input');
    c.type = 'checkbox'; c.value = op; l.append(c, document.createTextNode(op)); box.append(l);
  }
}
// Usable repositories for the account in the form. Unchecked = repository role 'none' for that
// account (e.g. whether AD may use cindy is the owner's choice here, not in code).
function renderAccountRepos(uncheckedFor) {
  const box = $('#acc-repos'); if (!box || !draft) return;
  const unchecked = uncheckedFor ?? new Set([...box.querySelectorAll('input')].filter((c) => !c.checked).map((c) => c.value));
  box.replaceChildren();
  for (const repo of Object.keys(draft.repositories)) {
    const l = document.createElement('label'); const c = document.createElement('input');
    c.type = 'checkbox'; c.value = repo; c.checked = !unchecked.has(repo); l.append(c, document.createTextNode(repo)); box.append(l);
  }
}
function fillAccount(name) {
  const a = draft.newAccounts[name]; $('#account-form-box').open = true;
  $('#acc-name').value = name; $('#acc-app-name').value = a.appName; $('#acc-slug').value = a.appSlug;
  $('#acc-app-id').value = a.appId; $('#acc-install-id').value = a.installationId; $('#acc-role').value = a.role;
  for (const c of $('#acc-ops').querySelectorAll('input')) c.checked = !!a.operations?.includes(c.value);
  renderAccountRepos(new Set(Object.keys(draft.repositoryRoles).filter((r) => draft.repositoryRoles[r][name] === 'none')));
}
$('#acc-apply').onclick = () => {
  const name = $('#acc-name').value.trim();
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(name)) return say('账号名只能用小写字母、数字和短横线，并以字母开头。', true);
  if (isBuiltin(name)) return say('内置账号不能修改，只能停用或启用。', true);
  const appId = Number($('#acc-app-id').value.trim()), installationId = Number($('#acc-install-id').value.trim());
  if (!Number.isSafeInteger(appId) || appId < 1 || !Number.isSafeInteger(installationId) || installationId < 1) return say('App ID 和 Installation ID 必须是正整数。', true);
  const appName = $('#acc-app-name').value.trim();
  if (!/^[A-Za-z0-9-]{1,34}$/.test(appName)) return say('App 名称只能包含字母、数字和短横线。', true);
  const appSlug = ($('#acc-slug').value.trim() || appName.toLowerCase());
  const ops = [...$('#acc-ops').querySelectorAll('input:checked')].map((c) => c.value);
  if (ops.length && !ops.includes('identity')) ops.unshift('identity');
  const blockedRepos = [...$('#acc-repos').querySelectorAll('input')].filter((c) => !c.checked).map((c) => c.value);
  if (blockedRepos.length >= Object.keys(draft.repositories).length) return say('至少要留一个可用仓库。', true);
  for (const repo of Object.keys(draft.repositories)) {
    const table = draft.repositoryRoles[repo];
    if (blockedRepos.includes(repo)) draft.repositoryRoles[repo] = { ...(table || {}), [name]: 'none' };
    else if (table && table[name] === 'none') {
      delete table[name];
      if (!Object.keys(table).length && !state.config?.repositoryRoles?.[repo]) delete draft.repositoryRoles[repo];
    }
  }
  draft.newAccounts[name] = { appId, installationId, appName, appSlug, role: $('#acc-role').value, ...(ops.length ? { operations: ops } : {}) };
  if (!draft.accounts.includes(name)) draft.accounts.push(name);
  say('已放入待保存：' + name + '。点「保存」后生效。'); render();
};
$('#repo-add').onclick = () => {
  const name = $('#repo-name').value.trim(), id = Number($('#repo-id').value.trim());
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || name === '.' || name === '..') return say('仓库名不合法（不带 owner）。', true);
  if (!Number.isSafeInteger(id) || id < 1) return say('仓库 ID 必须是正整数（GitHub 仓库的数字 ID）。', true);
  draft.repositories[name] = id; say('已放入待保存：' + name + '。新仓库默认是可选的，未安装时只影响它自己。');
  if (!draft.optionalRepositories.includes(name)) draft.optionalRepositories.push(name);
  render();
};
async function load(message) {
  const result = await ask({ type: 'settings-read' });
  if (!result?.ok) { $('#status').textContent = explain(result); $('#status').className = 'error'; return; }
  state = result; draft = state.config ? clone(state.config) : null;
  renderOps(); render(); say(message || '');
}
$('#reload').onclick = () => load('已重新读取。');
$('#save').onclick = async () => {
  $('#save').disabled = true; say('等待确认…');
  const { schemaVersion, revision, ...config } = draft;
  const result = await ask({ type: 'settings-save', config, expectedRevision: state.revision });
  if (result?.ok) return load('已保存，修订号 r' + result.revision + '：' + result.summary);
  if (result?.errorCode === 'SCOPE_REVISION_CONFLICT') await load();
  say(explain(result), true); render();
};
$('#key-import').onclick = async () => {
  const account = $('#key-account').value, pem = $('#key-pem').value.trim();
  if (!account) return say('请先选择账号。', true);
  if (!pem.includes('PRIVATE KEY')) return say('请粘贴完整的 PEM 私钥。', true);
  $('#key-import').disabled = true; $('#key-pem').value = '';
  let result;
  try {
    const put = await fetch('/secrets/app_private_key', { method: 'PUT', body: JSON.stringify({ value: pem }) });
    if (put.status !== 204) { say('私钥没能交给 Cindy 保险库（HTTP ' + put.status + '）。', true); return; }
    say('等待确认…');
    result = await ask({ type: 'settings-import-key', account, replace: $('#key-replace').checked });
  } finally {
    // Always clear the vault copy; the DPAPI-protected store is the only persistent copy.
    await fetch('/secrets/app_private_key', { method: 'DELETE' }).catch(() => {});
    $('#key-import').disabled = false;
  }
  if (result?.ok) {
    say('已导入 ' + account + ' 的私钥，GitHub 核对通过（' + result.app_slug + '，' + (result.installationRepositorySelection === 'all' ? '全部仓库' : '指定仓库') + '）。');
    await load('已导入 ' + account + ' 的私钥并通过 GitHub 核对。');
  } else say(explain(result), true);
};
// A key copy left by a closed or crashed page is removed as soon as the settings page opens.
async function clearLeftoverKey() {
  try {
    const list = await (await fetch('/secrets')).json();
    const rows = Array.isArray(list) ? list : Array.isArray(list?.secrets) ? list.secrets : [];
    if (rows.some((r) => r && r.key === 'app_private_key' && r.saved)) await fetch('/secrets/app_private_key', { method: 'DELETE' });
  } catch (_) { /* best effort; main.js also clears at startup and after each import */ }
}
clearLeftoverKey().finally(() => load());
