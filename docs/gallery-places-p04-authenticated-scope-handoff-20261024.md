# P0-4 · 双模式百度地图 Owner PhotoScope 一次性安全交接

> 状态：PR #2535 源码候选；以准确 HEAD 的 CI/合并结论为准，不等同真实百度、iOS 真机或生产网络验收。

## 成熟的设计决策

[#2525](https://github.com/lazyxu/xdrive/pull/2525) 已把两版地图的 Owner Cells、Camera Range、PhotoScope、封面和 Viewer 业务汇合。剩余限制不是渲染能力，而是切换 Baidu SDK 时必须进行 `location.replace` 全文档重载，会遗失可信 Parent 的私有内存筛选。

模式切换时，**未筛选但已有有效 BD-09 当前相机**同样使用这条现成的一次性交接：不仅保留筛选，而且保留地图中心与缩放；只有尚无有效相机且没有受限成员时才允许不经票据直接换文档。绝不通过 URL 或浏览器 Storage 传递原始位置，也不创建第二种交接协议。

P0-4 新增独立于 Baidu Map-only Child Ticket 的 `BaiduMapScopeHandoff`：单个 256-bit 随机 nonce；数据库只存 SHA-256，90 秒过期；绑定 OwnerID、SessionVersion、current signed BrowserAK release revision、Map revocation epoch、目标模式、规范化并经白名单校验的有限 Gallery Scope、Album revision、可选 BD-09LL Camera。唯一消费使用 PostgreSQL `FOR UPDATE` 及同一事务更新 `consumed_at`。不能转交 media authorization；`/cells` 与原 Gallery Range 始终是独立重查询的最终数据授权源。

### 端到端流程

1. Web/Mobile 的地图切换按钮先规范化可信 Scope、抓取带 `coordinate_space: bd09ll` 的当前 Camera。受限范围调用当前登录 Owner 的 `POST /media/places/baidu-jsapi/scope-handoff`（准确 Origin，Bearer、固定 JSON allowlist），签发将要进入的模式。失败不更改旧页面。
2. **仅随机 64 hex 字符**短暂进入同一 HTTPS 文档 URL 的 `places_map_handoff` 参数，同时写入非敏感的 `places_map_scope_required=1` fail-closed 标记（无 Album/Owner/GPS 身份），PhotoScope/Album/GPS/Node/Owner/JWT/Baidu AK 不进入 URL/history.state/Storage/Child；调用 `location.replace` 保留现有 Gallery route hash。
3. 新文档在模块初始化、任何地图/图库第三方 SDK 挂载前同步 `history.replaceState` 删除 nonce。遇到重复、异常、非 HTTPS 或移除失败直接停在受限错误，不显示默认全图库。强制刷新、后退到带有 scope_required 标记但已经没有一次性票据的文档，同样进入拒绝页面；只有用户主动选择退出受限范围才清除该标记。
4. 等待本页面当前 Owner 的已授权 Profile；以自身当前 Bearer 对 **消费 API** 发起一次 POST。Service 层验证单次消费、DB 用户 SessionVersion/disabled 状态、Map epoch/revoke、签名发布 revision、目标模式、Album 当前 revision，再由同一 Owner Profile 接受结果。消费的 Promise 由文档/Owner/Api 绑定，以免 React StrictMode 重挂载双重消费；账户切换不能借用已经兑现的结果。
5. 只有成功恢复相同规范化 Scope/可选 BD09 Camera 后，才挂载唯一共享的 Gallery Parent/Child Map/Viewer。失败明确提示且需要用户**主动**选择返回未筛选图库，不进行自动隐式扩大。
6. Desktop Electron file: 继续只使用独立 HTTPS 受控地图窗口和原有 IPC 交接，**不**暴露或复用 Web P0-4 POST，安全版 Child 原有 Map-only Ticket/HTTPS 站点隔离完全不变。

### 可验证的安全门槛

- 重复、过期、跨 Owner、跨 Session、撤权、Provider Release 轮换、相册更新/删除、相机 WGS84 注入、不在白名单的过滤字段、JSON 重复字段、Origin/Fetch Site 异常均 fail-closed。
- PostgreSQL **两条 DB 连接、20 个同时消费尝试**只允许一次成功，且无持久凭据明文与媒体字节。
- Web/Mobile 初始 Scope 校验及模式目标一致、失败阻止旧范围扩大、全新文档先清 URL 才挂载 SDK；Web/Desktop/Go/PG Race/Android/Final Gate 使用 PR 确切 HEAD。
- 非生产 iOS27 浏览器视图对照和 10k/100k 原始 Count/首屏/取消基线→优化配对仍由 [#2210](https://github.com/lazyxu/xdrive/issues/2210) 持续追踪，不能冒充完成。
- ChatGPT 不可触达的真实生产环境验收：**按用户决定跳过（未验收）**，不请求生产 AK/JWT/Cookie/HAR 或用户手工签字；可控源代码级 Owner、Origin、Revocation、恶意 SDK 隔离 CI 不跳过。

### 日期筛选的本地日历语义

Web/Mobile 地图的拍摄起止日期是 HTML `<input type="date">` 产生的严格 `YYYY-MM-DD`；它表达所选 IANA 时区内的**当地零点**，而非原样按 UTC 零点解释。`mediaQueryTime` 必须使同一个相册/日期 Scope 在 BD09 Cells、Cell/Viewport Range、Viewer 与一次性模式交接中得到相同 UTC 边界，并允许旧客户端原有 RFC3339 日期时间格式（保持原始含义）。在夏令时切换日，两个本地零点可能相差 23 或 25 小时；非法日期或结束早于开始仍应拒绝。
