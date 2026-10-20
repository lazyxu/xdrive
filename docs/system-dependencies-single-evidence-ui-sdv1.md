# 系统依赖 SD-UX-V1：单一状态事实与按需技术证据

日期：2026-10-20。首批落地为共享 `ServiceDependenciesPage` 和百度地图子组件；强制适用于未来所有系统依赖。当前阶段没有修改 Server 接口或运行时授权。

## 问题与修正

- **导航和折叠**：旧详情的「状态」和「配置」默认同时展开，移动端需要滚过多块重复说明。现在只有导航明确指定的区块默认展开，其他区块可按需展开，用户已手动展开状态被保留。进入「检测」时打开状态容器及其中的检测区。
- **一套生命周期事实**：配置、部署、健康、生效的四个真实状态仍保留在同一共享 `ServiceRow`，手机使用紧凑 2×2 指标。长篇解释通过「查看状态依据」展开；未知、未验证不可改成已验证，Caddy/Worker 等专属证据保持原样。
- **一个动态地图运行快照**：配置区只显示可编辑的期望 JSAPI4 开关、独立 Browser AK 更新和安全保存；检测区显示一个 Server 签名放行结论、Loader 人工验证和可手动刷新的发布证据。六项原始字段只在「查看六项技术字段」披露一次，不再和配置区重复。
- **Static Map 完全独立**：Server AK 只用于静态地图。128×128 PNG 在线验证需要管理员主动点击，耗一次配额，不发送用户 GPS；不会因为展开、保存 JSAPI4 或刷新只读状态自动发出请求。Server AK 临时显示仍需显式管理员操作并限制至 30 秒。
- **证据边界**：`runtime_enabled=true` / `authorized_signed_release` 只表示签名运行时可用；单次 Loader 探测不是完整 JS/瓦片、ClusterLayer、Web/Mobile/Desktop 真机或敏感信息隔离验收。Browser AK 不回填前端，`release_blockers` 和运行时状态不能由 UI 修改。
- **交互稳定性**：保持旧有只读刷新、乐观修订号、dirty 草稿保护和取消/卸载状态；折叠不自动保存，不打开网络缩略图，不执行 Host 操作。历史仅展开时读取。

## 后续所有系统依赖的统一准则

一个服务、一套主要状态来源；一处编辑期望值；一处查看只读运行证据；一处按需读取历史。状态描述仅保留用户决策所需的一句话。展开是阅读行为，不是执行行为。对于具有真实操作的依赖（如 GeoNames 数据集、Caddy 网关、数据库、媒体 Worker），维持显式确认、权限、审计、版本及真实副本生效检测，不因简化文案删除证据。

## 代码与验收

共享代码：`ui/shared/src/mui/ServiceDependenciesPage.tsx`、`BaiduJSAPIDesiredPanel.tsx`、`BaiduJSAPIConfigSnapshot.tsx`。回归：`desktop/tests/system-dependencies-single-evidence-ui-sdv1.cjs` 和现有 C24/A3g/路由/密钥保护测试。Web/Mobile Web/Desktop 仍复用 MUI 页面及原始 Server/Agent，不另建视图。

当前只声称源代码重构和 CI 可核实部分；真实窄屏、键盘/VoiceOver、深浅色、真实百度配额/网络、Caddy/Host 状态及设备 UI 对照需单独验收。

地图上 iOS 27「照片」式**多照片缩略图+真实数量**仍未实现，已独立新增为 P0-Places-A3h，而不是混入这次系统依赖 UI 工作。具体标记、选中和 100k 安全边界见 `docs/gallery-places-ios27-roadmap.md`。
