# Separate installation and execution repository scopes

Status: code candidate for review; hot-configuration UI deferred. No installation or deployment is implied by this document.

## Decision

Use a fixed, reviewed catalog of repositories belonging to good-night-oppie. Verify both name and numeric repository ID, reject unknown or incomplete sets, and never derive allowed scope automatically from an observed installation.

| Account | Installation | Execution | Existing operation boundary |
| --- | --- | --- | --- |
| bb, cindy, deja | Seven | Seven | Ordinary account operations; no administration |
| dd | Seven | Seven | Ordinary operations on the six; on cindy only reads, issue comments and COMMENT reviews |
| gg, jj, rea, pg, video, vv | Seven | Six | Ordinary account operations; no administration |
| qq | Seven | Seven | Existing QQ_ALLOWED / QQ_ONLY rules and contents:read |
| reviewinbox | Seven | Two | contents:read and COMMENT-only reviews |

Six means MontClip/1441621868, MontClip-Cindy/1446532339, montclip-rsi/1450602468, rsi-playbooks/1450603260, oppie-github/1451885379 and sglang-review-inbox/1451900929. Seven adds cindy/1457433299, the fork good-night-oppie/cindy (#22). Two means MontClip and MontClip-Cindy. Which accounts execute on cindy follows the owner's instruction on #19 (DD only reviews code; PG, Deja and BB configure the fork) and is pending QQ review; accounts not named stay on six until QQ or the owner decide.

The account grants above include the subsequent Video/VV authorization recorded in issue #8 and supersede the initial Deja-only candidate. Repository access does not override a teammate's task authorization or restrictions on comments, reviews, approvals or merges.

## PG installation permissions

The PG installation may contain additional owner-granted permissions. Require sufficient levels for contents/write, issues/write, pull_requests/write and metadata/read, using only known string levels for those required entries; additional installation permissions do not change the execution allowlist. Administration is not a required ordinary permission. Request execution tokens with exactly the four ordinary permissions, omitting administration and all other extra grants. Independently check the returned execution permissions: unexpected non-none permissions or different required levels are rejected. PG remains a non-admin account; admin_get/admin_update and QQ-only operations are denied before credential access. QQ permission behavior is unchanged.

## Request consistency

Validate and deep-copy one complete policy snapshot before reading credentials. Use it for target validation, installation-set verification, execution token repository IDs and execution-set verification. Return scopeRevision and both repository sets on successful identity reads. There is no token cache; every call obtains fresh tokens. The internal provider seam is not a public tool input, settings write API or authorization source. Production worker and CLI use compiled defaults.

## Deferred settings UI

The settings write interface, persistence, concurrent-save conflict handling, rollback, audit storage and UI acceptance tests are follow-up work, not blockers for this compiled-scope release. A future implementation must use a verified host-owner authorization contract bound to the exact candidate and revision. Page input, /kv data, a confirmed flag or an arbitrary call ID cannot establish authorization. No new host capability, network destination, dependency or CI workflow is introduced here.

## Validation and release

Tests cover ordinary writes on all six targets for each of the ten accounts; exact installation and execution sets; malformed/duplicate/incomplete repository lists; PG installation versus token permissions; denied management operations; unchanged QQ/ReviewInbox boundaries; malformed direct worker input; snapshot consistency and bundle consistency. Network responses in unit tests are synthetic.

After code review and merge, install the reviewed package through Cindy, verify the installed bytes/version, then read identity for all twelve accounts. This verifies scopes and token permissions only, not successful business writes or human review/approval. No live write is required for identity acceptance.
