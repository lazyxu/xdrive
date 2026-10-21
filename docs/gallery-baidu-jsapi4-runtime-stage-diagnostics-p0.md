# P0 · 百度 JSAPI4 真实客户端失败阶段诊断（2026-10-21）

## 已确认的源码问题与修复边界

- Server AK Static Map v2 在线 PNG 成功、Server 发行签名成功、固定 Loader HTTP 响应校验成功，是不同的前置条件；任何一个都不能证明实际浏览器脚本、动态子资源、BMap namespace、WebGL Map 或照片聚合就绪。
- 旧共享 Loader 在 `script.onload` 同步一次性检查四项 BMap 能力，直接归并为 `baidu_jsapi4_not_authorized`；相应 Gallery 捕获层只记录 `sdk_load_failed`。在 SDK 异步初始化、代理脚本失败、CSP 拦截、能力缺失和地图构造失败时管理员无法精确定位。
- 当前更改等待已接受的同源 bootstrap 加载后有界完成的 BMap namespace；最长 7.5 秒，不绕过八秒组件总超时，不复用外来脚本实例。明确区分 `sdk_script_failed`、`sdk_script_timeout`、`sdk_namespace_missing`、四项能力缺失、代理宿主冲突、缓存身份冲突、坐标转换与原生构造错误。错误码来自源码白名单，不保存原始 SDK 异常、URL、AK、JWT、Cookie、图片或 GPS。
- Gallery fallback 就地显示这次错误的标题、代码、处理建议；管理员「系统依赖 → 百度地图 → 检测与生效证据」保留完整只读诊断，并明确 Static/Loader 成功不能覆盖浏览器 SDK 失败。8 scope / 15min 本地内存隔离、Owner 变更清理、Abort 不记录和 Server 签名授权约束不变。
- 对原有 15 分钟诊断失效机制补充窗口焦点、文档可见性恢复时的纯内存读取。Safari/iOS PWA 后台挂起导致 setTimeout 延迟时，管理员和图库不能继续展示过期或其他账户诊断；不触发百度检测、不增加 API 配额。
- `script.onerror` 仅能证实实际浏览器脚本失败；无法单凭此事件区分网关/CSP/浏览器网络。只有后续受控浏览器测试与现场运行证据才能进一步收窄。不得把回退文案或 Loader 成功冒充真实动态地图验收。

## 工程验收

- 真实 TypeScript 源经 Node 编译的模拟 DOM 测试覆盖：bootstrap onload 后异步 BMap 就绪；无 AK 的固定代理 URL；script.onerror；不同 serviceHost；Map 构造失败及白名单匿名输出。
- 仍需 PR 当前准确 HEAD 完整 Linux/Windows/Go PostgreSQL API Race/Web/Desktop/Final Gate 成功；真机与 100k 实测单独追踪，不由上述确定性用例代替。
- **P0-03 仍未完成**：同文档运行第三方 JS 的真实独立 HTTPS Origin iframe、严格 CSP/Cookie/Storage 隔离、恶意脚本 Chromium 测试等，应沿原 #2263 → #2287 分支实施。本 PR 只修复现行源码诊断与 bootstrap 完成判定，不宣称第三方代码已安全隔离。
- 生产环境安全验收始终 **按用户决定跳过（未验收）**；不要求任何生产账号、HAR、凭证或人工生产签字，也不以它阻塞源码、CI 或 PR。Owner/Consent/revocation/Origin/CSP/fail-closed 源码测试照常强制。
