# xDrive · PWA P0-B1：旧哈希资源跨升级保留

日期：2026-10-21。前置 P0-A [#2246](https://github.com/lazyxu/xdrive/pull/2246) 已通过准确 HEAD 77-job CI / 真实 Chromium，并合入 master e6018a4。**本阶段只处理公开 Vite /assets/，没有私人文件离线缓存。**

## 已定位缺口

原版 Caddy 镜像把 web/dist/ 直接打包到 /srv。更换镜像后，正在运行旧版浏览器/PWA 的按需加载 Gallery/Viewer JS chunk 不再存在。P0-A 只缓存必要的静态启动图，不缓存所有动态 imports，这是正确的容量约束，但无法解决旧 lazy chunk 404。

## P0-B1 实施

- 镜像保留原 /srv 静态构建供独立 caddy-rescue 使用，并提供 /usr/share/xdrive-current-assets 供常规 Caddy 在实际启动前追加至独立持久目录。
- 常规 Caddy 才挂载 XD_CADDY_ASSET_DIR（默认 ~/.xd/data/caddy/assets → /srv/assets）。Server、Worker、rescue 不挂载。 /sw.js、HTML、API 缓存语义不变；/assets/* 缺失仍返回 404，不能 fallback SPA HTML。
- 启动前必须完成严格哈希命名检查、无符号链接检查和「同名内容相等，否则拒绝」检查。利用相同目录临时文件和硬链接原子发布；重新启动幂等，不能抹掉旧资源。
- 官方安装器升级前，从仍存在的旧 Caddy 容器 /srv/assets 导出旧版公开静态目录，经同样的只追加规则持久保存，然后再部署新镜像。遇到软链或内容冲突拒绝，保留升级事务回滚。没有旧容器或无旧 assets 时仅报告未迁移，不得宣称有历史兼容保证。
- 旧静态 archive 不随 Service Worker activate、切用户、应用更新而自动删除。当前不做自动 GC；后续 P0-B2 才定义容量阈值、与已知活跃版本相容的安全清理及操作员控制。

## 可核验证据和限制

源码/Node POSIX shell 回归：真实复制两个版本的 hash chunk、重复启动、同名冲突、非哈希/私人路径拒绝；另外检查主/Rescue 隔离、Caddy Header/404 及旧容器优先迁移。完整 GitHub CI、Final Gate 和原有 PWA 登录/大文件/相册测试必须保持。

**尚未验证：** 真正旧浏览器动态 import 跨版本成功率、API 双版本兼容、iOS 27 Home Screen 冷热启动 FCP/p50/p95、弱网/设备回收、100k Files/Gallery 布局抖动、上线回滚性能。手工执行 docker compose up 而不运行官方升级器时，第一次引入持久目录之前的旧镜像资源不会自行被搬入；必须由操作员执行一次受控迁移。P0-B1 不声称已经解决这些问题。

生产环境专属安全验收按所有者永久决定 **跳过（未验收）**；源码安全、版本隔离、完整 CI 不能因此跳过。
