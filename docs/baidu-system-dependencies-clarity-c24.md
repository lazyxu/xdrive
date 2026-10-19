# A3c24 · 百度地图系统依赖页面：配置与生产生效证据分离

日期：2026-10-19。基于已经合入的 A3c23 #2113，修复被明确观察到的 Web/Mobile Web/Desktop 共用「系统依赖 → 百度地图 Server API」页面的重复说明与误导状态。百度仍是唯一 Provider。

## 生产现象与原因
操作者已在当前生产环境持久化两类 AK（Static Map v2 Server AK、JSAPI4 Browser AK），并确认受信 HTTPS 正常。然而动态 JSAPI4 仍显示“运行未授权放行”。这是符合真实 Server 发布门禁的状态：当前构建的 operator Ed25519 root 为空、批准的 JS/tile/font/WASM 子资源策略 revision/count 为空/0、无真实资源/HAR、签名发布续期或三端真机证据。AK 正确不可能让客户端绕过该门禁；不能通过关闭签名或安装通配代理冒充地图生产可用。

另一类问题是视觉证据重复：原配置与验证块均渲染完整静态 Server AK 文案、Browser AK 文案和相同配置状态。静态服务的通用 `status=unknown, health_state=not-checked` 显示“无法检测”，尽管已有按需人工固定 PNG 探针；“已配置”与“已通过真实百度 API 检测”不应混用。

## Server snapshot correctness
- 修正 `admin_service_dependencies.go` 误导性的“按需取图验证，不消耗额外 API 配额”：读取配置本身不请求百度，但管理员手动触发真实 Static Map PNG 在线验证会消耗一次 API 配额。保留 `status=unknown` 和 `health_state=not-checked`，已保存凭据不代表在线验证通过。
- 在现有真实 Go `TestAdminServiceDependencyLifecycleBaiduAndCaddyNoFalseApplied` 中加入状态文案契约断言；不添加百度网络请求。

## Scoped shared UI correction
- 仅在配置区显示 Server AK 可修改、短时 reveal、配置来源与修订；「状态与检测 → 检测与生效证据」只显示固定 128×128 PNG 实际在线验证的动作与结果。它消耗一次 Static Map 配额、绝不读取照片 GPS、不主动定时请求。
- 仅在配置区显示 Browser AK 输入、期望保存等编辑语义；检测区命名为“动态地图 · Server 发布授权”，展示独立的实际放行状态及当前 Server 返回的 `release_blockers`。当旧服务未返回详细 reasons 时明确提示证据缺失，绝不将空原因视为已放行，也不让用户再次填写 AK。
- 将百度 Static `unknown + not-checked` 的展示名改为“待人工在线验证”，保留健康未检测与生效条件不变。其他服务、未知错误、真实健康失败的原始状态与统计不动。
- 仅改 Web/Mobile Web/PWA/Desktop 共用 MUI 组件，不复制后端请求、不调整 App Frame/52px、Server AK 存储/浏览器加密/限速/临时 reveal、不改虚拟列表、地图图层、Viewer、前 24 个地点/精确坐标和图片网络缩略图。

## Actual production GO requirements unchanged
完整私有真实 Browser/Server upstream 9×2 HAR，百度授权/AK 保密复核，原始字节和子资源逐项审核，source-pinned Ed25519 release, protected host provisioning, HTTPS 三端真机、iOS 27 Photos 页面 1:1 与真实 100k 才可对外宣布动态生产可用。本 PR 仅改善诊断真实性，保留有界精确子资源门禁，不提供不审计的上线捷径。

验证：专用 TSX parse/source 可执行 Node 回归 + 既有 Baidu、系统依赖和 Web/Desktop tests；需要新完整、准确 HEAD 77+ CI 与 GitHub clean mergeability 才可合并。
