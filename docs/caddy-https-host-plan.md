# NET-M5-B2 — Caddy HTTPS 双入口宿主应用计划（只读准备阶段）

## NET-M5-C2-D · 一次性私有回滚原件锚定（2026-10-19）

**已完成前置：** C2-A 独立 Ed25519 签名申请、C2-B 私有单 Pending 登记、C2-C 只读 Pending 复核。本阶段新增 `scripts/caddy-https-host-rollback-anchor.py`，只备份**正式宿主机当前 .env/Compose 的完整原始字节**（含可能存在的凭据），**不修改这些文件**，不调用 Docker，不启停 Caddy，不构成可用的回滚执行器。

- 操作员提供与 C2-C 一样的全部受信任路径及独立的 Plan、Stage Receipt、Pending 原始 SHA-256、Ed25519 公钥 DER 指纹；先运行原 C2-C 只读核验，再于 `state/caddy-https-admissions/.intent.lock` 的排它非阻塞锁内完整复核签名、双修订、当前 `.env`/Compose 和现有 Pending 记录。旧运行入口安全性与证书信任仍待实体现场确认。
- 只允许在同一 xDrive 安装 HOME 的私有 `state/caddy-https-admissions/rollback-anchor` 目录创建**唯一**备份。目录必须为操作员自有 0700，内部 `original.env`、`original.compose`、`receipt.json` 使用 `O_CREAT|O_EXCL|O_NOFOLLOW` 0600 创建，完整写入及 fsync 文件和父目录；校验备份前后原配置字节、文件身份、签名、Pending 摘要均不变。任何重复/既存锚点、符号链接、部分写入、错误权限和竞争都直接拒绝，不能自动清理、继续或重试。
- 回执只保存 Plan/Pending/原始配置摘要、两修订与固定阻断项，**不能**输出 `.env`、AliDNS 密钥、域名、私网 IP、Root CA 或绝对路径。即使写入完整成功，返回状态也仅为 `host-rollback-anchor-prepared-unapplied`、`apply_supported=false`。
- 该锚点只是后续隔离事务、独立 watchdog 超时回滚的材料。没有真 Host/DB CAS、nonce 消耗、安全 AliDNS 密钥交付、受信实体独立 Rescue、重启后的已启用入口正向验证与已关闭入口负向验证、不可变签名 Applied Receipt，绝不授权自动应用/重启。实体设备登录、证书信任、宿主停机和生产回滚未执行。测试使用原始离线 OpenSSL/Ed25519 夹具覆盖成功、机密保护、残留、非法源、符号链接、排它锁和三进程竞争。
## NET-M5-C2-C · 已登记签名申请的独立只读复核（2026-10-18）

