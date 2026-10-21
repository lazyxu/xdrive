# P1-B1 — 已登录用户明确授权与首次真实目录 Range 采样

本变更叠加于 P1-B0（持久 Server UUID）和 P1-A（有界 IndexedDB）。
必须先完成上游完整 CI，再合并，不预设旧 SHA CI 绿色有效。

## 已实现

- 已登录用户的 **设置 Dialog** 才出现明确的 opt-in Switch；无在线认证且无
  `/me.pwa_offline_instance_id` 时没有可信 Owner，开关不可使用。
- 默认关闭；授权/取消在 IndexedDB 同一账号作用域的真实记录上生效。
- 仅在真实 authenticated CloudFilesController 成功完成 FIRST counted
  directory Range，且当前 Files 路由与目录一致、页面加载结束、
  opt-in 已开启时，以只读投影保存前 20 个摘要，不额外预取 100k。
- 浏览器/文件/图库完整请求仍由现有 JWT/Owner ACL 执行，快照读取不授予权限。
  不写入原件、媒体、thumbnail、SHA、URL、Cookie、Token、EXIF/GPS。
- 退出调用 `xDrivePwaClearOfflineMetadata`，删除同站点目录快照，
  best-effort BroadcastChannel 通知其他标签页关闭 consent 表示，
  不触及公共 App Shell CacheStorage。
- 开关下方明确告知本机其他人可读取存储的摘要，且该数据绝非实时权限或实时文件状态。
  iOS App Frame 52px 与 Web/Mobile 统一 Files/Go 读取链路不改。

## 限制与下一步

**尚未启用离线快照的实际浏览页**。P1-B2 必须解决断网启动时的账号/实例
可信绑定、跨标签页窗口消失/清理竞态、过期和撤销后的重新验证逻辑，
添加真实 Chromium IndexedDB 退出/切换身份/Server 重新部署场景。
如果没有严格可信身份，不显示任何私人离线目录；网络只读异常不得悄悄切至历史目录。

P1-C 图库集合仅受控只读；P2 缩略图仍不得抢跑。P0 公开 Shell FCP
FIRST/WARM/OFFLINE 的原始 baseline、100k 多媒体延迟和真实 Go ctx.cancel
保持在原 CI 证据，**本 PR 无可比 AFTER 加速数据**。

生产环境安全验收：按用户决定跳过（未验收）；源码级权限/隐私负例、
Go/PostgreSQL/Chromium CI 必须继续执行。

## 真实浏览器专项

新增 `desktop/scripts/pwa-p1b1-real-idb.cjs` + 独立 Chromium 工作流，
覆盖真实 secure-loopback IndexedDB opt-in、100k 输入只保留 20 条、
跨 Server UUID/Owner 隔离、断网只读未验证、清理跨标签页通知和
公共 SW CacheStorage 不被误删；这是源码 CI，不冒充 iOS 真机。
