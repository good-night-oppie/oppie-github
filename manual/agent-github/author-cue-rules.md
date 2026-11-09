# Review Inbox：何时 cue PR 实际作者（可执行规则）

## 0. 范围与不变量

- 仅 `good-night-oppie/MontClip`、`good-night-oppie/MontClip-Cindy`。
- 只处理启用后新出现或更新的非草稿 PR；草稿不 cue。
- 所有问题、回答、批准和去重都绑定完整 head SHA。旧 head 的结论不能当当前结论。
- 自动评审 agent 只发 COMMENT，不自动批准、不自动合并；QQ 终审，QQ 作者 PR 交 DD。
- 每 15 分钟只能有一个调度入口、一个运行实例；不重复建立现有 Inbox 例行任务。
- 本规则是设计交付，不改共享凭据、不发布 PR 评论、不新建自动化。

## 1. 实际作者/执行伙伴映射

### 1.1 区分两种身份

- **PR actor**：GitHub `author.login` 或 App bot login，只表示谁创建了 PR。
- **当前执行伙伴**：此刻应回答 reviewer/agent 问题的人。PR actor 不必然是当前执行伙伴。

`EdwardTang`、`GoodNightOppie`、`good-night-oppie` 是共用账号，不能直接映射到某个伙伴。11 个显式 App 身份可用受控 `app_login → teammate_id` 表确认技术身份，但若 App 代他人执行，仍须补当前任务/承接证据。

### 1.2 按以下优先级确定 cue 目标

1. **当前 head 的有效承接记录**：`status=accepted`、唯一 `owner`、有效 `acceptedAt`、可检索的 `sourceMessage`、有效 `reportAt`，且 `head` 与当前完整 SHA 完全一致。`sourceMessage` 必须能回查实际伙伴/任务，不能只是自报字段。
2. **PR 正文第二行 `负责人：<伙伴名>`**：只作为 declared owner。必须在 roster 内，不能是共用账号或 QQ；没有实际承接时标为 `pending_accept`，可 cue 但不能算已负责。
3. **唯一 App 身份映射**：可确认 actor，但仍不能覆盖后续改派；有当前承接记录时以承接记录为准。
4. **无法可靠映射**：只 cue Deja 路由，不猜人、不群发、不把共用账号当接收人。QQ 是作者的 PR 按主人规则交 DD；其他实现归属不明也由 Deja 定。

多人参与时仍只保留一个当前协调 owner。实现换人必须旧负责人移交、新负责人明确承接；旧 head 的 owner 自动标 stale，不直接沿用。

## 2. 何时 cue，何时不 cue

### 2.1 立即形成一次作者待办

必须同时满足：事件发生在启用水印之后、PR 非草稿、head 为当前完整 SHA、问题需要作者动作，并属于以下之一：

- QQ/授权 reviewer 在当前 head 的 `CHANGES_REQUESTED`；
- QQ 当前 head 的 COMMENTED 中明确「要改」结论；
- Review Inbox agent 已确认的阻塞 finding，或 `needs_author` 的作者前置项；
- 当前 head 的可执行 CI 修复、冲突、缺测试/实跑证据、隐私或外发说明缺项。

每个问题生成稳定 `question_fingerprint`：优先 finding id；否则用 `kind + reviewer + path + line + 规范化标题`。不要仅用易变化的评论 id。

### 2.2 不 cue 作者

- 只有新 PR、queued、reviewing 或「已送审」状态，没有作者待答问题；
- agent 的问题应由 QQ/安全/隐私负责人回答，而不是作者；
- 问题属于旧 head，或当前 head 已有有效回答/修复/承接且未到 `reportAt`；
- PR 正文或 updatedAt 变了，但没有新证据；
- Inbox/GitHub 读取失败、快照不完整或来源降级。此时 fail-closed，不报「无事可 cue」，也不制造新提醒。

### 2.3 新 head

旧问题先标 `superseded`，停止旧 cue。只有在新 head 上重新确认同一问题仍存在，才生成新 cue；新 head 不自动抹去旧问题，也不自动延续旧批准。

## 3. 去重与状态机

`cue_id = sha256(repo#number | head | question_fingerprint | recipient)`。

持久化：

- `cue_id / question_fingerprint / head / recipient`
- `firstSeenAt / lastEvidenceAt / notifiedAt / acceptedAt / reportAt`
- `status / attempts / lastNotificationReceipt / nextEscalateAt`

状态：`detected → notified → pending_accept → accepted → answered`；另有 `superseded`、`closed`、`degraded`。

规则：

