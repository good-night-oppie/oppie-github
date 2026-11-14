---
name: oppie-github-work
description: Use a teammate's own Oppie GitHub App on its configured repositories; inspect identity and diagnose repository scope mismatches before performing GitHub work.
---

# Oppie GitHub work

Discover `ghost_info({ghost_id:"oppie-github",namespace:"local"})` and read `ghost_manual({ghost_id:"oppie-github",namespace:"local",path:"agent-github"})`. Use the live tool schemas; do not assume a settings page or configuration-reading operation exists in the installed version.

Select the account alias matching the acting teammate. The account parameter is a selection, not proof of caller identity or authorization. If the identity is unknown, clarify it; do not choose another teammate's account to make an operation succeed. Use `github_operations` to discover operation arguments and `github_accounts` to inspect account readiness without exposing credentials.

## Repository configuration

Since #22 the catalog has seven repositories: the original six plus the fork good-night-oppie/cindy. Installations must contain the six original repositories and may contain cindy (optional during rollout; absent cindy gives REPOSITORY_NOT_INSTALLED for cindy only). bb/deja execute on all seven with ordinary operations; DD executes on all seven but on cindy only reads and posts COMMENT reviews; QQ executes on all seven with its existing restrictions and only reads and reviews on cindy; cindy/gg/jj/rea/pg/video/vv execute on the original six only; ReviewInbox keeps two with read-only contents and COMMENT-only reviews. PG may have additional installation permissions, but ordinary execution tokens still contain only contents/write, issues/write, pull_requests/write and metadata/read. Installation grants do not permit management operations through this plugin. Confirm the installed version with identity before relying on these defaults.

The settings-write UI is deferred. This release uses reviewed code configuration; there is no supported hot-save tool or page.

Use the current account configuration, when exposed by the installed plugin, rather than a hard-coded two-repository list. Distinguish:

- Installation repositories: the exact set expected on the GitHub App installation.
- Execution repositories: the repositories this account may target through the plugin.
- Operation permissions: the account's existing role restrictions, which are not changed by adding a repository.

The repository catalog is not a grant of access to every account. Never copy a discovered installation list into the allowed configuration automatically. Configuration changes require an explicit user request covering the affected account and repository scope. Do not write configuration through private files or undocumented endpoints.

When the installed version supports configuration readback, record the effective account, repository sets and revision. After an authorized save, read back the effective configuration and make a fresh read-only identity call. Do not report that a saved setting has taken effect solely because the page displayed success. If the required interface is absent, report the installed version and missing capability; do not invent a tool or use another identity.

## Identity and execution

Before the first write, call the plugin's `github` tool with the selected account, target repository and `operation:"identity"`. Require the inner result to succeed. An outer `ok:true` only confirms that the plugin call completed. `execution:"not_executed"` means the requested GitHub operation did not run.

Retain the receipt's App slug, installation ID, repository, object URL and configuration revision when available. Check the target and operation against the user's request and the account's role. Available GitHub permissions do not override teammate restrictions on commenting, reviewing, approving or merging.

## Scope failures

For `INSTALLATION_REPOSITORY_SCOPE_MISMATCH`, compare expected and actual installation repositories in the diagnostic receipt. For `EXECUTION_REPOSITORY_SCOPE_MISMATCH`, compare the execution token's repositories with the expected execution scope. For the older `REPOSITORY_SCOPE_MISMATCH`, report that the failure stage is unknown unless other evidence identifies it. Preserve any completeness indicator: a partial list cannot establish the full difference.

Report repository names and the difference, never tokens or private keys. Do not weaken exact-set checks, change App installation settings, retry a write, or switch to a shared login merely to clear the error. After an authorized correction, verify identity again before resuming the original operation. Check for an existing result before retrying any write whose outcome is unknown.

For automatic review work, follow the installed manual's queue claim/finish protocol and COMMENT-only restrictions. Resolve author notifications from verified current task ownership; never guess a partner from a bot login or signature.

## Bounded editing of an existing file

Discover the live operations first. When edit_file is available, send one small request containing the GitHub path, branch, current Git blob SHA (expected_sha), SHA-256 of the exact intended UTF-8 result (expected_result_sha256), commit message, and edits [{old_text,new_text}]. Both hashes are mandatory. old_text must match exactly once in the current intermediate text; edits run sequentially. Empty new_text deletes the matched text. There are at most 100 edits.

The plugin fetches the GitHub baseline on that branch, verifies its SHA and decoded bytes, applies the literal replacements in memory, verifies the entire result hash, and performs one conditional PUT. Preserve BOM and CRLF when calculating the result hash; never normalize text. Non-UTF-8, NUL-containing, symlink and oversized files are rejected. Baseline, intermediate and result files must each be <=525000 bytes, preserving the previous decoded content ceiling. The ordinary account/repository permissions and default-branch refusal still apply; QQ and ReviewInbox cannot use this authoring operation.

The serialized operation object (including account, repo, operation and args) must be <=261120 UTF-8 bytes; 1024 bytes are reserved below the host's 262144-byte request limit. Count JSON bytes, not JavaScript string characters. The same budget applies to update_file, including base64 expansion and metadata. A new file whose complete request does not fit is unsupported in this release. No local path upload, cross-request fragments, resume cache, permission expansion or automatic write retries are provided.

REQUEST_TOO_LARGE and PATCH_CONFLICT mean no GitHub write occurred. A changed baseline fails without overwriting it. If the execution status is unknown, read back the exact branch/path before deciding whether to retry. An outer tool ok:true is not write success: inspect the inner ok/errorCode/execution fields. Error messages never forward raw host diagnostics.

## Multi-file commits

`commit_files` writes one commit with many changes (inline content, existing blobs by `blob_sha` including large files, renames, deletes, gitlinks; `local_file` is disabled with `LOCAL_FILE_DISABLED`) through the Git Data API. `expected_head` must equal the live branch head (`null` creates a new branch from `parent`); updates are fast-forward only and force is never allowed (QQ decision on #19; a non-fast-forward fails with `NOT_FAST_FORWARD`); `merge_parent` creates a merge commit that keeps the branch head as first parent, e.g. to bring a new main into a feature branch; it does not bring in main's changes by itself, so `changes` must contain them and the first-parent diff should be checked against main. The default branch is refused, the message must contain `Assisted-by:`, failures before the ref update are not_executed, and an uncertain ref update is read back once and never retried. Details: docs/commit-files.md.
