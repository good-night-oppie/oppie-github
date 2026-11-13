# QQ review operations candidate

Final review belongs to the owner or Rea. QQ may inspect but must not self-approve this tool. No installation/deployment is included.

## Verified scope

QQOppieXYZ App5665946 / installation179806512, ownergood-night-oppie. Metadata-only App-key probe independently verified exact six names+IDs: MontClip1441621868, MontClip-Cindy1446532339, montclip-rsi1450602468, rsi-playbooks1450603260, oppie-github1451885379, sglang-review-inbox1451900929.

The registration currently lists18permission keys (metadata plus17others), but the installation currently grants only5: contents/issues/pull_requests/administration write, metadata read. Registration is not installation consent. Candidate requests only contents read, metadata read, issues/pull_requests/administration write and explicitly six repository_ids. It verifies the token's exact repository set. QQ permission checks accept sufficient known levels and additional permissions; operation allowlists never expand with token grants. Other accounts' policies are unchanged.

## Exposed QQ operations

Reads: existing repository/Issue/PR reads, list_rulesets/get_ruleset. Writes: submit_review (COMMENT/APPROVE/REQUEST_CHANGES), enqueue_pull (current-head-bound GraphQL, no auto-merge fallback), dismiss_review, ruleset_update. Authoring create/update PRs, branches, files, Issues/comments and old generic admin_update/admin_get are refused before reading credentials. No delete-repository/secrets/workflow authoring route.

Ruleset update accepts GitHub's optional name,target,enforcement,bypass_actors,conditions,rules fields, but caps the JSON patch at160characters so the complete request and reference fit the native300character confirmation. Larger changes are refused, not truncated. This is intentionally bounded; future larger edits need a reviewed UI.

Each update requires owner_authorization as an allowed-repository GitHub Issue/PR comment URL. A nonempty string is insufficient. Native cindy.confirm must return ok AND confirmed for this exact call; cancellation/unavailable/timeout fails closed. After token acquisition, the reference is reread and must match the exact URL, owner EdwardTang login and immutable GitHub userID3278807/typeUser, a creation time within the last24hours (not future), and the exact directive described below. Only the target repository or MontClip may hold the reference. Current Host confirmation is the actual per-call authorization; a historical owner comment alone is NOT consent. References outside the pinned repos, absent/non-owner references, or missing confirmation cannot write. No authorization is cached. Host callId is internal to the confirmed worker route, not accepted in tool args.

This retains the existing explicit-account architecture: it is not Host-attested teammate isolation and cannot secure against arbitrary local native code modifying the plugin or invoking internals. Final reviewer must assess that boundary. No approval dialogs or real administrative writes were exercised during development; Host confirmation was mocked in tests only.

## Validation and limits

Red test observed six-repo QQ identity rejection before implementation. Initial full suite80passed; final focused27passed after adding owner-reference verification; final full result recorded at delivery. Pinned esbuild0.27.0+lock/build/check used, no manual bundle edits. Live candidate identity through QQ App succeeded with six repos and contents:read/minimal requested permissions. No actual enqueue/dismiss/review/ruleset mutation executed.

Official docs specify pull_requests:write for dismiss, metadata:read for ruleset reads and administration:write for updates. Enqueue GraphQL requires pullRequestId; candidate also uses expectedHeadOid. #16 proved contents:read insufficient for enqueue (the QQ installation holds contents:write; the plugin had narrowed the token). Only enqueue_pull now requests a contents:write execution token; every other QQ operation keeps contents:read, and a token granted below write fails closed before GraphQL. Lack of capability must still fail with an explicit code, never fall back to a human login. The owner has made both source repositories public and configured main protection. Required CI checks are a separate repository-administration follow-up after the workflow reaches main; this source change does not modify repository settings.

This branch is independent of pending Draft, managed-service, PG and ReviewInbox recovery PRs. Do not install it over a runtime containing those changes without explicit integration and review. Production credentials, scopes, schedules and Inbox are untouched.


## Verifiable one-use owner directive

主人在 Cindy 中的授权记录由 QQ 保管。内部会话、消息标识和截图不在此公开；这些记录不替代插件的逐次授权校验。

For each ruleset update, the owner posts a GitHub comment in the target repo or MontClip containing one exact line:

```text
authorize ruleset_update good-night-oppie/<repo> <32-lowercase-hex-nonce> parameters-sha256:<canonical-parameters-hash>
```

