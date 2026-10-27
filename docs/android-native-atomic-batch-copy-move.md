# Android Files 原子批量复制/移动 · iOS PWA parity · 2026-10-27

## 本次源码范围

- 直接扩展 Android 已有的“选择（最多 200 项）”和 **同一个 Owner 目标文件夹选择器**，提供“复制到…”和“移动到…”。可复用 List/Grid 两种呈现；每次 Source Snapshot 只来自当前账号已加载、已验证、同一目录的当前 Node 列表（ID + revision）。
- 后端 **已经存在** 两个 Go 原子事务接口：`POST /api/v1/nodes/batch/copy` 与 `POST /api/v1/nodes/batch/move`，输入 `{"items":[{"id":7,"revision":2},...],"parent_id":9}`。移动是整体成功或回滚；复制由服务端生成合法新文件名。Android 没有循环 200 次调用 `copyNode/moveNode`，没有独立上传器和本地数据索引。
- Android Core 拒绝空集合、超过 200、重复 ID、无 revision、危险自目标；每次仅发送 **一次** JWT/Owner 原子请求。回执要求非空 operation_id、条目数量与顺序一致、无重复、目标 parent/type/size 一致；copy 必须为新 Node ID，move 必须原 Node ID、名称、版本上升。响应不可信时 fail closed。
- 同一份 Folder Picker 只列来自 `root`/`children` 的 Owner 验证目录，不允许复制或移动已选文件夹到自身、直接选择自身目录或其子孙；Go Server 仍最终验证祖先/受管目标/冲突。
- 复制目录子树可能超过普通 JSON 的 30 秒总调用时限；批量提交使用现有 pinned Owner Client 的长操作模式（10 分钟读取空闲上限，仍保留取消、Owner/TLS/SNI、禁重定向和禁自动重试），避免假超时导致不确定 ACK。绝不另建无期限后台写入器。
- 在点击确认之后不做 Token refresh 自动重试。因网络中断、丢 ACK、返回体异常而结果不确定时，禁用再提交并要求“取消并刷新原目录”；不得凭错误状态重播写入或宣称事务成功。只有真实 ACK 才更新临时列表，再用 GET 刷新；GET 失败仍保留已提交提示。
- 单项复制/移动、200 项批量 Trash、Recent/Favorites/Search 只读选择、PDF/Audio/Media Viewer 和各种文件加载路径保持原实现；批量选择的“复制/移动”从选中栏进入，并与原有单项操作、下载、收藏分离。

## 验证边界

MockWebServer Core 测试：真实 Bearer POST/JSON、操作结果字段/版本/重复/缺项拒绝；Controller JVM：已选 Owner 行快照、目标目录、单笔事务、同父移动拒绝、丢 ACK 冻结和取消保持选择；API35 原生 Compose：两项复制、两项移动、同父禁用、目标从实际 Server 子目录读取，并验证只有一笔物理请求。

该文件描述的是待测 **源码候选，不是发布/合并已完成事实**。Android Kotlin、JVM、Lint、Debug APK、API35 Compose 和实际 GitHub 保护仍需要准确提交验证。真实手机、生产身份凭证、100k 混合目录吞吐与 iOS 1:1 像素差异按项目策略记录为 **跳过（未验收）**，不当作源码开发阻塞或假装通过。完整排序/分组、批量下载和可靠后台传输另行验收。
