# xDrive Gallery Places — 百度地图 Server API（唯一地图 Provider）

**当前产品约束（2026-10-10）：Gallery Places 仅显示百度地图。** 既有本地 SVG 世界轮廓、经纬网格、投影与聚合地图已退役。**未配置 AK、网络断开、百度接口失败、配额限制或旧版 Server/Agent 时，显示明确的地图不可用状态；不加载任何离线地图、备用瓦片、OpenStreetMap、Google 或其他 Provider。** 地点文字列表和照片筛选可继续使用，但它们不是地图回退。

## 地图服务与坐标

- 唯一底图来源：百度地图开放平台 `https://api.map.baidu.com/staticimage/v2`；xDrive Server 代表已登录用户调用，AK 不发送到 Web/Desktop。
- 原始 EXIF 与持久数据库保持 **WGS84**，请求携带 `coordtype=wgs84ll`；`center` / `markers` 使用 `经度,纬度`，避免 BD-09/WGS84 混用导致定位偏移。
- `scaler=2` 输出高清 PNG，且不改变 zoom。
- **静态图不是交互瓦片引擎。** Places 可通过地点搜索选择、重新加载、缩放按钮查看百度静态地图；点击“查看此地点照片”打开相应素材。当前不提供离线拖拽/滚轮投影地图。若未来需要流畅拖动/动态地图，必须采用经许可的百度接口进行独立设计，不得恢复旧离线实现。
- GeoNames 数据仅用于已有可选的**地名元数据解析**，不生成地图、不提供地图回退。不调用百度地理编码和坐标转换 API；未来若需要可另行评审。

## 部署配置（显式启用）

首次安装可选择在 **Server** 的 Compose/环境变量中配置，或者在管理员页面保存 AK：

```env
XD_BAIDU_MAP_ENABLED=true
XD_BAIDU_MAP_AK=在百度控制台申请的Server类型AK
```

默认 `XD_BAIDU_MAP_ENABLED=false`，从而普通升级不会突然把 GPS 发送给外部服务。即使管理员设置了 `true` 却漏填 AK，Server 也应正常启动并在地图区域明确报告未启用；不能因此中断上传、下载、同步等核心服务。配置前需确认 AK 类型、应用出口 IP 白名单、每日调用配额、静态地图权益及署名要求。不要把 AK 放在客户端、Vite env、前端路由或 GitHub 仓库中。

## 管理员“服务与依赖”页面：AK 修改无需重启

管理员在 Web 或 Desktop 的 **服务与依赖 → 百度地图 Server AK** 中输入或替换 AK，可直接点击“保存并立即生效”；也可禁用地图或二次确认后清除 AK。修改后**不重启 xDrive Server，也不停止上传、下载、同步或任务运行**。地图每次请求都会使用 PostgreSQL 中最新的有效设置，多个 Server 实例共用该状态。

- 页面读取 `GET /api/v1/admin/services/baidu-map`，返回是否启用、是否已配置、来源、修订版本及 `requires_restart=false`，**绝不返回 AK 明文**。
- 页面提交 `PUT /api/v1/admin/services/baidu-map`，包含 `enabled`、`revision`，可选 `ak` 或 `clear_ak`。AK 为空表示保留旧值；清除需要明确确认，并停用百度地图。
- **主动显示 AK（与一刻相册 Cookie 共用 UI）**：`POST /api/v1/admin/services/baidu-map/reveal` 请求体含当前 `revision`，仅管理员可调用；正常 GET 状态绝不带明文。点击“显示”后临时返回 `{field:"ak",value,expires_in_seconds:30}`，页面仅在当前组件内存中显示，30 秒后自动隐藏；手动隐藏、保存/清除、切换账号、组件卸载或窗口离开前台立即清空，并屏蔽失效的异步结果。
- 显示 AK 必须先写入**不包含任何密钥内容**的 `admin.service.baidu_map.reveal` 审计记录；审计失败则不返回 AK。API 响应带 `Cache-Control: no-store` / `Pragma: no-cache`；浏览器网络调试仍可能看到本次主动揭示响应，所以不要将已显示的密钥写入日志或剪贴板。
- 新 AK 通过服务端现有版本化 AES-GCM keyring（`XD_CONNECTOR_SECRET_KEYS`）加密存入独立表 `xd_admin_service_secrets`。持久记录优先于原有 `XD_BAIDU_MAP_* ` 部署变量。更新使用乐观版本控制和审计日志（只记录操作、启用状态、修订版本，不记录密钥）。
- 安装器通常会生成加密密钥。如果历史部署没有密钥环，需要先通过部署环境配置并重启一次以启用加密功能；**之后换 AK 永远不需要重启**。
- 首次尚无管理员持久记录时，现有 `XD_BAIDU_MAP_ENABLED`/`XD_BAIDU_MAP_AK` 环境变量仍提供兼容初始化。保存后数据库成为唯一管理来源，包括主动禁用或清除时；不会因删除 AK 而暗中回退到旧环境 AK。
- 替换 AK 的输入框默认始终为空，不会自动填入已显示的密钥；现有 AK 只通过独立的遮罩只读字段主动显示。服务健康状态仍区分 disabled 与 configured-but-unverified；不能仅凭保存成功就报告百度线上调用成功。

## xDrive 后端接口与安全边界

- `GET /api/v1/media/places/map-provider`：需登录；只返回 provider 名称、是否启用、百度署名、定位信息披露说明，**不返回 AK**。
- `GET /api/v1/media/places/baidu-static?lat=...&lng=...&zoom=12&width=480&height=280`：需登录；固定百度 HTTPS 上游、AK 由 Server 拼接、拒绝 HTTP redirect、不可传入任意 URL。
- 参数限制：纬度 -85~85，经度 -180~180，缩放 3~18，宽高 128~512 px，拒绝 NaN/Inf、异常大小。
- 输出：只接受 `image/png` 与 PNG 签名，最大 3 MiB，`no-store`，`nosniff`，上游错误统一安全转译且不回传任何包含 AK 的错误/URL。
- 每 Server 同时最多 3 个百度请求、每用户最多 30 次/分钟、5 秒 deadline。多个 Server 实例共用 AK 时还需全局配额控制。请求使用客户端上下文取消，不发起全库坐标批量查询。
- Web 通过 Bearer 获取 Blob，Desktop 通过 Go Agent / Electron Main 的二进制链路获取 ArrayBuffer。切换地点、缩放或退出时取消网络请求并撤销旧 Blob URL。
- 管理员“服务与依赖”页：未启用时显示 disabled；AK 已配置但未实际发送健康请求时显示 unknown，**不能把已配置等同于可用**。

## 失败、隐私与验收

- 所有地图获取失败均保留 Baidu-only 地图区域并显示错误/配置提示，绝不 fallback 到旧内置地理底图。
- Places 地点列表、封面、计数、筛选是普通图库元数据界面，不依赖地图成功；它们不是另一种地图。
- 当百度地图成功加载，地图服务会得到当前所选坐标和 Server 出口 IP；不发送全库 GPS。
- Server AK 未提供给本次开发环境，只能使用 mock 上游完成 Go 代理安全测试，不能声称百度线上账号配额和真实地图结果已通过验收。
- PR 验收：Go API/权限/配额/超时/PNG/WGS84 测试、Web & Desktop 编译、Desktop IPC 取消、Places 唯一 Baidu 渲染的断言、10k/100k facet 不批量发图，以及合法 AK 的实际在线功能复核。

官方服务文档：https://lbs.baidu.com/docs/webapi?title=static/heightStatic
