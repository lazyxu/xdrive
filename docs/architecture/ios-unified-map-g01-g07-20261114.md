# iOS 统一图库来源地图：G01–G07 单 PR 修复候选（2026-11-14）

## 边界与准确口径

基线 `master@c511f73ebac0ef3ee3517c1dd3c89a9cad2c73a7`。不替换已合入的本机 MapKit/PhotoKit、Owner 地图、Trip v2 或云端 Reader；不新增备份、上传、写入或扩大 Owner ACL。下面是**代码候选**，不是 Apple Photos 逐帧 1:1 或实机验收结果。

| 项 | 本 PR 的实现 | 验证与剩余限制 |
| --- | --- | --- |
| G01 P0 动态聚合 | 取消全局 8×8 静态桶；当前 MapKit 摄像机变化即使旧 pin 失效，静止 900ms 后用**同一已核验来源 Timeline** + 本机已有 64-cell 自适应空间网格完整重扫；新计数和 Member cursor 完成后一次发布 | 无旧桶数字按视口拆分；真实 Owner+100k 性能及连续手势仍未验收；最多 10k 个 48-item 结果页 |
| G02 P0 点击实时复核 | 地点墙每次触摸重新读取本机 PHAsset 当前 GPS/种类/Live/拍摄及修改日期/文件名；对「两端都有」还通过当前 Owner 重新读取并核对匹配的云端 Node（ID/revision/content identity），对仅云端照片实时检查 Node GPS 和 query，失败阻止 Viewer | 仅当前授权、当前窗口的唯一成员可打开；仍需生产 Owner 403/修订并发 E2E |
| G03 P1 Marker | 与本机/云端 MapKit 共用 `NativeMapMarkerVisualPolicy` 的 68pt frame、64pt cover、33×28 count badge、圆角/偏移/选中描边。仅允许 PhotoKit 请求 128px iCloud 缩略图（不取原件），支持 degraded→final 渐进图与失败保持已有海报；Owner 令牌读取云端封面，并在 scope 变化取消 | 实际同 iOS 系统截图/动画/聚合过渡未逐像素核验 |
| G04 P1 相机 | 首次完整已验证的 GPS Marker 代表点计算最短经线包围弧（支持 ±180°）与纬度范围，自动定位一次；后续用户 pan/pinch 保留相机，不因服务端响应而自动重置 | 需真实经纬度分布、横竖屏和 MapKit 行为验证 |
| G05 P1 地点照片墙 | 引入与现有 #4351 同形的共用 SectionList / DisplayMenu，时间分组、密度、裁切共用展示；滚动返回必须处于当前两窗、唯一且已验证 ID；48-item cursor 不越权 | 与 #4351 待合入共用文件可能存在文本冲突，需要保全两者代码与测试 |
| G06 P1 附近照片 | 地点 Sheet 按当前 GPS Cell 中心展开有界附近视口，在**原 Owner / presence / query / Full PhotoKit / library epoch**下单独连续检索；不借用全 Owner 未筛选图库 | 附近集合总数只以真实已加载/验证成员为准，不用原地点 count 冒充 |
| G07 P1 本机离线浏览 | 来源 == 仅本机且无 Owner 时，以原生已授权 PhotoKit MapKit 路由显示本机照片，同时明确提示“云端缺失未经验证”；有 Owner 的“仅本机”等来源身份继续走确切配对源地图 | 未登录不可虚构 `localOnly` 负向云端证明，混合/仅云端仍需真实 Owner |

## 运行时拒绝条件

- 任一 PhotoKit Full Access、library epoch、当前 Owner 或认证失败即隐藏旧图/停止选取，不调用 original writer 或上传。
- MapKit pinch/pan 后旧 pin 与 cover 立即撤租，不等待 900ms 扫描/网络完成。
- 时间/日期分组是 presentation-only，不扩大云端 Range 或本机 scan。
- 新 Viewer 仅在点击前重新核对实体 PHAsset 或当前 Owner Node，且该成员仍唯一存在于本次 48-item 页窗口时出现。
- 10k 页为已有全源地图的保守上限；附近墙和原地点墙不会再错误终止于 256 页空白跨度。仍可能在 10k 页真实上限处严格失败而非伪造数量。

## 测试与合入门槛

- 新增 `desktop/tests/ios-native-unified-map-seven-parity.cjs` 八项源代码边界测试，要求七个 G01–G07 实际接线、Owner/PhotoKit 失败关闭逻辑。
- 新增 `ios/tests/NativeUnifiedMapCameraPolicyChecks.swift` Foundation-only 日期线/自动视野测试，可在 Linux swiftc 中编译运行。
- 更新既有 `ios-native-map-five-feature-gaps`、`ios-native-unified-gallery-map-entry`、`ios-native-map-one-pr-scope` 的过时源码断言，保留安全校验，不因重构直接跳过。
- 本 PR 为 Draft；必须获得当前准确 HEAD 的 iOS Xcode/unsigned IPA、全部关联 Simulator、全套 CI/Final Gate 才能作为合入候选。仅源码、Swift policy 或旧 SHA 绿色**不等于验收通过**。
- 真正同一部 iPhone/iPad 系统照片 App 的 60/120Hz 逐帧、像素、真实 iCloud 和 10万张照片实际运行，若不可用应标为“跳过（未验收）”，不能作为已达 1:1 的证明。

## 与其它进行中 PR 的关系

- 本 PR 从 master 独立，不修改已经启动 CI 的 #4305（六项 P0）、#4351（共用照片墙）、#4344（100k 性能）或 #4355（稀疏来源地图）HEAD。
- 本 PR 自身包含 G01–G07，并覆盖 #4355 中的 256 页稀疏范围/失效 Owner 屏蔽问题；等本 PR 验证后再按真实 diff 处理重复 PR，避免提前删除正在验证的工作。
