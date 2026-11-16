'use strict';
// Compare an installed (or unpacked) plugin directory byte for byte with the files committed at a
// git revision of this repository (QQ review of #32: the installed seven-roles.1 bundle did not
// match its own source). Usage: node scripts/verify-installed.cjs <installedDir> [rev=HEAD]
// Packaging skips .git, node_modules, hidden files and *.cindy; the host adds .cindy-trust.json.
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const [dir,rev='HEAD']=process.argv.slice(2);
if(!dir){console.error('usage: node scripts/verify-installed.cjs <installedDir> [rev]');process.exit(2);}
const git=(...a)=>execFileSync('git',['-C',root,...a],{maxBuffer:64*1024*1024});
const skip=p=>p.split('/').some(s=>s.startsWith('.')||s==='node_modules')||p.endsWith('.cindy');
const tracked=git('ls-tree','-r','--name-only',rev).toString('utf8').split('\n').filter(Boolean).filter(p=>!skip(p));
// Submodule files (vendor/review-inbox) are compared from the checked-out submodule at that commit.
const submodules=git('ls-tree','-r',rev).toString('utf8').split('\n').filter(l=>l.startsWith('160000 commit ')).map(l=>{const [meta,p]=l.split('\t');return {path:p,commit:meta.split(' ')[2]};});
const expected=new Map();
for(const p of tracked){if(submodules.some(s=>s.path===p))continue;expected.set(p,git('show',rev+':'+p));}
for(const s of submodules){
 const sub=path.join(root,s.path);
 const files=execFileSync('git',['-C',sub,'ls-tree','-r','--name-only',s.commit]).toString('utf8').split('\n').filter(Boolean).filter(p=>!skip(p));
 for(const f of files)expected.set(s.path+'/'+f,execFileSync('git',['-C',sub,'show',s.commit+':'+f],{maxBuffer:64*1024*1024}));
}
const actual=new Set();
(function walk(rel){for(const e of fs.readdirSync(path.join(dir,rel),{withFileTypes:true})){const p=rel?rel+'/'+e.name:e.name;if(skip(p))continue;if(e.isDirectory())walk(p);else actual.add(p);}})('');
const problems=[];
for(const [p,bytes] of expected){if(!actual.has(p)){problems.push('missing '+p);continue;}if(!fs.readFileSync(path.join(dir,p)).equals(bytes))problems.push('differs '+p);}
for(const p of actual)if(!expected.has(p))problems.push('extra '+p);
if(problems.length){console.error(problems.join('\n'));console.error(problems.length+' problem(s) against '+rev);process.exit(1);}
console.log('installed files match '+rev+' byte for byte ('+expected.size+' files)');
