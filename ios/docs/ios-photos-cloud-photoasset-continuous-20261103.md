# iOS 原生云端 PhotoAsset 连续照片墙（2026-11-03）

## 适用范围

仅改 iOS 原生 Server PhotoAsset 的三类共用照片墙：全部云端媒体、云端相簿成员、地图地点照片。保留五模块、搜索、密度缩放、已验证 Owner 与 Server API。**不改变** Server、备份、CAS、同步账本、Web/Android/DSM，也不修改正在排队的本机 PhotoKit PR #3670 HEAD。

## 用户交互合同

- 统一连续滚动，无上一页、下一页、每页数字或加载更多按钮。
- 保留方形缩略图、视频/Live 标识、3 档密度与双指缩放；加载中等尺寸占位。
- 只为可见的 48 项范围发起 Owner 验证的 API 读取；SwiftUI 离屏时取消读者和缩略图，绝不生成全库媒体数组。
- Viewer 打开时先采纳当前独立验证的范围、读者、Owner、Node ID 和 revision；跨 48 项仍重新读取并对比旧范围，再校验新范围。
- Viewer 返回先定位数字范围，然后根据 Node ID + revision 复核并恢复缩略图及 VoiceOver 焦点，不把旧 Owner 的焦点给新账户。
- Owner 撤销、权限失效、范围数据无效或相邻范围重复 Node ID 时终止当前墙并要求刷新；暂时性网络故障允许单个范围显式重试。
- 总数改变、相邻范围重叠时不默默拼接不同 Server 视图；已有 Server API 没有固定快照游标，无法保证后台并发插入期间完全不重排。

## 验证

- 现有 ios-native-photoasset-gallery.cjs 新增连续网格与边界测试，覆盖按需读取、独立缩略图读者、相邻去重、Owner 失效、Viewer 锚恢复。
- 现有 photoasset-wall-density、thumbnail-state、viewer-neighbors、viewer-adjacent-range 源码契约随网格布局同步更新，但原来的鉴权、revision、跨页 Viewer 约束保留。
- 在已有 iOS Native Unsigned IPA 专项中增加 thumbnail-state 检查。
- 必须通过准确 PR HEAD 的 macOS Xcode IPA、适用 CI、Final Gate 和 GitHub 合并保护规则；iPhone 真机/10 万照片/短横屏/弱网/Owner 切换需补充现场验收。

## 后续任务

“云端备份原件”是 Owner 根目录文件筛选，不是 PhotoAsset；其 48 节点扫描另行改造。本机 PhotoKit 连续滚动归 PR #3670 单独验证。
