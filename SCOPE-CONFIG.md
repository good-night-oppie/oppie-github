# Account configuration (`scope-config.json`) and remote authority

Since 1.5.0-preview.10-settings.7. Owner decision 2026-11-16 (oppie-github#8): 「以后plugin代码里不要框死伙伴的权限。永远以远端为主。远端配置了什么，我们这边通过配置页面加上伙伴后，应该同步接受远端的配置」.

## The remote decides

- What an account can do and which repositories it can use follow its GitHub App installation in good-night-oppie: the installation's permissions and its repositories (`all` or `selected`). The plugin has no roles, operation allowlists or ceilings, repository list, per-repository roles, QQ-only or admin-only account limits, and no "installation must equal X" checks.
- The owner has given every App access to all repositories. Under this model every teammate whose installation has write permissions can write every repository in its installation (56 today). To narrow an account, change its App's installation (permissions or repository selection) on GitHub; the next call follows it.
- Every call reads the App (`/app`) and its installation again. Built-in accounts use their pinned installation ID; accounts added in the settings page use the App's single installation whose account is good-night-oppie (none or more than one: `INSTALLATION_NOT_FOUND`). Nothing is cached between calls.

## Safety baseline (kept in code)

- Per-operation token: each call requests a new installation token for the target repository only (plus MontClip when a ruleset change cites an owner comment there) with exactly the operation's permissions, `metadata:read` plus the list in `OPERATION_NEEDS` (`node/core.cjs`). It never asks for more than the installation has.
- Before the token: if the installation lacks a level the operation needs, the call fails with `INSTALLATION_PERMISSION_MISSING`; `details.missing`, `details.fix` and two links say what to add and where (App permissions page, installation page).
- Workflow files: a write that touches `.github/workflows/` (update_file, edit_file, or a commit_files change, delete or rename) adds `workflows:write` to that call's token request, because GitHub refuses workflow changes without it. Without it on the installation the call fails with `INSTALLATION_PERMISSION_MISSING` and `details.workflowFiles`. No other call asks for `workflows`, and an installation that holds it still passes `identity`.
- Repository ID first (ADR 0003 section 2 step 6): the name, which must belong to good-night-oppie, is resolved to its numeric ID with a `metadata:read` token limited to that name (`GET /repos/good-night-oppie/<name>`; owner and full name must match, otherwise `REPOSITORY_RESOLUTION_FAILED`). The execution token is then requested with `repository_ids` only, so it is bound to that repository even if a name changes in between.
- Default branch: a write to the default branch (create_branch, update_file, edit_file, commit_files) is refused from the resolved repository's `default_branch`, before the execution token and before any request that could write (`DEFAULT_BRANCH_WRITE_REFUSED`).
- Comments on pull requests (ADR 0003 Amendment 1): GitHub refuses a comment on a pull request from a token holding only `issues:write`. Before `comment_issue`, a `metadata:read` + `pull_requests:read` token for the resolved repository checks whether the number is a pull request (404 means an issue); if it is, the execution token asks for `issues:write` and `pull_requests:write`, and an installation without `pull_requests:write` fails with `INSTALLATION_PERMISSION_MISSING` before the execution token. Installations that cannot read pull requests skip the check.
- Confirmation cards (ADR 0003 section 4): `ruleset_update` (with the owner's written authorization and a one-use nonce) and `admin_update` (repository merge settings) need a host confirmation every time, whichever account runs them; without it the call fails with `OWNER_CONFIRMATION_REQUIRED` before the private key is read.
- GitHub refuses a token for a repository outside the installation; the plugin reports `REPOSITORY_NOT_INSTALLED` with the repository name.
- After the token: the granted permissions must equal the request (`TOKEN_PERMISSION_MISMATCH`) and the token's repository listing must be exactly the resolved repository IDs with the same full names (`EXECUTION_REPOSITORY_SCOPE_MISMATCH`).
- Identity stays pinned: App ID, slug and owner organisation must match (`APP_IDENTITY_MISMATCH`); the installation must be the App's, in good-night-oppie, an organisation and not suspended (`INSTALLATION_MISMATCH`).
- Private keys only through the settings-page key field into the DPAPI store, never in logs, results or audit lines. No writes to a repository's default branch (`DEFAULT_BRANCH_WRITE_REFUSED`); `commit_files` is fast-forward only, force is never allowed. `ruleset_update` still needs the owner's written authorization comment, a one-use nonce and a host confirmation each time, whichever account runs it. `automaticReviews` is read only when the worker starts. The configuration file is signed (see Integrity); forged or replayed files fail closed.

## Settings page

The plugin detail page in Cindy (sidebar → 插件 → 伙伴 GitHub) lets the owner:

- add, change, disable or delete teammate Apps with identity only: account name, App name, slug (optional, default lower-case App name) and App ID;
- enable or disable the twelve built-in accounts (their identities stay in code and cannot be edited);
- import an App private key.

Saving: the page sends the whole proposal to main.js; Node validates it and returns a summary and SHA-256; main.js shows the host confirmation card with the revision change and the summary (over 300 characters is refused as `CONFIRMATION_TOO_LARGE`); only a confirmed click saves. Node re-validates, refuses a stale revision (`SCOPE_REVISION_CONFLICT`) or a changed payload (`PROPOSAL_CHANGED`), writes a signed `scope-config.json` atomically with the store's owner-only ACL and appends a redacted line to `scope-config-audit.jsonl`. The card for an added or changed App says that permissions and repositories follow its installation on GitHub and are shown when the key is imported.

Private keys: the page puts the PEM straight into the host vault (`PUT /secrets/app_private_key`). The host injects it only into the Node method `settings/import_key` (manifest `node.secretBindings`). Import has two steps with the same key:

1. `inspect`: Node signs in as the App, finds its good-night-oppie installation and returns a summary of what GitHub reports (App slug and ID, installation ID, all or selected repositories with a count and the first five names, the installation's permissions) plus a hash of those facts. Nothing is stored.
2. main.js shows that summary on the host confirmation card. Only after the owner confirms does it call `store` with the hash; Node checks again and stores the key only if GitHub still reports the same facts (otherwise `PROPOSAL_CHANGED`).

The vault copy is deleted afterwards by main.js (after every import attempt and at plugin start) and by the settings page whenever it opens, because the host does not delete a manual secret after injecting it (verified in Cindy 0.1.136 `ghostSecretsEndpoint.ts`). The key is never placed in `/kv`, BroadcastChannel messages, RPC parameters, results, audit lines or logs. Nobody should ask for or relay a private key.

Requires Cindy 0.1.136 (verified against tag v0.1.136, commit 7227e8311a2d782f399323b21483c072fb1353b8).

## File location

`<plugin private store>/scope-config.json` — the same directory as the encrypted key store (`github_accounts` reports the exact path as `scopeConfig.path`). On Windows this is under the user's profile with an owner-only ACL.

- Missing file (never saved): compiled defaults (the twelve built-in accounts). Once the audit log `scope-config-audit.jsonl` records a save, a missing configuration together with a missing key is refused (`INVALID_SCOPE_CONFIGURATION`, reason `configuration and key deleted after a save`) instead of reverting to the defaults (QQ review of #33).
- `identity` reports `scopeConfigSource` and `github_accounts` reports `scopeConfig.source`: `default` (compiled defaults), `file` (signed configuration) or `invalid`.
- Both files are checked on every call (size, mtime, inode) and re-read through the store's owner-only ACL check and re-verified when they change, so a save applies to the next call without restarting the plugin.
- `deployment.json` (accounts allowed on this host, `automaticReviews`) is also read on every call, not once at worker start (DD, europa, 2026-11-16: the earlier `require()` snapshot ignored edits until the plugin restarted). An unreadable or invalid `deployment.json` makes every account unavailable on this host (`ACCOUNT_NOT_AVAILABLE_ON_THIS_HOST`) until it is fixed; no restart is needed. `automaticReviews` is an owner safety switch and is the exception: it is read once when the worker starts, so editing `deployment.json` cannot turn automatic reviews on in a running plugin (QQ review of #33); a change takes effect after the plugin restarts. `test/hot-reload-runtime.test.cjs` runs one worker and changes both files underneath it.
- An unreadable, oversized (> 64 KB), unsigned or invalid file never falls back to defaults: every call returns `INVALID_SCOPE_CONFIGURATION`, `not_executed`, before credentials are read; `github_accounts` reports `scopeConfig.error`; the settings page shows the reason.

## Integrity (QQ review 2026-11-16)

`scope-config.json` is an envelope `{"format":"oppie-scope-config/v1","config":"<JSON text>","hmac":"<hex>"}`. `hmac` is HMAC-SHA256 over the `config` text with a random 32-byte key. The key and the last saved revision live only in `scope-config.key`, sealed with DPAPI CurrentUser (Linux: Secret Service) under the context `oppie-github/v1/scope-config`. The configuration is therefore no longer edited by hand; use the settings page.

Every call (and the settings page) rejects with `INVALID_SCOPE_CONFIGURATION`:
- a hand-edited configuration, including one whose revision was bumped (signature mismatch);
- an unsigned or legacy plain-JSON file;
- a replay of an older, correctly signed file (its revision is below the sealed revision);
- a deleted configuration after a save (the sealed revision is above 0);
- both the configuration and its key deleted after a save (the audit log records the save);
- a configuration without its sealed key, or a key that cannot be unsealed.

A save writes the signed configuration first and then seals the new revision; if the plugin stops in between, the configuration is one revision ahead of the sealed state and is accepted (the first-ever save fails closed until it is repeated).

Residual risk: any process running as the same Windows user can also call DPAPI, so it could unseal the key and sign its own configuration, or delete the configuration, its key and the audit log together to fall back to the compiled defaults (deleting only the configuration and key is refused). The audit log is trimmed from the oldest line at about 900 KB, so a save could only drop out of it after hundreds of kilobytes of later audit lines. This is outside the trust boundary below; it is no longer possible by editing a JSON file.

## Format

The settings page edits the configuration below (the `config` text inside the signed envelope). All keys are optional; unknown keys, including the removed `repositories`, `optionalRepositories`, `twoRepositories`, `repositoryRoles`, `reviewOperations` and per-account `installationId`, `role` and `operations`, are rejected.

```json
{
  "schemaVersion": 1,
  "accounts": ["bb", "cindy", "deja", "dd", "gg", "jj", "pg", "qq", "rea", "video", "vv", "reviewinbox", "ad"],
  "newAccounts": {"ad": {"appId": 5764947, "appName": "ADOppieXYZ"}}
}
```

| Key | Rules |
| --- | --- |
| `accounts` | accounts usable on this machine; each must be built-in or defined in `newAccounts`. Default: built-ins plus every `newAccounts` entry. |
| `newAccounts` | additional teammate Apps: `appId` (pinned), `appName`, optional `appSlug`. The live App must have that ID, a slug of `appSlug` (or lower-case `appName`) or `oppie-agent-<name>`, and be owned by good-night-oppie. A built-in account name or a built-in App ID cannot be reused; two accounts cannot share an App ID. |

## Not configurable

Owner organisation; App and installation IDs of the twelve built-in accounts; per-operation token permissions; default-branch refusal; fast-forward-only `commit_files`; owner-authorization checks for `ruleset_update`; the review queue repository list (MontClip and MontClip-Cindy).

## Adding a teammate App (example: AD)

1. In the settings page, add account `ad` with App name `ADOppieXYZ` and App ID 5764947. Save and confirm the card.
2. The owner pastes AD's private key into the settings page key field and clicks import. The confirmation card shows what GitHub reports, for example: installation 182084517, all repositories (56), permissions contents:write, issues:write, pull_requests:write and more. Confirm to store the key.
3. Run `github` `identity` for `ad` (optionally with a `repo`) and check `installation_id`, `installationRepositorySelection`, `installationPermissions` and `availableOperations`.

The key is encrypted with DPAPI entropy derived from the account and App ID (`installationId` is recorded as `auto` for settings-page accounts), so a later installation change does not make the stored key unreadable.

## Upgrading from settings.2-6 (QQ on #34: an upgrade must not stop anyone)

- A signed `scope-config.json` saved by settings.2-6 still loads. Its `repositories`, `optionalRepositories`, `twoRepositories`, `repositoryRoles` and `reviewOperations`, and the `role` and `operations` of added accounts, are ignored: the installation decides (owner 2026-11-16), including any earlier `role: none`. The next save writes the current format. New proposals from the settings page must use the current format.
- An added account saved then (for example AD) keeps its `installationId` in the configuration, only because the private key imported then is DPAPI-bound to it. It never selects the installation or grants anything; the installation is still looked up on GitHub on every call. The settings page and the save path keep it while the App ID is unchanged; it cannot be changed or added for a new account.
- If an added account's stored key no longer matches its App identity (for example after its App ID was changed in the settings page), only that account fails, with `KEY_IMPORTED_FOR_OTHER_APP`, and its key can be imported again; the key store and every other account keep working. A row of a built-in account that does not match its compiled pins still makes the store fail closed.
- The twelve built-in accounts need nothing: without a configuration file they use the compiled values, and their keys are bound to the compiled App and installation IDs as before.

## Caching

None in this version. Every call reads `/app` and the installation again and requests a new token for that one operation, then drops it, so a narrowed installation applies to the very next call. Caching (ADR 0003 section 5) comes in a later step.

## `identity` output

The `identity` token asks for `metadata:read` only. Fields:
- kept: `app_id`, `app_slug`, `owner`, `installationRepositorySelection`, `scopeRevision`, `scopeConfigSource`, `scopeConfigDigest`, and `expires_at` (with `repo`);
- added: `installation_id`, `installationPermissions` (what the installation actually holds), `availableOperations` (operations the installation allows), `repository` (`{id, full_name}`, with `repo`), and `installationRepositories` as `{complete, repositories}`;
- removed: `permissions` (role permissions), `repositories` (the old repository list) and `installationRepositoryCount`.
Without `repo` no single-repository token is requested; one `metadata:read` token lists the installation's repositories.

## Trust boundary

Changes are made only through the settings page and the host confirmation card. As in ADR 0002, a process already running as the same OS user is out of scope (see Integrity). Plugin pages are isolated from other plugins: each plugin has its own Electron session partition and `cindy-ghost://<id>` origin (Cindy 0.1.136 `ghostWebviewPartition.ts`, `electronSandboxAdapter.ts`), so other plugins cannot post to this plugin's `oppie-github-settings` BroadcastChannel.

## Verifying an installed copy

`npm run verify:installed -- <installed plugin dir> [rev]` compares every packaged file with the files committed at `rev` (default HEAD), byte for byte, including the `vendor/review-inbox` submodule. Package from a worktree where both the repository and the submodule are checked out with `core.autocrlf=false`; otherwise the submodule files are packaged with CRLF line endings.
