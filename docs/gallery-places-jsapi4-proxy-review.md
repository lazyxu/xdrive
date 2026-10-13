# P0-Places-A3a · 百度 JSAPI 4.0 代理接入、安全及许可评审

**日期：2026-10-13** · **唯一地图 Provider：百度** · **判定：有条件可行；生产动态 JSAPI 尚未批准开启**

## 最新批准及官方事实

用户最新决定允许 Server AK 与 Browser AK 按真实业务需求分别配置。以前的“只允许 Server AK”临时决议已被取代。**已有 Baidu Static Map v2 使用 Server 类型 AK**，JSAPI 4.0 按官方 [加载说明](https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcepts%2Fload) 和 [准备步骤](https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fquickstart%2Fprepare) **需要 Browser 类型 AK**，不是同一密钥的两种模式。

官方 [JSAPI 代理说明](https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcepts%2Fproxy) 支持 `serviceHost`、`BMAP_PROXY_URL` 在自己的 Server 后端加 AK 后转发，前端不必带 AK；其 Nginx 范例**不能直接用作 xDrive 多用户通配生产代理**。生产使用还需账户实际满足 [百度开放平台条款](https://lbs.baidu.com/docs/pcsa?title=law%2Fopen%2Flaw) 和 [付费授权协议](https://lbs.baidu.com/docs/pcsa?title=law%2Fopen%2Flaw-commercial)，包括自托管、PWA、Electron、商用权、配额、归属标记、数据隐私与缓存限制。**没有账号/许可证实证，动态 JSAPI NO-GO。**

## 选型与已经具备的能力

| 路径 | 密钥和存储 | Web、Mobile Web、Desktop 业务集成 | 当前门禁 |
|---|---|---|---|
| 百度 Static Map v2 | xDrive 既有加密 **Server AK** | Server 授权 PNG；Web/Mobile 共用 Gallery DataSource，Desktop 走受限 Agent IPC | 已交付；可继续展示 |
| 百度 JSAPI 4.0 | **Browser AK** 独立加密，仅 Server 内部解封，不返回普通用户 | 同一 Gallery、Server 媒体范围查询、真实 GPS、Viewer；另需只允许百度资源的 Server 同源代理和安全 Electron 运行环境 | **未启用**；#1607 是独立 desired-config 的前置候选 |

PR #1607 曾在 Server-AK-only 临时约束下关闭，已有准确的完整 CI 通过证明；依据最新决定应优先核查并恢复，避免重复分支。它只保存 **desired_enabled**、密钥版本/修订号、加密密文和不含敏感数据的审计记录，**runtime_enabled 永远 false**。不能把“保存配置”解释为“JSAPI 已启用或生效”。

## 强制 A3b2 代理安全门禁（未完成）

1. **鉴权和撤销**：原 API 使用 Owner Bearer；JSAPI `<script>`、瓦片、字体无法附带该 Header。Server 只有在原 JWT 登录/用户有效且服务已审核的情况下才可签发**地图专用短 TTL**、HttpOnly、Secure、SameSite、Path 限定的独立会话；每个地图资源请求重新验证撤销状态与配额。严禁从 `?token=`、Referer、User-Agent、自报 owner 获权；防 CSRF 与登出后仍可使用。
2. **绝对固定上游资源**：在授权 Browser AK 的测试环境收集实际 JSAPI 4.0 loader、JS、瓦片、WASM、样式等完整依赖，逐项制定固定百度 HTTPS host、path、method、query 参数、请求头、Content-Type 和响应大小/超时限制。代理绝不允许任意 URL、未知域、DNS rebinding、目录遍历、重定向、Host/Cookie 注入或浏览器 `ak` 参数；没有验证过的子资源必须 fail closed。**不得直接采用官方通配 Nginx proxy 示例**。
3. **严格无密钥泄漏**：真实网络逐请求、原始响应字节和浏览器 DevTools HAR 检查，不允许 AK 出现在 JS/CSS/JSON/响应 body、Location、browser URL、source map、日志、分析、Electron preload、Service Worker 存储或离线缓存。若必要的第三方资源在响应里回显 AK，禁用该资源和 JSAPI 整体激活，不能靠前端遮盖。Server upstream 注入 `BMAP_PROXY_URL` 仅在白名单匹配时合法。
4. **配额/隔离**：每 Owner、全局且跨副本的限流，超时、并发、流量/字节数、异常域名防护和独立 AK 使用观测；不记录完整用户 GPS。地图交互视窗变化即取消短网络请求，到 Go `Context.Done()`，不取消持久上传/下载/同步。
5. **共享组件与真实地理数据**：同一 Web/Mobile Gallery DataSource、VirtualCollection/Grid/Timeline/Viewer、Server authorized Range。照片坐标来自经过有效性判定的原件 GPS，网格中心只是区域代表点，不能冒充照片坐标。Baidu 坐标系、隐私转发和用户分享策略要有显式合同。地图 Marker/Cluster 仅消费 Server 有界 Owner 数据，不拉取 100k 全量到 DOM。
6. **跨客户端安全**：Desktop 同一 MUI 组件/媒体后端但 Electron sandbox、contextIsolation、受控 Agent/Main IPC、CSP 必须确保第三方百度 JS 无 Node/文件/设备根路径/账号令牌访问权；PWA 禁止缓存任何地图授权、脚本私有回复或 GPS 私有内容。iOS 27 Safari、Android、Desktop 实机 WebGL/手势/深浅色/无障碍/性能需要独立验收。

## 下一步严格顺序和状态

- **A3a（本 PR）**：安全许可评审与规范；合入前必须有本提交的完整 CI Final Gate。
- **A3b1（#1607）**：恢复已测试的浏览器 AK 独立加密 desired-config、管理员乐观锁、加密/越权单元与 Postgres 集成测试；保持动态 Runtime 禁用。
- **A3b2**：在合法授权 Browser AK、官方实际完整子资源白名单、泄漏证明前提下实现同源会话/代理，未满足条件持续 NO-GO。
- **A3b3**：Web/Mobile Web/Desktop 共用平移/缩放、Marker、区域聚合、范围照片墙和 Viewer；百度唯一 Provider。Static Map 作为同供应商的已授权可用模式，不能假称 JSAPI 连续交互。
- **A4、B1–B3、C1**：Owner 有界 Nearby Range、语义地区、准确旅程、定位编辑/隐私和 iOS 27 真机像素/交互测试另行开发。

**不改变 xDrive 全屏 App Frame、52px 全局栏、Web/Desktop 共享后端、Web/Mobile Web 功能等价。没有真实授权或未达到安全门禁前，不得宣称 JSAPI 已可用，也不得用 OSM、Google、SVG 等另一地图源降级。**


## A3b2a · 浏览器 HAR 泄漏审计门禁（2026-10-13）

本步骤仅提供**本地、离线、只输出固定错误码的审计程序**，不是 JSAPI 生产代理，也不是百度真实账号的法律授权证明。A3b1 的 `runtime_enabled=false` 保持不变，不增加任何 Server 路由、JSAPI loader 或第三方动态脚本。唯一 Provider 仍为百度，静态地图 Server AK 功能不变。

- 审计实现：`scripts/ci/baidu-jsapi4-browser-har-audit.cjs`；可执行合成正反例：`desktop/tests/baidu-jsapi4-browser-har-audit.cjs`，自动纳入 Desktop `node --test tests/*.cjs`。
- **拟议尚未上线的协议**：已登录客户端通过 Server Bearer 申请 `POST /api/v1/media/places/baidu-jsapi/session`；Server 校验当前用户、授权、修订和撤销状态后，发给地图资源专用、最多 300 秒的 `XD_BMAP_SESSION` HttpOnly + Secure + SameSite + Path=/_BMapService/ Cookie。代理载入 `/_BMapService/api?v=4.0`，后续子资源同源，Browser AK 仅由 Server 注入百度上游。此处的路径/Cookie 只是未来必须满足的验收合同，**端点和 Cookie 均尚未实现，不能调用**。
- **离线执行**：先在隔离环境从 Web、Mobile Web、Desktop 各自导出包含响应体的完整地图启动+平移/缩放 HAR；在本地安全终端由秘密管理器注入 `XD_BAIDU_JSAPI_AK_CANARY`（仅审计进程环境，勿出现在命令行、仓库、CI 产物或聊天记录），运行 `node scripts/ci/baidu-jsapi4-browser-har-audit.cjs /secure/path/session.har https://your-actual-origin.example web`。第三参数依次可为 `web`、`mobile-web`、`desktop`，每平台独立运行；退出码 0 才表示**该份完整采样 HAR 的浏览器侧检查通过**，并非 JSAPI 已上线。
- 必须拒绝：无真实密钥比对标记、浏览器 URL/Header/脚本 Body 的 AK 泄露、`ak` 查询参数、任意外域直连、重定向、Service Worker/浏览器缓存、HTTP 非成功、缺失 `no-store` / `nosniff` / `no-referrer`、Bearer 出现在代理资源请求、无地图专用 Cookie、没有 loader+子资源、无响应文本 body 或过长会话 TTL。仅输出固定码/汇总计数，不回显 URL、路径、Cookie、密钥或原始响应。
- **隐私**：真实 HAR 可能含 GPS、访问令牌、Cookie 和源图请求。严禁上传至 GitHub、提交仓库、生成 CI 附件或分享给第三方；采用按需访问和受控销毁。只有无密钥合成 fixture 可入库。

**明确未通过的生产门禁**：真实百度 Browser 类型 AK 及账户合法许可、自托管/Electron/商用边界、官方实际完整 loader/JS/WASM/瓦片/字体/样式请求清单、严格逐 host/path/method/query 白名单、Server 注入/上游返回原始字节无 AK 泄漏、跨副本配额与会话撤销、反向代理/CSP/Electron 沙盒、真实 iOS 27 Safari/PWA、Android、Desktop 验收。HAR 仅能证明采集的浏览器侧样本，不可证明未被采集的服务端上游或移动系统行为；模拟测试通过时 **A3b2/b3 仍为 NO-GO**。
