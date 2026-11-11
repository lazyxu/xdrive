# iOS 原生相册地图：#4267 合入后的剩余差距与验证矩阵（2026-11-11）

## 口径和基线

- 源码审计基线：`master@ad5f0e251164f4770bdc8bb1e974efdec643e4f2`（2026-11-11）；本审计的两个新修复须以其新 PR 的准确 HEAD 验证，不认为已经合入。
- 已合入、**不得重复实现**：#4267 的 1/10/1k/10k/100k 合成 GPS 数量守恒、64/65 与日期线策略、Owner 旧 Range 负例、真实 MapKit Full Access + fixture 地点照片墙、统一图库 **本机** 文件名/媒体/日期过滤、合成 P50/P95；#4277 的统一图库“显示地图”及返回保留；既有日期/年份、地图类型、用户主动定位、附近照片、Viewer GPS 入口、地点 Sheet。上述测试不能替代实体设备/跨账户/像素验收。
- 目标参照：Apple iOS 27《按位置浏览照片和视频》：https://support.apple.com/zh-cn/guide/iphone/iph390138909/ios 。官方明确包括图库→显示地图、地图聚合照片、照片资料里的位置/附近照片、最近的日子/旅程精选集→显示地图。参照《按日期查找照片和视频》：https://support.apple.com/guide/iphone/find-photos-and-videos-by-date-iph0ea0234e0/27/ios/27 。
- “未实现”与“有代码但缺真机/运行时证据”严格区分；不可触及的真实设备和生产账户验收标记 **跳过（未验收）**，不伪造结果，也不阻塞可控源码/CI 修复。

## 仅剩缺口

