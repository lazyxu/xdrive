# P0-03 · Desktop HTTPS 独立地图 Owner 受限集合交接

日期：2026-10-24。源码候选，不是已完成的 Electron 浏览器或真实百度 SDK 验收。

- Desktop 的已接受图库范围（相册、收藏、日期、类型、排序、时区）经过纯白名单 DTO 校验，由 Electron Main 在内存中暂存一次，十分钟绝对过期。
- 交接只面向 Main 创建的独立 HTTPS map BrowserWindow 顶级 Frame，要求同一 Server Origin、强制 isolated 地图模式、当前 Agent 登录名与 HTTPS Web 的 /auth/me 用户名一致；拒绝其他 Frame、账号、路径、Origin、重复领取及过期。
- 独立 BrowserWindow 采用独立 Session、专用最小化 preload；只暴露领取范围与「有新范围」通知，不导出 Agent 密钥、JWT、Cookie、原始 WGS84、私有媒体 URL。拒绝时 Web **不能显示无筛选地图**，也不能默默进入旧同页 Prototype。
- Main 中一次性销毁 Pending；Webpack/Web Gallery 只在独立完成 /auth/me、严格 DTO 校验后才使用该范围。地图 Child 仍只得到被授权聚合点，不得到 Parent Scope/Album。
- Desktop 原本的 Gallery/VirtualCollection 继续留在 Desktop；安全窗口独立认证的 Web Gallery 负责地图、Wall、Viewer，所有成员依然由 Server Owner/Consent/revision 重新校验。

**独立剩余 P0：** Electron 当前严格的单-Origin 网络出口还没有基于 Server 的签名 Child Release 动态准入第二个 HTTPS Origin。因此这份交接即使源码/CI 通过，不能宣称百度 Child 真实资源已经加载成功；不能为让其「能显示」而向任意第三方 Origin 放宽。需要另行增加 Agent 可信签名发布读取、Child origin 受控准入与实浏览器验证。受控 10k/100k/iOS27/Android/Electron 真机性能与视觉亦未实测。无法触及的生产环境安全验收按用户决定跳过（未验收），不作为源码、CI、PR 合并门槛；代码级 Owner/撤权/Origin/CSP/恶意 SDK 测试仍必须执行。
