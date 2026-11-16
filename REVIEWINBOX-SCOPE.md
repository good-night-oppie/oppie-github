> Update 2026-11-16 (owner decision, 1.5.0-preview.10-settings.7): ReviewInbox, like every account, can do what its GitHub App installation allows on the repositories that installation covers; the plugin no longer keeps its own repository or operation lists. See SCOPE-CONFIG.md. The text below is history.

> Candidate update 2026-11-14: all accounts retain seven repositories. DD and QQ inherit their original repository operation boundaries on cindy. Global account guards remain. ReviewInbox now has ordinary read/write and review permissions on all seven repositories. This notice supersedes older fork-specific DD/QQ restrictions below.

# ReviewInbox repository scope

**Current (user authorization 2026-11-14, 1.5.0-preview.8-seven-roles.1):** ReviewInbox installation and execution scopes are both the seven repositories (original six plus good-night-oppie/cindy). It has ordinary contents/issues/pull_requests write, metadata read and standard review operations; administrative operations remain unavailable. The automatic review queue remains a separate MontClip/MontClip-Cindy configuration and is not enabled by this change. The six/two split described below is historical and superseded.

## Historical: installation/execution split candidate (superseded 2026-11-14)

This narrow recovery candidate validates the exact six-repository installation, while operation targets, execution token repository_ids, and token-returned repository set remain exactly MontClip/MontClip-Cindy. App5687106/installation180305629, contents/metadata read, issues/pull_requests write and COMMENT-only remain unchanged. No other account scope is widened here.

identity returns installationRepositories (six names and numeric IDs) and repositories (two execution names and IDs). Missing/extra/wrong-ID/duplicate installation metadata and an expanded execution token are rejected. The metadata-only probe is separate from the narrowed execution token.

Paired Python candidate must independently check both sets, using explicitly configured runtime repo allowlist. Existing credential metadata and ciphertext are untouched. No production config/hash update or restart is performed by this source change.

Actual candidate bundled CLI identity succeeded with the real existing ReviewInbox key: six installation repositories, two execution repositories and existing permissions verified; no GitHub comment/admin write. Bundle SHA256:4c306c3d94341ff2e8d43ab0212e7cf996d6faf0cff54814c57c22e4c6838813. This is a candidate hash, NOT an installed-entry acceptance receipt.

Tests: initial core red19pass2fail; final75/75 local suite passed. Build uses pinned esbuild0.27.0 and lockfile; check:bundle verifies bytes. This branch does not include the pending Draft override or managed-service feature; those remain separately reviewed work. Windows hosted-runner ACL failure on the other PR remains open and is not represented as fixed here. QQ C-class joint review, actual installation path/hash, and independent Python+plugin identity validation are required before recovery. Do not edit the current1.2.1 pin speculatively.

## Installation changes fail closed

The installation set is intentionally exact, including repository names and integer IDs. Adding or removing even one repository in the GitHub App installation makes identity fail closed until the approved matrix is updated. Do not loosen the check, automatically trust the new selection, or fall back to shared gh.

After a user-authorized change: record the actual IDs and permission levels, separately decide the execution allowlist, update the plugin installation contract and Python matching contract in reviewed commits, run negative tests and scoped-token identity checks, and obtain QQ joint approval. Only then install, revalidate the actual entry/hash and update the private runtime pin through the approved deployment flow. An installation change alone never expands the publication token.
