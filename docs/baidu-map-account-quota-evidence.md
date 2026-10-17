## P0-Places-A3d2m1b2b2c6 · 更低账号额度的原子预留（2026-10-17）

承接 #1974 合入的百度账号配额历史台账。新增一个**仅限 Go Server 内部**使用的 `reserveBaiduGeoconvQuotaWithLowerAccountCaps`，接收未来经独立许可核验与可信签名绑定的更低分钟请求/点、每秒请求、UTC 日请求四类 Fleet/Owner 限额。它只调用已有真实 PostgreSQL 原子 reservation，并在同一外部事务内处理全部维度：秒/日失败时，分钟、点和已写入的 Fleet/Owner 行一起回滚；已有消耗不能因更换/降低限额而清零。所有输入仍受现有更严格的工程上限约束，杜绝通过“3 QPS、5,000次/天”截图扩大容量。跨两个独立真实 PostgreSQL pool 的合成回归验证拒绝回滚、历史消耗、一项非法额度后的零行、24 次并发和默认路径合同。

**明确不意味着已经获得生产授权。** 生产 `reserveBaiduGeoconvQuota` 仍只能传入固定默认安全上限，尚无可信签名实证或授权 Worker 调用此新方法。签名候选 `verifyPinnedBaiduGeoconvAccountEvidence` 继续硬拒绝；JSAPI4 `runtime_enabled=false`、0 个获批 child，Web/Mobile Web/PWA/Desktop 不增加 Loader/Proxy/Server 公开路由、Agent IPC 或自动 Indexer；无真实 AK、GPS、百度请求、真实用户扫描或配额上调。仍须真实账号 AK 服务范围、额度归属与撤销证据、签名受信根、配额领取顺序、可取消任务和真实九场景 Browser+upstream HAR 等审查后才能继续开启。保持百度唯一 Provider、iOS 27「照片」1:1、52px 全屏 App Frame、一个跨端 Gallery Range/VirtualCollection/Viewer。

本阶段必须自身一个工作提交、准确 HEAD 完整 76-job CI（PostgreSQL Go API Race、Linux/Windows、Web/Desktop、Rootless、制品镜像、single-commit/final-gate）和 GitHub clean 后才能 Rebase Merge；不以 #1974 的绿色 CI 代替本阶段。

# xDrive · 百度地图账号服务额度与配额证据台账

> **记录日期：2026-10-17（Asia/Tokyo）。来源：用户在本次讨论中提供的百度地图开放平台「资源管理 → 我的额度 / 额度管理」控制台文本快照。** 截图的实际采集时刻及 AK 归属范围未由 Server 独立校验。以下为**历史快照，不是实时用量、长期额度保证或正式许可合同**。本文不保存控制台用户名、账号编号、AK、原始 HAR、照片/GPS、访问 Cookie、Token 或许可证全文。

## 1. A3 直接相关的已报告额度

| 服务 | 截图报告的每日上限 | 截图报告的 QPS 峰值/上限 | 显示的使用率 | xDrive 用途 |
| --- | ---: | ---: | ---: | --- |
| **坐标转换（Geoconv）** | **0.5 万次/天 = 5,000 次/天** | **0 / 3 QPS** | 0% | 原始 WGS84 → 官方 BD-09 正向转换；必须有照片来源授权与独立账号许可 |
| **静态图** | **0.5 万次/天 = 5,000 次/天** | **0 / 3 QPS** | 0% | 现有百度 Static Map v2，使用 Server 类型 AK |
| 正逆地理编码 | 0.5 万次/天 = 5,000 次/天 | 0 / 3 QPS | 0% | 后续 B1 需要另行评审，不代表已启用 |
| 地理编码 | 0.5 万次/天 = 5,000 次/天 | 0 / 3 QPS | 0% | 后续 B1 可评审，不能自动调用 |
| 逆地理编码 | 0.03 万次/天 = 300 次/天 | 0 / 3 QPS | 0% | 地名解析候选，额度显著低于坐标转换 |

