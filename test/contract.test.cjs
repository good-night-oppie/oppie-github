'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const manifest=require('../ghost.json');const {REPOS}=require('../node/review-queue.cjs');
test('queue candidate identities are accepted by actual exposed tool schema',()=>{
 const schema=manifest.tools.find(t=>t.name==='github_review_queue').parameters;
 for(const repo of REPOS)assert.ok(schema.properties.repo.enum.includes(repo),repo+' cannot be claimed through Host');
});
