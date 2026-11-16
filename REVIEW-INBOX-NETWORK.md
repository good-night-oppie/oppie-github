# vendor/review-inbox: where it connects, what it sends, how to turn it off

Listed for PG design review #8 step 1 (QQ asked for it in the first implementation PR, #8 6906411580).
Read from the source at submodule commit 7cb961a (`inbox/config.py`, `inbox/github.py`, `inbox/slack.py`,
`inbox/agent.py`, `server.py`); not measured at runtime. Listing only: no behaviour is changed here.

## What this plugin runs

The plugin starts review-inbox only through `inbox_service` (`node/inbox-service.cjs`), and only in
preview mode (`node/inbox-runner.py`):

- It runs `server.py --no-pipeline`, so no polling, review, CI or Slack job starts.
- The server binds `127.0.0.1:<port>` only. All sources are disabled, `repos` is empty, the agent's
  daily limit is 0, every policy switch is off, and every POST is refused (`READ_ONLY_PREVIEW`).
- `github_login` is set, so the startup `gh api user` lookup is skipped.
- The worker checks health at `http://127.0.0.1:<port>/_oppie_health`.

Expected outbound connections from the plugin-run preview: none (local loopback only).
The owner turns the whole preview off with `inbox_service` `stop`, or by not starting it; automatic
reviews in this plugin stay off unless `automaticReviews` is set in `deployment.json` (read at start).

## What the upstream code can reach when run outside this plugin

None of these run under the plugin's preview mode. "Default" is the upstream default in
`inbox/config.py`; upstream `mode` defaults to `shadow`, where nothing is written to GitHub or Slack
until someone clicks a button.

| Destination | What it sends | Code | Can the owner turn it off, and how |
| --- | --- | --- | --- |
| api.github.com (through the `gh` CLI and the machine's own `gh` login) | Reads: PR lists, mentions, assigned PRs, diffs, reviews, CI status for `repos`. Writes (live mode only, each behind a `policy` switch): review comments and reviews, approvals, CI slash commands, author notes, merges. | `inbox/github.py`, `inbox/config.py` | Yes. `repos` empty stops all PR work; `sources.github_mentions` / `github_assigned` / `github_review_requested` `enabled:false` stop polling; `mode:"shadow"` (default) stops writes; each write has its own `policy` switch (`auto_publish_findings`, `auto_approve`, `auto_merge`, `auto_fix`, `auto_discuss`, `auto_author_notes`, `auto_ci`, ...). |
| github.com (git) | `git clone` / `git fetch` of reviewed repositories; in live mode with `auto_fix`, pushes fix commits (never forced). Also clones the review skill repository `agent.review_skill.repo` (default `BBuf/AI-Infra-Auto-Driven-SKILLS`). | `inbox/agent.py`, `inbox/fixer.py`, `inbox/skill.py` | Yes. No reviews (`repos` empty or `agent.daily_review_limit:0`) means no clones; `policy.auto_fix:false` (default) means no pushes; `agent.review_skill.repo:""` uses a local skill directory instead of cloning. |
| slack.com/api | With a user token: `search.messages`, `conversations.history` / `replies`, `users.conversations` (reads mentions and DMs); in live mode with `slack_report`, `chat.postMessage` thread replies with a review outcome line. | `inbox/slack.py` | Yes. No token configured (`SLACK_USER_TOKEN` / token file) means no Slack traffic; `sources.slack.enabled:false` and `sources.slack_inbox.enabled:false` stop reads; `policy.slack_report:false` (default) stops posts. |
| OpenAI or Anthropic (through the `codex` or `claude` CLI) | The review prompt with PR title, description, diff and repository files the agent reads, to the model provider of the CLI's own login. | `inbox/agent.py` | Yes. `agent.daily_review_limit:0`, `agent.daily_token_budget`, `agent.windows`, or no `repos` stop agent runs; `agent.runner` picks the provider. |
| Tailscale (tailnet only, never Funnel) | Relays the local dashboard to listed tailnet users. | `server.py` | Yes. Off unless `tailscale serve` is set up by hand on that machine; not started by the plugin. |

## Open points

- Runtime confirmation (for example a packet capture during preview) has not been done.
- Why the plugin directory stays in use during installs is a separate question (#8 step 7).
