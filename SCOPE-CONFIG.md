# Scope configuration (`scope-config.json`)

Since 1.5.0-preview.10-settings.1 (2026-11-15). Owner request: every GitHub App now has access to all repositories of good-night-oppie, and the repository list, accounts and role tables must be changeable without a code change.

## What changed

- The App installation no longer has to equal the configured list. `repository_selection` may be `selected` or `all`; the installation listing is read completely (up to 10 pages / 1000 repositories) and repositories outside the list are ignored.
- The target repository must still be in the configured list. Anything else fails with `REPOSITORY_NOT_ALLOWED`, `not_executed`, before any credential is read.
- Execution tokens are still requested with `repository_ids` = the configured repositories present in the installation, and the token's repository set is still checked exactly (`EXECUTION_REPOSITORY_SCOPE_MISMATCH`). A token never covers the whole organisation.
- Still fail closed (`INSTALLATION_REPOSITORY_SCOPE_MISMATCH`): incomplete or inconsistent listing, an entry not owned by good-night-oppie, duplicate IDs, a configured name present with a different ID, a required (non-optional) configured repository missing.
- ReviewInbox keeps APPROVE/REQUEST_CHANGES as installed (seven-roles.1, 2026-11-14); per the owner decision of 2026-11-15 the COMMENT-only limit stays removed. QQ, admin and other account rules are unchanged.

## Settings page (1.5.0-preview.10-settings.1)

The plugin detail page in Cindy (sidebar → 插件 → 伙伴 GitHub) shows the current configuration and lets the owner:

- add, change, disable or delete teammate Apps (account name, App name, slug, App ID, Installation ID, role, allowed operations);
- enable or disable the twelve built-in accounts (their identities stay in code and cannot be edited);
- add or remove repositories (name + numeric ID; new repositories start as optional);
- import an App private key.

Confirmation card contents (QQ review 2026-11-16): an added repository lists how many accounts can write it and which ones, which accounts are read/review only, that qq additionally gets its rulesets/dismissal/merge-queue/repository-settings operations there, and that accounts not listed in `repositoryRoles` keep their own account role on it (compiled accounts: ordinary write). A configured account shows its role in words (for example `可写名单内全部仓库`). Whether a newly added repository should default to write or to read/review is an open owner decision; until it is made, accounts without a `repositoryRoles` entry keep their account role, and the card says so.

Saving: the page sends the whole proposal to main.js; Node validates it and returns a summary and SHA-256; main.js shows the host confirmation card with the revision change and the full summary (over 300 characters is refused as `CONFIRMATION_TOO_LARGE`, split into smaller saves); only a confirmed click saves. Node re-validates, refuses a stale revision (`SCOPE_REVISION_CONFLICT`) or a changed payload (`PROPOSAL_CHANGED`), writes a signed `scope-config.json` atomically with the store's owner-only ACL (see Integrity below) and appends a redacted line to `scope-config-audit.jsonl`. The next call uses the new configuration; no restart.

Private keys: the page puts the PEM straight into the host vault (`PUT /secrets/app_private_key`). The host injects it only into the Node method `settings/import_key` (manifest `node.secretBindings`). After a confirmation card, Node checks the key against GitHub with the configured App ID, slug, installation and permissions, then stores it with the existing DPAPI store; the vault copy is deleted afterwards by main.js (after every import attempt and at plugin start) and by the settings page whenever it opens, because the host does not delete a manual secret after injecting it (verified in Cindy 0.1.136 `ghostSecretsEndpoint.ts`). The key is never placed in `/kv`, BroadcastChannel messages, RPC parameters, results, audit lines or logs. Nobody should ask for or relay a private key.

Configured accounts may also list `operations` (a subset of the ordinary operations; `identity` required). Admin and QQ-only operations are never available to them, and they may not reuse a built-in App or installation ID.

Requires Cindy 0.1.136 (verified against tag v0.1.136, commit 7227e8311a2d782f399323b21483c072fb1353b8).

## File location

`<plugin private store>/scope-config.json` — the same directory as the encrypted key store (`github_accounts` reports the exact path as `scopeConfig.path`). On Windows this is under the user's profile with an owner-only ACL.

- Missing file (never saved): compiled defaults (identical to 1.5.0-preview.8-seven-roles.2).
- Both files are checked on every call (size, mtime, inode) and re-read through the store's owner-only ACL check and re-verified when they change, so a save applies to the next call without restarting the plugin.
- `deployment.json` (accounts allowed on this host, `automaticReviews`) is also read on every call, not once at worker start (DD, europa, 2026-11-16: the earlier `require()` snapshot ignored edits until the plugin restarted). An unreadable or invalid `deployment.json` makes every account unavailable on this host (`ACCOUNT_NOT_AVAILABLE_ON_THIS_HOST`) and keeps automatic reviews off until it is fixed; no restart is needed. `test/hot-reload-runtime.test.cjs` runs one worker and changes both files underneath it.
- An unreadable, oversized (> 64 KB), unsigned or invalid file never falls back to defaults: every call returns `INVALID_SCOPE_CONFIGURATION`, `not_executed`, before credentials are read; `github_accounts` reports `scopeConfig.error`; the settings page shows the reason.

## Integrity (QQ review 2026-11-16)

