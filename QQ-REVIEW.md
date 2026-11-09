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

Official docs specify pull_requests:write for dismiss, metadata:read for ruleset reads and administration:write for updates. Enqueue GraphQL requires pullRequestId; candidate also uses expectedHeadOid. Exact fine-grained enqueue permission with contents:read was not proven; lack of capability must fail, never request broader contents or fall back to a human login. Rulesets may be unavailable for the organization's private free-plan repos; no plan/visibility change is authorized here.

This branch is independent of pending Draft, managed-service, PG and ReviewInbox recovery PRs. Do not install it over a runtime containing those changes without explicit integration and review. Production credentials, scopes, schedules and Inbox are untouched.


## Verifiable one-use owner directive

QQ supplied corrected source references: owner message uoo5v4wps4x67s56htfyk3cr in session c40a7fc6-d41d-4332-b4b1-0cce4f529aea at2026-11-09T23:05:28Z; earlier installation message ige9rh779hlnfk2cxihcspqf at22:30:49Z. These session IDs are audit context only, not plugin authorization evidence. No screenshot is exported.

For each ruleset update, the owner posts a GitHub comment in the target repo or MontClip containing one exact line:

```text
authorize ruleset_update good-night-oppie/<repo> <32-lowercase-hex-nonce> parameters-sha256:<canonical-parameters-hash>
```

The digest is SHA256 of recursively key-sorted JSON {ruleset_id,ruleset}; node/owner-authorization.cjs parametersHash/requiredLine define it. Caller passes owner_authorization URL and nonce. Exact operation/repository/nonce/parameters, owner login+ID/type, live URL and24hour TTL all must match. Host confirmation is still required in addition. Nonce is durably consumed with exclusive creation before the write; a timeout/error never makes it reusable. Concurrent calls and future runs reject replay. An unreadable/unsafe nonce store fails closed. No raw comment text or keys are logged.

These new controls were not exercised with real administration writes. Final owner/Rea approval and actual Host confirmation/nonce behavior verification remain mandatory before installation. QQ remains read-only reviewer.
