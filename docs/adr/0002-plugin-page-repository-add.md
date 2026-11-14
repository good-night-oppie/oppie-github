# Add repositories from the Cindy plugin page without breaking App installations

Status: proposed for QQ verification (issue #8, P1). Documentation only. No code, package, App installation, workflow or setting is changed by this document, and nothing in it may be implemented before QQ has verified it.

Baseline: main `34079c6c6d5a64eb10cef00d09097897e4fa475c` (merge of #23, package `1.5.0-preview.8`). Related: [ADR 0001](0001-repository-scope-settings.md), issue #22 and PR #23 (optional `cindy` repository), the owner request recorded on #8 by Deja on 2026-11-14 ("the plugin can add new repositories in the Cindy plugin page"; for the plugin page and the App installation scope the owner chose "both together").

## Context

When the owner added `good-night-oppie/cindy` to the App installations, the compiled catalog did not know it. The installation check requires the exact catalog set, so every account whose installation contained the new repository failed every operation with `INSTALLATION_REPOSITORY_SCOPE_MISMATCH`. #23 fixed that one repository by making `cindy` an optional installation repository: six required repositories plus an optional `cindy` are accepted; while `cindy` is absent only `cindy` operations fail, alone, with `REPOSITORY_NOT_INSTALLED`.

The same lock-out returns for every future repository, because two independent lists must change together:

1. the GitHub App installation of each of the twelve Apps (which repositories the App can see), and
2. the plugin's reviewed catalog and per-account execution sets (which repositories the plugin will mint tokens for).

The owner wants to add repositories from the plugin page and keep both lists in step. This ADR decides who changes which list, in what order, what every intermediate state reports, whether the Cindy plugin page can store the configuration, and how an owner confirmation is made trustworthy.

## What was checked, and what is inferred

Checked in this session (2026-11-14):

- Code on main `34079c6`: `node/repository-policy.cjs` holds a frozen catalog (six required plus optional `cindy`) and per-account sets; `node/core.cjs` validates and freezes one policy snapshot before reading credentials, checks the installation listing (complete listing, owner, name and ID per entry, no duplicates, required repositories present, only `OPTIONAL_REPOSITORIES` may be absent, any other repository is a mismatch), requests execution tokens with explicit `repository_ids` of the effective set, and checks the token's repositories exactly. `main.js` already shows a host confirmation card (`cindy.confirm`, `danger:true`) before QQ `ruleset_update`, and Node independently verifies an owner GitHub comment plus a one-use nonce (`node/owner-authorization.cjs`). The `repo` parameter in `ghost.json` is a fixed enum of seven names.
- BB `identity` through the installed plugin: seven installation and seven execution repositories, `scopeRevision: 0`.
- Cindy plugin documentation bundled with the host's plugin-creator Skill (read on 2026-11-14):
  - `settingsHtml` renders the plugin's own page inside the plugin detail page. It is a sandboxed page without a host bridge or direct network access; it shares browser storage and `BroadcastChannel` with the plugin's other pages and `main.js`.
  - `/kv` is one host-managed JSON object per plugin, shared by the settings page, panels and `main.js`; `PUT` replaces the whole object (last write wins, no field merge, no revision), at most 64 KB, kept across updates, removed on uninstall. Secrets must never be stored there.
  - `mcpApps.host.settings` and `cindy.ui.settings` (unified plugin settings) are documented as not yet released, and their values are the same `/kv` keys.
  - `cindy.confirm` is drawn by the host with the plugin's installed identity; the click path belongs to the host; no answer within 90 seconds, no window, rate limiting or busy all fail closed. The answer is returned to `main.js` only.
  - The host injects reserved fields into Node requests (`request.cindy.secrets`, `request.cindy.secretInputCompleted`) and ignores same-named fields reported by `main.js`. No host-minted field carries a `cindy.confirm` result, a configuration digest or an expected revision to Node. This matches QQ's earlier finding on #8 for Cindy 0.1.130.

Inferred, not exercised in this session (each needs a real test before code relies on it):

- GitHub only lets a user with administration rights on the installation change its selected repositories, through the GitHub settings page or user-to-server endpoints such as `PUT /user/installations/{installation_id}/repositories/{repository_id}`. An App JWT or installation token cannot change its own installation scope.
- `main.js` can call `cindy.confirm` when the request comes from the settings page rather than from a tool call (the documentation does not tie confirmation to a tool call; it requires a window to attach to).
- The installed host version on each machine. QQ last checked 0.1.130; `minCindyVersion` is 0.1.126.

## Decision

### 1. Who changes what

| List | Changed by | Channel | Plugin role |
| --- | --- | --- | --- |
| App installation scope (12 Apps) | The owner (or a person the owner names, acting under the owner's own GitHub login) | GitHub App installation settings page | Read-only reconciliation |
| Added-repository overlay (catalog entries and per-account grants for repositories added after the compiled baseline) | The owner | Plugin settings page, then host confirmation card, then Node conditional save (section 4) | Writes only after confirmation |
| Compiled baseline (six required repositories, `cindy`, role tables, permissions) | Reviewed code PR | GitHub PR reviewed by QQ | Read-only |

The plugin never changes an App installation, never asks for a user token or personal credential to do so, and never copies an observed installation list into its configuration. It reads each account's installation listing (the same metadata probe used today) and shows the difference.

### 2. Order of steps and intermediate states

Adding a repository:

1. **Install first, in at least one App.** The owner adds the repository to one or more App installations on GitHub. With the change in section 3, accounts keep working: the new repository is reported as pending and is never put into a token.
2. **Register on the plugin page.** The page lists repositories that are installed in at least one App but not configured, with the name and numeric ID read by the plugin from GitHub. The owner selects the repository and the accounts that should use it (section 5 limits the choice). The host confirmation card shows the account list, repository name and ID, and the old and new revision.
3. **Install in the remaining Apps** in any order. Accounts granted the repository but not yet having it installed fail only that repository with `REPOSITORY_NOT_INSTALLED`, as in #23.
4. **Read back.** The page runs a read-only `identity` for each affected account and shows which accounts are complete. The page does not report success from the save response alone.

Configuring before installing is also safe (an overlay repository is optional in every installation), but it cannot bind a repository ID until some installation shows it, so step 1 must still happen before a grant is saved.

Removing a repository goes the other way: revoke the grants on the plugin page first (the next call stops minting tokens for it), then the owner removes it from the App installations. Removal in the other order is also safe: the repository becomes `REPOSITORY_NOT_INSTALLED` for the affected accounts.

| State for one account and repository | Result |
| --- | --- |
| Installed, not in catalog or overlay | Other repositories work. `identity` adds `pendingRepositories` (name and ID only). Calls naming it fail with `REPOSITORY_NOT_ALLOWED` and `not_executed`. |
| In overlay, granted, not installed | Only this repository fails with `REPOSITORY_NOT_INSTALLED` and `not_executed`. |
| In overlay and installed, not granted to this account | `REPOSITORY_NOT_ALLOWED` and `not_executed`. |
| Installed name matches a catalog or overlay name with a different ID | The whole account fails with `INSTALLATION_REPOSITORY_SCOPE_MISMATCH` (possible rename or re-creation; fail closed, as today). |
| Installation listing incomplete, duplicated or not owned by `good-night-oppie` | `INSTALLATION_REPOSITORY_SCOPE_MISMATCH`, as today. |
| Installation in "all repositories" mode | `INSTALLATION_REPOSITORY_SCOPE_MISMATCH`; pending tolerance applies only to selected-repository installations. |
| Required baseline repository missing | `INSTALLATION_REPOSITORY_SCOPE_MISMATCH`, as today. |
| Overlay file unreadable, malformed or with an older revision than the last one recorded | Overlay ignored, compiled baseline only, `identity` reports `overlayError`. Calls to overlay repositories fail with `INVALID_SCOPE_CONFIGURATION`. |
| Save with a stale revision | `SCOPE_REVISION_CONFLICT`; nothing written; the page reloads. |

### 3. Installation check: generalise #23 instead of adding more names

The #23 rule ("only `cindy` may be absent") becomes two symmetric rules:

- every catalog or overlay repository except the six required ones is optional in an installation, and
- a repository that is installed but known to neither the catalog nor the overlay is accepted as pending, provided the listing is complete, the installation uses selected repositories, the entry belongs to `good-night-oppie`, its ID is unique and its name does not collide with a known name under a different ID. The number of pending repositories is bounded (proposed: 20).

Pending repositories are never included in `repository_ids`, and the exact execution-token check remains unchanged, so a pending repository cannot reach a token. This relaxes the exact installation-set check, so it needs QQ's decision (open question 2). Without it, step 1 still locks out every account, and only the configure-first order would be safe.

### 4. Where the configuration lives, and how the owner's confirmation is trusted

The plugin page can show and edit configuration, but `/kv` cannot be the store or the authorisation source: any page or `main.js` of the plugin can overwrite it in one `PUT`, it has no revision or compare-and-set, and the unified settings write the same keys. Page state, `/kv`, `BroadcastChannel` messages and model input cannot prove that the owner agreed.

The decision:

1. `settings.html` reads the current state through `main.js`, which asks Node with read-only RPCs (overlay, revision, per-account installation probe). `/kv` stores only page drafts and display preferences, never data Node trusts.
2. The page sends a proposal (overlay diff and `expectedRevision`) over `BroadcastChannel` to `main.js`. `main.js` asks Node to validate it read-only. Node re-reads the installation listings, binds name and ID, checks the role limits in section 5 and returns a canonical summary and its SHA-256.
3. `main.js` calls `cindy.confirm({danger:true})` with that summary (accounts, repositories with IDs, grants added or removed, old and new revision). Only `confirmed === true` continues.
4. `main.js` calls a Node save RPC that is not listed in the `ghost.json` tools, so neither the Agent nor `ghost_call` can reach it. Node re-validates the full proposal, compares the summary hash and `expectedRevision`, and writes atomically (temporary file and rename) into its private directory under `store.paths.root`, increasing the revision by exactly one.
5. Node appends an audit record (section 6), then the page runs the read-back from step 4 of section 2.

Trust boundary (the same as QQ's option A on #8): this protects against forged page state, `/kv`, `BroadcastChannel`, Agent or `ghost_call` arguments, untrusted repository text and concurrent overwrites. It does not protect against a local process that already runs as the same operating-system user, because Node and `main.js` cannot prove to each other that a host click happened: the host gives the confirmation result only to `main.js`.

Expanding access is the risky direction, so for adding a repository or a grant, the save also requires QQ's existing owner-proof path: an owner comment by `EdwardTang` (ID 3278807) within 24 hours containing an exact line with a one-use nonce and the SHA-256 of the canonical proposal, verified by Node and consumed before the write (`node/owner-authorization.cjs`). Narrowing (revoking a grant or removing an overlay repository) needs only the confirmation card. Whether expansion needs the owner comment is the owner's choice (open question 1); without it, the boundary above is the whole protection. A host-minted confirmation receipt delivered to Node would remove this trade-off, but it would be a Cindy change outside this repository.

### 5. Limits the plugin page cannot bypass

The overlay only adds repositories after the compiled baseline. It cannot:

- remove or narrow the six required repositories, `cindy`, or any compiled grant; those stay reviewed code;
- change App permissions, requested token permissions, PG's execution-permission narrowing or any account's role;
- grant more than the account's role allows for a new repository. Proposed limits: ordinary accounts may get ordinary operations or none; `dd` and `qq` get read and review operations only (as on `cindy`); `reviewinbox` gets nothing from the page; QQ-only operations (`admin_*`, rulesets, review dismissal, merge queue) are never extended to an overlay repository;
- weaken default-branch refusal, fast-forward-only `commit_files`, `Assisted-by:`, COMMENT-only automatic review, the review queue's fixed repository list, or the rule that every write follows the user's task authorisation;
- add a repository outside `good-night-oppie`, a repository without a GitHub-observed ID, or a repository to an account automatically. New repositories default to no grants; installing a repository never grants it.

### 6. Requirements from #8, item by item

| #8 requirement | How this design meets it |
| --- | --- |
| Name and ID bound together | Overlay entries store name and ID observed in an installation listing at proposal time and checked again before the save; any later listing with the same name and another ID fails the account closed. |
| Installation separate from execution | Installation is checked against required, optional and pending repositories; execution is the explicit overlay grant set; `execution` stays a subset of `installation` minus pending repositories. |
| Configuration snapshot and version | Node reads and freezes baseline plus overlay once per call before reading credentials; calls in flight keep their snapshot; the next call reads the new revision; receipts carry `scopeRevision`. |
| Role boundaries | Section 5; role tables stay in code. |
| No token caching | Unchanged: fresh tokens every call; tokens and keys never go to the page, `/kv`, `BroadcastChannel`, logs or audit records. |
| Concurrent saves and version rollback | Compare-and-set on `expectedRevision`; revisions only increase; the highest revision seen is recorded beside the file, so restoring an older file is rejected; a rollback is a new revision with old content, made through the same confirmation. |
| Redacted audit records | Append-only JSON lines in Node's private directory: time, revision before and after, accounts, repository names and IDs added or removed, confirmation path (card only, or card plus owner comment URL), proposal hash. No tokens, keys, local paths or GitHub response bodies. |
| No CI, dependency, network or monitoring changes | Uses existing `api.github.com` calls and host capabilities already declared (`confirm`, settings page, Node worker). |

### 7. Consequences

- The `repo` parameter can no longer be a fixed enum. It becomes a bounded name string, checked against the snapshot (`REPOSITORY_NOT_ALLOWED`). `identity` and `github_accounts` report the configured repositories so teammates can discover them.
- The overlay is per machine. Win11 and `europa-aws` each keep their own file and can differ until both are configured, which is the same situation as package versions today.
- Repository names added through the page appear only in the local overlay and audit file, not in this public repository.
- Tests needed before release: pending repositories never reach a token; optional overlay repositories; ID collision; "all repositories" installation; incomplete listing; snapshot consistency across a concurrent save; stale revision; restoring an older file; malformed overlay falling back to baseline; role limits per account; the save RPC unreachable through `ghost_call`; audit redaction; and a real save and read-back on the Cindy plugin page.

## Open questions

For the owner:

1. Confirmation strength for adding access: confirmation card only (simpler; trusts the local machine), or confirmation card plus a GitHub owner comment with nonce and proposal hash (proposed; Node can verify it independently). Revoking access uses the card only either way.
2. Who edits the twelve App installations when a repository is added: the owner alone, or a named teammate under the owner's login, as DD did for `cindy`.

For QQ:

3. Whether pending tolerance (section 3) is acceptable, including the bound of 20 and the requirement for selected-repository installations.
4. The default role limits for overlay repositories in section 5, especially `dd`, `qq` and `reviewinbox`.
5. Replacing the `repo` enum with a validated string, and whether `github_review_queue` stays on its fixed list.
6. Whether the overlay should stay per machine or be synchronised, and how.
7. Whether to request a host-minted confirmation receipt for Node from Cindy, which would remove the need for the owner comment.

No implementation starts until QQ has verified this ADR on its pull request.
