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


## M01–M16 全项整合进度（同一 PR，2026-11-14）

以下是代码实现候选，不代表 Apple Photos 逐帧 1:1 验收通过。

| 任务 | 当前代码实现 | 尚待证明的边界 |
| --- | --- | --- |
| M01 云端变更 | 前台无地点 Sheet 时每 30s 重新枚举当前 Owner 来源，最终核对后一次发布 Marker；过时请求取消 | 是定期刷新而非实时 SSE |
| M02 来源状态 | both 重新校验 Node/内容；localOnly 点击前重算离线原件 SHA 并向当前 Owner exactMatches 取得 unmatched；cloudOnly 复用完整库 epoch 证明并读当前 Node | iCloud-only 原件暂不可读时拒绝负向证明 |
| M03 10万缩放 | 完整来源扫描后只保留临时 GPS 与经授权分页游标/页内序号；缩放本地重聚合并最多重读 64 个代表页 | 初始扫描与真实 100k iPhone FPS/耗时尚未验证 |
| M04 双向滚动 | 两个不超过 48 行窗口，保存无媒体 ID 的来源游标历史，向前/向后重新核验，保留可见锚点 | 尚无真实帧级无跳动证据 |
| M05 地点 Viewer | 同 GPS Cell/筛选来源相邻页、48px 缩略图导航；每次切图前重新核验 | 真机视频/Live/图片切换尚未验证 |
| M06 大型旅行 | **已经在 master 存在**：65+ 地点聚合区域、按视口重新请求，聚合区域不能直接当照片 Range | 真实 100k 旅行缩放体验仍未验证 |
| M07 底图 | 统一来源改为原生 MKMapView，标准/卫星切换 | 尚无同设备 Apple Photos 像素比较 |
| M08 我的定位 | 复用明确点击才调用的 CoreLocation 控制器、定位点与失败提示 | GPS/权限真实设备未验证 |
| M09 地图日期 | 最近7/30天、指定天/月/年、全部日期、恢复图库原筛选；重新核验 Owner 时间线 | UI 真机验收待做 |
| M10 网络故障 | MKMapViewDelegate 瓦片失败与恢复状态，和照片来源权限分开 | 真实弱网与断网验证待做 |
| M11 精确视野 | 用完整已证 GPS 坐标而非最多64代表点计算跨日期线短弧 | 复杂极区实机视野待做 |
| M12 封面并发 | 云端最多 3 个并发缩略图；本机128px渐进海报；旧世代回调拒绝 | 下载耗时/内存待测 |
| M13 地点名称 | 用户打开地点时短期 Apple CLGeocoder 解析 locality；不缓存、不做权限证据 | 网络不可用时保持原地点标题 |
| M14 附近排序 | 完整已证 GPS 样本按球面距离有序；分页每行重新核对精确来源 | 首次完整扫描必须成功 |
| M15 相机恢复 | 保存当前 Owner 会话的相机，Owner/照片库变化即清空 | 未跨进程持久化，避免无加密私密 GPS |
| M16 系统交互 | 真实 UIKit MKMapView/AnnotationView、系统手势、同步拒绝旧点击与 VoiceOver | Apple Photos 私有动画参数/像素无法直接保证相同 |

### 合并门槛
- 新增 12 组 Node 代码契约于 desktop/tests/ios-native-unified-map-m01-m16.cjs，同时更新 G01–G07 原测试到真实 UIKit MapKit。
- 以最新 HEAD 运行完整 CI、unsigned IPA、iOS Simulator 地图/图库导航、Owner 权限/撤销、相关 Final Gate。源码测试不能代替真实运行。
- #4305/#4351/#4357/#4344 相关在途 PR 有重叠展示组件或独立门禁；整合时必须保留差异和对应测试，不能盲目关闭或宣称已合入。
- Apple Photos 与 xDrive 同设备同相册 60/120Hz 截帧对比、真实 iCloud-only、真实10万照片设备耗时：跳过（未验收），不得伪造性能数值。