- 同一 `cue_id` 只发一次初始 cue；每 15 分钟重读相同状态不重复唤醒。
- 同一 owner/head 的多个相关问题聚合成一张待办卡，避免评论风暴。
- 重启进程不能重置去重状态。
- 作者已回答、已修复或 reviewer 已关闭问题时，直接停止，不再 cue。
- 运输层 `accepted/queued/delivered` 只表示消息状态，不等于伙伴承接。

## 4. 回执与超时升级

### 4.1 有效回执

以下任一项可作为承接：

- 当前 head 的 PR 评论实际回答问题或说明下一步与回报时间；
- 当前 head 的 `RSI-ACCEPT`：唯一 owner、具体 next、reportAt，并有可检索实际来源；
- 可回查的宿主任务记录，包含 cue_id、owner、next、reportAt。

「收到」「还在看」、消息入队、被 @、机器人回执都不算承接。决定以 PR 书面记录为准，伙伴消息只作通知。

### 4.2 时间线

- **T0**：确认新问题后立即 cue 一次。
- **T0 + 1h 未承接**：第二次 cue，并通知 Deja；此后不再发第三次相同作者提醒。
- **已承接且未到 reportAt**：等待，不重复 cue。
- **reportAt 已过**：提醒一次并记录；修复阶段从 stage/push 事件计时，不用 PR `updatedAt`。
- **修复达到 3h 仍未解决**：交 Deja 协调改派/备援；媒体 Rea、界面 DD/VV、文案 JJ，QQ 保留安全与高风险裁决。
- **安全、隐私、clean-room、密钥、外发**：立即交 QQ，不等 1h/3h；不能只交普通作者后结束。

计时起点取问题首次有效证据时间或新 head push/阶段事件，不能用正文编辑刷新。

## 5. 通知形态

将来获准写 GitHub 时：

- **PR 评论是系统记录**：写完整 head、question_fingerprint/cue_id、需要作者做的动作、回报时间和当前状态；由对应 App 身份发送。
- **Cindy 任务/私信只作通知**：发送同一 cue_id、PR 链接和截止条件；有已验证任务就发原任务，否则用稳定 teammate id，不使用共享凭据或共用账号身份。
- 找不到可靠接收人时只通知 Deja；安全类同时通知 QQ。

## 6. 现有实现入口与约束

- `inbox/pipeline.py`：`poll_sources`、`_github_search`、`reconcile_open_prs`、`advance`、`author_note`。已上线开放 PR 对账，能补「请求被清空」的缺卡；新插件不能只依赖当前 `reviewRequests`。
- `inbox/github.py`：`fetch_pr`、`list_open_prs`、`pr_timeline`、`search_issues`。列表/时间线失败必须上抛，不得把 404 当无问题。
- `inbox/db.py`：action ledger 以 `(PR, head, event)` 防重复外部写入；插件应使用自己的 cue 状态，未获授权不要直接写 Inbox DB。
- `review-inbox-nudge-lib.mjs`：`latestDecisions`、`changeRequestState`、`authorPrerequisite`、`ownershipState`、`LIMIT_H={accept:1,fix:3,rereview:2,merge:6}`。沿用其语义，不另造一套批准/承接口径。
- `scripts/pr-sop/rules.mjs`：`ownerDeclaration`、`reviewerRequested`、`verifiedExceptionItems`。roster 以仓库 `pr-sop/teammates.json` 为准；QQ 不作为实现 owner。
- `review-inbox-pr-nudge.mjs` 与 `nudge-ledger.json`：已有只读采集和承接台账。新 15 分钟插件应是唯一的作者 cue 写入入口，不能再让两个调度器重复发同一提醒。
- 当前 Review Inbox 自动审查 agent 只发 COMMENT，不是 QQ 正式批准；合并队列、批准和合并仍走现行人工/QQ 门禁。

## 7. 最低回归集

1. 共用 GitHub author + 正文 declared owner 但未承接：只能 pending_accept，不能记为已负责。
2. 当前 head 新问题立即 cue 一次；后续 15 分钟同状态不重复。
3. review request 13 秒后被 COMMENT 清空：仍可由时间线发现并 cue，不能永久漏卡。
4. 旧 head 问题、旧批准和旧 owner 不用于当前 head。
5. 1h 未承接只升级一次，不产生第三次相同 cue。
6. reportAt 未到期不催；到期只提醒一次；3h 交 Deja。
7. QQ 作者的 PR 必须路由 DD。
8. GitHub/Inbox 404、部分快照和超时：fail-closed，不发「无事」或重复 cue。
