# master CI 合入与发布门禁：修复回归（2026-11-03）

## 故障依据
- master push [CI #41553922713](https://github.com/lazyxu/xdrive/actions/runs/41553922713)，SHA `84ef83137de86813c885fff990f30324e32f62f2`：`android-native` 235 项中一项搜索用例首次等待 10 秒超时。
- [PR #3673](https://github.com/lazyxu/xdrive/pull/3673) HEAD `976522e0c42f75eeb953a125f6ca1cb90bfb0677` 的 231 项 Android UI 测试和 Final Gate 通过，但 Final Gate 测的第一父提交为旧 master `ed269bace...`。
- 合入前 master 前进至 `573eff99...`，旧 Final Gate 仅检查祖先关系，没检查相等。合入后完整测试红灯。
- `publish-master` 以前没有 `final-gate` 依赖；同一 master 红灯仍启动了发布任务。

## 提交的代码保护
1. PR Final Gate：验证合成 merge SHA 的第二父提交**等于精确 PR HEAD**，第一父提交**等于实时 master HEAD**。master 前进即失败，要求重新运行 PR 检查；仅“属于 master 祖先”不够。
2. CI 支持 `merge_group.checks_requested`。对队列组合运行完整 CI，Final Gate 验证事件 head SHA、base 祖先、实时 master 祖先。GitHub Merge Queue 为多 PR 串行合入提供原子性；单靠 PR Final Gate 不能消除“检查刚完成、合入前 master 又前进”的 TOCTOU 竞态。
3. `publish-master` 依赖 `final-gate`。构建/打包仍可并行，但真实 Snapshot 发布不可绕过 Android Emulator 等测试。独立的 Android Master APK Workflow 仍仅生成标识为 Debug 的 GitHub Actions 构建产物，**不是经过放行的 Snapshot/公开发行**。
4. Android 搜索补充键盘“搜索”提交，与按钮共用 `submitGlobalSearch` 的 Owner 校验。定位用例走真实 IME、只发起一次查询，失败时记录 fixture 状态和搜索请求次数；另一用例继续测试搜索按钮。没有增加超时或自动重试。
5. `scripts/ci/test_master_ci_gate.py` 在临时本地 Git 仓库运行实际 Gate shell，验证旧基线失败、最新基线通过、队列头不匹配/过期失败。

## **必须在 GitHub 管理界面执行的强制门禁（无法由本次代码 PR 替代）**
当前可读规则集 [master ruleset #23892726](https://github.com/lazyxu/xdrive/rules/23892726) 只包含禁止删除和禁止非快进，未配置 Required status checks 或 Merge Queue。仅修改 Workflow 并不禁止 GitHub 手工/自动合入。

在 **本 PR CI 通过且代码合入 master 后**，由拥有仓库 Administration 权限的人员在 Settings → Rules → Rulesets → master 中：
- 启用 **Require a pull request before merging**（如果当前保护策略没有此要求）。
- 启用 **Require status checks to pass**，将 `CI / final-gate`（确切名称以 GitHub Checks UI 为准）设为必需检查；不用 `android-native` 单项代替 Final Gate。
- 启用 **Require merge queue**。队列负责创建实际合入组合，`merge_group` Workflows 必须完成并全绿；保护规则不得允许跳过检查的管理者例外。
- 校验 `merge_group` 合并队列构造的 SHA 全部检查是否触发；若 Check 名称变化，以实际 `final-gate` 上报名称更新配置。
- 若无法立刻启用 Merge Queue，临时启用 **Require branches to be up to date before merging**，但它仍非队列的原子合入保证。

## 验收清单
- 用测试中的临时 Git 仓库验证“旧 PR candidate + 新 master”Final Gate 失败，“当前 master candidate”通过。
- `merge_group` 提交运行 `android-native` 与所有适用 CI 的 `final-gate`，无跳过或红灯。
- 任一必需非发布 CI 失败时，`publish-master` 必须 `skipped`；不能上传/发布该 master Snapshot。
- 231/235 Android 用例的差异不按“新版更多测试”草率下结论：需对目标搜索用例独立及全套重复测试，报告准确的搜索状态，不通过直接增加等待秒数掩盖。
- 已开始运行且正常的其他 PR 不重复推送，不绕过仓库的 PR→验证→合入规则。

> 说明：在仓库规则配置完成之前，这只是**代码级加固**，并不等于 GitHub 服务器已经强制禁止未验证的合入。
