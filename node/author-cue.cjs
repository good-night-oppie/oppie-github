'use strict';
// Pure decision function. sourceVerified flags are attestations from the caller's
// read-only source adapter, never evidence that this module performed a lookup.
const crypto=require('node:crypto');
const REPOS=new Set(['good-night-oppie/MontClip','good-night-oppie/MontClip-Cindy']);
const SHARED=new Set(['edwardtang','goodnightoppie','good-night-oppie']);
const SECURITY=new Set(['security','privacy','clean_room','secret','external_transmission']);
const ACTIONABLE=new Set(['changes_requested','qq_comment_change','confirmed_blocking','needs_author','ci_fix','conflict','missing_tests','missing_runtime_evidence','missing_privacy_note','missing_external_disclosure']);
const HOUR=3600000,MAX_AGE=15*60000;
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const validHead=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const time=x=>typeof x==='number'&&Number.isFinite(x)?x:(typeof x==='string'&&x.trim()?Date.parse(x):NaN);
const normalize=x=>String(x??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
class Invalid extends Error{}
function requireValue(ok,code){if(!ok)throw new Invalid(code);}
function planAuthorCues(input){
 try{
  requireValue(object(input),'INVALID_INPUT');
  const now=time(input.now),activation=time(input.activationAt),s=input.snapshot;
  requireValue(Number.isFinite(now)&&Number.isFinite(activation)&&activation<=now,'INVALID_CLOCK');
  requireValue(object(s)&&s.complete===true&&s.current===true&&s.degraded!==true,'INCOMPLETE_SNAPSHOT');
  const observed=time(s.observedAt);
  requireValue(Number.isFinite(observed)&&observed<=now&&now-observed<=MAX_AGE,'STALE_SNAPSHOT');
  requireValue(REPOS.has(s.repo)&&Number.isSafeInteger(s.number)&&s.number>0&&validHead(s.head),'INVALID_PR');
  requireValue(['open','closed'].includes(s.state)&&typeof s.draft==='boolean'&&typeof s.actor==='string'&&typeof s.body==='string'&&Array.isArray(s.findings),'INVALID_PR');
  requireValue(Array.isArray(input.roster)&&Array.isArray(input.ownership)&&Array.isArray(input.priorCues),'INCOMPLETE_CONTEXT');
  const names=new Map(),ids=new Map(),apps=new Map();
  for(const row of input.roster){
   requireValue(object(row)&&typeof row.id==='string'&&row.id&&typeof row.name==='string'&&row.name&&!SHARED.has(normalize(row.name))&&!ids.has(row.id),'INVALID_ROSTER');
   const name=normalize(row.name);requireValue(!names.has(name),'AMBIGUOUS_ROSTER');
   ids.set(row.id,row);names.set(name,row);
   if(row.appLogin!==undefined){requireValue(typeof row.appLogin==='string'&&row.appLogin&&!apps.has(row.appLogin),'AMBIGUOUS_APP_MAPPING');apps.set(row.appLogin,row);}
  }
  const qq=names.get('qq'),dd=names.get('dd'),deja=names.get('deja');
  requireValue(qq&&dd&&deja,'MISSING_ROUTING_ROSTER');
  const resolve=value=>ids.get(value)||names.get(normalize(value));
  const accepted=input.ownership.filter(row=>{
   if(!object(row)||row.head!==s.head||row.status!=='accepted'||row.sourceVerified!==true||typeof row.sourceMessage!=='string'||!row.sourceMessage.trim()||typeof row.next!=='string'||!row.next.trim())return false;
   const owner=resolve(row.owner),a=time(row.acceptedAt),r=time(row.reportAt);
   return owner&&owner.id!==qq.id&&Number.isFinite(a)&&a<=now&&Number.isFinite(r)&&r>=a;
  });
  requireValue(new Set(accepted.map(x=>resolve(x.owner).id)).size<=1,'AMBIGUOUS_ACCEPTANCE');
  accepted.sort((a,b)=>time(b.acceptedAt)-time(a.acceptedAt));
  const currentOwner=accepted[0];
  const declaration=s.body.split(/\r?\n/)[1]?.match(/^负责人[：:]\s*(\S.*?)\s*$/)?.[1];
  const declared=declaration&&!SHARED.has(normalize(declaration))?resolve(declaration):null;
  const actor=apps.get(s.actor);
  let routing;
  if(currentOwner)routing={recipient:resolve(currentOwner.owner),basis:'verified_acceptance',status:'accepted',acceptance:currentOwner};
  else if(actor?.id===qq.id)routing={recipient:dd,basis:'qq_author_to_dd',status:'pending_accept'};
  else if(declared&&declared.id!==qq.id)routing={recipient:declared,basis:'declared_owner',status:'pending_accept'};
  else if(actor&&actor.id!==qq.id)routing={recipient:actor,basis:'app_actor',status:'pending_accept'};
  else routing={recipient:deja,basis:'unmapped_to_deja',status:'pending_accept'};
  const prior=new Map(),transitions=[],proposals=[],suppressed=[];
  for(const p of input.priorCues){
   requireValue(object(p)&&typeof p.cue_id==='string'&&typeof p.head==='string'&&typeof p.recipient==='string'&&typeof p.question_fingerprint==='string'&&!prior.has(p.cue_id),'INVALID_PRIOR_CUES');
   requireValue(p.repo===s.repo&&p.number===s.number,'PRIOR_PR_MISMATCH');
   if(p.head!==s.head){if(!['superseded','closed'].includes(p.status))transitions.push({cue_id:p.cue_id,status:'superseded',delivery:'not_sent'});continue;}
   if(p.attempts!==undefined)requireValue(Number.isInteger(p.attempts)&&p.attempts>=0,'INVALID_PRIOR_CUES');
   for(const k of ['firstSeenAt','notifiedAt','acceptedAt','reportAt','reportReminderAt','noAcceptEscalatedAt','fixEscalatedAt'])if(p[k]!==undefined&&p[k]!==null)requireValue(Number.isFinite(time(p[k])),'INVALID_PRIOR_CLOCK');
   prior.set(p.cue_id,p);
  }
  if(s.state!=='open'||s.draft)return {ok:true,status:'inactive',reason:s.draft?'draft':'closed',proposals:[],suppressed:[],transitions,delivery:'not_sent'};
  for(const f of s.findings){
   requireValue(object(f)&&validHead(f.head)&&typeof f.kind==='string'&&typeof f.title==='string','INVALID_FINDING');
   const fingerprint=typeof f.id==='string'&&f.id.trim()?'finding:'+f.id.trim():digest([f.kind,normalize(f.reviewer),String(f.path??''),String(f.line??''),normalize(f.title)].join('|'));
   if(f.head!==s.head){suppressed.push({question_fingerprint:fingerprint,reason:'superseded_head'});continue;}
   const eventAt=time(f.occurredAt);requireValue(Number.isFinite(eventAt)&&eventAt<=now,'INVALID_FINDING_CLOCK');
   if(eventAt<=activation){suppressed.push({question_fingerprint:fingerprint,reason:'before_activation'});continue;}
   if(f.verified!==true){suppressed.push({question_fingerprint:fingerprint,reason:'unverified_finding'});continue;}
   const security=SECURITY.has(f.kind)||f.security===true;
   if(!security&&(f.requiresAuthor!==true||!ACTIONABLE.has(f.kind))){suppressed.push({question_fingerprint:fingerprint,reason:'not_author_action'});continue;}
   if(f.kind==='changes_requested'&&f.authorizedReviewer!==true){suppressed.push({question_fingerprint:fingerprint,reason:'unauthorized_review'});continue;}
   if(f.kind==='qq_comment_change'&&resolve(f.reviewer)?.id!==qq.id&&f.reviewer!==qq.appLogin){suppressed.push({question_fingerprint:fingerprint,reason:'not_qq_decision'});continue;}
   if(f.kind==='confirmed_blocking'&&f.blocking!==true){suppressed.push({question_fingerprint:fingerprint,reason:'not_blocking'});continue;}
   if(f.kind==='ci_fix'&&f.executable!==true){suppressed.push({question_fingerprint:fingerprint,reason:'not_actionable_ci'});continue;}
   const route=security?{recipient:qq,basis:'security_to_qq',status:'pending_accept'}:routing;
   const cueId=digest([s.repo+'#'+s.number,s.head,fingerprint,route.recipient.id].join('|'));
   const p=prior.get(cueId);
   const base={cue_id:cueId,question_fingerprint:fingerprint,repo:s.repo,number:s.number,head:s.head,recipient:route.recipient.id,recipient_name:route.recipient.name,owner_basis:route.basis,status:route.status,firstSeenAt:p?.firstSeenAt??f.occurredAt,title:f.title,delivery:'not_sent'};
   if(f.resolved===true&&f.resolutionVerified===true||p&&['answered','closed','superseded'].includes(p.status)){
    if(p&&!['answered','closed','superseded'].includes(p.status))transitions.push({cue_id:cueId,status:'answered',delivery:'not_sent'});
    suppressed.push({cue_id:cueId,reason:'resolved'});continue;
   }
   const alreadyAttempted=!!p&&(Number(p.attempts)>0||p.notifiedAt!=null||p.lastNotificationReceipt!=null||['notified','pending_accept','accepted','unknown_delivery'].includes(p.status));
   const add=(action,recipient,escalation)=>{
    const recipientCueId=digest([s.repo+'#'+s.number,s.head,fingerprint,recipient.id].join('|'));
    const actionId=digest(recipientCueId+'|'+action),recipientPrior=prior.get(recipientCueId);
    if(proposals.some(x=>x.action_id===actionId)||recipientPrior?.action_ids?.includes(actionId))return;
    if(action==='fix_timeout'&&recipientPrior?.fixEscalatedAt)return;
    proposals.push({...base,cue_id:recipientCueId,recipient:recipient.id,recipient_name:recipient.name,action,action_id:actionId,escalation:escalation??null});
   };
   if(security){
    if(!alreadyAttempted)add('security_escalation',qq,{immediate:true,reason:f.kind});
    else suppressed.push({cue_id:cueId,reason:'security_already_cued'});
    continue;
   }
   const own=route.acceptance;
   if(own){
    base.acceptedAt=own.acceptedAt;base.reportAt=own.reportAt;
    if(time(own.reportAt)>now){suppressed.push({cue_id:cueId,reason:'awaiting_report',reportAt:own.reportAt});continue;}
    if(!p?.reportReminderAt&&!p?.action_ids?.includes(digest(cueId+'|report_overdue')))add('report_overdue',route.recipient,{reason:'reportAt_elapsed'});
    const stage=f.stageEvent;
    if(object(stage)&&stage.sourceVerified===true&&stage.head===s.head&&['fix','push'].includes(stage.kind)){
     const started=time(stage.at);requireValue(Number.isFinite(started)&&started<=now,'INVALID_STAGE_CLOCK');
     if(now-started>=3*HOUR&&!p?.fixEscalatedAt)add('fix_timeout',deja,{reason:'fix_stage_3h',original_recipient:route.recipient.id,stageStartedAt:stage.at,backup_by_domain:{media:'Rea',ui:'DD/VV',copy:'JJ'},high_risk_decider:qq.id});
    }
    continue;
   }
   if(!alreadyAttempted){add('initial_cue',route.recipient);continue;}
   const first=time(p.firstSeenAt??f.occurredAt);requireValue(first<=now,'INVALID_PRIOR_CLOCK');
   if(now-first>=HOUR&&Number(p.attempts??1)<2&&!p.noAcceptEscalatedAt&&!p.action_ids?.includes(digest(cueId+'|no_accept_timeout'))){
    add('no_accept_timeout',route.recipient,{reason:'unaccepted_1h',notify:deja.id,maximum_author_attempts:2});
   }else suppressed.push({cue_id:cueId,reason:'already_cued'});
  }
  // Pure proposals only: the single Inbox writer must persist action IDs before
  // dispatch and reconcile unknown delivery rather than treating these as sent.
  return {ok:true,status:proposals.length?'proposed':'no_proposals',proposals,suppressed,transitions,delivery:'not_sent',activation_required:'single_writer_inbox_cutover',group_by:'recipient + repo + number + head'};
 }catch(e){return {ok:false,status:'degraded',errorCode:e instanceof Invalid?e.message:'INVALID_INPUT',proposals:[],transitions:[],delivery:'not_sent'};}
}
module.exports={planAuthorCues};
