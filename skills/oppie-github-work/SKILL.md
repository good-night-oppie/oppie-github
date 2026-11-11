---
name: oppie-github-work
description: Use a teammate's own Oppie GitHub App on its configured repositories; inspect identity and diagnose repository scope mismatches before performing GitHub work.
---

# Oppie GitHub work

Discover `ghost_info({ghost_id:"oppie-github",namespace:"local"})` and read `ghost_manual({ghost_id:"oppie-github",namespace:"local",path:"agent-github"})`. Use the live tool schemas; do not assume a settings page or configuration-reading operation exists in the installed version.

Select the account alias matching the acting teammate. The account parameter is a selection, not proof of caller identity or authorization. If the identity is unknown, clarify it; do not choose another teammate's account to make an operation succeed. Use `github_operations` to discover operation arguments and `github_accounts` to inspect account readiness without exposing credentials.

## Repository configuration

In the six-repository release, bb/cindy/deja/dd/gg/jj/rea/pg/video/vv use all six catalog repositories for installation and execution. QQ keeps six/six and its existing operation restrictions; ReviewInbox keeps six/two with read-only contents and COMMENT-only reviews. PG may have additional installation permissions, but ordinary execution tokens still contain only contents/write, issues/write, pull_requests/write and metadata/read. Installation grants do not permit management operations through this plugin. Confirm the installed version with identity before relying on these defaults.

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

## Large file updates

In the bounded-transfer candidate, use the existing github operation update_file with content_base64, branch and expected_sha. The adapter transfers large content internally; agents must not call internal upload RPC methods, split the GitHub file into separate commits, or switch identities. The limit remains 700000 base64 characters, not 700000 decoded bytes. FILE_TOO_LARGE and UPLOAD_INTERRUPTED with execution:not_executed mean no file write was attempted. WRITE_OUTCOME_UNKNOWN with execution:unknown requires readback through the same account before any retry. A successful plugin call alone is not proof that GitHub wrote the file. Confirm the installed version before relying on this behavior.
