# iOS 27 地图 P0-01 · GPS 覆盖对账与批量授权设计

状态：**统计与四种用户反馈已实现；批量授权和后台执行尚未实现**。此文是实施合同，不代表源代码已经支持自动批量转坐标。

## 已有可信底座

- `GET /api/v1/media/places/baidu-jsapi/coverage` 仅对当前已完成索引的 Owner PhotoAsset 汇总 `valid_gps_assets`、`eligible_bd09_assets`、`not_eligible_bd09_assets`、`source_outside_camera_latitude_assets`。
- 现有后端同一可重复读数据库快照比较原始 GPS 与已授权、来源版本匹配的 BD-09 派生点，客户端返回没有坐标、PhotoAsset ID、Node ID 或 AK。
- 结果中的 `map_runtime_verified=false` 是强制值；不能把“地图可显示成员齐全”解释为“第三方 SDK 已可用”。
- Web、Mobile Web、Desktop 共用 `ui/shared` 严格解析与 UI；切换 Owner / 卸载 / 新查询通过 Abort 和序列号防旧结果覆盖。未知/错误数据属于“不可用”，绝非 0 张。

## 覆盖范围与用户状态

| 当前快照 | 用户显示 | 严格含义 |
| --- | --- | --- |
| 返回无效、旧 Server、请求失败 | 统计不可用 | 不得展示为 0 |
| `valid_gps_assets=0` | 没有有效原始 GPS | 仅指已完成索引的 PhotoAsset |
| `valid_gps_assets>0, eligible_bd09_assets=0` | 暂无可显示 BD-09 照片 | 可能是未授权、授权过期、来源修订改变或派生索引未就绪 |
| `0<eligible_bd09_assets<valid_gps_assets` | 部分覆盖 | 不可仅凭差值断定 GPS 无效 |
| `eligible_bd09_assets=valid_gps_assets>0` | 本次统计范围内覆盖完整 | 不代表 SDK/签名发布成功 |

**下一阶段诊断**应由数据库对当前 Owner 的符合条件的 PhotoAsset 分解不可显示原因，避免重复计数与越权：未获转坐标授权、已撤权/过期、源修订不一致、任务待执行/失败、BD-09 索引缺失或无效、地图纬度范围外。原因计数和总差额应在**同一只读快照**中完成；必要时采用互斥优先级分类保证相加一致。既不能向浏览器传明细 GPS/ID，也不能把已撤权的坐标当成可显示点。

## 批量授权与转换方案（尚未实现）

1. 初始默认不授权。通过当前 Owner 的可信图库 UI，给出清晰的一次性批量授权操作，明确将选中的原始 WGS84 坐标发送给百度作转换、可能多次发送、已发送内容无法撤回。授权是**账户、具体照片及其当前 GPS 来源修订**的协议，不是简单设置 `consent=true` 的全局绕过。
2. 勾选范围必须由 Server 解析（例如“当前已完成索引且有 GPS 的照片”）；浏览器不得自报 Owner、Asset ID 列表、GPS 或转换结果。API 必须校验当前 Bearer/SessionVersion、Origin/Fetch-Metadata、用户显式 `confirm`、授权时效与撤权语义。
3. 批次有界、可取消、可恢复；每批基于最新 Owner/Node/PhotoAsset/Media/GPS 修订与授权事务逐项确认，审计写入与授权写入原子化。不能直接在 HTTP 内连续转换全部 100k，也不能将原始坐标放在前端持久化状态、日志或审计明文中。
4. 只由 Server 在获得当前有效授权且实际满足百度账号合法许可和当前配额时通过固定官方 HTTPS 服务转换，使用已有跨副本 fleet+Owner 限流、持久 Intent、可取消租约、重试和最后事务内的来源/Consent 双重复核。
5. 一旦撤销、退出登录、账户切换、GPS 编辑、Node 删除、版本改变，未来任务立刻失效，并清理当前派生地图索引及旧缩略图可见性。已向第三方提交的坐标无法撤回，应明确告知。
6. 与同页原型的关系：单次已经明确批准的 Owner 策略可免去**以后每次打开**时的重复确认；从未批量/逐片授权的照片不得因打开默认地图就静默外传。原型内运行第三方 SDK 的风险与独立 HTTPS Child 安全边界仍需分别展示和回归。不可将“应用使用权”误作“原始坐标外发权”。

## 代码与安全验收

- 两 Owner / 会话轮换、部分撤权、并发编辑 GPS、重试与重复批次、稀疏/密集/0,0/日期线/极区、指数退避、超额配额、审计故障回滚必须通过真实 PostgreSQL 和前端竞态测试。
- 指标：Owner 可显示 BD-09 数据数量、未就绪原因互斥总和、首批缩略图、取消延迟、100k 数据集数据库执行计划及端到端 P50/P95；首先记录基线再优化。
- 不得用旧 SDK 代表点的 64 条请求或 10 张预览替代全图库可显示照片计数，也不得将未经授权的 Source GPS 隐式转换为 BD-09。
- 生产环境不可访问的安全验收：**按用户决定跳过（未验收）**，不阻塞源码级权限测试、CI、PR；严格的 Owner/Consent/CSP/Origin/撤销回归仍是必要门槛。

关联：[#2436](https://github.com/lazyxu/xdrive/pull/2436)（全 Camera Range 已合并）、[#2468](https://github.com/lazyxu/xdrive/pull/2468)（GPS 对账已合并）、[#2460](https://github.com/lazyxu/xdrive/pull/2460)（筛选 Camera/Cell/Wall 已合并）。
