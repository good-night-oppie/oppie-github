# 伙伴 GitHub plugin

## Six-repository configuration candidate

This candidate enables six-repository installation and execution scopes for bb, cindy, deja, dd, gg, jj, rea, pg, video and vv. QQ remains six/six; ReviewInbox remains six/two. Existing operation roles are unchanged. PG's installation may contain additional owner-granted permissions, provided the four ordinary required permissions are sufficient. Its execution token still requests and validates only contents/write, issues/write, pull_requests/write and metadata/read; additional installation grants never enable administrative operations. Each request validates and freezes one scope snapshot before accessing credentials; identity and successful receipts now include the scope revision.

**Settings writes and the hot-configuration UI are not implemented in this increment.** No caller-provided configuration, approval flag or `/kv` value can change the running policy. The internal provider seam is tested with synthetic configurations only. See [the security decision and remaining host contract](docs/adr/0001-repository-scope-settings.md). This preview is not deployment approval.

The earlier diagnostics section below describes PR #7; this candidate additionally rejects malformed repository rows safely and changes the ten authorized accounts' expected sets as documented above.

Source snapshot of local oppie-github 1.2.1 for QQ review. The owner has made this repository and its Inbox submodule repository public; CI can fetch the pinned submodule without a separate cross-repository secret. It contains implementation, manual, bundled Skill adapter and tests; no credentials or packaged .cindy binaries.

## Validation

Run `node --test test/*.test.cjs` with Node.js 18+; Windows ACL tests require Windows. Linux secure storage requires Python3, PyGObject/Secret and an unlocked user Secret Service. Real credentials are not required for the test suite.

The checked-in Skill CLI is self-contained because Cindy projects Skills without the surrounding plugin directory. Its source is src/review-cli.cjs. Build tooling is pinned to esbuild 0.27.0 with a lockfile. Run npm ci, npm run build:skill, and npm run check:bundle; CI verifies byte-for-byte agreement. package.json retains its historical package version; ghost.json declares this source candidate version, not proof of an installed version.

## Repository scope diagnostics

The two former `REPOSITORY_SCOPE_MISMATCH` failures now report
`INSTALLATION_REPOSITORY_SCOPE_MISMATCH` (metadata-only installation probe) or
`EXECUTION_REPOSITORY_SCOPE_MISMATCH` (narrowed execution token). Both remain
`not_executed`; the exact-set predicate, permissions and allowed repositories
are unchanged. Consumers matching the old error code must handle both new codes.

These failures add `diagnostics.expectedRepositories` and
`diagnostics.actualRepositories`, containing only `owner/name` strings, with
known credentials redacted. No raw response objects, repository IDs, tokens or
keys are included. Invalid names are omitted and output is bounded to 100 entries.
`actualRepositoriesComplete` is false when the list is absent, malformed,
filtered, bounded or inconsistent with the reported total; an empty diagnostic
array must not be assumed to mean an empty installation. Identical name lists
can still fail because IDs or counts differ. This is a diagnostic addition, not
permission to accept a mismatch or automatically update expected repositories.
Malformed responses that previously raised `INTERNAL_ERROR` inside the unchanged
predicate still fail closed as before; this patch does not change their handling.

## Boundaries

This archival commit does not deploy or change running instances. deployment.json records the local profile; remote deployment allows only dd/gg/video. automaticReviews remains false. ReviewInbox is COMMENT-only. App IDs and installation IDs are identifiers, not credentials. Private keys and account ciphertext remain outside this repository.

The owner or Rea must review QQ-specific tool changes; QQ cannot self-approve them. Other changes follow the applicable review gate before integration or deployment. Adding a submodule does not make its write-capable plugin part of the read-only RSI patrol execution path.

## Large file updates

In the bounded-transfer candidate, use the existing github operation update_file with content_base64, branch and expected_sha. The adapter transfers large content internally; agents must not call internal upload RPC methods, split the GitHub file into separate commits, or switch identities. The limit remains 700000 base64 characters, not 700000 decoded bytes. FILE_TOO_LARGE and UPLOAD_INTERRUPTED with execution:not_executed mean no file write was attempted. WRITE_OUTCOME_UNKNOWN with execution:unknown requires readback through the same account before any retry. A successful plugin call alone is not proof that GitHub wrote the file. Confirm the installed version before relying on this behavior.
