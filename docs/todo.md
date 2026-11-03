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
