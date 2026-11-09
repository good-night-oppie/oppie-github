'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path');
const childEnv={...process.env};delete childEnv.NODE_DEBUG;
const script=path.join(__dirname,'../skills/oppie-github-work/scripts/review-request.cjs');
test('ReviewInbox stdin bridge refuses formal approval, identity overrides and unknown actions without credentials',()=>{
 for(const request of [{repo:'MontClip',operation:'submit_review',args:{event:'APPROVE'}},{account:'qq',repo:'MontClip',operation:'identity',args:{}},{repo:'MontClip',operation:'admin_update',args:{allow_merge_commit:true}}]){
  const r=cp.spawnSync(process.execPath,[script],{input:JSON.stringify(request),encoding:'utf8',env:childEnv,timeout:10000});
  assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).errorCode,'REVIEW_REQUEST_REFUSED');
 }
});

test('projected Skill works without the plugin source tree',()=>{
 const fs=require('node:fs'),os=require('node:os');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oppie-skill-test-'));
 try {
  fs.cpSync(path.dirname(path.dirname(script)),path.join(dir,'skill'),{recursive:true});
  const r=cp.spawnSync(process.execPath,[path.join(dir,'skill/scripts/review-request.cjs')],{
   input:JSON.stringify({repo:'MontClip',operation:'admin_update',args:{}}),encoding:'utf8',env:childEnv,timeout:10000,cwd:dir});
  assert.equal(r.status,1);assert.equal(r.stderr,'');
  assert.equal(JSON.parse(r.stdout).errorCode,'REVIEW_REQUEST_REFUSED');
  assert.ok(fs.existsSync(path.join(dir,'skill/scripts/secret-service.py')));
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
