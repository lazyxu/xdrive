# xDrive 百度坐标转换：会话缓存、峰值、BD09 来源与审计

状态：2026-10-23；本文件属于代码原型与受控回归，不代表百度账户配额、许可证或生产环境验收已经通过。

## 当前并存的三条链路

| 链路 | 经纬度来源 | 计算方法 | 本轮配额措施 | 跨窗口/跨副本 |
| --- | --- | --- | --- | --- |
| 旧版浏览器 Gallery Prototype | Owner 已授权的 WGS84 地图代表点（单次最多 64） | `BMap.Convertor.translate(points,1,5,...)` | 浏览器文档全局串行、最短 1000ms 间隔、最多 1 个在途、内存复用 | **不保证**，浏览器多窗口与多设备不是一个配额域 |
| 独立 HTTPS Baidu Child | 服务端返回的已转换 BD09 Owner Cells | 直接创建 `BMap.Point` 和 `BMap.Label`；不再次 Convert | 不进行 JS Convertor；请求由可信 Parent 发起，500ms 相机静默合并 | 与旧 JS Convertor 无法互相计费 |
| 服务端 PhotoMapIndex/Geoconv | 可信 DB Owner/Consent/SourceRevision 的单张真实 WGS84 | 未来的许可范围内经 `ForwardWGS84ToBD09` | PostgreSQL fleet+Owner 秒/分/日配额、flight 租约、可信身份/Consent/Lease，多副本共享 | 基础设施存在，**生产调度及许可证明门禁仍关闭** |

不能把 `internal/api/baidu_geoconv_quota.go` 的常数写成 JS Convertor 的账号 QPS 保证。`internal/api/baidu_geoconv_entitlement_proof.go` 的生产可用签名密钥未配置，`verifyPinnedBaiduGeoconvAccountEvidence` 拒绝派发；不能因管理员保存 AK、通过 Loader 测试或跳过不可接触的生产验收就绕过该门禁。

## P0 会话缓存

- 会话内至多 **512** 个 GPS 源坐标对 → 官方成功 BD09 派生结果，内部硬容量上限 1024。采用 Map LRU，键为 WGS84 的纬经度精确字符串，不按 0.01° 四舍五入，否则有位置误配。
- 最近 1024 个 `placeID → 源坐标键` 用于检测**同一代表 ID 的源坐标变化**：源坐标变化时驱逐旧 BD09 结果；照片数量变化不重复消耗转换。
- 每次地图视窗切换仍要立刻**清除已发布地图标记、聚集封面、Owner Cell 查询结果**，但不清除独立会话转换缓存。重新进入地图仅能用新一次可信 Owner 响应列出的 ID/坐标建立标记，不能把旧 Marker 显示为当前授权照片。
- Web 退出登录、账号身份变更与 FileManager 撤出，以及 Desktop 退出、服务器切换/账号切换，立即清除缓存、来源索引与匿名审计会话。页面内无 IndexedDB、sessionStorage、localStorage、Cookie、Service Worker、SQL 或任何持久派生 BD09 写入。

**重要界限：**缓存保留最近的派生坐标不是对持续有效 Consent/照片权限的证明；每次展示仍须由可信 Owner 列表重新授权。缓存命中不能直接恢复或重放旧照片 ID 或缩略图。

## P0 峰值控制

- 相同 Browser 文档中全局串行 JS Convertor 方法调用，方法发起之间至少 1000ms，最多 1 个真正等待官方回调的调用；最多 16 个任务在队列中等待。
- 正在等待中的过期地图请求在队列中被取消，不应继续调用 SDK。已经真正调用的请求无法退回百度配额，其 slot 一直等待回调或超时。
- 回调超过 3 秒可能意味着底层 SDK 请求仍未结束；为避免不安全的峰值重试，同文档后续转换**fail-closed**。再次进入一个新浏览器文档前不得声称旧请求已结算或已退款。
- Prototype 拖动/缩放后 500ms 安静期才提交新 Owner 视窗请求；独立 Child 对 moveend + zoomend 也做 500ms 合并，并在 movestart/zoomstart 立即向 Parent 发送 cancel。
- 限流只覆盖 xDrive **显式调用** `BMap.Convertor.translate` 的次数，不证明 SDK 内部或地图图块/资源请求数量、百度账户的所有 QPS/日配额。严格限额需以百度实际计量方式和许可进行独立确认。

## P1 最小匿名审计（实现与边界）

客户端实现 `XDriveBaiduJSAPI4ConversionSession.audit()` 和 `xDriveBaiduConversionAuditSnapshot()`，只返回：功能入口枚举 `places-prototype`、本次浏览器内生成的随机匿名会话 ID、方法调用总数、请求提交的坐标点数与成功转换数、每秒方法调用峰值、命中/未命中与命中率、取消/失败数、当前队列在途与缓存条目数。图库 Prototype 提供默认收起的“本次地图会话转换统计”只读详情。

**暂未实现**跨浏览器/跨设备聚合的持久化服务端调用审计与管理员趋势界面。现有浏览器数字既不是服务端已核准计费，也不是百度服务端账单。未来上报时只能提交严格白名单的整数计数与短寿命匿名会话 ID，必须 Owner 已认证、速率受限、审计 TTL/容量明确，不能提交浏览器 AK、原始/派生 GPS、照片/节点 ID、SDK 负载、原始 HTTP 响应或响应 URL。对真正的百度账号峰值，应由已许可的统一服务端调度链路记录；服务器审计不得把客户端自报数据当成真实上游账单。

## P1 统一路线与不能跳过的阶段

1. 优先使用独立 Child，消费可信 Server **已授权** BD09 聚合点，禁止再次把它当 WGS84 调用 Convertor。保留旧 Prototype 作为兼容路径，不宣称它继承了 Server 配额。
2. 对后续确需生成 BD09 的图片，先确认数据使用/保存权、账户真实 QPS/日额度、运行于自托管环境是否许可、可接受的缓存 TTL，再有条件激活当前硬关闭的 Server 端单张受控 dispatcher。
3. 用当前 PostgreSQL fleet+Owner second/minute/day quota + photo Consent/current source fingerprints + 跨副本 flight 执行；绝不把 Provider 未证实额度用工程常数替代；明确 Provider 收到调用即可能扣量，不因客户端 Abort 而退款。
4. 上线后再实施跨窗口的不可伪造调用审计与管理员统计，逐步删除旧 Prototype 对同一 AK 的独立调用。若条款不允许缓存 BD09，只保留会话内不持久的原型缓存，不启用 Server 派生坐标落库。

## 可复现的源码级验收

`node --test desktop/tests/gallery-baidu-jsapi4-conversion-session.cjs desktop/tests/gallery-baidu-isolated-child-runtime.cjs`，并运行 Desktop/Web TypeScript 检查、原有 Go/PostgreSQL 相关 Owner/Consent/权限/失效安全回归，以及与准确 HEAD 对应的完整 CI。真实百度服务计量和不可接触的生产安全验收：**按用户决定跳过（未验收）**，不请求生产凭证/HAR，不作为源码开发与 PR 合并门槛；同时不得冒称经真实生产验证。
