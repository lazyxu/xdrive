# 待办

## GitLab CI 与 gen10 GitLab Server update 后续验收

记录日期：2026-11-03。以下状态仅针对提交
`7f045d8cccb43dfc0c1f9bd1a9a0056ba586403b` 和
[GitLab pipeline 3728](http://gitlab.t-fluid.com:1080/xuliang/xdrive/-/pipelines/3728)。

### 已完成的修复与验证

- 五轮修复已通过 GitHub PR 合入并普通快进同步至 GitLab，最后一轮为
  [#3674](https://github.com/lazyxu/xdrive/pull/3674)。该 PR 的准确 HEAD
  `515f83feab46fb252e6ea2985503257552570c47` 已通过全部适用 CI 和 Final Gate。
- Pipeline 3728 的 34 项任务中，30 项成功；镜像冒烟的 broken pipe 和 API 第三分片累计超时均已在真实 GitLab 任务中验证修复。剩余四项为 `allow_failure` 失败，不能将流水线总状态 `success` 当作全部验收通过。
- 对应 snapshot 的 `XDRIVE_RELEASE_COMMIT` 已核对为上述 `7f045d8c` 完整 SHA。22 个当前版本必需资产均已实际下载并通过摘要校验，安装器的 11 项嵌入 manifest 及 4 个准确版本镜像也已验证。发布中的另外 2 个链接是保留的历史 SPK 及其摘要，不计入当前版本资产。

### Windows 验收待办

四项任务在实际安装及 Agent 验收开始前，被既有用户会话保护拒绝；它们尚未完成验收。需先由用户完整退出 Windows Runner 登录会话中的已安装 xDrive 桌面程序和 Agent，再只读确认进程及 `Local\xDriveAgent` 互斥锁均已释放，并运行
[`assert-windows-artifact-session.ps1`](../scripts/ci/assert-windows-artifact-session.ps1) 确认通过。未经授权不得关闭用户程序、绕过保护或弱化测试。

满足上述条件后，仅重试同一 pipeline、同一 `7f045d8c` 完整 SHA 的以下四项失败任务，保留现有 `resource_group` 串行执行约束；重试会产生新的 job ID，需记录新 ID 及实际结果。

- [ ] `master-test-backup-cli-windows`：原任务 [42893](http://gitlab.t-fluid.com:1080/xuliang/xdrive/-/jobs/42893)。
- [ ] `master-test-windows-rollback-artifact`：原任务 [42897](http://gitlab.t-fluid.com:1080/xuliang/xdrive/-/jobs/42897)。
- [ ] `master-test-windows-upgrade-artifact`：原任务 [42898](http://gitlab.t-fluid.com:1080/xuliang/xdrive/-/jobs/42898)。
- [ ] `master-test-windows-smoke-artifact`：原任务 [42899](http://gitlab.t-fluid.com:1080/xuliang/xdrive/-/jobs/42899)。
- [ ] 重试完成后，分页枚举全部最新任务，确认每项实际成功，包括所有 `allow_failure` 诊断。排队、运行、取消或跳过均不能当作通过；GitHub Windows 虚机上的成功也不能替代上述 GitLab 验收。

### gen10 更新待办

- [ ] 全部 GitLab 任务通过后，复核 snapshot 的 description marker 和资产链接仍与已验证版本一致，再通知用户可重试 GitLab Server update。若发布 SHA 改变，必须重新验证该 SHA 的 22 项资产下载与摘要、11 项嵌入 manifest 和 4 个准确版本镜像，不能复用 `7f045d8c` 的结果。
- [ ] gen10 生产更新：**跳过（未验收）**。本轮未执行生产 update、重启、停机或数据库迁移，也未确认部署成功；实际更新须由用户执行或另行明确授权后验收。

本机续接资料位于 `D:\CodexTemp\xdrive\gitlab-3709`：`delivery-status.json`、`published-7f045d8c-verification.json`、`api3-42888-verification.json`、`pipeline-3728-windows-session.json` 及四项失败任务的脱敏日志。继续处理前须重新读取远端和工作区真实状态。

## GitHub 发布镜像、xDrive 分享源更新与 SHA-256 快传

记录日期：2026-11-03，目标主机最后核查于 03:02 UTC。按用户要求停止自动跟进与部署，保留以下未完成项；本记录不代表生产升级成功。

### 已完成与当前边界

- 自动客户端镜像触发 [#3663](https://github.com/lazyxu/xdrive/pull/3663)、分享源与快传后端 [#3691](https://github.com/lazyxu/xdrive/pull/3691)、发布确认修复 [#3692](https://github.com/lazyxu/xdrive/pull/3692)、Docker 镜像身份兼容 [#3693](https://github.com/lazyxu/xdrive/pull/3693) 均已在准确 HEAD 的适用 CI / Final Gate 通过后合入。已有上传凭据配置，不需要重复配置。
- #3692 对应 `35ad90a0601da5d1fe8f7c7a667f38e7b27f3714` 的 Snapshot、客户端镜像、五包签名发布与 Share 同步已实际成功。这个历史成功不能替代后续版本的验收。
- #3693 对应 `47cc4cd0a00fd2367b0338b5b7d08026c508ede8` 的 master Final Gate 已通过，[五组件及签名 Manifest](https://github.com/lazyxu/xdrive/releases/tag/offline-manifest-47cc4cd0a00f) 已在 GitHub 发布。delivery、manifest、installer 的签名及准确 source 身份已独立验证；[Share 镜像任务](https://github.com/lazyxu/xdrive/actions/runs/41552602712/job/125668992474) 于 02:41:39 UTC 失败，仅有受控错误码 `[verification]`，不能认定上传完成或精确断言失败请求。
- 02:54 UTC 的只读 Share 检查：四个复用包存在且目录元数据大小匹配；新 App 包（78,824,300 字节）只有目录、没有完整文件；generation 3505 的发布目录及最终 `delivery.json` 均不存在。目录检查不是包字节校验。
- 客户端镜像 [47cc 运行](https://github.com/lazyxu/xdrive/actions/runs/41553519705) 与后继 [c9a 运行](https://github.com/lazyxu/xdrive/actions/runs/41561219149) 均以 PUT 有界重试后的 `URLError` 失败。Caddy 有一个分块先以 180 秒 / 502 失败、后以约 167 秒 / 201 接收完整 8 MiB 的记录，但尚未将该会话严格绑定到目标 App；不能由此断定具体网络根因。
- `192.168.2.4` 仍运行旧 `0d87a908cc414b401abc1fc190e4fd404b6cb0ab`，四个运行服务健康、严格 TLS readyz 为 200。管理器和 helper 已备份并安装，旧 generation 3503 的五包预取曾成功；首次激活因 Docker config / manifest 摘要表示差异在停服前终止。兼容修复尚未生产安装，`installed.json` 不存在，high-water 为 generation 3504。

### 恢复发布与传输待办

- [ ] 先重新读取准确 master、发布身份、作业和 Share 状态。必要时补充受控阶段码，区分 GitHub 包下载、Share 上传、回读及 metadata；仅记录静态阶段、异常类别或 HTTP 状态，不输出 URL、token、ticket、请求头或任意异常文本。
- [ ] 将失败会话与已签名 App 的身份绑定，核对状态、到期时间和已持久分块。严格只读诊断应使用限定会话的只读事务；普通 upload-session GET 在过期时可能清理分块，不能当作无副作用探针。相关只读数据库诊断尚未执行。
- [ ] 根据证据恢复原 Server 发布。官方 failed-job 重试绑定原 CI SHA，并复用已有签名发布；同 Share、intent、8 MiB 分块且会话未过期时可复用摘要和大小均匹配的分块。会话初始有效期为 24 小时；不得删除、覆盖旧会话或修改已签名文件。减小分块仅为待验证选项：后端允许 4–16 MiB，改为 4 MiB 不会自动迁移旧 8 MiB 分块，不能盲目改参数或增加超时。
- [ ] 确认五包与最终 delivery 全部同步并独立验签、校验完整目录；同时取得后续客户端自动镜像的真实成功。客户端重跑会重新选择当时的 Snapshot 和 mobile 最新成功 master 产物，不能把新版本成功当作补齐旧 47cc 历史版本。

### 目标主机与快传验收待办

- [ ] 生产升级：**跳过（未验收）**。恢复执行前重新检查主机版本、锁、磁盘、健康、文件所有者及 0700 模式，保留原始备份；按实际完整签名 delivery 重新准备计划。若管理器/helper 与 accepted Git blobs 逐字相同，可省略重复安装。
- [ ] 运行 `xdrive-server update --source xdrive --channel master --prefetch-only`，下载并校验全部五包；用独立工具验证精确镜像引用及 config / manifest / index、平台、层摘要的绑定。全部通过后才运行正常 `xdrive-server update --source xdrive --channel master`，由既有事务负责失败回滚，不能绕过镜像身份检查。
- [ ] 核对 installed receipt、App 的实际 built-from commit、有限受证 Docker 身份、四服务 healthy、初始化退出 0、profiles 和严格 TLS readyz。正常 CLI 若选到更新的可信 master，需重新审核其 accepted ancestry、签名及运行身份；不能拿旧版本证据代替或贸然撤销成功更新。
- [ ] SHA-256 快传现场验收：在同 Share 的固定测试目录，用已有小文件创建一个新路径，证明 finalized、CAS reuse、零数据分块、同 intent 重试幂等及下载字节 SHA-256 一致。不得以既有路径跳过冒充快传；目前尚未执行。
- [ ] 客户端自身原生更新源选择器仍属 [Issue #3664](https://github.com/lazyxu/xdrive/issues/3664) 的独立未完范围，不因 Server 交付而关闭整个 Issue。

本机续接材料位于 `D:\code\xdrive\tmp\xdrive-source-20261103`：`publish-confirmation`、`share-partial47cc`、`server-bootstrap`、`image-acceptance`、`target-acceptance-bound.py` 和 `instant-share-acceptance.py`。保留原始主机脚本备份；重新核验工具及版本绑定后再使用，不使用旧的直接比较 Docker config ID 的静态验收工具。凭据不写入待办或 PR。