The digest is SHA256 of recursively key-sorted JSON {ruleset_id,ruleset}; node/owner-authorization.cjs parametersHash/requiredLine define it. Caller passes owner_authorization URL and nonce. Exact operation/repository/nonce/parameters, owner login+ID/type, live URL and24hour TTL all must match. Host confirmation is still required in addition. Nonce is durably consumed with exclusive creation before the write; a timeout/error never makes it reusable. Concurrent calls and future runs reject replay. An unreadable/unsafe nonce store fails closed. No raw comment text or keys are logged.

These new controls were not exercised with real administration writes. Final owner/Rea approval and actual Host confirmation/nonce behavior verification remain mandatory before installation. QQ remains read-only reviewer.

## Base merge conflict resolution

Merged main c60f0fb (containing accepted PR#4 and managed-preview PR#2) without rewriting history. Kept QQ's six-repository execution allowlist and minimal review permission request; ReviewInbox independently validates six installation repos but mints/validates a two-repository execution token. Kept owner-reference TTL/parameter/nonce checks and fresh Host confirmation. Runtime retains both confirmed QQ dispatch and resident Inbox lifecycle; no service is started by this source merge.

Conflicts resolved individually in ghost.json, node/core.cjs, node/runtime.cjs, test/core.test.cjs; generated Skill bundle rebuilt with pinned esbuild rather than choosing either side. Manifest stays1.4.0 candidate, retains confirm capability and main's resident lifecycle. Fixtures model each token's actual repository_ids for both QQ and ReviewInbox; both negative suites retained.

Local merged-tree validation:94/94 tests passed, including real isolated Inbox process tests, owner-confirmation/nonce tests and Windows ACL test. npm ci, check:bundle and git diff --check passed. Actual private submodule checked out at unchanged7cb961a4. No new live GitHub writes or installed-Host acceptance was run. New merged head requires owner/Rea final review; old approvals do not transfer.

## Consolidated CI follow-up

Owner closed PR#1/#3 and directed subsequent plugin work to this PR#5. Included the CLI child-env NODE_DEBUG isolation, checkout submodules:true, setup-python3.12 and OPPIE_TEST_PYTHON resolved from sys.executable. Both source repositories are now public, so normal submodule checkout uses the default workflow token. No local App keys or custom token secret are copied to Actions.

Windows negative reproduction showed newly created objects may carry explicit broad Administrators/Users ACEs, which /inheritance:r does not remove. tightenNew now removes non-owner/non-SYSTEM Allow ACEs on ONLY its newly-created object, then applies the unchanged strict verification. Existing stores remain verify-only and reject unsafe ACLs; no global ACL or actual account store was modified by these tests. New synthetic directory/file regression failed before the fix and passes after. The helper export exists for isolated native tests, not as a plugin tool.

The resident-lifecycle regression from the prior branch is retained: boot without config does not load keys and every GitHub operation loads credentials freshly. A resident Node process remains to own the child lease; absent config starts no Python/network loop. No absolute idle RSS claim is made and JS string memory erasure is not guaranteed.

Draft override remains excluded from this branch; no future Draft feature is implicitly approved. PG operation policy remains unchanged here; the separate per-account matrix will build on this branch with no PG admin operations. ReviewInbox still verifies installation6/execution2, Video/VV execution2. This follow-up is not installation authority.


Owner visibility decision confirmed by live GitHub metadata: both oppie-github and sglang-review-inbox are now public. The previously missing private-submodule CI credential is no longer required; workflow uses normal checkout with submodules:true and no custom token secret. No visibility mutation was performed by this source task.


## Merged 1.4.0 artifact and communication boundary

The merged 1.4.0 source bundle SHA256 is `97fd68a41fb5c93e16e3ecc6f8a48fd30510377aa5e4939e4092cc0b49338992`. This identifies the source artifact, not an installed-entry receipt; recompute the actual Skill realpath/hash before any Inbox pin update.

QQ intentionally cannot use `comment_issue`, including ordinary Issue/PR conversation comments. Its allowed written review communication is `submit_review` on a PR; the separate bounded queue/dismiss/ruleset actions remain as documented. This preserves the approved review-only write whitelist. Restoring Issue commenting would require an explicit scope change and tests, not a documentation interpretation.

For ruleset writes the nonce is consumed before the API call. On any write failure or uncertain result, first read back the remote ruleset. Do not retry with the same nonce. If another write is necessary, the owner must publish a new matching authorization comment with a fresh nonce and confirm the new call. Old directives and cached confirmations cannot be reused.
