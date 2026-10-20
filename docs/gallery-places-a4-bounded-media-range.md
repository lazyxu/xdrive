# P0-Places-A4 · 同一媒体 Range 的附近照片（2026-10-20）

在图库 → 地点 → 地图选择具有真实 GPS 的地点，选择 1/5/25/100km，点击 **查看附近照片**；放大静态地图至纬度和经度范围均 ≤20° 时可点击 **当前地图范围照片**。Web/Mobile Web/PWA/Desktop 使用同一个 MUI 地图和同一个 Owner-authenticated `GET /api/v1/media/items?range=true`、Gallery VirtualCollection、缩略图与 Viewer；没有第二个媒体列表或地图 Provider。

Server `nearby=lat,lon,radiusKm`（0.1–200km）采用真实来源 WGS84 及 SQL bbox 粗筛 + Haversine 球面距离精筛；`bbox=west,south,east,north` 最大20°×20°，支持日期变更线。拒绝 NaN/Inf、过大面积、未授权/重复/不完整参数；`total_count` 与分页/anchor 都由同一 Owner+PhotoAsset+Node+MediaMetadata+现有媒体 Range 过滤完成，不拿网格中心、当前页条数、BD09 反推做统计。其它时间、相册条件继续可交集。Web 和 Desktop Agent 使用相同查询字段及各自原有 AbortSignal→Go Context 取消链路。

GPS 只在当前登录用户与 Server 间作为原始媒体查询使用，不对百度发送坐标或 AK；JSAPI 4.0 失败时也可在已索引 GPS 上用原生媒体 Range 返回结果。完整 iOS27 1:1、Android/桌面真机、真实百度许可/HAR、100k 物理性能尚未验收，不得从单测推断通过。下一阶段 B1→B2→B3→C1。

**Desktop transport parity fix:** Electron Main's `normalizeMediaGalleryQuery` preserves and validates `nearby/bbox` before forwarding to Agent. Missing this fix silently strips filters and displays all Owner photos. Preload query contracts, Agent HTTP filter, Go Client and Server SQL all carry the same bounds; malformed/multiple modes fail closed. Node regression asserts exact main-process boundary.

**Native 视窗防误选：** JSAPI4 动态地图的原生平移/缩放是 BD-09；静态地图最后一次估算的 WGS84 范围不等于动态视窗，故动态地图加载成功时禁用「当前地图范围照片」，防止错误范围/计数。A4 仍可通过真实样本 GPS + 半径使用附近照片；静态百度地图可使用 WGS84 bbox。保留现有日期、搜索、收藏等 Gallery 筛选交集，进入新范围时仅清除旧地点网格 ID。此限制在真正完成独立审核的原始 WGS84 动态视窗桥接之前不得移除。
