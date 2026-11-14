# Multi-file commits (`commit_files`, #19)

`commit_files` writes one commit with many changes through the Git Data API. It covers what `update_file` / `edit_file` cannot: several files at once, deletes, renames, files larger than the request budget (by reference to existing blobs), and submodule (gitlink) pointers.

## Request

`{branch, expected_head, parent?, merge_parent?, message, changes[]}`

- `expected_head`: the 40-hex commit the branch must point to right now; otherwise `STALE_HEAD` and nothing is written. `null` creates a new branch (refused with `BRANCH_EXISTS` if it exists) and then `parent` is required.
- `parent`: first parent of the new commit; defaults to `expected_head`. For an existing branch it must equal `expected_head`, otherwise `NOT_FAST_FORWARD`.
- `merge_parent`: optional second parent for an existing branch. The commit is a merge whose first parent is the current head, so the branch still moves forward and no history is rewritten (use it to bring a new main into a feature branch; `changes` describe the merged tree relative to the branch head).

  **`merge_parent` does not bring in main's changes by itself.** It only records the second parent; the merged tree is the branch head's tree plus `changes`. If `changes` miss files that changed on main, the result is a merge commit that silently drops main's changes. After merging, check that the first-parent diff of the merge commit matches what main changed (for example `git diff <old head> <merge>` against `git diff <merge base> <main>`).
- `message` must contain an `Assisted-by:` line (`ASSISTED_BY_REQUIRED`).
- `changes[]` (1–500, unique paths, no file/directory overlap). Each change has exactly one source:
  - `{path, content_base64, mode?}` inline content;
  - `{path, blob_sha, mode?}` a blob already in the repository (rebase replays, large files already pushed);
  - `local_file` is **disabled** in this release and fails with `LOCAL_FILE_DISABLED` before credentials are read (QQ review on #20: without a root allow-list and a secret deny-list any local file could be published). Large files are pushed as blobs through another channel first and then referenced with `blob_sha`; local reading will be reviewed separately;
  - `{path, from}` rename: blob and mode come from the parent tree; the old path is deleted; renaming onto an existing path is refused;
  - `{path, delete:true}` the path must exist in the parent tree;
  - `{path, gitlink_sha}` submodule pointer (mode `160000`).
  - `mode` accepts `100644` or `100755` only.

## Order of work and outcome

Validate everything (before credentials) → token → refuse the default branch → read the branch ref and compare with `expected_head` → read the parent commit/tree → walk the parent tree for deletes and rename sources → create blobs and compare GitHub's SHA with the local one → create a tree on `base_tree` → refuse an unchanged tree (`NO_CHANGES`) → create the commit → update the ref.

Everything before the ref update only creates unreferenced objects, so every failure there is `not_executed` (an uncertain object POST is reported as `OBJECT_WRITE_FAILED`). The ref update is the single visible write: `POST refs` for a new branch, otherwise `PATCH` with `force:false`, so GitHub itself rejects anything that is not a fast-forward (a concurrent push fails with `NOT_FAST_FORWARD`, not overwritten). If that outcome is uncertain the plugin reads the ref back once: the new commit means success (`readback:true`), the old head means `not_executed`, anything else stays `unknown`. It never retries.

## No force updates (QQ decision on #19)

Force updates are never allowed and there is no `force` argument. The live branch head must equal `expected_head`, the new commit's first parent must be that head, and the ref update is sent with `force:false`; anything else fails with `NOT_FAST_FORWARD` and writes nothing. To bring a feature branch up to a new main, either merge it in on the same branch (`merge_parent:<new main>`) or start a new branch from the new main (`expected_head:null`, `parent:<new main>`) and open a replacement pull request.

## Large files

`local_file` is disabled (QQ review on #20). Pushing large new content is left to another channel that creates the blob first; `commit_files` then references it with `blob_sha`. Why not dir_deposit or a git bundle: the host lets a plugin forward a deposited directory only as a multipart POST to its declared hosts, the plugin never sees the bytes, and GitHub's blob endpoint takes JSON; a git bundle still needs a local read and a dependency-free packfile parser (zlib + deltas).

## Commit identity

No author is sent: GitHub records the App bot of the installation token (for Deja `dejaoppiexyz[bot]`) as author and committer, matching the bot identity table in the manual. The first real use (MontClip#284) confirms this on GitHub.

## Limits

The host bridge waits up to 120 s per call and each inline blob upload up to 110 s. Split very large changes over several commits. App permissions are unchanged (contents:write); QQ and ReviewInbox cannot use this operation.
