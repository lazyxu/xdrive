# PWA P1C · 同一 Runner 真实 Owner 100k / Go 取消配对 AFTER（2026-10-23）

P1-01 不能把 #2408 的公开 App Shell gzip/首屏数字冒充真实业务 100k AFTER。本独立 opt-in CI 固定 P1-02 相邻的两份原始 Web 发布：

- BEFORE：`84ef0076506b958001369bb173f221418bf4833a`（未分包）。
- AFTER：`7515c421412666893e4b0519e4b5869d988bf8e1`（首次接受的分包源码）。

两者使用**字节相同**的 `desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs` 和真实 Go Test Fixture 源码；在**同一 Ubuntu Runner**分别构建普通 Vite Web，由**同一编译 Go Binary**与 PostgreSQL 17、CAS 提供真实 Owner JWT、文件和媒体 Range。各跑 n=3 原生 Electron Chromium、390px/52px App Frame、真实 Files→Gallery→Files 路由，并真正触发 Go Handler 的 `Context.Done`。
本轮核验真实 Go Context.Done、Handler 退出和响应字节停止，而不是模拟浏览器取消事件。

测试场景为 **100k logical PhotoAssets + 115k metadata Nodes**，每次视口仅有 **4–6** 条物理 JPEG 流，其余为元数据与真实授权分页。由已有原始基准测出 Go 取消耗时/响应浪费、CPU、RSS 及真实业务导航是否无中间页面。它 **NOT full 100k distinct-physical-original** 负载，亦不是全部图片/视频/Live 解码；没有测量经认证 Files/Gallery 的完整冷启动首帧，不能宣称 P1-01 所有 100k 性能项已完结。

只有同条件原生、真实 Server Go/JWT/PG/CAS 两份结果都通过 160 ms 取消约束且 CPU 无明显回归，才记录此明确**受限场景 AFTER**。若无法运行，原始 RED 保留；不得伪造数字或取消安全负例。

物理 iOS/Android/Installed、OS 进程回收、VoiceOver/TalkBack `NOT RUN`。生产不可接触的安全验收**按用户决定跳过（未验收）**，不阻塞源码 CI 和 PR；Owner ACL、隐私与无旧请求回填仍按源码真实测试强制。
