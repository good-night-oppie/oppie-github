---
name: oppie-github-work
description: Use a teammate's own Oppie GitHub App on the repositories its installation covers; inspect identity and diagnose installation, permission and repository scope failures before performing GitHub work.
---

# Oppie GitHub work

Discover `ghost_info({ghost_id:"oppie-github",namespace:"local"})` and read `ghost_manual({ghost_id:"oppie-github",namespace:"local",path:"agent-github"})`. Use the live tool schemas; do not assume a settings page or configuration-reading operation exists in the installed version.

Select the account alias matching the acting teammate. The account parameter is a selection, not proof of caller identity or authorization. If the identity is unknown, clarify it; do not choose another teammate's account to make an operation succeed. Use `github_operations` to discover operation arguments and `github_accounts` to inspect account readiness without exposing credentials.

## What an account can do

Since 1.5.0-preview.10-settings.7 (owner decision 2026-11-16) what an account can do and which repositories it can use follow its GitHub App installation in good-night-oppie. The plugin keeps no roles, operation allowlists, repository list or QQ-only limits. The owner has given every App all-repository access; to narrow an account the owner changes its App installation on GitHub, and the next call follows it. Confirm the installed version with identity before relying on this.

Accounts are enabled and new teammate Apps (such as AD) are added in the plugin's settings page with identity only (App name, slug, App ID); installation, permissions and repositories are read from GitHub when the owner imports the key, on a host confirmation card. Never ask anyone for an App private key; only the owner enters it in the settings page. Do not write configuration through private files or undocumented endpoints.

Each call gets its own token for the target repository only, with exactly the permissions that operation needs. Default branches are never written and force pushes are never made. Ruleset changes still need the owner's written authorization comment and a host confirmation each time.

GitHub permissions are not the whole rule: team rules (SOP) on who comments, reviews, approves or merges still apply even when the installation would allow more.

## Identity and execution

Before the first write, call the plugin's `github` tool with the selected account, target repository and `operation:"identity"`. Require the inner result to succeed. An outer `ok:true` only confirms that the plugin call completed. `execution:"not_executed"` means the requested GitHub operation did not run.

Retain the receipt's App slug, installation ID, repository, object URL and configuration revision when available. Check the target and operation against the user's request and the team's rules. Available GitHub permissions do not override teammate restrictions on commenting, reviewing, approving or merging.

## Installation and scope failures

- `INSTALLATION_PERMISSION_MISSING`: the App installation lacks a level the operation needs. `details.missing` and `details.fix` name it and the two links show where the owner adds it. Report that to the owner; do not switch accounts to get around it.
- `REPOSITORY_NOT_INSTALLED`: the target repository is not in the App installation. Only the owner can add it on GitHub.
- `INSTALLATION_NOT_FOUND`: a settings-page account's App has no single installation in good-night-oppie.
- `TOKEN_PERMISSION_MISMATCH` or `EXECUTION_REPOSITORY_SCOPE_MISMATCH`: GitHub returned a token that differs from the request (permissions or repositories). Nothing ran; report the diagnostics.

Report repository names and the difference, never tokens or private keys. Do not change App installation settings, retry a write, or switch to a shared login merely to clear the error. After an authorized correction, verify identity again before resuming the original operation. Check for an existing result before retrying any write whose outcome is unknown.

For automatic review work, follow the installed manual's queue claim/finish protocol and COMMENT-only restrictions. Resolve author notifications from verified current task ownership; never guess a partner from a bot login or signature.

## Bounded editing of an existing file

Discover the live operations first. When edit_file is available, send one small request containing the GitHub path, branch, current Git blob SHA (expected_sha), SHA-256 of the exact intended UTF-8 result (expected_result_sha256), commit message, and edits [{old_text,new_text}]. Both hashes are mandatory. old_text must match exactly once in the current intermediate text; edits run sequentially. Empty new_text deletes the matched text. There are at most 100 edits.

The plugin fetches the GitHub baseline on that branch, verifies its SHA and decoded bytes, applies the literal replacements in memory, verifies the entire result hash, and performs one conditional PUT. Preserve BOM and CRLF when calculating the result hash; never normalize text. Non-UTF-8, NUL-containing, symlink and oversized files are rejected. Baseline, intermediate and result files must each be <=525000 bytes, preserving the previous decoded content ceiling. The ordinary account/repository permissions and default-branch refusal still apply; QQ cannot use this authoring operation.

The serialized operation object (including account, repo, operation and args) must be <=261120 UTF-8 bytes; 1024 bytes are reserved below the host's 262144-byte request limit. Count JSON bytes, not JavaScript string characters. The same budget applies to update_file, including base64 expansion and metadata. A new file whose complete request does not fit is unsupported in this release. No local path upload, cross-request fragments, resume cache, permission expansion or automatic write retries are provided.

REQUEST_TOO_LARGE and PATCH_CONFLICT mean no GitHub write occurred. A changed baseline fails without overwriting it. If the execution status is unknown, read back the exact branch/path before deciding whether to retry. An outer tool ok:true is not write success: inspect the inner ok/errorCode/execution fields. Error messages never forward raw host diagnostics.

## Multi-file commits

`commit_files` writes one commit with many changes (inline content, existing blobs by `blob_sha` including large files, renames, deletes, gitlinks; `local_file` is disabled with `LOCAL_FILE_DISABLED`) through the Git Data API. `expected_head` must equal the live branch head (`null` creates a new branch from `parent`); updates are fast-forward only and force is never allowed (QQ decision on #19; a non-fast-forward fails with `NOT_FAST_FORWARD`); `merge_parent` creates a merge commit that keeps the branch head as first parent, e.g. to bring a new main into a feature branch; it does not bring in main's changes by itself, so `changes` must contain them and the first-parent diff should be checked against main. The default branch is refused, the message must contain `Assisted-by:`, failures before the ref update are not_executed, and an uncertain ref update is read back once and never retried. Details: docs/commit-files.md.
