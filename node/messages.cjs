'use strict';
// Plain-language error text added by the worker (PG design review #8 step 1). Not bundled into the
// Skill script, whose esbuild output escapes non-ASCII text. Every error result gets:
//   message: a plain reason, plus which check failed when the core says so;
//   next: {who, action}: who should do what next.
// Text never includes private keys, key paths, tokens or other secrets: only fields listed here
// are read from details, and they hold public identifiers (App/installation IDs, slugs, logins).
const OWNER='主人',CALLER='发起这次调用的伙伴',MAINT='插件维护者（Deja）',QQ='QQ';
const READ_BACK='写操作结果未知：先读回 GitHub 上的实际状态，确认没写成再重试，不要直接重试。';
const E=(why,who,action)=>Object.freeze({why,who,action});
const CATALOG=Object.freeze({
 // Account and host
 ACCOUNT_REQUIRED:E('调用里没有写 account。',CALLER,'在调用里写明用哪个账号（例如 deja）。'),
 UNKNOWN_ACCOUNT:E('这个账号不在插件的账号表里。',CALLER,'换成 github_accounts 列出的账号；要新增账号，请主人在设置页添加。'),
 ACCOUNT_NOT_CONFIGURED:E('这个账号不在当前配置里（没有添加或已停用）。',OWNER,'在插件设置页添加或重新启用这个账号，保存并确认。'),
 ACCOUNT_NOT_AVAILABLE_ON_THIS_HOST:E('这台机器的 deployment.json 没有启用这个账号。',OWNER,'在这台机器的 deployment.json 里加上这个账号，或换一台已启用它的机器。'),
 ACCOUNT_NOT_CONNECTED:E('这台机器上还没有导入这个账号的私钥。',OWNER,'在插件设置页为这个账号导入私钥。'),
 ACCOUNT_EXISTS:E('这个账号在这台机器上已经有私钥。',OWNER,'要替换就勾选「替换已保存的私钥」后重新导入。'),
 ACCOUNT_METADATA_MISMATCH:E('已保存私钥的元数据和账号配置对不上（例如 App 名变了）。',OWNER,'在设置页重新导入这个账号的私钥。'),
 ADMIN_ACCOUNT_REQUIRED:E('这个操作只给有管理权限的账号用。',CALLER,'换用被授权做仓库设置的账号，或请主人决定是否需要。'),
 QQ_ACCOUNT_REQUIRED:E('这个操作只有 qq 账号能做。',CALLER,'请 QQ 来做这一步。'),
 QQ_AUTHORING_REFUSED:E('qq 账号不能直接写代码或文件。',CALLER,'换用实现负责人的账号来写，QQ 只做审查和合并。'),
 OPERATION_NOT_ALLOWED_FOR_ACCOUNT:E('这个账号的角色不允许这个操作。',CALLER,'换用有这个操作的账号；需要放开的话，请主人在设置页调整这个账号的角色或可用操作。'),
 REVIEW_ONLY_REPOSITORY:E('这个账号在这个仓库里只能读和评审，不能做这个写操作。',CALLER,'换用可写的账号；需要放开的话，请主人在设置页调整这个仓库的角色。'),
 COMMENT_ONLY_REVIEWER:E('这个账号在这个仓库里只能发 COMMENT 评审，不能批准或要求修改。',CALLER,'把 event 改成 COMMENT，或换用有批准权的账号（终审是 QQ）。'),
 // Repository scope
 REPOSITORY_REQUIRED:E('调用里没有写 repo。',CALLER,'写明目标仓库名，例如 MontClip。'),
 REPOSITORY_NOT_ALLOWED:E('目标仓库不在这个账号可用的仓库名单里。',CALLER,'换成名单里的仓库；要加仓库或给这个账号开放，请主人在设置页修改。'),
 REPOSITORY_NOT_INSTALLED:E('目标仓库在名单里，但这个 App 的 GitHub 安装里没有它。',OWNER,'在 GitHub 组织设置里把这个仓库加进该 App 的安装。'),
 INSTALLATION_REPOSITORY_SCOPE_MISMATCH:E('App 安装里的仓库和配置对不上：缺了必需的仓库，或同名仓库的 ID 变了（被改名或删了重建），或列表读不完整。',OWNER,'对照 diagnostics 里的预期和实际仓库：把缺的仓库加进 App 安装；仓库被重建过就在设置页更新它的 ID。'),
 EXECUTION_REPOSITORY_SCOPE_MISMATCH:E('GitHub 发的令牌覆盖的仓库和申请的不一致，已丢弃，没有执行。',MAINT,'对照 diagnostics 排查；通常是 GitHub 侧仓库刚变动，稍后重试一次，仍不对就报维护者。'),
 // App, installation, permissions
 APP_IDENTITY_MISMATCH:E('GitHub 返回的 App 身份和配置对不上。',OWNER,'核对没对上的那一项：App ID 或 slug 填错就在设置页改正；私钥导错了 App 就重新导入正确的私钥。'),
 INSTALLATION_MISMATCH:E('App 的安装信息和配置对不上。',OWNER,'按没对上的那一项处理：安装 ID 填错就在设置页改正；安装不在 good-night-oppie 组织下或被暂停，就到 GitHub 组织设置里恢复。'),
 INSTALLATION_PERMISSION_MISSING:E('App 的安装缺少这次操作需要的权限。',OWNER,'在 App 设置的 Permissions 里加上缺的权限，再到组织的安装页接受权限更新。'),
 PERMISSION_MISMATCH:E('GitHub 发的令牌权限和申请的不一致（多给或少给），已丢弃，没有执行。',MAINT,'稍后重试一次；仍出现就报维护者排查 GitHub 返回的权限。'),
 INVALID_INSTALLATION_TOKEN:E('GitHub 返回的令牌无效或即将过期，没有执行。',CALLER,'稍后重试；连续出现就报维护者。'),
 // Credentials and key store
 CREDENTIAL_UNAVAILABLE:E('读不到这个账号在本机的私钥。',OWNER,'在插件设置页为这个账号导入私钥；已导入过就重新导入一次。'),
 KEY_UNAVAILABLE:E('本机密钥库里没有可用的私钥。',OWNER,'在插件设置页重新导入这个账号的私钥。'),
 INVALID_PRIVATE_KEY:E('私钥格式不对或不是 RSA 私钥。',OWNER,'到 GitHub 的 App 设置页重新生成私钥，把下载的私钥文件内容原样粘贴到设置页。'),
 INVALID_RSA_KEY:E('私钥不是可用的 RSA 私钥。',OWNER,'到 GitHub 的 App 设置页重新生成私钥后重新导入。'),
 PRIVATE_KEY_NOT_PROVIDED:E('没有收到私钥。',OWNER,'在设置页的私钥框里粘贴私钥后再点导入。'),
 INVALID_KEY_FILE:E('私钥文件不是普通文件、是链接或太大。',OWNER,'改用设置页粘贴私钥导入。'),
 INVALID_PEM_PATH:E('私钥文件路径不合法。',OWNER,'改用设置页粘贴私钥导入。'),
 INVALID_IMPORT:E('导入参数不对（账号不在配置里或路径不是绝对路径）。',OWNER,'改用设置页导入私钥。'),
 KEY_CHANGED_DURING_IMPORT:E('导入过程中私钥文件被改动，已放弃。',OWNER,'重新导入一次。'),
 KEY_IMPORT_FAILED:E('私钥没有存进本机密钥库。',OWNER,'重试导入；仍失败就报维护者。'),
 IDENTITY_VERIFICATION_FAILED:E('用这把私钥向 GitHub 核对 App 身份没有通过，私钥没有保存。',OWNER,'确认私钥属于设置页里填的那个 App，安装 ID 也正确，然后重新导入。'),
 DECRYPT_FAILED:E('本机密钥库里的私钥解不开（可能换了 Windows 用户或机器）。',OWNER,'在这台机器上用当前 Windows 用户重新导入私钥。'),
 INVALID_CIPHERTEXT:E('本机密钥库里的私钥数据损坏。',OWNER,'重新导入私钥。'),
 INVALID_KEY_DATA:E('本机密钥库里的私钥数据不完整。',OWNER,'重新导入私钥。'),
 INVALID_KEY_CONTEXT:E('私钥存储的上下文不匹配。',OWNER,'重新导入私钥。'),
 INVALID_EXPECTED_FINGERPRINT:E('私钥指纹核对不一致，没有保存。',OWNER,'重新导入私钥。'),
 INVALID_PRIVATE_FILE:E('本机私钥文件不安全或损坏。',OWNER,'重新导入私钥；仍失败就报维护者。'),
 INVALID_STORE:E('本机密钥库目录不可用。',MAINT,'检查插件数据目录是否完整，必要时重新安装插件后重新导入私钥。'),
 INVALID_OR_UNSAFE_STORE:E('本机密钥库目录不安全或损坏。',MAINT,'检查插件数据目录的权限（只能本人可读写）。'),
 UNSAFE_STORE:E('本机密钥库目录权限不安全。',MAINT,'把插件数据目录改成只有当前 Windows 用户可读写。'),
 UNSAFE_STORE_ACL:E('本机密钥库目录的访问控制不安全（别的用户可读写）。',MAINT,'把插件数据目录改成只有当前 Windows 用户可读写。'),
 UNSAFE_DATA_DIR:E('插件数据目录不安全。',MAINT,'检查数据目录的所有者和权限。'),
 DATA_DIR_NOT_OWNED:E('插件数据目录不属于当前用户。',MAINT,'用安装插件的同一个用户运行，或修正目录所有者。'),
 SECURE_STORAGE_UNAVAILABLE:E('这台机器上没有可用的安全存储（Windows DPAPI 或 Linux 密钥环）。',OWNER,'在支持的系统上使用，或联系维护者。'),
 STORE_WRITE_FAILED:E('写本机配置或密钥库失败，没有保存。',OWNER,'稍后重试；仍失败就报维护者。'),
 KEYRING_MISSING:E('Linux 上没有可用的密钥环。',OWNER,'安装并解锁系统密钥环后重试。'),
 KEYRING_LOCKED:E('Linux 密钥环是锁着的。',OWNER,'解锁系统密钥环后重试。'),
 KEYRING_PROMPT_REQUIRED:E('Linux 密钥环需要人工解锁。',OWNER,'在桌面上解锁密钥环后重试。'),
 KEYRING_BUSY:E('Linux 密钥环正忙。',CALLER,'稍后重试。'),
 KEYRING_AMBIGUOUS:E('Linux 密钥环里有多个同名条目。',OWNER,'清理重复条目后重新导入私钥。'),
 KEYRING_KEY_MISSING:E('Linux 密钥环里没有这个账号的私钥。',OWNER,'重新导入私钥。'),
 INVALID_KEYRING_NAMESPACE:E('Linux 密钥环的命名空间不合法。',MAINT,'报维护者。'),
 INVALID_SCOPE_KEY:E('配置签名密钥不可用。',OWNER,'在设置页重新保存一次配置；仍失败就报维护者。'),
 LINUX_REQUIRED:E('这个功能只在 Linux 上可用。',CALLER,'换到 Linux 机器上使用。'),
 WINDOWS_REQUIRED:E('这个功能只在 Windows 上可用。',CALLER,'换到 Windows 机器上使用。'),
 UNSUPPORTED_PLATFORM:E('不支持这台机器的操作系统。',OWNER,'在 Windows 或 Linux 上使用。'),
 UNEXPECTED_SECRET:E('这个请求不该带私钥却带了，已拒绝。',MAINT,'报维护者排查调用来源。'),
 // Configuration
 INVALID_SCOPE_CONFIGURATION:E('插件的范围配置不可用，没有执行。',OWNER,'按原因处理：配置被手改、签名不对或文件被删时，在设置页重新保存一次配置；填写错误就在设置页改正。'),
 INVALID_DEPLOYMENT:E('这台机器的 deployment.json 格式不对，本机所有账号都不可用。',OWNER,'修正 deployment.json（accounts 为账号名数组，automaticReviews 为 true/false）。'),
 SCOPE_REVISION_CONFLICT:E('保存时配置已被别处改过（修订号变了），没有保存。',OWNER,'在设置页重新读取后再改。'),
 PROPOSAL_CHANGED:E('确认期间配置变了，没有保存。',OWNER,'在设置页重新读取后再保存。'),
 INVALID_PROPOSAL:E('要保存的配置提议无效或已过期。',OWNER,'在设置页重新读取后再保存。'),
 NO_CHANGES:E('没有改动，不需要保存。',OWNER,'无需处理。'),
 OWNER_CONFIRMATION_REQUIRED:E('需要主人在确认卡上点确认，这次没有确认（被取消或没点）。',OWNER,'需要做这件事就重新发起，并在确认卡上点确认。'),
 OWNER_CONFIRMATION_UNAVAILABLE:E('没能弹出确认卡。',OWNER,'稍后在 Cindy 里重试。'),
 CONFIRMATION_TOO_LARGE:E('确认卡要显示的内容太长。',CALLER,'把这次改动拆小一些再提交。'),
 BUSY:E('另一个确认正在进行。',OWNER,'先处理完正在显示的确认卡，再重试。'),
 // Owner authorization (rulesets)
 OWNER_AUTHORIZATION_REQUIRED:E('改规则集需要主人的授权引用。',QQ,'先请主人在 Issue 上写授权，再带上 owner_authorization 链接。'),
 OWNER_AUTHORIZATION_REPLAYED:E('这条授权已经用过一次，不能重复用。',QQ,'请主人为这次改动另写一条授权。'),
 OWNER_REFERENCE_UNVERIFIED:E('授权链接核对不通过（不是主人写的或内容不符）。',QQ,'确认链接指向主人本人写的授权评论。'),
 OWNER_REFERENCE_SCOPE:E('授权评论里的范围和这次改动对不上。',QQ,'请主人写一条与这次改动一致的授权。'),
 INVALID_AUTHORIZATION_NONCE:E('授权 nonce 格式不对。',QQ,'使用 32 位十六进制的新 nonce。'),
 UNSAFE_NONCE_STORE:E('本机记录已用授权的目录不安全。',MAINT,'检查插件数据目录的权限。'),
 INVALID_NONCE:E('nonce 不合法。',QQ,'使用新的 32 位十六进制 nonce。'),
 RULESET_CHANGE_TOO_LARGE:E('规则集改动太大，确认卡放不下。',QQ,'拆成更小的改动分次提交。'),
 // Arguments and requests
 INVALID_ARGUMENTS:E('参数不对：缺少、多余或格式不对。',CALLER,'用 github_operations 查这个操作的参数格式后改正。'),
 INVALID_PARAMS:E('请求参数格式不对。',CALLER,'按工具说明传对象参数。'),
 INVALID_INPUT:E('输入格式不对。',CALLER,'按工具说明改正输入。'),
 INVALID_REQUEST:E('请求格式不对，没有发出。',CALLER,'按工具说明改正后重试。'),
 UNKNOWN_OPERATION:E('没有这个操作。',CALLER,'用 github_operations 查可用的操作名。'),
 UNKNOWN_METHOD:E('插件后台没有这个方法。',MAINT,'报维护者。'),
 UNKNOWN_TOOL:E('插件没有这个工具。',CALLER,'换成插件列出的工具名。'),
 INVALID_ACTION:E('action 不对。',CALLER,'按工具说明使用支持的 action。'),
 INVALID_REVIEW_ACTION:E('评审队列的 action 不对。',CALLER,'使用 initialize、poll、claim 或 finish。'),
 INVALID_MODE:E('mode 不对。',CALLER,'按工具说明使用支持的 mode。'),
 INVALID_TARGET:E('目标不合法。',CALLER,'按工具说明改正目标。'),
 INVALID_PATH:E('文件路径不合法（绝对路径、..、反斜杠或特殊字符）。',CALLER,'使用仓库内的相对路径，用 / 分隔。'),
 INVALID_REF:E('分支名不合法。',CALLER,'换一个只含普通字符的分支名，例如 deja/fix-x。'),
 INVALID_PR:E('PR 编号不合法。',CALLER,'写正确的 PR 编号。'),
 REQUEST_TOO_LARGE:E('请求太大，超过插件上限，没有发出。',CALLER,'把改动拆成多次提交，或改用 edit_file 只传改动部分。'),
 REQUEST_CAPACITY:E('插件后台同时处理的请求太多。',CALLER,'稍后重试。'),
 REQUEST_FAILED:E('请求没有完成。',CALLER,READ_BACK),
 RATE_LIMITED:E('调用太频繁，被限流。',CALLER,'等一会儿再试。'),
 WORKER_UNAVAILABLE:E('插件后台没有响应或已退出。',OWNER,'在 Cindy 里重启插件后重试；写操作先读回确认结果。'),
 PROCESS_START_FAILED:E('插件后台没能启动。',OWNER,'在 Cindy 里重启插件；仍失败就报维护者。'),
 NO_RESPONSE:E('插件后台没有响应。',OWNER,'稍后重试，或在 Cindy 里重启插件。'),
 DEPENDENCY_REQUIRED:E('这个操作缺少前置条件（例如需要先读到相关对象）。',CALLER,'按报错先完成前置步骤再重试。'),
 INTERNAL_ERROR:E('插件内部出错。',MAINT,'报维护者，附上时间和操作名。'+READ_BACK),
 // GitHub transport
 NETWORK_ERROR:E('连不上 GitHub，读操作没有执行。',CALLER,'检查网络后重试。'),
 WRITE_OUTCOME_UNKNOWN:E('写操作发出后连接断了，不知道 GitHub 有没有写成。',CALLER,READ_BACK),
 REDIRECT_REFUSED:E('GitHub 返回了重定向，插件按安全规则拒绝跟随。',CALLER,'核对仓库是否被改名或迁移；被改名就请主人在设置页更新仓库。'),
 INVALID_API_RESPONSE:E('GitHub 返回的内容无法解析或太大。',CALLER,'稍后重试；仍出现就报维护者。'+READ_BACK),
 INVALID_API_ROUTE:E('插件生成了不合法的 API 路径，已拒绝。',MAINT,'报维护者。'),
 INVALID_LIST_RESPONSE:E('GitHub 返回的列表格式不对。',CALLER,'稍后重试；仍出现就报维护者。'),
 PAGINATION_LIMIT:E('结果太多，超过插件的分页上限。',CALLER,'缩小查询范围（例如按状态过滤）。'),
 // Files and commits
 STALE_FILE:E('文件在你读取之后被改过（SHA 变了），没有写入。',CALLER,'重新读取文件，基于最新内容再改。'),
 CONTENT_BASELINE_MISMATCH:E('GitHub 上文件内容和 expected_sha 对不上，没有写入。',CALLER,'重新读取文件后再改。'),
 CONTENT_SHA256_MISMATCH:E('按你的改动算出的结果和 expected_result_sha256 不一致，没有写入。',CALLER,'在本地按同样的改动重新计算结果哈希；注意保留 BOM、CRLF，不要转义或改写字符。'),
 INVALID_RESULT_SHA256:E('expected_result_sha256 格式不对。',CALLER,'传 64 位小写十六进制。'),
 PATCH_CONFLICT:E('old_text 在文件里找不到，或出现了不止一次，没有写入。',CALLER,'把 old_text 改成文件里唯一的一段原文。'),
 INVALID_EDITS:E('edits 格式不对（为空、太多或含非法字符）。',CALLER,'每项只含 old_text 和 new_text，old_text 不为空。'),
 INVALID_FILE_BASELINE:E('GitHub 返回的文件不是普通文本文件或数据不完整。',CALLER,'确认路径指向文件；二进制文件不能用 edit_file。'),
 INVALID_FILE_ENCODING:E('文件不是 UTF-8 文本或含 NUL 字符。',CALLER,'这种文件不能用 edit_file，改用 update_file。'),
 INVALID_FILE:E('文件内容不合法。',CALLER,'检查要写入的内容。'),
 INVALID_CONTENT:E('文件内容不合法（例如 base64 不对）。',CALLER,'检查 content_base64 是否是正确的 base64。'),
 FILE_TOO_LARGE:E('文件超过大小上限。',CALLER,'把文件拆小，或改用别的方式提交。'),
 DEFAULT_BRANCH_WRITE_REFUSED:E('插件不往默认分支直接写。',CALLER,'先建自己的分支，在分支上改，再开 PR。'),
 BRANCH_EXISTS:E('同名分支已经存在。',CALLER,'换一个分支名，或直接在已有分支上继续。'),
 ASSISTED_BY_REQUIRED:E('提交说明缺少 Assisted-by 行。',CALLER,'在提交说明末尾加上 Assisted-by: Cindy (https://cindy.app)。'),
 INVALID_CHANGES:E('commit_files 的 changes 格式不对。',CALLER,'按 github_operations 里 commit_files 的格式改正。'),
 INVALID_CHANGE_SOURCE:E('改动内容的来源不合法。',CALLER,'内容直接放在请求里传，不要引用本地文件。'),
 LOCAL_FILE_DISABLED:E('不支持从本地路径上传文件。',CALLER,'把内容直接放进请求。'),
 DUPLICATE_PATH:E('同一个路径在一次提交里出现了多次。',CALLER,'每个路径只保留一项改动。'),
 PATH_CONFLICT:E('路径之间有冲突（例如文件和同名目录）。',CALLER,'调整路径后重试。'),
 DELETE_TARGET_MISSING:E('要删除的文件不存在。',CALLER,'核对路径和分支。'),
 RENAME_SOURCE_MISSING:E('要改名的原文件不存在。',CALLER,'核对原路径和分支。'),
 RENAME_TARGET_EXISTS:E('改名的目标路径已经有文件。',CALLER,'换一个目标路径，或先删除原有文件。'),
 BLOB_SHA_MISMATCH:E('上传后的文件内容核对不一致，没有提交。',CALLER,'重试；仍出现就报维护者。'),
 OBJECT_WRITE_FAILED:E('在 GitHub 上写入文件对象失败。',CALLER,READ_BACK),
 TREE_TRUNCATED:E('GitHub 返回的目录树不完整。',CALLER,'改用更小范围的改动。'),
 INVALID_TREE_RESPONSE:E('GitHub 返回的目录树格式不对。',CALLER,'稍后重试；仍出现就报维护者。'),
 INVALID_COMMIT_RESPONSE:E('GitHub 返回的提交格式不对。',CALLER,READ_BACK),
 INVALID_REF_RESPONSE:E('GitHub 返回的分支信息格式不对。',CALLER,'稍后重试；仍出现就报维护者。'),
 INVALID_PR_RESPONSE:E('GitHub 返回的 PR 信息格式不对。',CALLER,'稍后重试；仍出现就报维护者。'),
 PARENT_REQUIRED:E('需要写明基于哪个提交。',CALLER,'传入 parent（分支当前的完整提交号）。'),
 INVALID_PARENT:E('parent 提交号不对。',CALLER,'读取分支当前的完整提交号后再传。'),
 INVALID_EXPECTED_HEAD:E('expected_head 格式不对。',CALLER,'传 40 位完整提交号。'),
 STALE_HEAD:E('分支在你读取之后又有了新提交，没有写入。',CALLER,'重新读取分支最新提交，基于它再改。'),
 NOT_FAST_FORWARD:E('分支不能快进到新提交（中间有别的提交），没有写入。',CALLER,'重新读取分支，基于最新提交重做改动。'),
 INVALID_MERGE_PARENT:E('合并父提交不对。',CALLER,'核对 merge_parent 是要合入的那个提交。'),
 MERGE_PARENT_REQUIRES_EXISTING_BRANCH:E('带合并父提交时，分支必须已经存在。',CALLER,'先建分支再提交。'),
 // Reviews and merge queue
 PR_NOT_REVIEWABLE:E('这个 PR 现在不能评审（已关闭、已合并或是草稿）。',CALLER,'确认 PR 状态后再评审。'),
 ALREADY_REVIEWED:E('这个账号已经对这个 head 评审过了。',CALLER,'head 变了再评审；不要重复评审。'),
 REVIEW_NOT_CONFIRMED:E('评审发出后没能读回确认。',CALLER,READ_BACK),
 STALE_OR_UNQUEUEABLE_HEAD:E('PR 的 head 已经变了，或现在不能进合并队列。',QQ,'按最新 head 重新审查后再入队。'),
 ALREADY_IN_MERGE_QUEUE:E('这个 PR 已经在合并队列里。',QQ,'无需再入队，等队列结果。'),
 QUEUE_HEAD_MISMATCH:E('合并队列里的 head 和你核准的不一致。',QQ,'按最新 head 重新审查。'),
 QUEUE_REJECTED:E('GitHub 拒绝把 PR 放进合并队列。',QQ,'检查 PR 的检查项和分支保护后再试。'),
 QUEUE_RESULT_UNCONFIRMED:E('入队请求发出后没能确认是否进了队列。',QQ,READ_BACK),
 QUEUE_NOT_QUEUED_AFTER_UNKNOWN_WRITE:E('入队请求结果未知，读回后确认没有进队列。',QQ,'可以重新入队一次。'),
 QUEUE_PERMISSION_DENIED:E('没有权限把 PR 放进合并队列。',OWNER,'确认仓库开了合并队列，并且 qq 的 App 有对应权限。'),
 QUEUE_IO_ERROR:E('本机评审队列文件读写失败。',MAINT,'检查插件数据目录后重试。'),
 QUEUE_CONFIGURATION_INVALID:E('自动评审队列的配置不对。',OWNER,'修正自动评审配置，或保持关闭。'),
 AUTOMATION_DISABLED_BY_OWNER:E('主人没有打开本插件的自动评审。',OWNER,'需要时在这台机器的配置里打开 automaticReviews 并重启插件；否则继续用现有 Inbox 评审。'),
 NOT_INITIALIZED:E('评审队列还没初始化。',CALLER,'先调用 initialize。'),
 ALREADY_CLAIMED:E('这项评审已经被领走。',CALLER,'换一项，或等对方完成。'),
 CLAIM_MISMATCH:E('领取凭证对不上。',CALLER,'用领取时拿到的凭证提交结果。'),
 STATE_INVALID:E('本机评审队列状态文件损坏。',MAINT,'检查插件数据目录；必要时重新 initialize。'),
 STATE_BUSY:E('本机评审队列正被占用。',CALLER,'稍后重试。'),
 STATE_TOO_LARGE:E('本机评审队列状态太大。',MAINT,'清理已完成的条目。'),
 UNSAFE_STATE_DIRECTORY:E('本机评审队列目录不安全。',MAINT,'检查插件数据目录的权限。'),
 UNSAFE_STATE_PATH:E('本机评审队列路径不安全。',MAINT,'检查插件数据目录。'),
 // Inbox service
 CONFIG_REQUIRED:E('Inbox 服务还没有配置。',OWNER,'需要时按说明配置 Inbox 服务；不用就保持关闭。'),
 INVALID_CONFIG:E('Inbox 服务的配置不对。',OWNER,'修正 Inbox 服务配置。'),
 SERVICE_DISABLED:E('Inbox 服务已被关闭。',OWNER,'需要时在配置里打开。'),
 SUBMODULE_REQUIRED:E('插件包里缺少 vendor/review-inbox 子模块。',MAINT,'重新打包时带上子模块。'),
 PORT_IN_USE:E('Inbox 服务要用的端口被占用。',OWNER,'关掉占用端口的程序，或换端口。'),
 HEALTH_TIMEOUT:E('Inbox 服务启动后没有按时响应。',OWNER,'查看服务日志后重启插件。'),
 START_FAILED:E('Inbox 服务没能启动。',OWNER,'查看服务日志后重试。'),
 STOP_FAILED:E('Inbox 服务没能停止。',OWNER,'在任务管理器里结束它，再重启插件。'),
 PROCESS_EXITED:E('Inbox 服务进程意外退出。',OWNER,'查看服务日志后重启。'),
 INVALID_CLOCK:E('本机时间不对。',OWNER,'校准系统时间。'),
 // Author cues
 INVALID_ROSTER:E('伙伴名单格式不对。',CALLER,'按说明提供名单。'),
 MISSING_ROUTING_ROSTER:E('缺少路由用的伙伴名单。',CALLER,'先提供名单。'),
 AMBIGUOUS_ROSTER:E('伙伴名单里有重名或冲突。',CALLER,'去掉重复项。'),
 AMBIGUOUS_APP_MAPPING:E('一个 App 对应了多个伙伴。',CALLER,'改正名单里的 App 对应关系。'),
 AMBIGUOUS_ACCEPTANCE:E('承接记录不唯一，无法判断谁接了。',CALLER,'在 Issue 上补一条明确的 RSI-ACCEPT v1。'),
 INCOMPLETE_CONTEXT:E('提供的上下文不完整。',CALLER,'补齐需要的字段后重试。'),
 INCOMPLETE_SNAPSHOT:E('快照不完整。',CALLER,'重新读取完整数据后重试。'),
 STALE_SNAPSHOT:E('快照已过期。',CALLER,'重新读取后重试。'),
 PRIOR_PR_MISMATCH:E('之前记录的 PR 和现在的对不上。',CALLER,'重新读取 PR 后重试。'),
 INVALID_FINDING:E('评审发现的格式不对。',CALLER,'按说明改正。'),
 INVALID_FINDING_CLOCK:E('评审发现的时间不对。',CALLER,'使用正确的时间戳。'),
 INVALID_PRIOR_CLOCK:E('之前记录的时间不对。',CALLER,'使用正确的时间戳。'),
 INVALID_PRIOR_CUES:E('之前的提示记录格式不对。',CALLER,'按说明改正。'),
 INVALID_STAGE_CLOCK:E('阶段时间不对。',CALLER,'使用正确的时间戳。'),
 INVALID_RESOLVER:E('解析器配置不对。',MAINT,'报维护者。'),
});
const LABEL={app_id:'App ID',app_slug:'App slug',app_owner:'App 所属组织',installation_id:'安装 ID',installation_app_id:'安装所属的 App ID',installation_owner:'安装所在的组织',installation_owner_type:'安装所在账号的类型',repository_selection:'安装的仓库范围',suspended:'安装是否被暂停'};
const printable=s=>[...s].map(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127?' ':c).join('');
const clip=v=>printable(String(v)).slice(0,120);
function httpEntry(code){
 const status=Number(code.slice('GITHUB_HTTP_'.length));
 if(status===401)return E('GitHub 拒绝了这个 App 的身份（401）。',OWNER,'确认 App 的私钥没被吊销；吊销过就重新生成并在设置页导入。');
 if(status===403)return E('GitHub 拒绝了这次操作（403）：App 没有这个权限，或被分支保护、限流挡住。',OWNER,'先看 identity 里的 missingInstallationPermissions；缺权限就到 App 设置里加上并接受更新；是分支保护就按规则走 PR。');
 if(status===404)return E('GitHub 找不到目标（404）：仓库、分支、文件或编号不存在，或 App 看不到它。',CALLER,'核对名称和编号；仓库不在 App 安装里就请主人加上。');
 if(status===409)return E('GitHub 报冲突（409）：目标在你读取之后变了。',CALLER,'重新读取最新状态后再改。');
 if(status===422)return E('GitHub 拒绝了参数（422）：内容不合法或与现状冲突。',CALLER,'核对参数（例如分支已存在、评审对象不对）后改正。');
 if(status===429)return E('GitHub 限流（429）。',CALLER,'等一会儿再试。');
 if(status>=500)return E('GitHub 服务出错（'+status+'）。',CALLER,'稍后重试。'+READ_BACK);
 return E('GitHub 返回了错误（'+(Number.isFinite(status)?status:'未知')+'）。',CALLER,'核对参数后重试；仍出现就报维护者。');
}
const FALLBACK=E('操作没有完成。',CALLER,'核对参数后重试；仍出现就报维护者。'+READ_BACK);
function entryFor(code){return Object.hasOwn(CATALOG,code)?CATALOG[code]:code.startsWith('GITHUB_HTTP_')?httpEntry(code):FALLBACK;}
function specifics(code,d){
 if(!d||typeof d!=='object')return '';
 if(code==='INSTALLATION_PERMISSION_MISSING'&&Array.isArray(d.missing)){
  const items=d.missing.map(m=>clip(m.permission)+':'+clip(m.required)+'（现为 '+clip(m.installed)+'）').join('，');
  return 'GitHub App '+clip(d.app)+' 的安装缺少：'+items+'。请主人在 App 设置的 Permissions 里加上（'+clip(d.appPermissionsUrl)+'），再到组织的安装页接受权限更新（'+clip(d.installationUrl)+'）。';
 }
 if(Array.isArray(d.failed)&&d.failed.length)return '没对上的项：'+d.failed.slice(0,10).map(f=>(LABEL[f.check]||clip(f.check))+'（应为 '+clip(f.expected)+'，GitHub 返回 '+clip(f.actual)+'）').join('；')+'。';
 if(typeof d.reason==='string'&&d.reason)return '原因：'+clip(d.reason)+'。';
 return '';
}
function explain(result){
 if(!result||typeof result!=='object'||result.ok!==false||typeof result.errorCode!=='string')return result;
 const entry=entryFor(result.errorCode),extra=specifics(result.errorCode,result.details);
 const message=result.errorCode==='INSTALLATION_PERMISSION_MISSING'&&extra?extra:entry.why+extra;
 return {...result,message,next:{who:entry.who,action:entry.action}};
}
module.exports={explain,CATALOG,entryFor};
