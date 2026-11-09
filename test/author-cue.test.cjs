'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planAuthorCues}=require('../node/author-cue.cjs');
const H=3600000,NOW=1800000000000,HEAD='a'.repeat(40),OLD='b'.repeat(40);
const roster=['BB','Cindy','Deja','DD','GG','JJ','PG','QQ','Rea','Video','VV'].map(name=>({id:'id-'+name.toLowerCase(),name,appLogin:'oppie-agent-'+name.toLowerCase()+'[bot]'}));
const finding=(extra={})=>({id:'f1',head:HEAD,kind:'needs_author',title:'Need regression test',occurredAt:NOW-1000,verified:true,requiresAuthor:true,...extra});
function input(extra={}){return {now:NOW,activationAt:NOW-10*H,snapshot:{complete:true,current:true,observedAt:NOW,repo:'good-night-oppie/MontClip',number:9,head:HEAD,state:'open',draft:false,actor:'EdwardTang',body:'Title\n负责人：Deja',findings:[finding()]},roster,ownership:[],priorCues:[],...extra};}
function accepted(extra={}){return {head:HEAD,status:'accepted',owner:'DD',acceptedAt:NOW-2*H,reportAt:NOW+H,next:'Fix regression',sourceMessage:'session/message/verified',sourceVerified:true,...extra};}
function prior(proposal,extra={}){return {...proposal,status:'pending_accept',attempts:1,notifiedAt:NOW-2*H,firstSeenAt:NOW-2*H,...extra};}
test('declared owner remains pending acceptance; shared actor never becomes owner',()=>{const r=planAuthorCues(input());assert.equal(r.ok,true);assert.equal(r.proposals[0].recipient,'id-deja');assert.equal(r.proposals[0].status,'pending_accept');assert.equal(r.proposals[0].delivery,'not_sent');});
test('initial cue once, stable fingerprint across comment IDs and whitespace',()=>{
 const i=input();delete i.snapshot.findings[0].id;const r=planAuthorCues(i),p=r.proposals[0];i.priorCues=[prior(p,{firstSeenAt:NOW-1000})];i.snapshot.findings[0].comment_id=91;i.snapshot.findings[0].title='  Need   regression test ';const r2=planAuthorCues(i);assert.equal(r2.proposals.length,0);assert.equal(r2.suppressed[0].cue_id,p.cue_id);
});
test('timeline finding works after review request list cleared',()=>{const i=input();i.snapshot.reviewRequests=[];i.snapshot.findings=[finding({kind:'changes_requested',authorizedReviewer:true,reviewer:'QQ',source:'timeline'})];assert.equal(planAuthorCues(i).proposals.length,1);});
test('old head finding/owner never carries over; old cues superseded',()=>{
 const p=planAuthorCues(input()).proposals[0];const i=input({ownership:[accepted({head:OLD})],priorCues:[prior({...p,head:OLD})]});i.snapshot.findings=[finding({head:OLD})];const r=planAuthorCues(i);assert.equal(r.proposals.length,0);assert.equal(r.transitions[0].status,'superseded');
});
test('verified acceptance takes priority, unverified source falls back to declaration',()=>{
 let r=planAuthorCues(input({ownership:[accepted()]}));assert.equal(r.proposals.length,0);assert.equal(r.suppressed[0].reason,'awaiting_report');
 r=planAuthorCues(input({ownership:[accepted({sourceVerified:false})]}));assert.equal(r.proposals[0].recipient,'id-deja');assert.equal(r.proposals[0].status,'pending_accept');
});
test('one-hour noaccept escalation occurs once; queued transport is not acceptance',()=>{
 const p=planAuthorCues(input()).proposals[0];let i=input({priorCues:[prior(p,{lastNotificationReceipt:{state:'queued'}})]});let r=planAuthorCues(i);assert.equal(r.proposals[0].action,'no_accept_timeout');assert.equal(r.proposals[0].escalation.notify,'id-deja');
 i.priorCues=[prior(p,{attempts:2,noAcceptEscalatedAt:NOW-H})];r=planAuthorCues(i);assert.equal(r.proposals.length,0);
});
test('reportAt future suppresses; overdue once; fix stage three-hour clock uses verified event',()=>{
 const i=input({ownership:[accepted({reportAt:NOW-1})]});i.snapshot.updatedAt=NOW;i.snapshot.findings=[finding({stageEvent:{head:HEAD,kind:'fix',at:NOW-3*H,sourceVerified:true}})];let r=planAuthorCues(i);assert.deepEqual(r.proposals.map(x=>x.action),['report_overdue','fix_timeout']);assert.equal(r.proposals[1].recipient,'id-deja');
 const p=r.proposals[0];i.priorCues=[prior(p,{reportReminderAt:NOW-1,fixEscalatedAt:NOW-1,status:'accepted'})];assert.equal(planAuthorCues(i).proposals.length,0);
 i.ownership=[accepted()];i.priorCues=[];assert.equal(planAuthorCues(i).proposals.length,0);
});
test('old PR updatedAt alone never starts fix timer',()=>{const i=input({ownership:[accepted({reportAt:NOW-1})]});i.snapshot.updatedAt=NOW-5*H;assert.deepEqual(planAuthorCues(i).proposals.map(x=>x.action),['report_overdue']);});
test('QQ actor routes DD; unmapped shared actor routes Deja; app actor remains pending',()=>{
 const i=input();i.snapshot.body='Title';i.snapshot.actor='oppie-agent-qq[bot]';assert.equal(planAuthorCues(i).proposals[0].recipient,'id-dd');i.snapshot.actor='GoodNightOppie';assert.equal(planAuthorCues(i).proposals[0].recipient,'id-deja');i.snapshot.actor='oppie-agent-jj[bot]';let p=planAuthorCues(i).proposals[0];assert.equal(p.recipient,'id-jj');assert.equal(p.status,'pending_accept');
});
test('security immediately routes QQ even during accepted report wait',()=>{const i=input({ownership:[accepted()]});i.snapshot.findings=[finding({kind:'secret',requiresAuthor:false})];const p=planAuthorCues(i).proposals[0];assert.equal(p.action,'security_escalation');assert.equal(p.recipient,'id-qq');assert.equal(p.escalation.immediate,true);});
test('incomplete, stale, degraded or conflicting acceptance fails closed',()=>{
 for(const edit of [{complete:false},{current:false},{observedAt:NOW-16*60000},{degraded:true}]){const i=input();Object.assign(i.snapshot,edit);const r=planAuthorCues(i);assert.equal(r.ok,false);assert.equal(r.status,'degraded');assert.deepEqual(r.proposals,[]);}
 const r=planAuthorCues(input({ownership:[accepted(),accepted({owner:'JJ'})]}));assert.equal(r.errorCode,'AMBIGUOUS_ACCEPTANCE');
});
test('draft/before-activation/resolved/nonaction findings do not cue',()=>{
 const i=input();i.snapshot.draft=true;assert.equal(planAuthorCues(i).status,'inactive');i.snapshot.draft=false;i.snapshot.findings=[finding({occurredAt:i.activationAt}),finding({id:'f2',resolved:true,resolutionVerified:true}),finding({id:'f3',kind:'queued'})];assert.equal(planAuthorCues(i).proposals.length,0);
});
test('dedup action ids survive restarted pure planner instance; mutation free',()=>{const i=input();const before=JSON.stringify(i);const p=planAuthorCues(i).proposals[0];assert.equal(JSON.stringify(i),before);i.priorCues=[prior(p,{action_ids:[p.action_id],firstSeenAt:NOW-1})];assert.equal(planAuthorCues(i).proposals.length,0);});
test('coordination escalation cue id is bound to actual Deja recipient and deduped',()=>{
 const crypto=require('node:crypto');const i=input({ownership:[accepted({reportAt:NOW-1})]});i.snapshot.findings=[finding({stageEvent:{head:HEAD,kind:'push',at:NOW-4*H,sourceVerified:true}})];
 const r=planAuthorCues(i),p=r.proposals.find(x=>x.action==='fix_timeout');assert.equal(p.cue_id,crypto.createHash('sha256').update(['good-night-oppie/MontClip#9',HEAD,'finding:f1','id-deja'].join('|')).digest('hex'));
 i.priorCues=[prior(p,{fixEscalatedAt:NOW-1,action_ids:[p.action_id]})];assert.equal(planAuthorCues(i).proposals.some(x=>x.action==='fix_timeout'),false);
});
