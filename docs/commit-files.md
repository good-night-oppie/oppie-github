# Multi-file commits (`commit_files`, #19)

`commit_files` writes one commit with many changes through the Git Data API. It covers what `update_file` / `edit_file` cannot: several files at once, deletes, renames, files larger than the request budget, and submodule (gitlink) pointers.

## Request

`{branch, expected_head, parent?, message, changes[], force?}`

- `expected_head`: the 40-hex commit the branch must point to right now; otherwise `STALE_HEAD` and nothing is written. `null` creates a new branch (refused with `BRANCH_EXISTS` if it exists) and then `parent` is required.
- `parent`: parent of the new commit; defaults to `expected_head`.
- `message` must contain an `Assisted-by:` line (`ASSISTED_BY_REQUIRED`).
- `changes[]` (1–500, unique paths, no file/directory overlap). Each change has exactly one source:
  - `{path, content_base64, mode?}` inline content;
  - `{path, blob_sha, mode?}` a blob already in the repository (rebase replays, large files already pushed);
  - `{path, local_file, git_sha, mode?}` a regular local file read by the plugin's Node worker from an absolute path. Symlinks and non-regular files are refused; ≤50 MiB per file and ≤200 MiB per commit. The Git blob SHA of the bytes must equal `git_sha` before anything is uploaded;
  - `{path, from}` rename: blob and mode come from the parent tree; the old path is deleted; renaming onto an existing path is refused;
  - `{path, delete:true}` the path must exist in the parent tree;
  - `{path, gitlink_sha}` submodule pointer (mode `160000`).
  - `mode` accepts `100644` or `100755` only.

## Order of work and outcome

Validate everything (before credentials) → token → refuse the default branch → read the branch ref and compare with `expected_head` → read the parent commit/tree → walk the parent tree for deletes and rename sources → create blobs and compare GitHub's SHA with the local one → create a tree on `base_tree` → refuse an unchanged tree (`NO_CHANGES`) → create the commit → update the ref.

Everything before the ref update only creates unreferenced objects, so every failure there is `not_executed` (an uncertain object POST is reported as `OBJECT_WRITE_FAILED`). The ref update is the single visible write: `POST refs` for a new branch, otherwise `PATCH` with `force:false`, so GitHub itself rejects anything that is not a fast-forward (a concurrent push fails with `GITHUB_HTTP_422`, not overwritten). If that outcome is uncertain the plugin reads the ref back once: the new commit means success (`readback:true`), the old head means `not_executed`, anything else stays `unknown`. It never retries.

## Held for QQ

- Force update (rebase onto a new base on the same branch) is closed: `parent ≠ expected_head` needs `force:true`, which returns `FORCE_UPDATE_DISABLED`. To rebase, push to a new branch (`expected_head:null`, `parent:<new main>`) and open a new pull request.
- `local_file` is a narrow exception to the earlier "no local path upload" rule. If QQ declines it, large new files can only be referenced with `blob_sha`.

## Why not dir_deposit or a git bundle

The host lets a plugin forward a deposited directory only as a multipart POST to its declared hosts; the plugin never sees the bytes, and GitHub's blob endpoint takes JSON. A git bundle still needs a local read and a dependency-free packfile parser (zlib + deltas).

## Commit identity

No author is sent: GitHub records the App bot of the installation token (for Deja `dejaoppiexyz[bot]`) as author and committer, matching the bot identity table in the manual. The first real use (MontClip#284) confirms this on GitHub.

## Limits

The host bridge waits up to 120 s per call and each blob upload up to 110 s. Split very large changes over several commits. App permissions are unchanged (contents:write); QQ and ReviewInbox cannot use this operation.
