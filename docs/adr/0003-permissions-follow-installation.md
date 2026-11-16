# Permissions follow the live installation; tokens are minimal per operation

Status: proposed (PG, from the design review in #8 comment 6906393148; direction approved by QQ with three conditions, #8 comment 6906411580). Documentation only. No code, package, installation or deployment is implied by this document.

Supersedes, in ADR 0001: the exact installation-set and installation-permission checks, the "PG installation permissions" exception (generalised to every account), and "There is no token cache". Keeps, from ADR 0001: the owner-approved repository allowlist bound by name and numeric ID, and "never derive the allowed repository scope from an observed installation".

## Why

The plugin compares hand-written configuration with GitHub's live installation and refuses to run on any difference, including harmless widening:

- switching every App to "all repositories" stopped all twelve accounts (INSTALLATION_MISMATCH, fixed by #32);
- AD's installation holding more permissions than its role failed with PERMISSION_MISMATCH;
- every call makes at least six GitHub requests, with no token cache.

The security boundary that matters is the token request: which repositories it covers and which permissions it requests. Today that layer requests more than needed. Every non-qq account gets contents, issues and pull_requests write even for reads, and each token covers all seven catalog repositories instead of the target.

## Decision

### 1. One trust anchor: the signed configuration

The owner-signed scope configuration (HMAC envelope, DPAPI-sealed key, host confirmation card; PR #33) is the only source of authority. For each account it records:

- the **numeric App ID**. The slug is display only; slugs can be renamed (QQ condition 1);
- the allowed repositories, by name and numeric repository ID;
- the role and its allowed operations;
- `automaticReviews`, default off (QQ condition 2).

The settings page may ask only for the App slug and repository names. The plugin resolves the App ID and repository IDs through api.github.com and shows them on the confirmation card. The owner checks them there before the configuration is signed. Resolved repository IDs are stored in the signed configuration and compared on every call, which catches renamed or deleted-and-recreated repositories (QQ condition 3).

The compiled copies of the twelve App and installation IDs (`core.cjs`, `store.cjs`, `scope-config.cjs`) are replaced by this configuration. The first run migrates them into the configuration through one confirmation card.

### 2. Per-call sequence

Before the private key is read:

1. Verify the signed configuration and its revision.
2. Look up the account, the role and the operation.
3. Check that the target repository is in the account's allowlist by name and stored ID. Otherwise, fail with REPOSITORY_NOT_ALLOWED.

After the key is read:

4. Verify the App identity: `/app` must return the configured App ID (QQ condition 1). The result is cached in memory; see §4.
5. Resolve the installation for the good-night-oppie organisation. Its account login and type must be good-night-oppie / Organization, and it must not be suspended. Whether the installation covers selected or all repositories does not matter. Cached in memory; see §4.
6. Request an installation token with:
   - `repository_ids` = exactly the target repository;
   - `permissions` = the minimum table for this operation (below).
7. Check that the returned token's repositories and permissions do not exceed what was requested. Otherwise discard the token and fail with TOKEN_SCOPE_EXCEEDED. This needs no extra request.
8. If GitHub refuses step 6 because the installation lacks a permission or the repository, fail with INSTALLATION_MISSING_ACCESS. The error names the missing permission or repository, the App settings page, and who can grant it (the owner).

Removed:

- the installation-permission equality check;
- the `repository_selection === 'selected'` requirement;
- the paged installation-repository listing comparison;
- the organisation-wide metadata probe token.

An installation that is broader than needed is not a risk. The risk is a token that requests too much, and steps 6 and 7 bound that.

### 3. Minimum permission table (per operation)

| Operation group | Token permissions |
| --- | --- |
| identity, get_contents, list_branches, list_issues, get_issue, list_pulls, get_pull, pull_files, list_reviews | metadata:read plus the matching read: contents:read, issues:read or pull_requests:read |
| create_issue, update_issue, comment_issue | issues:write |
| create_pull, update_pull | pull_requests:write |
| submit_review | pull_requests:write |
| create_branch, update_file, edit_file, commit_files | contents:write |
| enqueue_pull (qq only) | contents:write, pull_requests:write |
| admin_get, admin_update, list_rulesets, get_ruleset, ruleset_update, dismiss_review (qq only) | the existing QQ permissions for that operation, unchanged |

The table lives in code and changes only through review. Role restrictions are unchanged. This ADR does not decide whether qq or review roles may use comment_issue; the owner decides that separately.

### 4. Caching (QQ condition 3)

- App identity and installation metadata are cached in memory for at most 10 minutes per account.
- Tokens are cached in memory only, keyed by account + repository ID + permission set.
- A cached token is dropped 5 minutes before it expires.
- Tokens are never written to disk, logs, diagnostics or tool return values.
- A worker restart empties every cache.

A typical call then makes one GitHub request.

### 5. Availability per machine

`deployment.json` is removed. An account is available on a machine exactly when its private key has been imported there through the host vault. `automaticReviews` moves into the signed configuration, defaults to off, and changes only through a confirmation card (QQ condition 2). Package installs no longer overwrite per-machine state. No unsigned file is hot-read.

### 6. Errors

Every error carries four things:

- the code;
- one plain-language sentence saying what happened;
- the specific item that did not match (for example the missing permission name, or which installation field differed);
- the next step and who takes it.

Secrets, tokens and key material never appear in errors.

## Security floor (unchanged or stricter)

| Floor | How it is kept |
| --- | --- |
| Target must be in the allowlist, checked before the private key is read | §2 step 3 |
| Token requests only allowlisted repositories and the minimum permissions | Stricter than today: the target repository only, with the per-operation table; the organisation-wide probe token is removed |
| No new network destination | api.github.com only. Destinations used by vendor/review-inbox are listed in the first implementation PR (QQ open item) |
| Configuration protected against local processes editing files | Signed configuration plus confirmation card. The unsigned, hot-read deployment.json is removed |

## Order of implementation

Each step is a separate PR, one package per fix, and no new features mixed into a P0.

1. Plain-language errors (§6). No change to security logic. Also lists the vendor/review-inbox destinations.
2. Per-operation minimal tokens and the removal of the installation equality checks (§2, §3). Fixes AD's PERMISSION_MISMATCH and BB's items 1–2 on #29.
3. Remove deployment.json and move automaticReviews into the signed configuration (§5).
4. In-memory caches (§4).
5. Settings page: slug and repository names in, resolved IDs on the card; migrate the compiled IDs (§1).
6. Release: drop the bundled copy of core in the skill script, and stop the resident worker and inbox before installing. Confirm by test why the plugin directory was locked (QQ open item).

PR #33 finishes within its current scope; none of these steps are added to it.

## Validation

- Unit tests with synthetic responses cover:
  - allowlist rejection before key read;
  - App ID mismatch;
  - wrong-organisation installation;
  - selected vs all installations;
  - each operation's requested permissions;
  - token-scope-exceeded rejection;
  - cache keying and early expiry;
  - no token in logs or return values.
- Acceptance after install: run identity for every account, plus one read and one comment on a test issue per writable role, on Win11 and arena. These checks cover token scope and permissions only; they are not approval of business changes.
