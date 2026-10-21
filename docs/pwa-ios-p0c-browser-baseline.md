# xDrive · P0-C0 真实 Chromium PWA 启动 BEFORE 基线（不等于 iPhone）

日期：2026-10-21。继 P0-A 公共 App Shell 和 P0-B 历史 JS/CSS 兼容性工作之后，**本阶段只建立可重放的启动基线**，不改生产 SW、FileExplorer、Gallery、52px App Frame、HTTP 缓存或业务数据接口，不增加任何私人离线存储。

## 为什么只测量

此前的“6 个文件、2,491,727 字节”是某次生产构建预缓存资源的**构建字节数**，不是 iPhone 下载、FCP、p50/p95 或用户可交互时间；不可从构建体积外推出启动提速。没有 BEFORE 时不得盲目优化，更不能报告虚构 AFTER。

## 自动化测试

工作流：.github/workflows/pwa-ios-p0c-browser-baseline.yml。复用正式 web/dist、已有 desktop/scripts/pwa-browser-install-offline.cjs 中的真实 Chromium 和公开独立 loopback HTTP 模拟服务；设置 XD_PWA_P0C_BASELINE=1，新增 9 个互相隔离的真实 Chrome BrowserContext（每个浏览器缓存/SW 安装初态不同；非简单反复计同一页），固定 390×844、zh-CN、Android UA、Touch 模拟；不安装 iOS Home Screen App。

每个 Context 顺序采集：

1. 首次独立导航：既有 Files Hash URL 进入真实登录界面，记录 navigation time origin 起的“登录入口就绪”、浏览器 Paint Timing FCP、DOMContentLoaded、load、PerformanceResourceTiming 请求计数和 transferSize 估计，以及真实 LayoutShift PerformanceObserver CLS；**不**把等待 SW 安装的时间计入登录入口就绪。
2. Service Worker 确认获得 controller 后重新加载同一页面，采集 warm。
3. 断开 loopback 根导航真实网络传输（不是 navigator.onLine 模拟），再次加载，验证登录 App Shell 与原 Hash 可恢复、controller 保留，并用已有严格公共 CacheStorage 白名单排除 API、令牌、原件、下载票据和媒体，采集 offline。
4. 每次都恢复网络并销毁独立 BrowserContext；任何 FCP 缺失、NaN、样本不足、SW 未控制或缓存私有请求一律失败，不能将缺失值填 0。

保存 JSON：每阶段 n=9 的 raw numerical samples 和插值 p50/p95/min/max、Chromium 版本、准确代码 SHA，以及明确的 NOT-iOS、NOT-100k、NOT-user-data 标志。采集请求数量是 Performance API 资源条目+主导航；transferSize 包括浏览器缓存/SW 行为的估计，**不是实际网络 Wire Byte**，更不是服务端流量或内存测试。不会输出来源 URL、文件名、密码、JWT/Cookie、目录元数据。真实浏览器渲染成功但无物理设备不代表真机验收。

## 性能门槛与后续

该 PR 是 **BEFORE instrument/baseline**：不会声称任何 p50/p95 实测值，直到准确 HEAD CI 产生可核查的 summary.json；本轮也没有进行生产代码的 AFTER 优化。后续仅在相同浏览器二进制、同等硬件/网络/数据集上配对复测，且有显著收益与无内存/错误率回退才保留。真实 iOS Safari/Home Screen 飞行模式、Files/Gallery 多次路径切换布局、100k 混合照片/视频/Live 场景和大文件传输另做物理专项，不以这 9 个公开登录页替代。

生产专属网络安全验收按用户决定跳过（未验收），不请求生产账号、HAR、AK、凭证或人工生产验收；代码级权限、隐私负例与 GitHub CI 仍必须通过。完整 master AGENTS.md 现有先基线→优化→同条件复测政策无需重复或重写。

### 首轮 Chromium 专项 RED 与修复

首次准确 HEAD `f4ca6db` 专项 [CI #39556855845](https://github.com/lazyxu/xdrive/actions/runs/39556855845) 中，Node 数值负例测试和正式 Web 生产构建通过，原有 S2B1 双视口离线/缓存断言通过；但新增 n=9 采样在 offline 重载 DOM 登录入口刚变得可见时立即读 PaintTiming，Chrome 尚未写入 FCP，得到 `null` 而严格失败。保留 RED 证据，绝不把缺测 FCP 代成 0。本次仅调整真实浏览器采集顺序：在看到登录入口时先取 `observedReadyMs`，再异步等待浏览器实际 first-contentful-paint 条目，最后读取同一次 navigation 的其余性能数据。仍需新准确 HEAD 的真实 Chrome 和全 CI 验证；不能根据上一红灯声称浏览器 FPS/性能优化成功。
