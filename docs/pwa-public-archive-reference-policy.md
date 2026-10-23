# xDrive PWA P0-B2c2 · 历史公开资源版本引用与容量审计（只读）

## 2026-10-23 · P1-04 / P2-03 最终长期保留与容量操作政策（高于以下历史记录）

**结论：公开内容哈希归档采用无限期只追加保留（indefinite retention），而不是以 7/30/90 天规则猜测可删除。** 这是一项明确的安全运行策略，不是已证明所有离线旧客户端不再引用历史资源。现有 `deploy/pwa-archive-assets.sh` 发布器不变，原始旧 bytes 不可覆盖；任何未知 hashed JS/CSS/worker 依赖、已发行 PWA Shell、离线主屏客户端与 A→B→A 回滚版本都仍按可能被使用处理。

| 审计或条件 | 决策与动作 |
| --- | --- |
| 归档正常、软容量阈值未超 | 保留所有公开历史资源；定期使用现有只读审计查看 `inode_unique_bytes`、文件数与缺失引用 |
| 资源未被**本次提供的** manifest 引用 | **保留**；只能说明这批清单没有引用，不证明已安装/离线客户端不引用 |
| 已提交 manifest 引用缺少对应字节 | **报警**，核对发布器和完整性；只能从可信原发布工件恢复**完全相同的 hash 内容**，绝不以新 SPA HTML 伪装缺失 JS |
| 超过容量软阈值 | **报告容量压力并扩容/调整保留介质**，不执行删除；审计返回 `safe_to_auto_delete=false` |
| 客户端长期失联、旧版本活跃度未知 | 维持保留。Heartbeat / 最近上线 / CacheStorage 观测并不能证明所有离线安装已经退出 |
| 想要不可逆人工删除或自动 GC | 当前产品 **不支持、不授权**；必须作为未来独立功能重新设计可验证的全生命周期引用证明、备份/恢复及审批，不以本政策推导候选清理列表 |

**不可变门禁：** `safe_to_auto_delete=false`、`delete_candidates_established=false`、`live_client_versions_proven=false`、`all_historical_releases_proven=false`、`rollback_reference_coverage_proven=false`。自动化只可以读取、核算、预警；不能移除历史 hashed 文件、原件/缩略图/Range/Owner/票据，也不能将公开缓存扩展到私人数据。软阈值是 `inode_unique_bytes` 的运营提醒，不是真实可用磁盘容量，也不能直接推断可保留天数。

**验收含义：** P1-04 的“安全的长期生命周期策略”已选择为**永久保留 + 容量审计**；“实时证明离线旧客户端已全部退休”仍属不可获得的证据，不能标记为通过，**自动删除故意不开发**。P2-03 的操作说明与源码回归合同同属此增量。PWA S5 真实 iOS/Android/Desktop Installed 七平台维持 `NOT RUN`；ChatGPT 无法接触的生产专属安全验收继续**按用户决定跳过（未验收）**，不作为源码/CI 合并门槛。

现有纯只读执行方式（要求显式提供公有存档根路径与经批准的清单，**不要公开生产路径**）：

```sh
node scripts/pwa-archive-audit.mjs "$XD_CADDY_ASSET_DIR"
node scripts/pwa-archive-reference-audit.mjs "$XD_CADDY_ASSET_DIR" \
  /local/old-web/dist/.vite/manifest.json /local/new-web/dist/.vite/manifest.json \
  --soft-limit-bytes=536870912
node --test desktop/tests/pwa-archive-policy-contract.cjs \
  desktop/tests/pwa-archive-reference-audit.cjs
```

这份政策不能替代 S5 七平台实际安装、锁屏、浏览器进程回收、VoiceOver/TalkBack 验收。那些实体验收继续独立记录为 `NOT RUN`，不能用 Linux CI 或 UA 模拟替代。

---


日期：2026-10-22。基于已合入的 P0-B2c1 [#2276](https://github.com/lazyxu/xdrive/issues/2276) 和 [五阶段台账](pwa-five-stage-execution-20261022.md)。**不部署 GC、不修改发布器、不清理文件、不新增私人缓存。**

## 能证明什么

正式 `deploy/pwa-archive-assets.sh` 继续只追加发布 hashed JS/CSS 等公开静态资产，原 `scripts/pwa-archive-audit.mjs` 对已明确选定的公开归档路径检查符号链接、伪造私人文件、普通文件与容量。新的 `scripts/pwa-archive-reference-audit.mjs` 在此基础上，接受操作员明确提交的一个或多个可信历史 Vite `.vite/manifest.json`，只读计算：

- 已知 manifest 引用的不同公开 hashed 文件数，归档中存在的数量/逻辑大小，缺失数量；
- 尚未被**本次提交的** manifest 引用的归档文件数量/逻辑大小，归档总文件/逻辑字节、硬链接去重 inode 字节、可获取时块分配大小；
- 可选容量软阈值（比较 `inode_unique_bytes`，它**不是**系统真实磁盘用量），只做预警，绝不触发任何删除。

用法（本机仅处理公开静态资源和本地构建清单）：

```sh
node scripts/pwa-archive-reference-audit.mjs \
  "$XD_CADDY_ASSET_DIR" /path/to/old-web/dist/.vite/manifest.json \
  /path/to/new-web/dist/.vite/manifest.json --soft-limit-bytes=536870912
node --test desktop/tests/pwa-archive-reference-audit.cjs
```

命令行使用示例是明确的操作员输入，不要求向 ChatGPT 提交实际宿主路径、生产配置、私有数据或凭据。输出只有聚合数量与字节，不输出任何文件名、路径或 manifest 内容。归档有符号链接/非 public hashed 项、manifest 文件不合法或图不闭合时整轮 fail closed；计数过程中归档发生变化也拒绝提供看似可信的一致快照。

## 不能证明什么

未被输入的 manifest 引用 **不等于不存在老客户端引用**。长期未启动的 iOS 主屏 PWA、仍挂起的旧 SW、旧 HTML、未关闭窗口中的动态 import、历史 Browser CacheStorage、旧机离线状态及潜在回滚代码都无法由公开归档目录或一组 manifest 推出。丢失旧 manifest、客户端上报不完整、旧 JS 的 runtime 动态加载行为、极长时间不打开的设备，都必须视为 **未知保留需求**。

输出固定 `safe_to_auto_delete=false`、`live_client_versions_proven=false`、`all_historical_releases_proven=false`、`rollback_reference_coverage_proven=false`，即使 `not_referenced_by_supplied_manifests > 0` 或超过软阈值也绝不提出可删除名单。没有一个可自动推导的 7/30/90 天安全 GC 期限。

## 后续人工策略与非功能边界

留存策略先保留所有已发布版本。后续若必须手动回收，另行完成：长期客户端 SW/HTML/lazy chunk 引用审计的可信来源，灰度与回滚版本窗口，跨多个真实浏览器进程 A→B→A 及失联后重新上线覆盖测试，针对预览候选的操作员双确认与不可逆删除保护。无证据则继续 append-only。公有 hash archive 不包含 Owner 原片、JWT、GPS、缩略图或权限凭据。

本增量不改变 P2-B 不做有限 Blob 缓存的决定，不宣称 PWA 100k 性能改善。无法接触的生产专属安全验收按用户决定跳过（未验收）；源码权限、隐私与真实 CI 不跳过。