- 控制台栏名为「并发峰值/上限」，写作 `0/3 QPS`。**3 QPS 是每秒请求频率限制，不等同于允许同时运行 3 个请求的连接数**；前面的 `0` 是截图中的显示峰值，不可推断整个自然日精确调用为 0。
- 所有**有数字配额的**服务行在所提供的控制台文本中显示「已使用：0%」。这是页面展示的百分比，可能有四舍五入，不能据此保证未发生过请求。
- 这些是**账号界面报告的服务额度**；尚需在正式放行前核实服务与当前实际 Server AK、应用及账号的生效关系，以及是否存在其他部署共同消耗同一个账号额度。它们**不是** Browser AK JSAPI 4.0 的独立请求额度，也**不是**地理坐标数据留存许可。
- 控制台可见服务的「配额在线购买情况」通常显示「包月：未在线购买 / 余额：0.00 元」，「并发购买情况」显示「未在线购买」。这是截图状态，不意味着保证永远免费或不会产生费用；是否需要购买须按实际官方条款判断。

## 2. 全部有数字上限的服务（原样展示值及换算）

**共 24 条。** 下表每行使用率均为截图所示 **0%**，数值换算遵循 `1 万次 = 10,000 次`。截图时间不等于当前实时状态。

| 控制台服务 | 原样每日上限 | 换算每日次数 | 页面峰值/上限 | 说明 |
| --- | ---: | ---: | --- | --- |
| 正逆地理编码 | 0.5 万次/天 | 5,000 | 0/3 QPS | — |
| 地理编码 | 0.5 万次/天 | 5,000 | 0/3 QPS | — |
| 逆地理编码 | 0.03 万次/天 | 300 | 0/3 QPS | — |
| 坐标转换 | 0.5 万次/天 | 5,000 | 0/3 QPS | P0-Places-A3 Geoconv，重点 |
| 普通 IP 定位 | 0.5 万次/天 | 5,000 | 0/3 QPS | 界面提及 IPv6 高级功能 |
| 地点检索 | 0.01 万次/天 | 100 | 0/3 QPS | — |
| 路线规划 | 0.5 万次/天 | 5,000 | 0/3 QPS | 界面提及历史耗时、未来路线、建议出发时间等高级功能 |
| 驾车路线规划（轻量） | 0.5 万次/天 | 5,000 | 0/3 QPS | — |
| 公交路线规划（轻量） | 0.5 万次/天 | 5,000 | 0/3 QPS | — |
| 步行路线规划（轻量） | 0.5 万次/天 | 5,000 | 0/3 QPS | — |
| 骑行路线规划（轻量） | 0.5 万次/天 | 5,000 | 0/30 QPS | — |
| 实时路况查询 | 0.2 万次/天 | 2,000 | 0/3 QPS | — |
| 批量算路 | 0.5 万次/天 | 5,000 | 0/3 QPS | — |
| 静态图 | 0.5 万次/天 | 5,000 | 0/3 QPS | 当前 Static Map v2 Server AK 调用，重点 |
| 全景静态图 API | 0.01 万次/天 | 100 | 0/50 QPS | — |
| 时区 | 0.03 万次/天 | 300 | 0/3 QPS | — |
| 鹰眼轨迹 | 0.5 万次/天 | 5,000 | 轨迹分析 0/20；其他 0/40；轨迹查询 0/20；图像 0/1；SDK 上传 0/30 QPS | 不同子类独立上限；界面提及道路属性、交通方式识别 |
| 轨迹纠偏 API | 0.01 万次/天 | 100 | 0/1 QPS | 界面提及道路属性高级功能 |
| 轨迹重合分析 API | 0.01 万次/天 | 100 | 0/1 QPS | — |
| 公交路线规划 API | 0.01 万次/天 | 100 | 0/1 QPS | — |
| 国内天气查询 | 0.5 万次/天 | 5,000 | 0/3 QPS | 界面提及国内经纬度天气查询 |
| 海外天气查询 | 0.5 万次/天 | 5,000 | 0/3 QPS | 界面提及海外经纬度天气查询 |
| 行政区划检索 API | 0.5 万次/天 | 5,000 | 0/3 QPS | — |
| MCP（SSE） | 5 万次/天 | 50,000 | 0/10 QPS | — |

「正逆地理编码」「地理编码」「逆地理编码」按控制台**不同服务行**分别记录；不能合并、累加或把它们的额度代替坐标转换额度。鹰眼轨迹的 5 类 QPS 必须保留各自语义，不能简化为单一并发额度。

## 3. 控制台未显示数字额度的服务

**共 20 条。** 表中仅表示该页面的「申请权限 / 联系我们」，**不表示有免费配额、已获批或服务不能使用**；未看到数字上限时不能填 0 或猜测上限。