**前置：** [#2089](https://github.com/lazyxu/xdrive/pull/2089) 的 C2-A 规范签名请求检验、[#2091](https://github.com/lazyxu/xdrive/pull/2091) 的 C2-B 宿主私有单 Pending 围栏均已合入。本阶段仍 **不会** 修改正式 Caddy 配置，也不具备 Host Apply/Restart、运行回滚或已应用回执。

新增操作员本地脚本 `scripts/caddy-https-host-pending-verify.py`，用于证明现有的 `state/caddy-https-admissions/pending.json` 仍然与可信签名请求、当前受保护部署文件及预演候选相符。主要核验规则：

- 与同一 xDrive `config/.env` 关联的私有状态目录必须存在且当前操作员拥有、0700、无路径符号链接；仅以 `O_NOFOLLOW|O_NONBLOCK` 打开 **已存在** 的 0600 单硬链接空 `.intent.lock` 和不超过 4096 字节的 0600 `pending.json`，不创建新锁或重写记录。取得 `flock(LOCK_SH|LOCK_NB)`；C2-B 正在独占登记时保守失败。
- 必须从**另一受信渠道**事先固定 Pending 原始字节 SHA-256，不能在同一不可信文件上现算并冒充独立批准。拒绝非规范 JSON、重复/未知字段、伪造已应用状态、错误版本或固定阻断原因。
- 复用 C2-A 的真实 Ed25519 签名、独立固定公钥 DER、UUIDv4/nonce、10 分钟窗口、HTTPS 与 AliDNS 修订、Host Plan、私有 Stage 以及原始 `.env`/Compose/candidate SHA 校验。将 Pending 内 operation/nonce 哈希、签名申请哈希、版本和所有源文件摘要逐项与当前签名请求及 Host 实际文件绑定。
- 完整验签后再次重做 C2-A 验证，重新比对 Pending 内容及 inode/size/mtime/ctime、锁文件和私有目录身份。签名到期、真实文件漂移、FIFO/软链接、锁竞争、部分写入或被篡改的 Pending 一律返回 `blocked`；不自动删除、恢复或覆盖已经登记的申请。

可信操作员示例（所有 PINNED 摘要须独立核验，不包含口令或私钥）：

```bash
python3 scripts/caddy-https-host-pending-verify.py \
  --plan "$TRUSTED_PLAN_JSON" --env-file "$HOME/.xd/config/.env" \
  --compose-file "$HOME/.xd/config/docker-compose.yml" \
  --expected-plan-sha256 "$PINNED_PLAN_SHA256" \
  --staging-dir "$HOME/.xd/state/caddy-https-staging" \
  --expected-stage-receipt-sha256 "$PINNED_STAGE_SHA256" \
  --apply-intent-manifest "$SIGNED_INTENT_JSON" \
  --apply-intent-signature "$SIGNED_INTENT_SIG" \
  --operator-public-key "$PINNED_OPERATOR_KEY_PEM" \
  --expected-operator-key-der-sha256 "$PINNED_KEY_DER_SHA256" \
  --admission-dir "$HOME/.xd/state/caddy-https-admissions" \
  --expected-pending-sha256 "$INDEPENDENT_PENDING_SHA256"
```

成功只返回 `signed-intent-pending-reverified-unapplied` 和 `apply_supported=false`。它不消费 nonce，不清除 Pending，不能发布宿主 Apply 许可或重启 Caddy。缺少生产实体 Rescue 停机、DB/Host 原子 CAS、AliDNS 安全凭据交付、配置原子替换、独立 watchdog 自动回滚、启用/禁用入口正反 TLS/管理员登录和不可变 Applied Receipt，仍然 NO-GO。

现有 `scripts/test-caddy-https-host-plan.py` 添加真实 Ed25519 签名、Pending 异常、同内容替换、权限、进程锁竞争与无副作用回归；由原 `server-validation` 运行。用户设备的真实 TLS/CA 信任及生产 Host Apply 均未在本阶段执行。

## NET-M5-C2-B · 操作员私有的一次性签名申请占位／防重放围栏（未应用，2026-10-18）

**前置：** C1-A、C1-B 的独立 Rescue 离线与已签名镜像验证已合入；C2-A [#2089](https://github.com/lazyxu/xdrive/pull/2089) 的 Ed25519 `operator-apply-intent.v1` **仅做规范签名申请只读检查**，仍处于准确 HEAD 全 CI 验收中。本 C2-B 必须独立验收，不能将 C2-A 的合法申请视为 Caddy 重启许可。

本阶段增加 `scripts/caddy-https-host-admission.py`，只供**宿主机可信操作员**使用。与 C2-A 的签名申请检查相比，这个新的显式独立命令唯一的写入是安装目录旁 `state/caddy-https-admissions` 私有状态子目录中的 `.intent.lock` 和 `pending.json`，**不会修改正在使用的 `config/.env`、Compose、Caddy、Docker、系统信任或 DNS**。

- 操作员先通过自己的可信通道取得 Canonical Host Plan 和 stage receipt 的独立 SHA 固定指纹，完成 C2-A 的正确签名和受监督 Rescue 准备。在宿主同一 xDrive-home 下自行预先建立 `state/caddy-https-admissions`，目录必须属于当前操作员、0700、不能是任何符号链接，`config/.env` 须仍位于同一家的 `config` 兄弟目录。
- 每次调用在 `O_NOFOLLOW`、`O_CREAT`、0600 的**固定宿主锁文件**上以 `flock(LOCK_EX|LOCK_NB)` 获取独占锁，检查既有 `pending.json` 必须不存在；在锁内重新执行**原样 C2-A 双阶段 Host Plan/stage/签名验证**，并使用受信运维公钥 DER 指纹、签名范围、期望 HTTPS 与 AliDNS 双修订和所有 host/candidate SHA 绑定当前请求。
- 验证通过后，在固定的同一私有目录用 `O_EXCL|O_NOFOLLOW` 创建 0600 `pending.json`，仅记录哈希过的 operation UUID / nonce、签名申请 SHA、期望修订/配置候选 SHA 和**否定**应用能力。必须 fsync 新收据及宿主状态目录；随后再次复核正式 host 文件、私有暂存候选和签名。若任意一步失败，**不自动删除**可能已经创建的 `pending.json`，阻断以后的请求，防止断电、进程异常或重放时默默再次执行。
- 同一时刻其他进程的锁竞争，以及相同或**不同**有效申请的第二次进入，都失败关闭；时间到期**不**自动清除占位。它是「最多一个待审查申请」的持久化围栏，而不是未来 Host Apply 的持久 nonce 消费授权、已执行的受信 CAS 事务或防所有操作者手动删除的全局锁。
- 返回固定 `state=signed-intent-pending-unapplied`、`apply_supported=false`，不回传真实 IP/域名、原始 `.env`、AliDNS 密钥、密码/Token、Caddy 本地 CA、运营者签名私钥、命令行、保密路径。历史未完成或被中断的占位只能通过**另一个独立审核的保守恢复流程**核查，不能靠自动 TTL、静默覆盖或本命令自行删除。
- **仍缺少：** PostgreSQL 与真实宿主环境版本一致性的一次性原子 CAS、可信 Host Manager 应用 scope 独立授权、AliDNS 秘密安全交付、机器配置备份和原子替换、Caddy 有界重启、与进程无关的超时 watchdog rollback、正反双入口真实 TLS/管理员登录，以及无法伪造的已应用回执。这一工具**不得被系统依赖页面当成应用成功**，不暴露任何 Host Apply/Restart 接口，**生产能力保持 `apply_supported=false`**。

示例（需操作员事先从可信渠道核对计划、签名和收据，并创建私有目录；命令**不会执行部署**）：

```bash
python3 scripts/caddy-https-host-admission.py \
  --plan "$TRUSTED_PLAN_JSON" --env-file "$HOME/.xd/config/.env" \
  --compose-file "$HOME/.xd/config/docker-compose.yml" \
  --expected-plan-sha256 "$PINNED_PLAN_SHA256" \
  --staging-dir "$HOME/.xd/state/caddy-https-staging" \
  --expected-stage-receipt-sha256 "$PINNED_RECEIPT_SHA256" \
  --apply-intent-manifest "$TRUSTED_SIGNED_INTENT_JSON" \
  --apply-intent-signature "$TRUSTED_INTENT_SIGNATURE" \
  --operator-public-key "$TRUSTED_OPERATOR_ED25519_PEM" \
  --expected-operator-key-der-sha256 "$PINNED_OPERATOR_DER_SHA256" \
  --admission-dir "$HOME/.xd/state/caddy-https-admissions"
```

原 `scripts/test-caddy-https-host-plan.py` 添加真实离线签名、目录权限、断电残留、重复申请以及**三个并发进程竞争同一独占锁**的回归，随原有 server-validation 运行，不改 GitHub 工作流。此阶段没有物理停机、真实独立设备 SSH 救援、实际 Caddy Host Apply 或 watchdog 演练。

## NET-M5-C2-A · 独立签名 Host Apply 请求意图只读校验（2026-10-18）

**当前能力边界：** C1-A 与 C1-B 解决 operator-only 主 Caddy 维护窗口 / SSH Rescue / Ed25519 Rescue 镜像证据的分阶段关联；尚未执行生产宿主机的受监督真实停机，也没有 Host CAS、Docker 操作或 watchdog。管理员页面仍只能保存**期望修订**和只读检测，不能重启并发布虚假的已应用状态。C2-A 仅实现未来安全事务前所需的签名请求**只读校验**。

新的受信操作员宿主工具 `scripts/caddy-https-host-apply-intent-check.py` 接受与旧 `candidate-review-only` **完全不同的**规范 Ed25519 签名请求：`scope=xdrive.caddy.https.operator-apply-intent.v1`、`action=request-restricted-caddy-apply`。固定字段要求：
- `schema=1`、RFC4122 canonical v4 `operation_uuid`、独立 32 字节随机非零 `nonce`（64 位十六进制字符）；意图生成和首次校验**不表示**请求已单次消费。
- `desired_revision`（必须大于 0）和 `credential_revision`，均与实时读到且独立固定原始 SHA 的 Canonical Host Plan 匹配。
- `plan_sha256`、`stage_receipt_sha256`、`host_environment_sha256`、`host_compose_sha256`、`candidate_environment_sha256` 与既有 B3-C1 严格私有候选复核完全一致。只允许符合 B3-C1 禁止危险变更策略的已私有暂存候选（现阶段对 AliDNS 新凭据交付、切换或禁用现有入口仍会拒绝）。
- 独立运营者预批准的 immutable OCI `approved_rescue_image`（必须为 `@sha256`，不能是可移动 tag）。此字段仅绑定申请者声明，**不**替代 C1-B 的现场已签名 Rescue 镜像验证、发行商 provenance。
- UTC `issued_at`／`expires_at`，窗口不得超过 10 分钟；阻止过期、过早生效、重复键、浮点、布尔型修订、非法 UUID/nonce、错误指纹、额外字段、非规范 JSON 或签名/密钥与操作者 PIN 不一致。
- 签名通过既有 `openssl` Ed25519 public DER 固定指纹完成；校验前后核对所有源文件 inode/mtime/ctime/内容及 B3-C1 暂存回执，不能用更改了但具有相同哈希的文件替换。

工具是**纯只读验签和请求一致性检查**。成功结果为 `state=signed-apply-intent-inspected-unapplied`、`apply_supported=false`，包含意图 SHA、两个期望修订、Plan／Stage 摘要，以及**必须继续阻断**的真实宿主机单次 nonce 消费 / 双修订 CAS、物理 Rescue 验收、AliDNS Secret 安全交付、独立超时 watchdog、启停入口正反验证及不可变 Applied Receipt。重复调用相同已签名意图仍是“通过静态验签”，不是一票使用一次的运行事务；不能被 Host Manager 当成执行许可证。

操作员离线命令示例（计划、阶段收据、公钥 DER 指纹应来自独立可信渠道，签名由用户私有密钥离线产生；**不填写凭据原文**）：

```bash
python3 scripts/caddy-https-host-apply-intent-check.py \
  --plan "$PINNED_PLAN_JSON" --env-file "$HOME/.xd/config/.env" \
  --compose-file "$HOME/.xd/config/docker-compose.yml" \
  --expected-plan-sha256 "$TRUSTED_PLAN_SHA256" \
  --staging-dir "$HOME/.xd/state/caddy-https-staging" \
  --expected-stage-receipt-sha256 "$TRUSTED_STAGE_SHA256" \
  --apply-intent-manifest "$PRIVATE_APPLY_INTENT_JSON" \
  --apply-intent-signature "$PRIVATE_APPLY_INTENT_ED25519_SIGNATURE" \
  --operator-public-key "$TRUSTED_OPERATOR_PUBLIC_KEY_PEM" \
  --expected-operator-key-der-sha256 "$TRUSTED_OPERATOR_KEY_DER_SHA256"
```

旧的 `scripts/caddy-https-host-signed-review.py` 必须继续拒绝新的 apply-intent scope，新工具也拒绝任何旧的 `candidate-review-only` 签名。该校验脚本没有 Docker、网络、服务重启、Host Manager API、新 Web/Desktop IPC 或修改正式 `.env` 的能力；其 **C2-A 离线验收不等于生产配置已应用**。现有 `scripts/test-caddy-https-host-plan.py` 扩展正反例，在原 `server-validation` 中自动执行，不新增 CI 工作流入口。

## NET-M5-C1-B · 已签名批准的 Rescue 镜像与异机停机观察绑定（只读，2026-10-18）

**前置：** NET-M5-C1-A #2080 已通过准确工作提交的完整 CI 并以 Rebase 合并，旧 Caddy 专题分支已清理。C1-A 四阶段 before → primary-down → 异机 SSH 管理员登录 → primary-down → restored 只证明相互关联的只读观察，原先**没有在每阶段复核已签名批准的 Rescue 镜像**。

C1-B 为同一个异机验收脚本增加**显式 opt-in 的** `--require-approved-runtime` 附加参数，不影响已有只读命令。独立操作员需从另外的可信渠道分别固定远端两个 Python 检查器 SHA-256、操作员 Ed25519 公钥 DER 指纹及由该密钥审核的独立 OCI Rescue 镜像 digest；批准清单/签名/公钥位于远端受保护文件，不传至 CLI 输出、浏览器、Server 或 Desktop。原阶段脚本与主机密钥钉住逻辑不放宽。

每次阶段采样严格执行：（1）核对四个远端只读 checker 脚本 SHA；（2）对远端私有 `.env`、Compose、签名清单、签名和公钥读取 5 个 SHA（仅散列，不读取明文，拒绝字段/路径错序）；（3）执行已经审查的 `caddy-rescue-approved-runtime-check.py`，复核受签名批准的 OCI digest、真实 Rescue 容器身份、独立运行状态和输入文件在同一窗口未变；（4）再次核对五项私有文件摘要，获取原只读 Caddy 阶段证据后第三次核对；（5）重复核对四个远端 checker 本身。跨 before/down/down/restored 四次采样的所有五个文件摘要必须字节一致；任何失败立即阻断，没有「有条件通过」或误称 `Host Apply`。

新增参数（必须完整提供，且只允许在**另一个可信操作员终端**且主机明确准备恢复方案后手动运行）：

```bash
python3 scripts/caddy-rescue-supervised-outage-check.py \
  "$TRUSTED_OPERATOR_SSH_TARGET" "$PINNED_KNOWN_HOSTS" 3080 22 \
  "$REMOTE_TRUSTED_XDRIVE_SCRIPTS/caddy-rescue-primary-state-witness.py" \
  "$REMOTE_XDRIVE_ENV" "$REMOTE_XDRIVE_COMPOSE" \
  "$INDEPENDENT_WITNESS_SHA256" "$INDEPENDENT_OPERATOR_CHECK_SHA256" \
  --require-approved-runtime \
  "$PINNED_APPROVED_RUNTIME_CHECK_SHA256" "$PINNED_IMAGE_APPROVAL_CHECK_SHA256" \
  "$REMOTE_APPROVAL_MANIFEST" "$REMOTE_APPROVAL_SIGNATURE" "$REMOTE_APPROVAL_PUBKEY" \
  "$INDEPENDENT_OPERATOR_PUBKEY_DER_SHA256" "$APPROVED_IMMUTABLE_RESCUE_IMAGE"
```

**安全与验收限制：** 签名的**Rescue 镜像运营者批准**不等于发行商/OCI provenance、主网关 Host Apply 授权或具备高可用保证。即便获得通过结果，也仍然是离散 read-only 观察，不能证明连续 outage、实际关闭入口不可达、域名公网链路、真实应用、自动受控重启和独立超时回滚。通过标记也始终 `apply_supported=false`；未提供额外参数时必须明确报告 `signed-rescue-runtime-across-phases: not-checked`。本阶段仅新增静态代码和离线 Python 正反回归，没有运行用户生产 Caddy 停机、真实异机 SSH、证书/文件修改或 Host Apply。

## NET-M5-C1-A — 异机监督主 Caddy 停机／独立 Rescue 管理员连续性验证（只读，2026-10-18）

**前置状态：** #2071 双入口初始化与页面去重已合并；NET-M5-C0 只能独立验证已经开启的 IP/域名登录，现有 `caddy-rescue-primary-state-witness.py` 和 `caddy-rescue-ssh-auth-check.py` 分别观测宿主生命周期或异机救援登录，过去**不能绑定在同一次实际主网关中断期间**。本阶段只增补可验证的观察链，不授予 Host Apply/Restart。

- `caddy-rescue-primary-state-witness.py --json before|primary-down|restored ENV COMPOSE` 在**宿主只读验证成功后**额外返回严格、单行、无凭据 JSON（固定协议、阶段、当前 UTC、哈希过的同 Compose 项目／主网关容器／Server 与 Rescue 进程代际、主 Caddy 启停时间，始终 `apply_supported=false`）。默认旧版人类可读输出不变；没有原始 Docker inspect、域名/IP、环境值、凭据或证书输出。Docker 状态、独立 Rescue 本机健康、匿名 401 与镜像隔离仍通过已有检查器。
- 新 `scripts/caddy-rescue-supervised-outage-check.py` **只能由另一台受信任操作员电脑在交互式终端显式运行**。准备已审查的独立 Rescue、可信 SSH known_hosts、真实双操作员受监督维护窗口及独立恢复方案之后，工具通过固定主机密钥与独立固定的远端 witness/checker SHA-256 执行四次**只读远端观察**：主网关健康 → 外部运维人员已停止主网关 → 在另一路固定 SSH -W 救援连接验证管理员登录（必须有 401、管理员身份和 11 项服务清单）之后再确认主网关仍停止 → 外部运维人员将主网关恢复健康。每阶段重新核验两个脚本内容摘要；从一次私有 SSH known_hosts 快照复用主机身份；不从保存配置猜测任何已生效事实。
- 本工具**不**执行 Docker stop/start/restart、Compose Apply、主机/DNS/证书写入、SSH 自动远程执行任意用户命令，也不自动操作现网端口。所有私有密码只从当前操作员的交互终端取得，经匿名本地子进程输入管道交给既有安全 Rescue SSH 检查器；禁止把密码和 Token 放进 CLI、环境或日志。输出仅固定枚举，不输出原始 SSH、Docker/Compose、用户地址或口令。
- 通过条件：同一项目、主 Caddy 容器身份、Server 与 Rescue 启动代际跨四次采样不变；Docker `StartedAt` → `FinishedAt` → 真实新的 `StartedAt` 时间线合理；两次主网关停机观测之间的独立 SSH 管理员登录成功。拒绝旧数据、重复键、非法 SHA、未经信任的远端脚本、失效主机证书、权限/登录失败、过期时间、代际变更或主 Caddy 未真正恢复。
- **证据限制：** 这是同一次受监督操作的「离散采样一致性」，不能证明两次停机采样之间毫秒级不间断、对外 DNS/公网 HTTPS、全客户端 CA 信任、已关闭入口不可访问、签名镜像发行商身份、Caddy 新配置实际应用或独立自动回滚；脚本绝不产生可被当作 Host Apply 授权的签名回执，`apply_supported=false`。**本轮只有离线夹具与源码/CI 测试，没有执行实体主 Caddy 停机或现场异机登录；生产 Host Apply 仍 NO-GO。**

使用示意（仅限已建立运维安全条件的监督演练；以下变量均需由操作员事先安全获得）：

```bash
python3 scripts/caddy-rescue-supervised-outage-check.py \
  "$TRUSTED_OPERATOR_SSH_TARGET" "$PINNED_KNOWN_HOSTS" 3080 22 \
  "$REMOTE_TRUSTED_XDRIVE_SCRIPTS/caddy-rescue-primary-state-witness.py" \
  "$REMOTE_XDRIVE_ENV" "$REMOTE_XDRIVE_COMPOSE" \
  "$INDEPENDENT_WITNESS_SHA256" "$INDEPENDENT_OPERATOR_CHECK_SHA256"
```

操作员不得在未准备主网关恢复、可信独立管理员救援及维护窗口的情况下尝试物理演练；参数对应真实平台端口与绝对路径，镜像签名及真实公网 TLS 必须另行验收。CI 原有 `scripts/test-caddy-rescue-profile.sh` 集成新的离线 Python 负例测试，不改工作流、不跳过旧检查，不触及 Web/Desktop Server Auth/Agent IPC。

本阶段把 xDrive「系统依赖 → Caddy」已审计、已保存的目标配置导出为**规范、无密钥的版本化运维计划**，并在宿主机只读复核配置一致性。它准备最终的“保存 → 安全应用 → 受控重启 → 实效验证 → 超时回滚”流程，**本阶段没有实际应用能力**。

## 实现与证据边界

- 仅管理员可访问 `GET /api/v1/admin/services/caddy/https/host-plan`。该接口使用既有管理员认证、PostgreSQL repeatable-read 的 HTTPS 与 AliDNS 双修订快照，生成 Canonical JSON。未保存修订、双入口均关闭、非法域名或私网 IP、域名启用却缺少加密 AliDNS 凭据，全部拒绝导出。
- 本次修复期望快照中遗漏的 LAN 开关及 LAN IP 对比。生成计划前后核对两项开关、两种地址、两种修订及已加密凭据元数据。快照复核不等于跨进程、跨时段的 Host Manager CAS。
- 只有操作员在受信任宿主机上执行 `scripts/caddy-https-host-plan.py`；它读取独立校验的计划 SHA-256 及当前私有 `.env`、Compose，拒绝软链接、无写入端 FIFO、不可信权限、重复字段、非法 IPv4/FQDN、错误 Bind/端口与文件中途替换，计算现有入口/目标模式差异及固定风险代码。
- 结果不包含原始域名、IP、AliDNS Secret、Token、CA 或原始 Compose。所有成功的本地预览均报告 `apply_supported=false`。它**不调用 Docker、网络、DNS、Caddy 或操作系统信任库，也不写宿主机文件、不能重启**。
- 既有 `apply_state=pending`、七点预检、`restricted-apply=blocked`、`public-https=unknown` 不变；任何计划哈希或本机 TLS 成功都不能冒充“已生效”。

## 规范输入

Canonical JSON 是严格小写 ASCII 字段值、键名排序、紧凑编码、末尾一个 LF。下列为无密钥、IP-only **示例**：

```json
{"credential_revision":0,"desired_revision":7,"domain":"","domain_enabled":false,"lan_enabled":true,"lan_ip":"192.168.2.4","protocol":"xdrive.caddy.https.host-plan.v1"}
```

字段固定：`protocol`、`desired_revision`、`credential_revision`、`domain_enabled`、`domain`、`lan_enabled`、`lan_ip`。整数修订小于 2^60；至少启用一个 HTTPS 入口；域名只接受规范小写 ASCII FQDN；IP 只接受规范 RFC1918 IPv4；启用域名必须有正的 AliDNS 凭据修订。额外/重复字段、浮点、IPv6、CIDR、URL、通配符、八进制/缩写 IPv4 都被拒绝。

## 宿主机只读预演

通过现有可信 HTTPS 管理员会话，安全地获取上述管理员 API 的**原始响应字节**，在操作员机器以模式 0600 保存为私有文件，并在**独立可信通道**核对其 SHA-256。不要把浏览器会话 Token、Secret 或 Caddy Root CA 写入该计划或命令行。

```bash
python3 scripts/caddy-https-host-plan.py \
  --plan "$HOME/.xd/state/caddy-host-plan.json" \
  --env-file "$HOME/.xd/config/.env" \
  --compose-file "$HOME/.xd/config/docker-compose.yml" \
  --expected-plan-sha256 "$TRUSTED_PLAN_SHA256"
```

仅从同一不可信文件计算哈希，再把它冒充“独立批准”没有认证效力。工具输出 `current_mode`、`desired_mode`、`changes`、`blockers`、`candidate_sha256`、`host_environment_sha256`、`host_compose_sha256` 与修订号，均无敏感明文。阻断时以固定 `invalid-or-changing-input` 报错，不泄露路径和异常文本。

## 尚未完成：真实自动应用 NET-M5-B3/C

真正让系统依赖页面“保存、应用、重启生效”还需独立交付：可信的宿主 Host Manager 版本化双修订 CAS、经过审核的 Operator Rescue 与异机登录实测、安全交付 AliDNS 凭据、原子替换环境和备份、独立限时回滚看门狗、两个真实 HTTPS 入口与登录/刷新/退出测试、失败恢复回执、不可变审计及 UI 真实进度。任何一项缺失均不得开放危险的 Apply/Restart 开关。

目前新部署优先直接配置 **IP HTTPS**；域名需要单独配置；两者可同时启用但不能全部关闭。对私网 IP 使用本地 CA：**浏览器/手机首次登录前仍须从可信通道核对并信任 Caddy 私有 CA，不能跳过 TLS 证书警告输入密码。**

## 回归

CI server-validation 执行 `python3 scripts/test-caddy-https-host-plan.py`。离线测试覆盖 IP-only、双入口、启停/切换、错 IP/FQDN/端口/Bind、双关、缺少 AliDNS 修订、重复与未知字段、错误摘要、损坏或可替换文件、FIFO、软链接与保守无密钥输出。Go 纯函数输出与 Python 严格规范必须一致，新的管理员只读路由仍在 requireAdmin 保护下。只有本工作提交完整准确 HEAD CI（Go PostgreSQL Race、Linux/Windows、Web/Desktop、Rootless、制品、Final Gate）全绿且 GitHub clean，才可合并。

## NET-M5-B2-UI — 在系统依赖页面核对应用计划（2026-10-18）

管理员可以在 **系统依赖 → Caddy → 检测** 点击“查看宿主机应用计划（只读）”，不需要手动调用 REST API。Web、Mobile Web、PWA、Desktop 共用同一 MUI 面板，访问管理员专用 Host Plan GET；Desktop 使用当前认证 Agent IPC，显式检查 `admin-services` 能力。UI 只显示规范的双入口启停意图、局域网 IP/域名以及已保存的 HTTPS/AliDNS 修订号，不会读取或复制加密凭据、宿主机环境文件或 Root CA。7 字段响应接受严格运行时 Schema；旧 Server/Agent、不完整字段、双入口同时关闭、非法 IP/FQDN、额外 `apply_supported`/applied 字段、无效修订都会显式报错。保存与历史回滚后，复用现有失效信号清空旧预览，避免误把缓存计划当成当前应用状态。

此按钮只提供**保存值预览**，不是宿主机已应用验收；本机 HTTPS 的独立检测仍在原预检页。实际“应用配置并重启”需要单独开发并通过物理验收，受限 Host Manager/Rescue/超时回滚门禁没有因此放宽，现有 Caddy 启停仍禁用。

## NET-M5-B3-A — 宿主机 .env 候选配置确定性指纹（只读，2026-10-18）

操作员只读 Host Plan 现追加 `candidate_environment_sha256`：在保护的同一 .env 快照上，于**内存**中仅重写固定的 `XD_DOMAIN`、`XD_LAN_HTTPS_IP`、`XD_LEGACY_HTTP_ONLY=0`，保留所有其他字节（包括不返回的旧凭据）。它计算候选 .env 整体 SHA-256，且重新按既有私网 IP、FQDN、非明文、绑定和端口规则验证候选；重复的任意环境变量、畸形行、CRLF、缺末尾 LF 和不可信文件一律阻断。缺失的三项固定变量可按确定顺序追加。变化结果仍只有受限枚举与哈希，绝不暴露候选完整内容、凭据、原始域名/IP、Shell 命令或写文件接口。

`host_environment_sha256` 与 `candidate_environment_sha256` 可供未来受信 Host Manager 的预提交版本/文件检查对比；**SHA 相同也不证明已应用**。本阶段无真实 Host CAS、授权令牌、可信 Rescue/失联实测、域名 AliDNS 凭据宿主安全交付、原子写入/备份、Docker/Caddy 重启、双入口浏览器登录或计时回滚，因此依然 `apply_supported=false`。绝对不能把此候选指纹当作应用许可或不可变已应用回执。完整宿主 Apply/Restart 属于后续 NET-M5-B3-B/C。

若目标 IP 与当前 `XD_HTTPS_BIND` 不兼容，仍按既有只读预检返回 `https-bind-migration-required`，但 `candidate_environment_sha256` 必须为 `null`，避免对无法仅靠这三个变量应用的候选生成可误用的摘要；绝不自动把绑定扩大到 `0.0.0.0`。

## NET-M5-B3-B — 受保护的宿主机候选 .env 暂存（不触碰实际网关）

`scripts/caddy-https-host-stage.py` 是**操作员在可信宿主机显式运行**的独立命令。先复用只读 Host Plan 预检与经独立可信通道核对的 Plan SHA，然后通过固定的期望修订、现有 .env 与 Compose 哈希再次核验候选字节；仅在已有的私有 `state/caddy-https-staging`（所属操作员、0700、不可是符号链接）内，以 O_EXCL/O_NOFOLLOW 创建 0600 的候选 .env 与无密钥暂存收据，fsync 文件与目录。二者以同一个输入指纹命名，重复执行拒绝覆盖；失败会尽量清理本次创建的文件。任何已有正式 `config/.env` / Compose 均只读；没有 Docker、DNS、TLS CA、Restart、Save/Apply API 或网页登录凭据。在异常断电时可能留下**没有收据的未完成暂存文件**，这种文件不得安装且需操作员清理。

为防遗漏保护，尚未具备 AliDNS 私密凭据宿主交付、当前私网 Bind 迁移、现有管理入口切换/关闭，或旧 HTTP 安装时，暂存直接失败，不会放宽绑定或删除当前入口。此命令只为后续经过批准的原子 Host Apply 提供可比对的私有输入工件，不是一次部署，也不是一个安全应用许可。收据固定 `state=candidate-staged-unapplied`、`apply_supported=false`；真实重启仍被 Rescue、Host CAS、双 HTTPS/login 与看门狗回滚门禁阻止。测试通过 `python3 scripts/test-caddy-https-host-plan.py` 同时覆盖纯只读计划与暂存权限、无覆盖、无凭据打印、不改原文件及危险入口拒绝。

## NET-M5-B3-C1 — 暂存候选的只读完整性复核（绝不应用）

宿主机操作员可显式执行 `scripts/caddy-https-host-verify-stage.py`。它独立复核已保存的 Canonical Host Plan 指纹、当前受保护的 .env/Compose 快照、确定性候选 .env 全部字节，以及暂存收据的严格规范 JSON 和 SHA-256。所有被读取的暂存文件必须属于当前操作员、0600 常规文件、不可使用符号链接/FIFO，所在目录必须为操作员所有的 0700 私有目录；读入前后核对固定 inode、长度、mtime、ctime，避免将旧候选当成可用部署。需要从独立可信通道核验两个 SHA-256，并保留原有七项 Caddy 只读预检。

例：`python3 scripts/caddy-https-host-verify-stage.py --plan "$HOME/.xd/state/caddy-host-plan.json" --env-file "$HOME/.xd/config/.env" --compose-file "$HOME/.xd/config/docker-compose.yml" --expected-plan-sha256 "$TRUSTED_PLAN_SHA256" --staging-dir "$HOME/.xd/state/caddy-https-staging" --expected-stage-receipt-sha256 "$TRUSTED_STAGE_RECEIPT_SHA256"`。

输出永远是 `candidate-verified-unapplied` 或 `blocked`，且 `apply_supported=false`；不返回原始 IP、域名、凭据、候选内容或路径。即使验收通过，也只代表固定时点的私有暂存工件正确，**不证明管理员保存修订已应用、当前 Caddy 运行配置、异机登录、独立救援或自动回滚可用**。它不修改文件、Docker、Caddy、DNS、证书和系统信任。必须先完成真实独立救援的停机验证、签名批准、受限 Host CAS、双入口登录证明、独立超时看门狗及不可变应用回执，才可以提供真正的“应用并重启”操作。

## NET-M5-B3-C2 — 受操作员签名的候选复核（非 Apply 授权，2026-10-18）

新的宿主机私有脚本 scripts/caddy-https-host-signed-review.py 严格重用 B3-C1 完整候选复核，另要求操作员经独立可信通道固定 Ed25519 公钥 DER SHA-256 指纹，验证私有 0600 签名清单和签名。私钥绝不进入 Server、Agent、Web、Desktop 或 Git；测试仅生成临时密钥。清单为规范 JSON + LF，固定 scope=xdrive.caddy.https.operator-stage-review.v1 与 action=candidate-review-only，绑定 HTTPS/AliDNS 双修订、Plan/Stage Receipt/原始 .env/Compose/候选五个 SHA-256、UTC 有效期（最长 60 分钟）及 nonce。

拒绝非规范/重复字段、过期与未来或超长有效期、错误类型/公钥/签名/摘要、源文件替换和权限错误；有效签名但包含 apply-and-restart 的越权 action 也拒绝。签名后再次验证保护文件与私有阶段收据没有更改。唯一成功返回 signed-review-verified-unapplied，所有路径一律 apply_supported=false，不输出 IP/域名/Secret/私有路径。

这不是可防重放的在线 Host Apply 授权，也不证明救援、DNS、真实 HTTPS 登录、宿主启动修订或回滚。实际生效仍必须由不同 scope 的一次性 Host 事务、独立离线授权和现网物理恢复证据构成；不得将 review-only 签名升级为重启许可。现有 server-validation 运行的 scripts/test-caddy-https-host-plan.py 增加临时真实 OpenSSL Ed25519 正反测试，不改线上 Docker/Caddy。

## NET-M5-C0 — 独立设备真实 IP/域名 HTTPS 与管理员登录验收（仍非 Host Apply）

操作员在**另一台受信任的终端**显式运行 `scripts/caddy-https-remote-login-check.py`，读取已安全保存的 Canonical Host Plan；Plan 文件须由独立可信通道固定 SHA-256，包含严格有效的局域网 RFC1918 IPv4、公网 FQDN、IP/域名独立启停以及正修订。至少一个 HTTPS 入口启用。要求显式提供 HTTPS 主机端口，不猜测公网/NAT 端口；不修改 DNS、Caddy 或服务器配置。

对于已启用的 LAN IP，必须从可信渠道取得 Caddy 本地 Root CA PEM 并**独立固定其文件 SHA-256**，用单独的 TLS 客户端信任上下文验证完整链、IP SAN 和所访问的 IP 主机名；对于已启用的公网域名，使用系统受信任 CA 验证完整链、DNS 主机名，不自动接受私有 CA。不使用代理、不跟随跳转、不绕过 TLS 证书校验，不允许明文 HTTP。尚未信任本地 CA 的浏览器和手机不可无视安全告警登录。

每个已启用入口通过真实网络、独立 TLS 会话执行固定顺序：GET /api/v1/readyz（200 且 ok=true）；匿名 GET /api/v1/admin/services 必须是 401；使用操作员**在本机交互输入**的账号密码 POST /api/v1/auth/login，必须成功且角色为 admin；再以该入口自己的临时 Bearer 获取严格 11 个服务项，并取得 GET /api/v1/admin/services/caddy/https/host-plan，要求其原始规范字节与独立固定的 Plan **完全相同**。拒绝非 200、重定向、TLS/身份错误、缺失权限、计划改动、响应超限、密码/Token 泄露。两入口同时开启时都必须独立通过，Token 不跨 Origin 复用；终端输出仅最小枚举、修订与哈希，不输出真实 IP、域名、Root CA 路径、密码或 Token。

典型 IP-only/双入口命令（port 以真实部署配置为准；domain-only 省略两项 lan-root-ca 参数）：

```bash
python3 scripts/caddy-https-remote-login-check.py \
  --plan "$HOME/.xd/state/caddy-host-plan.json" \
  --expected-plan-sha256 "$TRUSTED_PLAN_SHA256" \
  --https-port 8443 \
  --lan-root-ca "$TRUSTED_CADDY_ROOT_CA_PEM" \
  --expected-lan-ca-sha256 "$TRUSTED_ROOT_CA_SHA256"
```

**证据边界：** 只验证当前操作员所在网络能够到达开启的入口，并通过真实证书、管理员登录和已保存期望修订一致性检查；没有检测已关闭入口是否完全不可访问，无法断言两个 Origin 由同一 Server 进程服务、所有客户设备信任私有 CA、当前 Caddy 使用了该修订、WAN 所有路径可达或改动能够安全重启/回滚。`state=enabled-origin-logins-verified-unapplied`，固定 `apply_supported=false`。证据仍需由可信 Host Manager 与事务、启动配置摘要、不可变 Applied Receipt、独立超时回滚和实际设备验收联合使用，不能单独向“系统依赖”页面开放应用按钮。

CI 现有 `server-validation` 执行 `scripts/test-caddy-https-host-plan.py`，由此固定入口调用 `test-caddy-https-remote-login-check.py`，不需要修改 CI 工作流 YAML：使用真实临时 OpenSSL CA/IP SAN 证书和 loopback TLS HTTP Server，验证真实匿名 401、登录、权限、原始 Plan 字节、错误证书名/CA、阻断非管理员/篡改/健康失败、HTTP 代理旁路和不修改宿主机。所有密钥/管理员口令都是临时无效测试夹具，不连接生产网络。


## NET-M5-C2-E · 宿主原始回滚备份复核（只读，2026-10-19）

C2-D 的一次性 `rollback-anchor` 生成之后，操作员可独立固定 `receipt.json` SHA-256，并使用 `scripts/caddy-https-host-rollback-anchor-verify.py` 执行**仅用于变更前**的受保护回滚原件复核。该新工具不会创建、覆盖、恢复或删除备份，不会改写 `.env`／Compose，也不会联系 Docker/Caddy 或调用服务重启。

复核以受信签名 Apply Intent、Host Plan、stage receipt、Pending journal 和两个独立固定 SHA 为前提。在原有同一主机私有目录的**共享非阻塞锁**内，固定原 `rollback-anchor` 目录 inode、0700 权限和恰好三个 0600 私有文件；要求常规文件、当前操作员所有、单硬链且不允许符号链接。逐字节和 inode 二次读取 `original.env`、`original.compose`、规范 `receipt.json`，校验 receipt schema、协议、`apply_supported=false`、预定阻断原因、期望 HTTPS/AliDNS 修订、Pending 和签名请求指纹、两个原文件与**仍未改动的**实际宿主配置一致。任一修改、旧签名、私有输入丢失、额外文件、并发独占事务或独立 PIN 错误都固定 `blocked` 且不输出密钥、原始 IP、域名或绝对路径。

用原计划中的全部固定参数调用，只在末尾增加 `--expected-anchor-receipt-sha256 $TRUSTED_ANCHOR_RECEIPT_SHA256`；此 SHA 必须由不同可信渠道审核钉住，不可在同一个不可信源文件上计算后自称独立批准。成功固定输出 `state=host-rollback-anchor-reverified-unapplied`、`apply_supported=false`。此结果**不**是恢复可执行验证、不保证异机 Rescue、受限 Host CAS、AliDNS 密钥转交、Caddy 重启、超时看门狗、WAN/IP 正反 TLS 登录或签名 Applied Receipt。生产「应用并重启」仍禁止。新增离线正反例随原 `scripts/test-caddy-https-host-plan.py` 的 server-validation 执行，无新 Controller/Agent/UI 权限。
