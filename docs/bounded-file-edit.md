# Existing-file editing contract

## Bounded editing of an existing file

Discover the live operations first. When edit_file is available, send one small request containing the GitHub path, branch, current Git blob SHA (expected_sha), SHA-256 of the exact intended UTF-8 result (expected_result_sha256), commit message, and edits [{old_text,new_text}]. Both hashes are mandatory. old_text must match exactly once in the current intermediate text; edits run sequentially. Empty new_text deletes the matched text. There are at most 100 edits.

The plugin fetches the GitHub baseline on that branch, verifies its SHA and decoded bytes, applies the literal replacements in memory, verifies the entire result hash, and performs one conditional PUT. Preserve BOM and CRLF when calculating the result hash; never normalize text. Non-UTF-8, NUL-containing, symlink and oversized files are rejected. Baseline, intermediate and result files must each be <=525000 bytes, preserving the previous decoded content ceiling. The ordinary account/repository permissions and default-branch refusal still apply; QQ and ReviewInbox cannot use this authoring operation.

The serialized operation object (including account, repo, operation and args) must be <=261120 UTF-8 bytes; 1024 bytes are reserved below the host's 262144-byte request limit. Count JSON bytes, not JavaScript string characters. The same budget applies to update_file, including base64 expansion and metadata. A new file whose complete request does not fit is unsupported in this release. No local path upload, cross-request fragments, resume cache, permission expansion or automatic write retries are provided.

REQUEST_TOO_LARGE and PATCH_CONFLICT mean no GitHub write occurred. A changed baseline fails without overwriting it. If the execution status is unknown, read back the exact branch/path before deciding whether to retry. An outer tool ok:true is not write success: inspect the inner ok/errorCode/execution fields. Error messages never forward raw host diagnostics.

## Validation scope

Unit and VM tests use synthetic GitHub responses, including a 260876-byte baseline. They do not prove installed-plugin transport or a real repository write. Candidate installation and controlled end-to-end acceptance follow independent review. The earlier upload-staging candidate is superseded and must not be installed.

Host INVALID_REQUEST, PROCESS_START_FAILED and RATE_LIMITED are reported as not_executed. Read-only calls cannot perform a repository write; a transport failure on those calls also reports not_executed, not a successful read. Other transport failures on writes conservatively remain unknown; cancellation or timeout must not authorize a blind retry.

The worker independently limits params to 261120 bytes and the complete JSON-RPC line to 327680 bytes. The separate line limit leaves room for the host envelope and injected metadata without increasing the operation budget. Non-object params (including arrays) are rejected before dispatch with the original request ID. Runtime pre-execution argument/confirmation rejections retain a fixed error code and not_executed; later uncertain outcomes are not reclassified as safe to retry.

Prepare candidate packages from tracked source files, including tracked files from the pinned vendor submodule. Run tests with PYTHONDONTWRITEBYTECODE=1 and inspect the resulting package: it must contain no .pyc or __pycache__ entries. An older package with the same version string is not interchangeable: bind review and acceptance to the new package hash.
