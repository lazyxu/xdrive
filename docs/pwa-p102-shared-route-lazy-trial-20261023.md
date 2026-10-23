# PWA P1-02 · 共享路由动态分包试验（2026-10-23）

候选仅将 Files、Gallery 和三个管理员 Web 展示组件改成 React.lazy 动态入口；共用认证/路由/Owner API、Viewer、Task Center、Mobile App Frame 52px、虚拟列表及后端 Range 原样保留。Gallery wrapper 直接引用唯一共享 MUI MediaGalleryPage，不复制实现。

此 PR 只做 **同一 Runner 两次独立源码构建** 的生产 Vite 静态依赖 graph raw/gzip 早期筛选，不以编译成功、entry gzip 下降或当前公共 login UI 速度提升推断 100k 性能改善。接受生产之前还必须与 #2403 的真实宽度 n3 冷/热配对基线比较，并在真实 Go/PG17/CAS 上运行 100k Files/Gallery、Viewer 打开/返回、弱网动态模块失败与 899/900 断点的源码准确 E2E。

重要：Suspense 仅保留工作区主容器原有高度，不增加第二滚动容器、不引入 Loading Spinner。仍须证明首次 lazy chunk 到达前不会出现违反 P78 的白屏/闪烁；若不能证明，保留 Draft 并修改导航延迟提交/预热策略，不能仅以 JS gzip 节省为理由合并。

不会让私人 API/照片/视频进入公共 Service Worker，旧 hashed 静态归档保持 append-only，safe_to_auto_delete=false。生产安全不可触达验收按用户决定跳过（未验收），代码级 Owner/ACL/撤权不可跳过；真实 iOS/Android NOT RUN。
