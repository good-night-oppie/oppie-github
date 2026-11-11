# Bounded file transfer for update_file

A 260876-byte file encodes to 347836 base64 characters. That is valid under the existing 700000-character content limit, but its JSON parameters exceed the host's 256 KiB request limit. Raising only the worker's line limit cannot fix this.

## Candidate behavior

The Agent still uses the same github/update_file tool and arguments. Small requests use the existing run call. Larger requests are sent sequentially through internal upload_begin, upload_chunk and upload_finish RPC methods; these are not Agent tools. Each request is measured as UTF-8 JSON and capped at 240000 bytes, below the host limit. A chunk contains at most 65536 base64 characters. The complete file retains the existing 700000-character limit (at most 525000 decoded bytes).

The worker holds at most four preparation records in memory, each with at most 700000 ASCII characters and at most 8192 bytes of header JSON. Records expire after a fixed 120 seconds, with a bounded cleanup timer as well as an expiry check on RPC access; worker exit also releases memory. Chunks cannot extend that deadline. No payload is written to disk. An out-of-order, repeated, invalid or oversized chunk invalidates that preparation record. Finish consumes the record before awaiting the existing client, so a second finish cannot repeat the write. Incomplete or expired records cannot commit.

The random upload identifier is an internal 128-bit capability, never an Agent result. It is not a new proof of user authorization. The account selector retains its existing trust boundary. The worker rejects unavailable accounts and the existing content-read-only roles; the original client still checks repository name and ID, installation and execution permissions, file path, branch, base64, and expected file SHA before any PUT. Preparation never reads credentials. No credential export, new storage, network destination, file-path handoff or operation permission is added.

## Failure semantics

Before finish, a host interruption is UPLOAD_INTERRUPTED/not_executed. The adapter attempts a bounded abort, but expiry is the cleanup fallback when a cancelled host call cannot send another request. After finish has been issued, a missing host response is WRITE_OUTCOME_UNKNOWN/unknown: never retry automatically. Read the target file and branch through the same account before deciding whether another write is needed. Existing verified core error results remain intact.

Native framing preserves the 256 KiB UTF-8 params limit, permits a bounded 320 KiB complete JSON-RPC envelope, and admits at most 32 dispatched requests. Oversized parsed parameters receive REQUEST_TOO_LARGE with their request ID and not_executed. Oversized unterminated input is discarded until the next newline with a single id:null framing error; an unparsed ID cannot be trusted. The next valid line works normally.

## Evidence and limits

The current host authoring guide documents 256 KiB params, 1 MiB stdout lines, 32 pending calls, and cancellation tied to the active tool call. A separately inspected source snapshot supports repeated sequential requests under one active callId, with an independent JSON-RPC ID per request. Its build version has not been proven identical to the installed host; this is a compatibility candidate, not runtime acceptance.

Tests use synthetic payloads, mocked host responses and a fake GitHub API. They exercise main.js through native framing and staging into the original SHA-checking client, plus runtime routing, interruption, capacity, expiry and recovery. They do not publish a real large file. Following independent review and separately authorized installation, acceptance must run through Cindy with the acting account, verify the destination branch and resulting content, and confirm a single write. Do not repeat already-published small files.
