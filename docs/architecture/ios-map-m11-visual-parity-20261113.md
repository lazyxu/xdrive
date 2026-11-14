# M11 MapKit 原生视觉一致性 / Pixel parity

本 PR 将 **本机 PhotoKit MapKit** 与 **Owner 云端 MapKit** 的可见 pin 缩略图、边框、角标数字以及可点击区域统一到一个只做展示的 Swift UIKit geometry policy，保持现有 PhotoKit Full Access / Owner 授权和源内缩略图取消逻辑。

**可自动证明的部分**：本机与云端 marker 的 frame/centerOffset/照片裁切/角标尺寸、字重和 999+ 显示一致；Node 源码回归确保不再使用两套裸 CGRect。不得把这些源码比较称为 Apple Photos 原生 UI 逐像素相同。

**仍需提供真实证据才可验收 M11**：在相同 iOS 版本、设备型号、缩放/动态字体下采集 Apple Photos 与 xDrive 的同坐标截屏，对 1 张、多个聚合、选中态、标准/卫星底图、Sheet medium/large、拖动阻尼、Viewer 返回动画逐帧比较；差异图与实测尺寸进入 artifact。系统级动画与 Apple 私有 UI 参数没有公开基准时，不能宣称 1:1。未提供配对原生截图，因此目前标记为**未完成像素验收**。

## 可执行的真实逐像素对照工具

macOS（Xcode Command Line Tools）执行：

```bash
swiftc -framework AppKit ios/scripts/compare-native-map-pixels.swift -o /tmp/m11-pixel-audit
/tmp/m11-pixel-audit apple-crop.png xdrive-crop.png diff.png summary.json 0.02 0.01
```

仅接受尺寸完全相同、设备/OS/比例一致的 PNG 裁切区域；严格校验参数、RGBA 像素差，生成红色差异图和 JSON。比较会根据给定阈值**确实失败**，缺 Apple 参考截图时没有默认通过。参照样本应包括聚合徽章、选中态、Sheet 中/大高度、暗色模式和过渡动画选帧。照片主体不应计入 UI 色彩误差，原件不写入仓库。
