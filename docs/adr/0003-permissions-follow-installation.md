# The GitHub installation is the source of truth; tokens are minimal per operation

Status: proposed. Sources:
- PG's design review: #8 comment 6906393148.
- QQ's conditions: #8 comment 6906411580.
- The owner's decision of 2026-11-16, recorded by Deja in #8 comment 6906496751: "以后plugin代码里不要框死伙伴的权限。永远以远端为主。远端配置了什么，我们这边通过配置页面加上伙伴后，应该同步接受远端的配置".

Where the owner's decision conflicts with the earlier review or conditions, the owner's decision wins. Documentation only.

Supersedes ADR 0001 in full:
- the fixed repository catalog;
- the exact installation-set and installation-permission checks;
- the per-account role ceilings and operation allowlists;
- "There is no token cache".

## Why

The plugin compared hand-written configuration with GitHub's live installation and refused to run on any difference, including harmless widening:

- switching every App to "all repositories" stopped all twelve accounts;
- AD's installation holding more permissions than its role failed with PERMISSION_MISMATCH.

The owner's direction is that the GitHub App installation alone decides what a teammate may do. To narrow a teammate, change its App installation on GitHub.

## Decision

### 1. What the plugin stores

The owner-signed configuration (HMAC envelope, DPAPI-sealed key, host confirmation card; PR #33) records, for each teammate:

- the **numeric App ID**, used as the identity anchor. The slug is for display (QQ condition 1);
- `automaticReviews`: default off, and changed only through a confirmation card (QQ condition 2).

It records no repository list, permission set or operation allowlist. When the owner adds a teammate, the settings page reads the installation from GitHub and shows its repositories and permissions on the confirmation card for information. Signing the card accepts whatever the remote installation grants, now and later.

### 2. Per-call sequence

Before the private key is read:
1. Verify the signed configuration.
2. The account must exist in it.
3. The operation name must be known to the plugin.

After the key is read:
4. `/app` must return the configured App ID (QQ condition 1).
5. Resolve the installation for the good-night-oppie organisation: login and type good-night-oppie / Organization, not suspended. Selected or all repositories does not matter.
6. Resolve the target repository to its numeric ID. Request an installation token with:
   - `repository_ids` = exactly the target repository;
   - `permissions` = the minimum table for this operation (§3).
7. Check that the returned token does not exceed what was requested; otherwise discard it and fail with TOKEN_SCOPE_EXCEEDED.
8. If GitHub refuses because the installation lacks the repository or the permission, fail with INSTALLATION_MISSING_ACCESS. The error names what is missing and says the owner can grant it on the App's GitHub settings page.

Removed:
- the repository catalog and REPOSITORY_NOT_ALLOWED;
- role ceilings and operation allowlists;
- installation equality checks;
- the paged installation listing;
- the organisation-wide probe token.

### 3. Minimum permission table (per operation)

| Operation group | Token permissions |
| --- | --- |
| identity, get_contents, list_branches, list_issues, get_issue, list_pulls, get_pull, pull_files, list_reviews | metadata:read plus the matching read (contents, issues or pull_requests) |
| create_issue, update_issue, comment_issue | issues:write |
| create_pull, update_pull, submit_review | pull_requests:write |
| create_branch, update_file, edit_file, commit_files | contents:write |
| enqueue_pull | contents:write, pull_requests:write |
| admin_get, admin_update, list_rulesets, get_ruleset, ruleset_update, dismiss_review | administration or pull_requests as each operation needs |

Whether a teammate can run an operation is decided by whether its installation grants that permission. No account name appears in code.

### 4. What stays fixed in code (operation safety, not permission ceilings)

These follow the owner's decision as recorded in 6906496751:
- Tokens are per operation and per target repository, and never exceed the installation.
- No writes to a default branch. No force push.
- Private keys only live in the host vault. They, and tokens, never reach logs, diagnostics or return values.
- The owner-confirmation steps for ruleset_update and admin_update stay, because they guard irreversible repository settings.
- Network destination: api.github.com only. The first implementation PR lists the destinations used by vendor/review-inbox (QQ open item).

### 5. Caching (QQ condition 3)

- App and installation metadata: in memory, at most 10 minutes per account.
- Tokens:
  - in memory only;
  - keyed by account + repository ID + permission set;
  - dropped 5 minutes before they expire;
  - never written to disk, logs or return values.
- A worker restart empties every cache.

### 6. Availability per machine

`deployment.json` is removed. An account is available on a machine when its private key has been imported there. `automaticReviews` lives in the signed configuration (§1).

### 7. Errors

Every error carries four things:
- the code;
- one plain-language sentence;
- the specific item that is missing or mismatched;
- the next step and who takes it.

## Consequence the owner must keep in mind

With the plugin no longer limiting repositories, a teammate can act on every repository its App installation covers. On 2026-11-16 the Apps are installed on all organisation repositories: 56 in total, 25 of them private. Narrowing is done on GitHub by changing the App installation to selected repositories. The plugin will follow.

## Order

1. PR #33: the remote-is-source-of-truth model (§1–§4), per the owner's decision.
2. Plain-language errors (§7).
3. Remove deployment.json (§6).
4. Caches (§5).
5. Release simplification:
   - drop the bundled copy of core;
   - stop the resident worker and inbox before installing;
   - one package per fix.

## Validation

Unit tests with synthetic responses cover:
- App ID mismatch;
- wrong-organisation installation;
- selected vs all installations;
- each operation's requested permissions;
- an installation missing a permission gives a named error;
- token-scope-exceeded rejection;
- default-branch write refusal;
- cache keying and early expiry;
- no token in logs or return values.

Acceptance after install: run identity for every account, plus one read and one comment per teammate on a test issue, on Win11 and on arena.

## Amendment 1 — reconciled with the implementation in #33 (head e8c1be06)

Decided by PG on 2026-11-16 after the implementer listed the differences in #33 comment 6908132008. Where the implementation is stricter or more precise, this ADR follows the implementation. The items below supersede the matching text above.

- **Built-in accounts (§1, §2 step 5).** Until the migration step, the twelve built-in accounts keep their compiled App IDs and installation IDs, as QQ allowed in 5914736615. The installation's owner, type and suspended state are still checked. The migration moves them into the signed configuration through one owner confirmation card. It is done together with removing `deployment.json`, in step 3 of the Order.
- **automaticReviews (§1, §6).** Until step 3, it is read from `deployment.json` once at start and defaults to off. From step 3 it lives in the signed configuration, defaults to off, and changes only through a confirmation card.
- **App slug (§1).** The numeric App ID is the only identity anchor. A slug that differs from the recorded one is reported as a warning and does not stop the account. This is implemented in step 1 (#36).
- **Installation listing and organisation-wide token (§2 "Removed").** These stay, but only for `identity` and for the private-key import card, which must show the installed repositories (§1). Business operations never use them.
- **Error codes (§2, §7).** These replace the names used above:
  - `TOKEN_PERMISSION_MISMATCH`: the token has more, stronger or fewer permissions than requested.
  - `EXECUTION_REPOSITORY_SCOPE_MISMATCH`: the token covers the wrong repository.
  - `INSTALLATION_PERMISSION_MISSING`: reported before the token is requested, when the installation lacks a needed permission.
  - `REPOSITORY_RESOLUTION_FAILED`: the repository name could not be resolved to an ID.
  - `REPOSITORY_NOT_ALLOWED`: only for repositories outside good-night-oppie.
- **Repository ID (§2 step 6).** The name is resolved with a metadata-only token; the execution token is requested by `repository_ids` and checked to cover exactly that ID. Exception: the `ruleset_update` token also covers the repository that holds the owner's authorization comment, because it has to read that comment.
- **admin_update (§4).** It now has the owner confirmation card, added in #33.
- **Permission table (§3), completed.** Every token includes `metadata:read`.
  - `identity`: metadata:read only.
  - `create_pull`: contents:read + pull_requests:write.
  - `ruleset_update`: administration:write + issues:read.
  - Writes under `.github/workflows/`: add workflows:write.
  - `comment_issue`: issues:write; when the target number is a pull request, also pull_requests:write. Without it, GitHub returns 403 on pull-request comments (#8 6909218332). Fixed in step 1 (#36) with priority, because it blocks calling reviewers on PRs.
- **Private key storage.** The existing DPAPI store, unchanged, as the owner said.
