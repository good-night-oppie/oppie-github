# vendor/review-inbox: where it connects

Listed for PG design review #8 step 1 (QQ asked for it in the first implementation PR). Read from the
source at submodule commit 7cb961a; not measured at runtime.

## What this plugin runs

The plugin starts review-inbox only through `inbox_service` (`node/inbox-service.cjs`), and only in
preview mode (`node/inbox-runner.py`):

- It runs `server.py --no-pipeline`, so no polling, review, CI or Slack job starts.
- The server binds `127.0.0.1:<port>` only. All sources are disabled, `repos` is empty, the agent's
  daily limit is 0, every policy switch is off, and every POST is refused (`READ_ONLY_PREVIEW`).
- `github_login` is set, so the startup `gh api user` lookup is skipped.
- The worker checks health at `http://127.0.0.1:<port>/_oppie_health`.

Expected outbound connections from the plugin-run preview: none (local loopback only).

## What the upstream code can reach when run outside this plugin

None of these run under the plugin's preview mode:

| Destination | Code | How |
| --- | --- | --- |
| api.github.com | `inbox/github.py`, `inbox/config.py` | the `gh` CLI with the machine's own `gh` login |
| github.com (git) | `inbox/agent.py` | `git clone` / `git fetch` of reviewed repositories |
| slack.com/api | `inbox/slack.py` | Slack Web API, only when a Slack token is configured |
| OpenAI / Anthropic | `inbox/agent.py` | the `codex` or `claude` CLI started as the review agent |
| Tailscale (tailnet) | `server.py` | optional `tailscale serve` relay to the dashboard |

## Open points

- Runtime confirmation (for example a packet capture during preview) has not been done.
- Why the plugin directory stays in use during installs is a separate question (#8 step 7).
