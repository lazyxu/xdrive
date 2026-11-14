# M14 iOS MapKit iPad/无障碍布局回归

本 PR 修改已存在的原生地图/Trips 年份栏，统一 44pt 可触控下限、iPad Split View / Landscape 有效 viewport 判断与对应 Swift + Node 回归。PhotoKit 的 Full Access 和 Owner 授权逻辑均不变。导航不因旋转或字体调整重建图片标识。

**已加入自动测试**：iPhone 竖屏/横屏、iPad 全屏与 507pt 分屏数学输入、无效尺寸、Dynamic Type 不进入紧凑信息模式、Trips 年份按钮 >=44pt、缩放旧标记不能 VoiceOver 选中。

**尚待设备实测**：iPad 分屏/多窗口真正 UIKit 场景、真实 VoiceOver 焦点顺序、AX 放大字号、暗色背景下缩略图对比度、实际 hit-test 触控热区、旋转前后 Sheet 位置与 Viewer 返回截图。不能将源代码/几何测试写成“实机已全部通过”。