| ID | 优先级 | 具体缺口 | 状态/达标证据 |
| --- | --- | --- | --- |
| M01 | P0 | 有界重扫失败后旧 GPS 封面可能恢复点击/VoiceOver 可操作，授权在失败间隙被撤销时仍可能显示旧封面 | **本修复 PR 修改中**：失败保留旧画布但永久冻结旧选择租约，`.readWrite` 非 Full Access 时立即清除；需要准确 HEAD CI 与运行时故障注入 |
| M02 | P0 | 世界概览/上一视窗在快速深缩放后，900ms 细化等待期的旧 Cell 数量可能仍可打开 | **本修复 PR 修改中**：细化条件满足时旧 Cell 禁止点击，直到当前 PhotoKit 快照完成；需真实 MapKit 放大/点击边界测试 |
| M03 | P0 | 1/10/1k/10k/100k、相同 GPS、跨日期线/极点、64/65+ 地点的 **真实 PhotoKit/Server 运行时** 计数、定位与成员精确性 | 已有合成 Swift 基准；仍无真实 10k/100k 设备/Server 全套一一对应证据；设备场景跳过（未验收） |
| M04 | P0 | 真实 Owner A/B 频繁切换、401/403、撤销、旧标记、旧缩略图、延迟 Range、断网恢复及双地图源切换的联合 E2E | 已有生产保护和源码负例，缺连续运行期注入、旧像素帧与旧 Cell 点击的联动证据 |
| M05 | P0 | PhotoKit Full/Limited/Denied/撤销及前后台/设置返回的完整运行时状态矩阵；仅 Full Access 可以进行位置扫描 | 主路径真实模拟器已通过；多次中途撤权/扫描失败/Sheet 遮盖、原生权限切换组合尚未验收 |
| M06 | P0 | 地图照片墙→Viewer→地图/相册的极快速手势/切页/退出返回的零空白、无错身份帧 | 真实模拟器已有正常导航案例，但缺高速复现与真实 60/120Hz 逐帧、可验证返回滚动锚点 |
| M07 | P1 | 统一图库“两端都有/仅本机/仅云端/待核验”来源谓词对应的完全精确地图成员集 | `NativeUnifiedPhotoGallery.swift` 明确禁用，而不是偷偷放宽；须实现可信原件身份配对与一致计数 |
| M08 | P1 | 云端 Owner 地图的文件名、照片/视频/Live 类型及跨来源复合筛选 | 本机 PhotoKit 已支持；`NativeOwnerPhotoMapGallery.swift` 云端仅有签名 Owner/日期范围，目前禁用无法精确表达的谓词；需 Server 可信 Range/overview API 与 UI |
| M09 | P1 | 最近的日子、本机旅程精选集的真实照片成员与“更多→显示地图→附近照片→Viewer→返回”一致性 | 现有日期/年范围不是 Apple 精选集成员，不能以日期窗代替精确照片 ID 集合；需本机可信成员模型 |
| M10 | P1 | 云端旅程稳定成员集合跨城市、同日异地、时区/DST、编辑/删除/修复后版本一致性 | 有 `trip:v2` 与独立 `NativeExactTripMap`；#2208 B2 精确成员/共享导航及复杂组合仍需验收和完善 |
| M11 | P1 | Apple Photos 可见 UI 的像素、Marker 封面、数量角标、聚合/选中态、控件顺序、Sheet 高度/拖拽与动效 1:1 | 尚无相同真实媒体/设备/系统版本的成对截图、布局逐像素与完整帧动画对照，不宣称已经 1:1 |
| M12 | P1 | iCloud-only HEIC/Live Photo、视频首帧/超长视频、缩略图失败重试、后台恢复和资源释放 | 存在原生缩略图/降级与重试路径；缺真实混合媒体、网络切换下的播放/封面/Viewer 端到端 |
| M13 | P1 | 100k 照片真实首次扫描与复用缓存的 P50/P95、CPU/RSS、FPS、首帧响应、快速缩放/取消/重入 | 5 次合成 SpatialIndex 基准已合入；真实 PhotoKit 100k 与硬件帧率/内存还未测量 |
| M14 | P1 | iPad/横屏、多窗口、深浅色、VoiceOver、Dynamic Type、辅助访问控件焦点顺序及完整触控尺寸 | 源码支持部分系统能力，真实 iPad/辅助功能成对 UI 与操作流程尚未全覆盖 |
| M15 | P2 | 无网络/Maps 底图错误、无法定位、地图瓦片恢复、地理极端值和超时重试 | 目前有权限/过期保护，但地图 Provider 离线/错误/重连的受控模拟器全过程尚未证明 |
| M16 | P2 | 图库任意多年/开放日期区间地图映射 | 统一图库地图日期窗口最多 370 天；Apple Photos 可跨年浏览与精选；需要设计跨度更大的精确 Owner/PhotoKit 过滤，不能静默扩大 Server 访问 |
| M17 | P2 | 首页与“排序和筛选→显示地图”实际入口手势/层级对照 | 已有“搜索与筛选→显示地图”可用入口；尚未证明与 iOS 27 系统可见菜单顺序、返回层级一致 |

## 本次优先实现范围（不建立第二套地图）

- 修复 M01：`scanFullLibrary(preserveCurrentMap: true)` 异常后不将 `globalCameraMoving` 恢复为 `false`；授权非 Full Access 时清除所有先前封面/相机/缓存。MapKit 视图可以留存，但用户不可点击旧照片。
- 修复 M02：`refinedViewportIsCurrent` 除了已完成和视窗包含，还校验 `shouldRefine`；深度缩放后的聚合必须等新的有界 PhotoKit 计数。初始未回调的原始世界概览仍可打开。
- 扩展现有 `desktop/tests/ios-native-photo-map-auto-refine.cjs` 源码回归，要求新旧 Cell 选择权失败即撤销、Full Access 撤销即清空、细化前不可交互。
- 合入门禁：本 PR **准确 HEAD** 主 CI / Final Gate、iOS IPA、强制真实 `candidate-mapkit`、Gallery/Files 相关 Simulator 和 b9（若触发）通过；CI 尚未完成前不得改成已验收。物理 iPhone/iPad、生产 Owner/iCloud/100k 标记跳过（未验收）。
