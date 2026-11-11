# Existing-file editing contract

## Bounded editing of an existing file

Discover the live operations first. When edit_file is available, send one small request containing the GitHub path, branch, current Git blob SHA (expected_sha), SHA-256 of the exact intended UTF-8 result (expected_result_sha256), commit message, and edits [{old_text,new_text}]. Both hashes are mandatory. old_text must match exactly once in the current intermediate text; edits run sequentially. Empty new_text deletes the matched text. There are at most 100 edits.

The plugin fetches the GitHub baseline on that branch, verifies its SHA and decoded bytes, applies the literal replacements in memory, verifies the entire result hash, and performs one conditional PUT. Preserve BOM and CRLF when calculating the result hash; never normalize text. Non-UTF-8, NUL-containing, symlink and oversized files are rejected. Baseline, intermediate and result files must each be <=525000 bytes, preserving the previous decoded content ceiling. The ordinary account/repository permissions and default-branch refusal still apply; QQ and ReviewInbox cannot use this authoring operation.

The serialized operation object (including account, repo, operation and args) must be <=261120 UTF-8 bytes; 1024 bytes are reserved below the host's 262144-byte request limit. Count JSON bytes, not JavaScript string characters. The same budget applies to update_file, including base64 expansion and metadata. A new file whose complete request does not fit is unsupported in this release. No local path upload, cross-request fragments, resume cache, permission expansion or automatic write retries are provided.

REQUEST_TOO_LARGE and PATCH_CONFLICT mean no GitHub write occurred. A changed baseline fails without overwriting it. If the execution status is unknown, read back the exact branch/path before deciding whether to retry. An outer tool ok:true is not write success: inspect the inner ok/errorCode/execution fields. Error messages never forward raw host diagnostics.

## Validation scope

Unit and VM tests use synthetic GitHub responses, including a 260876-byte baseline. They do not prove installed-plugin transport or a real repository write. Candidate installation and controlled end-to-end acceptance follow independent review. The earlier upload-staging candidate is superseded and must not be installed.

Host INVALID_REQUEST is reported as not_executed. Other transport failures conservatively remain unknown unless non-dispatch is independently guaranteed; cancellation or timeout must not authorize a blind retry.
