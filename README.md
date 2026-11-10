# 伙伴 GitHub plugin

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