`scope-config.json` is an envelope `{"format":"oppie-scope-config/v1","config":"<JSON text>","hmac":"<hex>"}`. `hmac` is HMAC-SHA256 over the `config` text with a random 32-byte key. The key and the last saved revision live only in `scope-config.key`, sealed with DPAPI CurrentUser (Linux: Secret Service) under the context `oppie-github/v1/scope-config`. The configuration is therefore no longer edited by hand; use the settings page.

Every call (and the settings page) rejects with `INVALID_SCOPE_CONFIGURATION`:
- a hand-edited configuration, including one whose revision was bumped (signature mismatch);
- an unsigned or legacy plain-JSON file;
- a replay of an older, correctly signed file (its revision is below the sealed revision);
- a deleted configuration after a save (the sealed revision is above 0);
- a configuration without its sealed key, or a key that cannot be unsealed.

A save writes the signed configuration first and then seals the new revision; if the plugin stops in between, the configuration is one revision ahead of the sealed state and is accepted (the first-ever save fails closed until it is repeated).

Residual risk: any process running as the same Windows user can also call DPAPI, so it could unseal the key and sign its own configuration, or delete both files to fall back to the compiled defaults. This is outside the trust boundary below; it is no longer possible by editing a JSON file.

## Format

The settings page edits the configuration below (the `config` text inside the signed envelope). All keys are optional; a missing key keeps its default. Unknown keys are rejected.

```json
{
  "schemaVersion": 1,
  "repositories": {"MontClip": 1441621868, "MontClip-Cindy": 1446532339, "montclip-rsi": 1450602468, "rsi-playbooks": 1450603260, "oppie-github": 1451885379, "sglang-review-inbox": 1451900929, "cindy": 1457433299},
  "optionalRepositories": ["cindy"],
  "accounts": ["bb", "cindy", "deja", "dd", "gg", "jj", "pg", "qq", "rea", "video", "vv", "reviewinbox", "ad"],
  "newAccounts": {"ad": {"appId": 5764947, "installationId": 182084517, "appName": "ADOppieXYZ", "role": "review"}},
  "twoRepositories": {"MontClip": 1441621868, "MontClip-Cindy": 1446532339},
  "repositoryRoles": {"cindy": {"bb": "write", "deja": "write", "dd": "write", "qq": "write"}},
  "reviewOperations": ["identity", "get_contents", "list_branches", "list_issues", "get_issue", "list_pulls", "get_pull", "pull_files", "list_reviews", "submit_review"]
}
```

| Key | Former constant | Rules |
| --- | --- | --- |
| `repositories` | `SIX` / `CATALOG` | name → numeric GitHub repository ID; names `^[A-Za-z0-9._-]{1,100}$`; IDs unique. Replaces the whole list. |
| `optionalRepositories` | `OPTIONAL_REPOSITORIES` | names from `repositories` that may be absent from an installation; at least one repository must stay required. |
| `accounts` | `ACCOUNT_NAMES` | accounts usable on this machine; each must be built-in or defined in `newAccounts`. Default: built-ins plus every `newAccounts` entry. |
| `newAccounts` | — | additional teammate Apps. `appId`, `installationId`, `appName` are pinned exactly like the compiled accounts (App ID, installation ID, owner and slug `oppie-agent-<name>` or lower-case `appName` are verified on every call). `role`: `review` (default), `comment_review` or `write`. Never admin, never QQ. Built-in accounts cannot be redefined. |
| `twoRepositories` | `TWO` | must be a subset of `repositories` (kept for compatibility; the review queue keeps its own fixed list). |
| `repositoryRoles` | `CINDY_ROLES` / `CINDY_EXECUTION` | per repository: account → `write`, `review` (only `reviewOperations`) or `comment_review` (same, COMMENT reviews only). |
| `reviewOperations` | `REVIEW_OPERATIONS` | subset of the compiled list and must contain `identity`; write, admin and QQ-only operations can never be added. |

## Not configurable

Owner organisation; App/installation IDs of the twelve built-in accounts; token permission sets (including QQ contents:read and PG narrowing); QQ-only and admin operations; default-branch refusal; fast-forward-only `commit_files`; owner-authorization checks for `ruleset_update`; the review queue repository list.

## Adding a teammate App (example: AD)

1. In the settings page, add account `ad` with App name `ADOppieXYZ`, App ID 5764947, Installation ID 182084517 and a role (`review` unless the owner grants `write`); save and confirm the card.
2. The owner pastes AD's private key into the settings page key field and confirms the import card. Import verifies the App and installation first.
3. Run `github` `identity` for `ad` and check `app_id`, `installationRepositorySelection` and `repositories`.

The key is encrypted with the App ID and installation ID as DPAPI entropy; changing those IDs in the file later makes the stored key unreadable (`KEY_UNAVAILABLE`) until it is imported again.

## Trust boundary

Changes are made only through the settings page and the host confirmation card. As in ADR 0002, a process already running as the same OS user is out of scope (see Integrity). Plugin pages are isolated from other plugins: each plugin has its own Electron session partition and `cindy-ghost://<id>` origin (Cindy 0.1.136 `ghostWebviewPartition.ts`, `electronSandboxAdapter.ts`), so other plugins cannot post to this plugin's `oppie-github-settings` BroadcastChannel.

## Verifying an installed copy

`npm run verify:installed -- <installed plugin dir> [rev]` compares every packaged file with the files committed at `rev` (default HEAD), byte for byte, including the `vendor/review-inbox` submodule. Package from a worktree where both the repository and the submodule are checked out with `core.autocrlf=false`; otherwise the submodule files are packaged with CRLF line endings.
