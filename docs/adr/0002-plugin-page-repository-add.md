# Add repositories from the Cindy plugin page without breaking App installations

Status: proposed for QQ verification (issue #8, P1), revised after the owner's decisions recorded on PR #24 (issuecomment-6875134659 and issuecomment-6875260329, 2026-11-14). Documentation only. No code, package, App installation, workflow or setting is changed by this document, and nothing in it may be implemented before QQ has verified it.

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
- An installation token or App JWT can read `GET /repos/good-night-oppie/{name}` for a public repository that is not in its installation, and so obtain the numeric ID before the repository is installed. A private repository cannot be read this way.
- `main.js` can call `cindy.confirm` when the request comes from the settings page rather than from a tool call (the documentation does not tie confirmation to a tool call; it requires a window to attach to).
- The installed host version on each machine. QQ last checked 0.1.130; `minCindyVersion` is 0.1.126.

## Decision

### 1. Who changes what

| List | Changed by | Channel | Plugin role |
| --- | --- | --- | --- |
| App installation scope (12 Apps) | QQ, designated by the owner, working in the owner's signed-in browser (section 2) | Each App's Configure page on GitHub | Read-only reconciliation (`identity` after every App) |
| Added-repository overlay (catalog entries and per-account grants for repositories added after the compiled baseline) | The owner | Plugin settings page, then host confirmation card, then Node conditional save (section 4) | Writes only after confirmation |
| Compiled baseline (six required repositories, `cindy`, role tables, permissions) | Reviewed code PR | GitHub PR reviewed by QQ | Read-only |

The plugin never changes an App installation, never asks for a user token or personal credential to do so, and never copies an observed installation list into its configuration. It reads each account's installation listing (the same metadata probe used today) and shows the difference.

### 2. Order of steps and intermediate states

Adding a repository follows a fixed order, agreed by QQ and the owner on 2026-11-14 after the incident in which most accounts were locked out:

1. **Make the plugin compatible first.** Confirm that the installed plugin version supports the overlay on every machine whose teammates will use the repository (each machine keeps its own overlay, section 7), and that the name does not collide with a catalog or overlay entry.
2. **The owner registers the repository on the plugin page and confirms the host card.** Node binds the repository ID (below) and checks the role limits in section 5. The card shows the accounts, repository name and ID, grants and the old and new revision. After the save, the repository is optional in every installation (section 3), so installing it can no longer lock an account out.
3. **QQ changes the App installations, one App at a time,** on each App's Configure page in the owner's signed-in browser, using desktop control or the browser plugin. QQ records no password or token and does not use GoodNightOppie. The plugin takes no part in this step.
4. **Read back after every App.** After each App, QQ runs the plugin's read-only `identity` for that account and checks that the repository appears in the installation with the registered ID, and in execution only when it is granted. QQ moves to the next App only after the read-back passes; a failed read-back stops the rollout. Nobody reports success from the save response alone.

Removing a repository goes the other way: revoke the grants on the plugin page first, with the host card (the next call stops minting tokens for it), then QQ removes it from the App installations in the same way, with an `identity` read-back after each App. Removal in the other order is also safe: the repository becomes `REPOSITORY_NOT_INSTALLED` for the affected accounts.

Repository ID before installation: at step 2 no installation lists the repository yet, so the ID cannot come from an installation listing. Node reads it from GitHub repository metadata (`GET /repos/good-night-oppie/{name}`), which works for public repositories; for a repository Node cannot read, the owner enters the numeric ID shown on GitHub. Either way the card shows the name and ID, and the entry is saved as unverified. The first installation listing that contains the name verifies it. If the ID matches, the entry becomes verified. If it differs, only that repository is blocked (`REPOSITORY_ID_MISMATCH`, `not_executed`) and the page shows the conflict, because the unverified entry, not the installation, is in doubt. Once an entry is verified, a later listing with the same name and another ID fails the whole account closed, as today (open question 1).

| State for one account and repository | Result |
| --- | --- |
| Installed, not in catalog or overlay | Other repositories work. `identity` adds `pendingRepositories` (name and ID only). Calls naming it fail with `REPOSITORY_NOT_ALLOWED` and `not_executed`. |
| In overlay, granted, not installed | Only this repository fails with `REPOSITORY_NOT_INSTALLED` and `not_executed`. |
| In overlay and installed, not granted to this account | `REPOSITORY_NOT_ALLOWED` and `not_executed`. |
| Overlay entry still unverified; installed with the same name and another ID | Only this repository fails with `REPOSITORY_ID_MISMATCH` and `not_executed`; the page shows the conflict. |
| Installed name matches a catalog or verified overlay name with a different ID | The whole account fails with `INSTALLATION_REPOSITORY_SCOPE_MISMATCH` (possible rename or re-creation; fail closed, as today). |
| Installation listing incomplete, duplicated or not owned by `good-night-oppie` | `INSTALLATION_REPOSITORY_SCOPE_MISMATCH`, as today. |
| Installation in "all repositories" mode | `INSTALLATION_REPOSITORY_SCOPE_MISMATCH`; pending tolerance applies only to selected-repository installations. |
| Required baseline repository missing | `INSTALLATION_REPOSITORY_SCOPE_MISMATCH`, as today. |
| Overlay file unreadable, malformed or with an older revision than the last one recorded | Overlay ignored, compiled baseline only, `identity` reports `overlayError`. Calls to overlay repositories fail with `INVALID_SCOPE_CONFIGURATION`. |
| Save with a stale revision | `SCOPE_REVISION_CONFLICT`; nothing written; the page reloads. |

### 3. Installation check: generalise #23 instead of adding more names

The #23 rule ("only `cindy` may be absent") becomes two symmetric rules:

- every catalog or overlay repository except the six required ones is optional in an installation, and
- a repository that is installed but known to neither the catalog nor the overlay is accepted as pending, provided the listing is complete, the installation uses selected repositories, the entry belongs to `good-night-oppie`, its ID is unique and its name does not collide with a known name under a different ID. The number of pending repositories is bounded (proposed: 20).

Pending repositories are never included in `repository_ids`, and the exact execution-token check remains unchanged, so a pending repository cannot reach a token. With the fixed order in section 2 (register before installing), the normal path does not need pending tolerance; it is a safety net for an installation changed out of order. It relaxes the exact installation-set check, so it needs QQ's decision (open question 2). Without it, an out-of-order installation locks that account out until the repository is registered.

### 4. Where the configuration lives, and how the owner's confirmation is trusted

The plugin page can show and edit configuration, but `/kv` cannot be the store or the authorisation source: any page or `main.js` of the plugin can overwrite it in one `PUT`, it has no revision or compare-and-set, and the unified settings write the same keys. Page state, `/kv`, `BroadcastChannel` messages and model input cannot prove that the owner agreed.

The decision:

1. `settings.html` reads the current state through `main.js`, which asks Node with read-only RPCs (overlay, revision, per-account installation probe). `/kv` stores only page drafts and display preferences, never data Node trusts.
2. The page sends a proposal (overlay diff and `expectedRevision`) over `BroadcastChannel` to `main.js`. `main.js` asks Node to validate it read-only. Node binds name and ID as described in section 2, checks for collisions and the role limits in section 5 and returns a canonical summary and its SHA-256.
3. `main.js` calls `cindy.confirm({danger:true})` with that summary (accounts, repositories with IDs, grants added or removed, old and new revision). Only `confirmed === true` continues.
4. `main.js` calls a Node save RPC that is not listed in the `ghost.json` tools, so neither the Agent nor `ghost_call` can reach it. Node re-validates the full proposal, compares the summary hash and `expectedRevision`, and writes atomically (temporary file and rename) into its private directory under `store.paths.root`, increasing the revision by exactly one.
5. Node appends an audit record (section 6), then the page runs a read-only `identity` for the affected accounts. Installation read-backs follow in step 4 of section 2.

Trust boundary (the same as QQ's option A on #8): this protects against forged page state, `/kv`, `BroadcastChannel`, Agent or `ghost_call` arguments, untrusted repository text and concurrent overwrites. It does not protect against a local process that already runs as the same operating-system user, because Node and `main.js` cannot prove to each other that a host click happened: the host gives the confirmation result only to `main.js`.

Owner decision (2026-11-14): a real click on the host confirmation card is sufficient for both adding and revoking access. No GitHub owner comment or nonce is required, and the `ruleset_update` owner-proof path is not reused here. The trust boundary above is therefore the whole protection for page saves: a process already running as the same operating-system user is out of scope. The card text must show every account, repository name and ID, grant added or removed, and the old and new revision, so that the click approves exactly what is saved. The host limits the card body to 300 characters; a proposal whose summary does not fit is refused (`CONFIRMATION_TOO_LARGE`, as `main.js` already does for `ruleset_update`) and must be split into smaller saves, never abbreviated. A host-minted confirmation receipt delivered to Node would close the remaining gap, but it would be a Cindy change outside this repository (open question 6).

### 5. Limits the plugin page cannot bypass

The overlay only adds repositories after the compiled baseline. It cannot:

- remove or narrow the six required repositories, `cindy`, or any compiled grant; those stay reviewed code;
- change App permissions, requested token permissions, PG's execution-permission narrowing or any account's role;
- grant more than the account's role allows for a new repository. Proposed limits: ordinary accounts may get ordinary operations or none; `dd` and `qq` get read and review operations only (as on `cindy`); `reviewinbox` gets nothing from the page; QQ-only operations (`admin_*`, rulesets, review dismissal, merge queue) are never extended to an overlay repository;
- weaken default-branch refusal, fast-forward-only `commit_files`, `Assisted-by:`, COMMENT-only automatic review, the review queue's fixed repository list, or the rule that every write follows the user's task authorisation;
- add a repository outside `good-night-oppie`, a repository without a numeric ID shown on the confirmation card, or a repository to an account automatically. New repositories default to no grants; installing a repository never grants it.

### 6. Requirements from #8, item by item

| #8 requirement | How this design meets it |
| --- | --- |
| Name and ID bound together | Overlay entries store the name and ID shown on the confirmation card (from GitHub metadata, or entered by the owner) and stay unverified until an installation listing shows the same pair. A mismatch before verification blocks only that repository; after verification, a listing with the same name and another ID fails the account closed. |
| Installation separate from execution | Installation is checked against required, optional and pending repositories; execution is the explicit overlay grant set; `execution` stays a subset of `installation` minus pending repositories. |
| Configuration snapshot and version | Node reads and freezes baseline plus overlay once per call before reading credentials; calls in flight keep their snapshot; the next call reads the new revision; receipts carry `scopeRevision`. |
| Role boundaries | Section 5; role tables stay in code. |
| No token caching | Unchanged: fresh tokens every call; tokens and keys never go to the page, `/kv`, `BroadcastChannel`, logs or audit records. |
| Concurrent saves and version rollback | Compare-and-set on `expectedRevision`; revisions only increase; the highest revision seen is recorded beside the file, so restoring an older file is rejected; a rollback is a new revision with old content, made through the same confirmation. |
| Redacted audit records | Append-only JSON lines in Node's private directory: time, revision before and after, accounts, repository names and IDs added or removed, that the host confirmation card was confirmed, proposal hash. No tokens, keys, local paths or GitHub response bodies. |
| No CI, dependency, network or monitoring changes | Uses existing `api.github.com` calls and host capabilities already declared (`confirm`, settings page, Node worker). |

### 7. Consequences

- The `repo` parameter can no longer be a fixed enum. It becomes a bounded name string, checked against the snapshot (`REPOSITORY_NOT_ALLOWED`). `identity` and `github_accounts` report the configured repositories so teammates can discover them.
- The overlay is per machine. Win11 and `europa-aws` each keep their own file and can differ until both are configured, which is the same situation as package versions today.
- Repository names added through the page appear only in the local overlay and audit file, not in this public repository.
- Tests needed before release: pending repositories never reach a token; optional overlay repositories; ID collision; unverified ID mismatch blocking only that repository; "all repositories" installation; incomplete listing; snapshot consistency across a concurrent save; stale revision; restoring an older file; malformed overlay falling back to baseline; role limits per account; the save RPC unreachable through `ghost_call`; audit redaction; and a real save and read-back on the Cindy plugin page.

## Decided by the owner (2026-11-14)

Recorded by Deja on PR #24 (issuecomment-6875134659):

- Adding and revoking access both need only the host confirmation card; no GitHub nonce comment.
- QQ changes the installation scope of the twelve Apps in the GitHub App installation settings.

Recorded by Deja on PR #24 (issuecomment-6875260329), as relayed by QQ after confirming with the owner in person:

- QQ works in the owner's signed-in browser, on each App's Configure page, using desktop control or the browser plugin. No password or token is recorded and GoodNightOppie is not used.
- After each App is changed, QQ checks it with the plugin's `identity` read-back.
- The order is fixed: plugin compatible with the new repository first, then the owner's confirmation card, then the App changes.

## Open questions

For QQ:

1. How the repository ID is bound before installation (section 2): metadata lookup for public repositories and an owner-entered ID otherwise, saved as unverified, with a mismatch before verification blocking only that repository.
2. Whether pending tolerance (section 3) is acceptable, including the bound of 20 and the requirement for selected-repository installations.
3. The default role limits for overlay repositories in section 5, especially `dd`, `qq` and `reviewinbox`.
4. Replacing the `repo` enum with a validated string, and whether `github_review_queue` stays on its fixed list.
5. Whether the overlay should stay per machine or be synchronised, and how.
6. Whether to request a host-minted confirmation receipt for Node from Cindy, to close the same-user local-process gap left by card-only confirmation.

No implementation starts until QQ has verified this ADR on its pull request.