| 服务 | 控制台可见状态 |
| --- | --- |
| 推荐上车点 | 申请权限 |
| 境外路线规划 | 联系我们 |
| 境外地点检索 | 联系我们 |
| 境外地理编码 | 联系我们 |
| 逆地理编码境外 POI | 联系我们 |
| 智能硬件定位 | 联系我们 |
| 摩托车路线规划 | 申请权限 |
| 摩托车批量算路 | 申请权限 |
| 地址解析聚合 | 联系我们 |
| 货车路线规划 | 申请权限 |
| 货车批量算路 | 申请权限 |
| 货车 ETC | 联系我们 |
| 道路信息 API | 联系我们 |
| 行驶里程分析 | 联系我们 |
| 城乡类型判别 | 联系我们 |
| AI 向导 | 联系我们 |
| POI 智能提取 | 联系我们 |
| 导航诱导信息 API | 联系我们 |
| 境外逆地理编码 | 申请权限 |
| 地图 SDK 境外逆地理编码 | 申请权限 |

## 4. 与现有 xDrive 代码安全上限对照

以记录时现有 A3 Geoconv 安全常量为准；这些是**本地工程上限**，不会因为控制台显示 3 QPS、5,000 次/天自动提高：

| 范围 | 当前本地控制值 | 与账号截图关系 |
| --- | ---: | --- |
| Geoconv Fleet 每秒请求 | **2 次/秒** | 低于截图报告的 3 QPS |
| Geoconv Owner 每秒请求 | **2 次/秒** | 低于截图报告的 3 QPS |
| Geoconv Fleet UTC 每日请求 | **4,000 次/天** | 低于截图报告的 5,000 次/天 |
| Geoconv Owner UTC 每日请求 | **200 次/天** | 低于截图报告的 5,000 次/天 |
| Geoconv 每 Owner 同时执行任务 | **1** | 独立的跨 Server 容量限制，不是 QPS |
| Geoconv Fleet 同时执行任务 | **2** | 独立的跨 Server 容量限制，不是 QPS |
| Static Map 每 Server 并发请求 | **3** | 这是连接/请求 in-flight 上限，**不是**账号级 3 QPS 保证 |
| Static Map 每用户请求 | **30 次/分钟** | 属于本地窗口限制，不能替代账号级 3 QPS / 5,000 次/日 |

对应代码：`internal/api/baidu_geoconv_cadence.go`、`internal/api/baidu_geoconv_flight.go`、`internal/api/baidu_geoconv_quota.go` 和 `internal/api/baidu_map.go`。Geo API 的 fleet/Owner 计数使用 PostgreSQL 事务；现有静态图的实例本地限流不能直接当作跨副本、跨所有 AK 消费者的账号总额控制。

**后续执行建议：** 保持不高于更小的官方账号生效上限和 xDrive 本地上限，按实际账号归属计费，所有副本共享不可超发的请求配额；对于生产签名许可，应先验证账户服务范围、真实生效 QPS/日额、签名来源及撤销状态，再允许按 Owner 和用户明确授权的单项 PhotoAsset 请求调用。控制台截图可用于记录**报告值**，不能当作可自行签发的可信授权证明。

## 5. A3/JSAPI 4.0 关联门禁与隐私

