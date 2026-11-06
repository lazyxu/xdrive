# GitHub master → GitLab master（安全快进，同步后再验收）

GitHub `master` 是唯一代码源；**不要在 GitLab 上直接修复并提交到 master**。此同步入口默认只执行检查，且只有 GitHub 中已合入、当前 master 的**精确 40 位 SHA** 可被推送。它不自动触发任何未授权的写操作，且**从不 force push**。

## 一次性配置（仓库管理员）

1. 在 GitHub 仓库 Actions **Variables** 中设置 `XDRIVE_GITLAB_MIRROR_URL`，例如 `https://gitlab.com/<owner>/<repo>.git`。只能使用 GitLab.com 的纯 HTTPS 项目 URL，不可在 URL 中携带令牌；必须指向已有 `master` 的预期镜像仓库。
2. 创建 GitHub **Environment** `gitlab-master-ff` 并启用 Required reviewers/审批保护；镜像执行 Job 使用该 Environment。
3. 在这个 **Environment** 的 **Secrets** 中设置 `XDRIVE_GITLAB_MIRROR_PUSH_TOKEN`，建议专用 GitLab Project Access Token，最小 `read_repository` + `write_repository` 权限，且只能对目标仓库的受保护 `master` 进行授权操作；不要把令牌添加到普通仓库 Secrets、Variables、URL、PR 评论或日志。未配置这个 Secret 时工作流失败关闭。

## 操作

1. 确认所需 PR 已在 GitHub 经过完整 exact-HEAD CI / Final Gate 并合入 `master`。复制 GitHub 当前 `master` 完整 40 位 SHA。
2. 打开 Actions → **GitLab master fast-forward (manual, fail-closed)** → **Run workflow**，选择 `master`，填写 `expected_master_sha`，保持 `apply=false`（默认）。此轮仅验证 GitHub 的现场 SHA、GitLab master 祖先关系及认证，绝不改变 GitLab master。
3. 检查 Dry Run 的 GitLab HEAD、GitHub HEAD，以及明确的 `DRY RUN` 输出。若 GitLab 分叉、SHA 过期、权限不足、DNS/TLS/API 故障，必须解决原因；**不得使用 force 或重建 GitLab 分支绕过**。
4. 再次确认 GitHub master **仍是同一个 SHA**。重复触发，设置 `apply=true`，通过 Environment 审批后执行非 force 快进。工作流随后从 GitLab 重新读取 master SHA，必须与批准值完全一致。
5. 在 GitLab 核对同一 SHA 的 Pipeline、构建包、Server/Caddy/Media/Photo 镜像、Release Link 和 SHA-256、Release `XDRIVE_RELEASE_COMMIT`，不能把 Actions push 成功当成发布成功。后续再进行真实升级、`bash scripts/server-verify.sh --mode fast --summary-json` 及 `bash scripts/server-doctor.sh --fast --strict`；如无 NAS/Server 权限，记为“跳过（未验收）”。

## 安全失败条件

- `expected_master_sha` 必须与工作流事件 SHA、检出的 HEAD 和最新 GitHub `origin/master` **全部相同**，在推送前再次只读核对远端 GitHub master。
- 只接受来自 `https://github.com/lazyxu/xdrive` 的 GitHub checkout，以及位于 `https://gitlab.com/...` 的纯项目 URL；远端 GitLab `master` 必须存在、可读取，且必须是指定 GitHub master 的祖先。
- `apply=false` 默认无副作用；`apply=true` 仅执行普通非强制 fast-forward push。若其他 GitLab 写者并发修改，Git 正常拒绝非快进推送。成功后再从 GitLab 读取一次远端 HEAD。
- 不修改任何 GitLab CI 配置、Release、Tag 或现有 PR；也不会自动重试失败的发布流水线。本工作流只解决 Issue #3966 的 R01 同步前置动作；R02–R09 需单独提供可核验证据。

## 回归测试

`python3 scripts/ci/test-gitlab-master-fast-forward.py -v` 通过本地 bare Git repo 覆盖 Dry Run、非强制快进、重复同步、GitHub SHA 变化、镜像分叉、无 master、异常目标 URL 和凭据不出现在日志。测试完全离线，无真实 GitLab 凭据。
