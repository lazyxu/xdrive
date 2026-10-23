# CR04 · 真实在途 Owner Range × Peer Logout × SW waiting（2026-10-23）

## 目的

补齐 [#2347](https://github.com/lazyxu/xdrive/issues/2347) 与
[#2348](https://github.com/lazyxu/xdrive/issues/2348) 最后一个**同轮交错时序**，不能把独立成功的
CR01b4（Go Context）、CR02b1（离线撤销）、CR02b4（迟到 IDB）和 CR01b3（SW waiting）
口头组合成验收结论。

## 隔离真实 E2E

测试专用 `XD_PWA_CR04_RANGE_REVOKE=1` 在原 `TestPWAS2B3RealGinAuthFixture`
内开启，仅复用原来的真实 Gin Router、PostgreSQL17、Owner/外部 Owner、
LocalCAS、正常登录 JWT、独立浏览器磁盘 Profile、正式 Vite PWA Shell 和 IndexedDB。
此开关在正常构建、正常 Go Server 不存在。**不修改生产鉴权、PWA、SW 或传输代码**。

1. 原生 Chromium 进程 A 用真实 Owner 登录，创建真实父/子目录及相册，
   经 `/me`、Node、单行 Range 核验后显式 opt-in 写入有界 P1 元数据，
   验证另一个 Owner 对 Node 返回 404。
2. 退出 OS 进程 A，以同一 Profile 启动进程 B，断网重开公开 SW Shell，
   读取目录和相册历史；联网后真实 Gin `/me → node → one-row Range`
   成功，但 UI 始终标记历史摘要，不提升离线缓存为实时授权结果。
3. 同一进程 B 开两个旧 SW 控制的页面；为原拥有者目录的**下一次真实 Gin
   Range**设一次性有界 ResponseWriter 节流，生产 Handler 先写至少一个
   前缀并 `Flush`，CDP `Network.dataReceived` 要观察到真实浏览器收到的字节，
   Go Handler 尚未退出。
4. 发布**仅注释版本变化**的第二份真实编译 SW 字节，让 `registration.update()`
   进入 `waiting`；两个旧窗口不得 `controllerchange` 或强制 reload。
   未替换为 mock Worker，不缓存任何私有 API/缩略图/原件/令牌。
5. 在原 Range 仍由 Go 节流的情况下，另一旧窗口先通过真实 Owner `DELETE /nodes/:id` 删除原已授权目录，并独立调用真实 Node GET 验证 **404**，证明 Server ACL/Node 已失效而旧 HTTP Range 尚未结束。随后按照 390px Mobile Web 的真实入口点击**“切换应用 → 账户菜单 → 退出登录”**；清退实际通过 BroadcastChannel
   触发，原 P1 页面 abort 正在等待的真实 Range；Go `Context.Done` 和 Handler
   退出都必须到达，UI/IndexedDB 不恢复旧 Owner 历史，旧 Controller 不更换。
6. 再关闭浏览器进程，以原 Profile 第三次断网冷启动，目录/相册历史仍为空；
   仅输出脱敏布尔项和准确 PR SHA。Go 夹具独立核对原 Owner/其他 Owner
   ACL、真实请求取消与 SW B 发布，构建及全 CI 必须分别成功。

## 门禁与边界

新准确 HEAD 专项必须真实成功（不是静态合同成功），再通过完整
Linux/Windows/PG17 API Race/Web/Desktop/Rootless/打包/Final Gate，
确认 GitHub fresh clean 才可以合并并收窄 Issue。失败保持 Draft，
保留原始 RED，不降低要求或将部分字节替换为伪造网络事件。

这是一组隔离的 Linux/Chromium/Go 测试，而不是 iOS 27/Android 物理安装，
也不是生产来源安全验收。生产专属不可触及验收：
**按用户决定跳过（未验收）**；Owner ACL/跨账号/隐私负例和 CI 不跳过。
