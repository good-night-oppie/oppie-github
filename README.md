# 伙伴 GitHub plugin

Source snapshot of local oppie-github 1.2.1 for QQ review. The owner has made this repository and its Inbox submodule repository public; CI can fetch the pinned submodule without a separate cross-repository secret. It contains implementation, manual, bundled Skill adapter and tests; no credentials or packaged .cindy binaries.

## Validation

Run `node --test test/*.test.cjs` with Node.js 18+; Windows ACL tests require Windows. Linux secure storage requires Python3, PyGObject/Secret and an unlocked user Secret Service. Real credentials are not required for the test suite.

The checked-in Skill CLI is self-contained because Cindy projects Skills without the surrounding plugin directory. Its source is src/review-cli.cjs. Build tooling is pinned to esbuild 0.27.0 with a lockfile. Run npm ci, npm run build:skill, and npm run check:bundle; CI verifies byte-for-byte agreement. package.json retains its historical package version; ghost.json declares this source candidate version, not proof of an installed version.

## Boundaries

This archival commit does not deploy or change running instances. deployment.json records the local profile; remote deployment allows only dd/gg/video. automaticReviews remains false. ReviewInbox is COMMENT-only. App IDs and installation IDs are identifiers, not credentials. Private keys and account ciphertext remain outside this repository.

The owner or Rea must review QQ-specific tool changes; QQ cannot self-approve them. Other changes follow the applicable review gate before integration or deployment. Adding a submodule does not make its write-capable plugin part of the read-only RSI patrol execution path.
