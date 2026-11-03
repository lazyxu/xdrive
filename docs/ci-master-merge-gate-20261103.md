# master CI 合入与发布门禁：修复回归（2026-11-03）

## 故障依据
- master push [CI #41553922713](https://github.com/lazyxu/xdrive/actions/runs/41553922713)，SHA `84ef83137de86813c885fff990f30324e32f62f2`：`android-native` 235 项中一项搜索用例首次等待 10 秒超时。
- [PR #3673](https://github.com/lazyxu/xdrive/pull/3673) HEAD `976522e0c42f75eeb953a125f6ca1cb90bfb0677` 的 231 项 Android UI 测试和 Final Gate 通过，但 Final Gate 测的第一父提交为旧 master `ed269bace...`。
- 合入前 master 前进至 `573eff99...`，旧 Final Gate 只检查祖先关系。合入后完整测试红灯，暴露跨 PR 组合未被充分覆盖的风险。仓库所有者现确认：**精确 HEAD CI 已绿、无冲突的 PR 不应仅因 master 前进被强制重跑**。
- `publish-master` 以前没有 `final-gate` 依赖；同一 master 红灯仍启动了发布任务。

## 提交的代码保护
1. PR Final Gate：验证合成 merge SHA 的第二父提交**等于精确 PR HEAD**、第一父提交继承事件 Base 并且**位于当前 master 的可信祖先链**。master 仅向前推进并不会让绿色 PR 无效；无冲突且符合仓库保护规则即可合入。若 master 发生历史改写、PR 候选不可信、HEAD 不匹配或真实冲突，则必须拒绝。
2. CI 支持 `merge_group.checks_requested`。对队列组合运行完整 CI，Final Gate 验证事件 head SHA、base 祖先、实时 master 祖先。GitHub Merge Queue 为多 PR 串行合入提供原子性；单靠 PR Final Gate 不能消除“检查刚完成、合入前 master 又前进”的 TOCTOU 竞态。
3. `publish-master` 依赖 `final-gate`。构建/打包仍可并行，但真实 Snapshot 发布不可绕过 Android Emulator 等测试。独立的 Android Master APK Workflow 仍仅生成标识为 Debug 的 GitHub Actions 构建产物，**不是经过放行的 Snapshot/公开发行**。
4. Android 搜索补充键盘“搜索”提交，与按钮共用 `submitGlobalSearch` 的 Owner 校验。定位用例走真实 IME、只发起一次查询，失败时记录 fixture 状态和搜索请求次数；另一用例继续测试搜索按钮。没有增加超时或自动重试。
5. `scripts/ci/test_master_ci_gate.py` 在临时本地 Git 仓库运行实际 Gate shell，验证绿色 PR 在 master 正常前进后仍可复用、错误 HEAD/不可信 Base 被拒绝；队列头不匹配/过期仍被拒绝。

## GitHub 仓库规则（按 Owner 的合入策略配置）
当前可读规则集 [master ruleset #23892726](https://github.com/lazyxu/xdrive/rules/23892726) 只包含禁止删除和禁止非快进，未配置 Required status checks 或 Merge Queue。仅修改 Workflow 并不禁止 GitHub 手工/自动合入。

在 **本 PR CI 通过且代码合入 master 后**，由拥有仓库 Administration 权限的人员在 Settings → Rules → Rulesets → master 中：
- 启用 **Require a pull request before merging**（如果当前保护策略没有此要求）。
- 启用 **Require status checks to pass**，将 `CI / final-gate`（确切名称以 GitHub Checks UI 为准）设为必需检查；不用 `android-native` 单项代替 Final Gate。
- **不强制 Merge Queue。** 当前 Workflow 支持 `merge_group` 作为可选机制，普通 PR 可在 exact HEAD CI / Final Gate 绿色且无阻塞冲突时直接合入。
- 如果以后主动启用 Merge Queue，再检查 `merge_group` 事件的实际全量 CI/Final Gate；当前无需为这次 PR 启用。
- **不要启用 `Require branches to be up to date before merging` 作为本次修复的前置条件**；这会让无冲突的绿色 PR 因 master 不相关提交而不必要地重复 CI。

## 验收清单
- 用测试中的临时 Git 仓库验证：旧的已验证 PR candidate 在 master 正常前进时仍通过；伪造的第二父提交、错误事件 Base、与 master 分叉的第一父提交都必须拒绝。
- `merge_group` 提交运行 `android-native` 与所有适用 CI 的 `final-gate`，无跳过或红灯。
- 任一必需非发布 CI 失败时，`publish-master` 必须 `skipped`；不能上传/发布该 master Snapshot。
- 231/235 Android 用例的差异不按“新版更多测试”草率下结论：需对目标搜索用例独立及全套重复测试，报告准确的搜索状态，不通过直接增加等待秒数掩盖。
- 已开始运行且正常的其他 PR 不重复推送，不绕过仓库的 PR→验证→合入规则。

> 说明：在仓库规则配置完成之前，这只是**代码级加固**，并不等于 GitHub 服务器已经强制禁止未验证的合入。
