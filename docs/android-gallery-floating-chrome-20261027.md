# Android Gallery 原生双层悬浮 Dock · 2026-10-27

## 基准与问题

当前真实 iOS PWA 在 `ui/shared/src/mui/MobileGalleryChrome.tsx` 使用固定悬浮的「年 / 月 / 全部」时间胶囊和独立的「图库 / 精选集 / 搜索」主 Dock。此前 Android 已具备对应的真实 Owner 功能和两层按钮，但把两行排在照片墙**下面**，永久压缩可滚动照片的空间，不是 iOS 27 全屏图库体验。

## 本次变化

- 同一个原生 `LazyVerticalGrid` 与完整 Owner Range 仍用于图库、相册、搜索、日期定位和 Viewer；没有第二个媒体 API/索引/Writer。
- 将两层现有 Compose Dock 放在照片墙 `BoxWithConstraints` 内部的 **BottomCenter 覆盖层**，而不是照片墙外的固定占位行。保留 Android 系统导航安全区、两个可操作的胶囊及无索引不显示假年月选项的逻辑。
- 可信服务端时间组存在且采用拍摄时间升序时，在网格底部保留 144dp 可滚动净空；没有时间组则保留 88dp。稀疏最新页的上方留白也按相同净空扣除，保证最后一张照片不会被悬浮导航压住。
- 既有 `gallery-grid`、`gallery-bottom-dock`、`gallery-time-dock` 等可访问性标识保留。

## 验证

新增独立 API35 Compose `GalleryFloatingChromeLayoutTest`，检查真实屏幕坐标：时间胶囊与主 Dock 都处于图库墙内部，时间胶囊在主 Dock 上方，最后一张图片保持可见；无服务端时间索引时仅保留真正的主 Dock。还需要准确 HEAD 的 Android Native 编译、Lint、APK、API35 和仓库要求的 CI 实际执行，不能把仅提交的测试算作通过。

实际 Android/iOS 27 的 375/390px 多尺寸、深色/浅色、横屏、大字体、TalkBack、手势及不同 OEM 系统导航栏仍为 **跳过（未验收）**。这不等于物理 1:1 已达标。

其它剩余项：图库排序/批量选择/导出、照片地图/地点/人物/宠物、相册写操作、持久传输队列和可公开稳定签名 APK，保持独立真实功能项目；不显示假按钮。

## 与 #2853 图库排序的兼容

延续四种真实 Owner 排序，仅在拍摄时间升序且服务端时间索引可用时显示年月胶囊。加入时间排序或拍摄时间倒序时只保留真实主导航与滑动净空，禁止虚假日期跳转。新增 API35 Compose 非时间排序几何断言。准确 HEAD 的编译/模拟器/保护检查未执行前，不视为通过。
