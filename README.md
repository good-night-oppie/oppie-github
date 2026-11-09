# 伙伴 GitHub plugin

Source snapshot of local oppie-github 1.2.1 for QQ review. This repository is private. It contains implementation, manual, bundled Skill adapter and tests; no credentials or packaged .cindy binaries.

## Validation

Run `node --test test/*.test.cjs` with Node.js 18+; Windows ACL tests require Windows. Linux secure storage requires Python3, PyGObject/Secret and an unlocked user Secret Service. Real credentials are not required for the test suite.

The checked-in Skill CLI is self-contained because Cindy projects Skills without the surrounding plugin directory. Its source is src/review-cli.cjs. The original bundle was built with esbuild from the author workspace; build tooling is not yet pinned in this snapshot. Preserve the checked-in bundle until a separately reviewed reproducible build change is ready. package.json still carries the historical 1.0.0 npm version; ghost.json 1.2.1 is the installed plugin version.

## Boundaries

This archival commit does not deploy or change running instances. deployment.json records the local profile; remote deployment allows only dd/gg/video. automaticReviews remains false. ReviewInbox is COMMENT-only. App IDs and installation IDs are identifiers, not credentials. Private keys and account ciphertext remain outside this repository.

QQ must review before changes are merged into the RSI integration or deployed. Adding a submodule does not make its write-capable plugin part of the read-only RSI patrol execution path.