- 本次新增的是**额度快照证据**，不是改配置、加额度、购买服务、启动 Worker、发起真实 Geoconv 请求或开放 JSAPI 4.0 Loader/Proxy。保持 `runtime_enabled=false` 且当前审核通过的 JSAPI4 子资源数量为 0，直到完整门禁完成。
- 百度是唯一地图 Provider；现有 Static v2 使用 Server 类型 AK，动态 JSAPI4 需独立 Browser 类型 AK 且由经授权的 Server 同源代理注入。**不得将 AK 输出给 Web / Mobile Web / Desktop、日志、HAR、URL、CI、第三方脚本或 GitHub**。
- 控制台额度**不能代替**官方对多用户自托管、PWA、Electron、JSAPI4 代理、Geoconv WGS84→BD-09 索引保存及商用范围的书面许可。此前操作者关于这些范围及无额外费用的结论已见 [#1798](https://github.com/lazyxu/xdrive/issues/1798)，**不要重复索取同一声明**；仍需独立可审查的账号具体服务额度证据。
- JSAPI4 上线还需隔离环境下 **Web、Mobile Web、Desktop × load、pan、zoom 共 9 组独立 Browser+Server upstream HAR 配对（18 份）**、真实子资源 Host/Path/Query/MIME/大小固定白名单、原始字节 AK 不泄漏、可信发布签名、Caddy/CSP/Electron/PWA/会话鉴权和真实 iOS 27「照片」1:1 截图/手势/深浅色/横屏/无障碍/100k 性能验收。HAR、AK 和私人坐标仅存私有受控目录，**不进入本台账**。
- 固定 xDrive **全屏 App Frame、52px 全局标题栏、一个 Server Gallery Range/VirtualCollection/Viewer**：Web、Mobile Web、PWA、Desktop 共用功能/数据合同，不为百度代理分叉业务后端或照片虚拟列表。

## 6. 更新规则与后续验证

未来取得新页面额度时，应在本台账**追加新日期的快照或经独立验证的更正**，保留 2026-10-17 的原始观察和来源，不静默覆盖历史。若额度变化或账号开通增值业务，必须注明服务名称、截图日期、账号/应用范围（仅匿名非敏感标识）、新 QPS/天额、计费或额外购买影响、证明级别与批准者。不要在 Git 历史中提交 AK、账号姓名、合同、原始 HAR 或真实照片 GPS。

参考：
- [百度 JSAPI4 运营者私有取证指南](gallery-places-jsapi4-operator-runbook.md)
- [百度 JSAPI4 代理许可与安全评审](gallery-places-jsapi4-proxy-review.md)
- [百度 Static Map Server API 设计](baidu-map-server-api.md)
- [Places iOS 27 Photos 1:1 路线图](gallery-places-ios27-roadmap.md)
- [Geoconv 与 JSAPI4 生产许可门禁 Issue #1798](https://github.com/lazyxu/xdrive/issues/1798)

## 7. A3d2m1b2b2c7 — 私有签名额度证明与唯一原子额度预留（尚未授权生产上线）

- 前序 [#1982](https://github.com/lazyxu/xdrive/pull/1982) 的 `reserveBaiduGeoconvQuotaWithLowerAccountCaps` 已通过 [76-job CI #39024792348](https://github.com/lazyxu/xdrive/actions/runs/39024792348)，Ready/Rebase 合入 `master@6f65e7658e357548217bb46fc48de667e8359aed`。另一条独立 SQL 写入方案 [#1980](https://github.com/lazyxu/xdrive/pull/1980) 已关闭且未合并，不能复活为第二套额度引擎。
- 新增私有候选 `reserveBaiduGeoconvSignedAccountQuota`：要求明确传入可信 Owner、当前会话和 Server AK 修订、许可证据哈希及签名公共密钥；用 PostgreSQL 时钟两次核对 c5 域隔离 Ed25519 证明，在同一个外层事务中**只复用**已合入 c6 的分钟／点数／每秒／UTC 日 Fleet-first+Owner-second 低额度预留。任何回滚均不遗留部分费用或试图返还此前已消耗的配额。这里只支持一张明确授权的照片候选，不执行任何 Geoconv 网络请求。
- 安全门禁仍为生产 NO-GO：测试生成的签名不是第三方真实授权，生产 pinned operator key 仍为空且生产验证路径硬拒绝；没有 Browser AK/Server AK 实际读取、地图 JSAPI4 会话、Cookie、Loader、跨域代理或个人 GPS 传输。没有真实证据的主体、版权、请求范围和长期留存不被静态代码推断。JSAPI4 `runtime_enabled=false`、已审查动态子资源数量 0。
- 采用旧关闭候选 #1980 的隔离 **两独立 PostgreSQL pool** 合成用例，验证串行和并发时签名造假、Owner/AK 修订错配、过期、低额度以及全天拒绝后的整笔回滚；增加 Node 源码契约保证不引入第二套 SQL 写入或任何公开 JSAPI4 代理路由。必须有本 c7 准确 HEAD 的全 76-job CI（含真实 PostgreSQL API Race、Rootless、Web/Desktop/Windows、final-gate）与 GitHub clean 可合并才能 Ready/Rebase。
- 用户已在 [#1798](https://github.com/lazyxu/xdrive/issues/1798) 报告自托管 PWA/Electron/BD09 许可与无额外费用，此处只保留其报告，勿重复询问；要解除动态地图封锁，还需要授权测试环境产生的三平台×冷加载/平移/缩放 **九组浏览器+上游原始 HAR**、独立复核固定第三方子资源规则、AK 原始字节泄漏验证、生产签名根、Caddy/CSP 与真机 iOS27/Android/Desktop 验收。

