# ReviewInbox installation/execution split candidate

This narrow recovery candidate validates the exact six-repository installation, while operation targets, execution token repository_ids, and token-returned repository set remain exactly MontClip/MontClip-Cindy. App5687106/installation180305629, contents/metadata read, issues/pull_requests write and COMMENT-only remain unchanged. No other account scope is widened here.

identity returns installationRepositories (six names and numeric IDs) and repositories (two execution names and IDs). Missing/extra/wrong-ID/duplicate installation metadata and an expanded execution token are rejected. The metadata-only probe is separate from the narrowed execution token.

Paired Python candidate must independently check both sets, using explicitly configured runtime repo allowlist. Existing credential metadata and ciphertext are untouched. No production config/hash update or restart is performed by this source change.

Actual candidate bundled CLI identity succeeded with the real existing ReviewInbox key: six installation repositories, two execution repositories and existing permissions verified; no GitHub comment/admin write. Bundle SHA256:4c306c3d94341ff2e8d43ab0212e7cf996d6faf0cff54814c57c22e4c6838813. This is a candidate hash, NOT an installed-entry acceptance receipt.

Tests: initial core red19pass2fail; final75/75 local suite passed. Build uses pinned esbuild0.27.0 and lockfile; check:bundle verifies bytes. This branch does not include the pending Draft override or managed-service feature; those remain separately reviewed work. Windows hosted-runner ACL failure on the other PR remains open and is not represented as fixed here. QQ C-class joint review, actual installation path/hash, and independent Python+plugin identity validation are required before recovery. Do not edit the current1.2.1 pin speculatively.
