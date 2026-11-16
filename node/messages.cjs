'use strict';
// Owner-facing explanations added by the worker (not bundled into the Skill script, whose
// esbuild output escapes non-ASCII text).
// INSTALLATION_PERMISSION_MISSING: say what the App installation lacks and where to add it.
function explain(result){
 const d=result?.details;
 if(result?.errorCode!=='INSTALLATION_PERMISSION_MISSING'||!d||!Array.isArray(d.missing))return result;
 const items=d.missing.map(m=>m.permission+':'+m.required+'（现为 '+m.installed+'）').join('，');
 return {...result,message:'GitHub App '+d.app+' 的安装缺少：'+items+'。请主人在 App 设置的 Permissions 里加上（'+d.appPermissionsUrl+'），再到组织的安装页接受权限更新（'+d.installationUrl+'）。'};
}
module.exports={explain};
