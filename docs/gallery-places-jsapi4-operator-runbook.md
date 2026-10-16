# xDrive 百度 JSAPI 4.0：操作员私有许可与流量取证指南

**2026-10-16 · A3 未完成 / JSAPI4 生产 NO-GO。** 当前 `runtime_enabled=false`，尚无公开 JSAPI4 Loader、地图 Cookie 签发或子资源代理。拥有 AK 或运行模拟测试都不能解除该门禁。百度是唯一地图 Provider；静态地图和动态地图使用独立 AK。Web/Mobile Web/Desktop 共用 Gallery REST/Agent、Range、VirtualCollection、Viewer，继续保留全屏 App Frame 与 52px 标题栏。

## 1. 你先在百度开放平台完成的手续

1. 打开 [百度地图 AK 控制台](https://lbs.baidu.com/apiconsole/key)，确认现有 Static Map v2 使用 **Server 类型 AK**，JSAPI 4.0 使用**单独的 Browser 类型 AK**，并按百度要求限制使用域名、用途和配额。在 xDrive 管理员「系统依赖 → 百度地图」仅保存适用的加密配置。**不要**把 AK 发到聊天、GitHub、截图、CI 日志、命令行参数或 HAR 附件。
2. 向百度官方客服、开放平台工单或商务渠道询问并保存**账户适用的书面结论**：是否允许 JSAPI 4.0、`serviceHost` + `BMAP_PROXY_URL` Server 注入 Browser AK、多个登录用户的自托管 HTTPS 服务、Web、iOS Safari/安装 PWA、Android 浏览器/PWA、Electron Desktop；是否覆盖你实际的个人或商业模式；域名、地图署名、SKU、费用和请求配额；**是否允许持久保存由原始 WGS84 官方正向转换得到的 BD-09 派生坐标索引**、保留期限与删除义务。没有明确答复的范围一律仍为 NO-GO。
3. 许可原文及账号信息只存放你的私有资料库。[Issue #1798](https://github.com/lazyxu/xdrive/issues/1798) 只记录不含身份、账户编号、合同正文或 AK 的范围结论、日期和待确认项。

官方参考：[代理保护 AK](https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcepts%2Fproxy)、[JSAPI 4.0 代理加载](https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcepts%2Fload)、[坐标系](https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcept%2Fcoord)。百度展示的通配 Nginx 代理范例**不能直接复制到 xDrive 多用户生产环境**。

## 2. 获得许可后，只在隔离的授权试验环境采集

使用你控制的**独立 HTTPS 测试域名、独立密钥/配额及无真实个人照片/GPS 的合成地点**。必须同时观测客户端和 Server→百度两段真实请求/响应，且测试环境的地图脚本/瓦片/样式/字体/WASM 和上游 Host/Path/Query/MIME/字节上限均经过人工复核。JSAPI4 `serviceHost` 必须以 `/` 结束，浏览器只请求同源 `/_BMapService/`，Browser AK 只在可信 Server 向经过批准的百度资源注入。此试验环境不等于 xDrive 已开放生产代理；不得启用通配开放代理或把未知 HAR 路径自动变成白名单。

每个平台 `web`、`mobile-web`、`desktop` 分别执行 `load`（冷加载）、`pan`（平移）、`zoom`（缩放），每种操作**单独保存一份浏览器 HAR 和一份 Server 上游 HAR**，共 **9 组 / 18 份**。每组都要有真实会话、Loader、子资源和尽可能完整的响应正文，不能把浏览器 HAR 冒充上游。浏览器可通过受控 DevTools 的 Network + Preserve log + Disable cache 导出含内容的 HAR；上游须由授权试验 Server 私有追踪取得。真实 iOS Safari、Android 与 Electron 的设备验收仍需另行记录，不能用模拟器标签代替。

**保密要求：** HAR 可含 Cookie、Token、Browser AK、个人坐标和 HTTP 响应，全部保存在访问受限的本地加密目录；绝对不要上传到聊天、GitHub、CI 工件或在线 HAR 查看站。完成后按授权存续期销毁。只有无隐私的合成测试数据允许提交仓库。

## 3. 复制此 manifest.json 结构到本地私有目录

```json
{
  "version": 1,
  "captures": [
    {"client":"web","scenario":"load","browser":"web-load-browser.har","upstream":"web-load-upstream.har"},
    {"client":"web","scenario":"pan","browser":"web-pan-browser.har","upstream":"web-pan-upstream.har"},
    {"client":"web","scenario":"zoom","browser":"web-zoom-browser.har","upstream":"web-zoom-upstream.har"},
    {"client":"mobile-web","scenario":"load","browser":"mobile-load-browser.har","upstream":"mobile-load-upstream.har"},
    {"client":"mobile-web","scenario":"pan","browser":"mobile-pan-browser.har","upstream":"mobile-pan-upstream.har"},
    {"client":"mobile-web","scenario":"zoom","browser":"mobile-zoom-browser.har","upstream":"mobile-zoom-upstream.har"},
    {"client":"desktop","scenario":"load","browser":"desktop-load-browser.har","upstream":"desktop-load-upstream.har"},
    {"client":"desktop","scenario":"pan","browser":"desktop-pan-browser.har","upstream":"desktop-pan-upstream.har"},
    {"client":"desktop","scenario":"zoom","browser":"desktop-zoom-browser.har","upstream":"desktop-zoom-upstream.har"}
  ]
}
```

所有文件必须为**不同的真实捕获**，存放在 `manifest.json` 同一私有目录中，不使用符号链接。Node.js 22 环境下，先让**你的秘密管理器**只为本地审计子进程注入 `XD_BAIDU_JSAPI_AK_CANARY`，其值应匹配这批试验请求真正使用的 Browser AK。**不可**把密钥直接写在 Shell 历史、脚本参数、Git 文件或输出日志里。然后在 xDrive 仓库根目录运行：

```bash
node scripts/ci/baidu-jsapi4-evidence-matrix.cjs /private/baidu-jsapi4/manifest.json https://your-actual-staging-origin.example
```

工具仅输出固定诊断码与计数。`capture_valid=true` 只说明**已提供的样本**通过离线检查，`release_authorized=false` 永远不变；失败退出码不可忽略。测试脚本本身可不使用任何真实 AK/HAR 而单独验证：

```bash
node --test desktop/tests/baidu-jsapi4-browser-har-audit.cjs desktop/tests/baidu-jsapi4-evidence-matrix.cjs
```

## 4. GO / NO-GO 及后续顺序

运营者还需核对账户许可的全部范围、真实子资源图谱、9 组浏览器+上游原始字节 AK 防泄漏、可信签名发布根、Server Owner/SessionVersion/Map Epoch/Browser AK 修订号/跨副本配额、Caddy/CSP、Service Worker 和 Electron sandbox 隔离，以及真实 iOS 27「照片」1:1 截图、手势、深浅色、横屏、无障碍、性能与 Android/Desktop 验收。任何一项未验收都保持 JSAPI4 `runtime_enabled=false`，不开放 Loader/Cookie/代理、不创建无许可的 BD-09 持久索引，也不从 BD-09 逆算原始照片 WGS84。完成 A3 后才依序 A4→B1→B2→B3→C1。
