# iOS 原生相册地图：十项差距，一个 PR（2026-11-11）

唯一实施入口：既有 SwiftUI/MapKit/PhotoKit 原生地图 PR #4267。此 PR 不是第二套地图，亦不修改安全/授权规则。

| 目标 | 本 PR 实际改动 / 已有保护 | 未验收事项 |
| --- | --- | --- |
| GPS 1/10/1k/10k/100k、64/65、相同地点/多城市/跨 180° | Swift 索引重新构造独立 Cell 成员数量并验证守恒；Owner 签名范围数量严格一致 | 真实 iPhone 100k PhotoKit 与 Server 100k |
| Owner/Photos 撤权、401/403、旧标记和慢请求 | 保留已有读权限、Owner、旧视窗、取消和图片降级；新增旧 Range 数量反例 | 双账户故障注入和重连模拟器 E2E |
| 统一图库按来源/文件名/类型/日期 | 新增本机照片文件名 + 类型 + 日期一致的地图/Sheet/Viewer PhotoKit 再核验；云端和两端身份筛选不支持时仍禁止显示错误集合 | 跨端来源匹配、云端按文件名和类型的原生精确授权查询 |
| 本机最近日子/旅行 | 现有本机最近 7/30 天范围及 Owner trip:v2 | Apple 私有旅行自动推断和真机对照 |
| 视觉 1:1 | 添加真实 MapKit 地点 Marker、Sheet、横屏截图证据 | Apple Photos 像素、布局、交互逐帧对照 |
| 地图/Sheet/Viewer 往返 | XCUITest 真实 pan/pinch、Sheet/Viewer/地图回退 | 高速连续手势无闪烁帧采样 |
| iCloud/HEIC/Live/视频、弱网 | 保留原生 thumbnail、权限撤销和失败路径 | 真 iCloud/视频/弱网组合 |
| 100k 性能 | 增加各规模合成 SpatialIndex 5 次 P50/P95；既有 100k 与 RSS | iPhone 真实图库 CPU/RSS/首屏/FPS |
| VoiceOver/Dynamic Type/iPad/深浅色 | 保留原生 AX、SwiftUI 动态排版、已有横屏与暗色 XCUITest | 真实 VoiceOver/iPad 与系统视觉基准 |
| 离线、极地、进退和超时 | 现有 WGS84、国际日期变更线、MapKit 取消/旧 Marker 失效保护 | 离线底图及交互压力验收 |

**真实已复现失败**：iOS 18.5 新建/抹除模拟器导入两张测试 JPEG 后全库仍含 7 张 GPS、6 地点。不能把真实全库硬断言为 2；应记录真实全库数量，同时保留**确切两张测试图片同一位置的 Marker 和地点墙→Viewer→返回**要求。

状态一律区分代码已提交、源码契约、合成策略、准确 HEAD IPA、真实 XCUITest 和真机。未取得真机、Apple 原生视觉、iCloud-only、100k 真实图库时：**跳过（未验收）**。不因源码或合成测试通过就宣称全部修复。
