# Managed Inbox integration candidate

Implementation owner: existing agent emails @oppie.xyz task c21db06a-0f9f-453e-9217-70cdfd4997c2. Branch feat/managed-inbox. This is partial implementation of the approved plugin-owned Inbox structure, not a completed live review service.

The plugin now owns vendor/review-inbox as a Git submodule at 7cb961a4efa7bf1480e219f967781436f5b5d78e. Repository: https://github.com/good-night-oppie/sglang-review-inbox (private source-derived fork; GitHub fork=false). Original recorded upstream BBuf/sglang-review-inbox remains404; native-fork acceptance is unresolved. Do not label this an upstream-native fork.

## Startup and configuration

Both plugin launch and native worker lifecycle are resident. Worker startup calls the same idempotent manager used by inbox_service(start/status/stop). Missing config leaves service not-ready while GitHub tools remain available. There is no invented main.js shutdown hook.

Prepare a local, non-secret ~/.oppie-github/inbox-service.json (Windows uses the existing store root). Do not commit this file. Example:

```json
{"enabled":true,"python":"python","port":18875,"dataDir":"C:/isolated/oppie-inbox-preview","mode":"preview"}
```

Choose an empty isolated data directory and unused loopback port. Never point it at the existing Inbox data directory. Existing unowned directories are refused; a managed marker and OS-held data lock prevent concurrent data use. The Python command is an executable, not shell text. No credentials or live config are copied. The preview has no sources, no background pipeline and rejects every POST action. The App key store is untouched; live App credential-reference integration awaits the separately reviewed COMMENT adapter.

Initialize source: git submodule update --init vendor/review-inbox. Use a short Windows checkout path; deeply nested Git pack paths were observed to fail. Packaging must include the checked-out source, not Git metadata or credentials.

inbox_service status distinguishes preview readiness from stopped/error and explicitly returns pipelineEnabled=false. Readiness requires both the owned live process and matching random per-instance health response, not any process listening on the port. Startup failure codes exclude raw Python logs/config. Stop closes only the owned child's stdin lease and falls back to terminating that child; it does not discover or kill existing Inbox processes. An abrupt worker loss closes the pipe and terminates the Python preview. Python's OS-held data lock is released on process exit.

## Validation and limits

Seven focused tests use the real pinned Inbox server and isolated temporary data/ports: missing configuration, idempotent/concurrent start, health plus POST refusal and stop, occupied-port preservation, missing executable, existing data refusal, abrupt worker termination, and two managers sharing data (grouped in seven cases). No GitHub comment or production process change is part of these tests. Initial tests exposed test-cleanup ordering on a Windows locked file; tests now retain isolated artifacts and stop owned processes before completion.

Host docs describe resident-worker closure on disable/update/uninstall/exit. Exact host commit was inaccessible (404), so actual installed-host lifecycle and package reload remain unverified. Tests prove direct native-worker/child behavior, not every host lifecycle event.

Remaining: ReviewInbox COMMENT candidate integration and version/hash pinning; actual review pipeline under App identity; Draft COMMENT PR#1 integration after QQ review; real host enable/disable/reload verification; native upstream fork provenance. No deployment or online replacement is authorized by this candidate test run. This branch is independent of PR#1 and retains its existing gate until the separately reviewed fix is integrated.

## Upgrade / stop / rollback

GG maintains source pins and this guide; ReviewInbox owns Inbox operation and COMMENT changes. Change the submodule to an exact reviewed commit in a parent PR, update this guide and re-run service/identity tests, then seek QQ approval. A parent/source rollback resets the gitlink through a new reviewed commit; never force-push history. Runtime installation or rollback is separate, must stop only this plugin-owned instance and needs new health/identity checks. Do not merge, close montclip-rsi#2/#269 or alter their old pins automatically; they remain historical evidence until a reviewed transition updates the ownership structure.
