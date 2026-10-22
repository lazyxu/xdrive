# xDrive PWA P0-B2c2 · 历史公开资源版本引用与容量审计（只读）

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
