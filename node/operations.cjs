'use strict';
module.exports={
 identity:'{}; verifies App, installation, permissions and exactly two repositories',
 get_contents:'{path?:string,ref?:branchOrSha}; bounded repository file/directory read',
 list_branches:'{page?:integer,per_page?:1..100}',
 list_issues:'{state?:open|closed|all,page?:integer,per_page?:1..100}',
 get_issue:'{number:integer}',
 create_issue:'{title:string,body?:string,labels?:string[]}',
 update_issue:'{number:integer,title?:string,body?:string,labels?:string[],state?:open|closed}',
 comment_issue:'{number:integer,body:string}; explicit user-authorized comments only',
 list_pulls:'{state?:open|closed|all,page?:integer,per_page?:1..100}',
 get_pull:'{number:integer}',
 pull_files:'{number:integer,page?:integer,per_page?:1..100}',
 create_pull:'{title:string,head:string,base:string,body?:string,draft?:boolean}',
 update_pull:'{number:integer,title?:string,body?:string,state?:open|closed}',
 list_reviews:'{number:integer,page?:integer,per_page?:1..100}',
 submit_review:'{number:integer,commit_id:40hex,event:COMMENT|APPROVE|REQUEST_CHANGES,body:string,comments?:array,draft_request?:string}; draft_request is caller-supplied explicit human request provenance (not verified by this plugin) for ReviewInbox COMMENT only, never automatic intake; checks live head; do not retry unknown outcome. Automatic review uses COMMENT only.',
 create_branch:'{branch:string,sha:40hex}; never writes the default branch',
 update_file:'{path:string,branch:string,expected_sha:null|40hex,message:string,content_base64:string}; optimistic concurrency; include Assisted-by: Cindy (https://cindy.app) in AI-assisted commit message',
 admin_get:'{}; QQ only',
 admin_update:'{allow_squash_merge?:boolean,allow_merge_commit?:boolean,allow_rebase_merge?:boolean,delete_branch_on_merge?:boolean}; QQ only; requires explicit user request for these settings'
};
