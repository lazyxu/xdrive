# xDrive 地点地图：唯一渲染实现为百度 JSAPI 4.0

**2026-10-23 产品决策。** 本文取代 Static Map v2 Server PNG 的运行规范。静态地图渲染方案彻底退役，不再以它作为任何失败降级。

## 地图和 GPS 的职责

- **唯一地图引擎：** 经 Server 签名授权的百度 JSAPI 4.0，部署在独立 HTTPS Child Origin。Gallery Parent 仅负责可信 Owner 范围的聚合、选中区域和照片墙，不在 Gallery DOM 执行百度 SDK。
- **照片 GPS：** 原始 EXIF/数据库保持可信 WGS84；原生 JSAPI 相机严格标识 BD-09LL，不以 BD-09 边界冒充 WGS84 查询条件，更不能以网格中心冒充真实照片坐标。
- **地点和照片墙：** `/media/places/page`、Owner 原生 Cells 和 Server Range 保留。精确数量与 Viewer 使用相同受权 Server Range；不向 SDK 暴露原始媒体字节。
- **百度 Server AK：** 仅用于另行授权、审计且限额的 Server API（例如 WGS84 坐标转换），不是静态地图 AK，不负责加载底图。Browser AK 仅用于签名发布的 JSAPI 运行链路。
- **GeoNames：** 可选地名解析，不生成地图或替代底图。

## 放行与不可用状态

只有合法 Provider、`enabled=true`、`activation_state=authorized_signed_release` 和有效的独立 HTTPS Child Origin 同时通过后才允许初始化动态 SDK；后续 Child Session、Origin、CSP、Owner Access 和凭据隔离仍须逐项校验。

`server_release_blocked`、SDK 故障和 Child 失败时，显示“百度动态照片地图暂不可用；地点列表和照片墙仍可使用。”，提供诊断/重试。**不回退到静态 PNG、离线地图、同源原型地图或其他 Provider，不绕过 Server 签名放行。**

Desktop Electron file 页面不直接执行第三方地图 JS，只通过独立 HTTPS 安全窗口访问动态地图。

## 永久退役的接口与代码

- `GET /api/v1/media/places/baidu-static` 和 `GET /api/v1/media/places/map-provider`。
- `POST /api/v1/admin/services/baidu-map/verify`（旧静态 PNG 生效校验；JSAPI4 另有其专用检测和发布授权）。
- Desktop Agent `/v1/media/baidu-static`、`/v1/media/map-provider`、`/v1/cloud/admin-baidu-map/verify` 以及 IPC/Preload 对应接口。
- `internal/api/baidu_map.go`、`internal/api/admin_baidu_map_verify.go`、`MediaGalleryBaiduStaticMap.tsx`、`media-gallery-baidu-camera.ts` 及静态 WGS84 相机/视窗辅助。

管理员 Server AK 安全配置和揭示能力仍保留，以支持受控 **Server 坐标转换**。Browser AK 单独配置，保存成功不等于 JSAPI 已授权发布。

## 安全与测试

Web/Mobile Web/Desktop 共用 Gallery 逻辑与 Owner Range；所有地图临时查询须可取消且不影响持久任务。按 Server Owner/ACL、Consent/撤销和短期会话隔离处理，SDK 只存在于独立 Child。

回归测试覆盖拒绝放行、Child 加载失败、SDK 隔离、授权 Range、真实 0/0 GPS、旧接口不存在、不同账号切换及返回后状态恢复。

生产环境专属验收按用户决定跳过（未验收），不阻塞源码开发、CI 与 PR 合并；代码级安全和安全负例仍必须完整验证。

相关：`docs/gallery-places-jsapi4-operator-runbook.md`、`docs/gallery-places-ios27-roadmap.md`。
