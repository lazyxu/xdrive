# P0-SAVE-C · Caddy 单页联合原子「保存配置」UI

2026-10-21 · 本增量是 Draft stacked on #2270（Caddy 单页面），代码并非已合并，也不表示 Host Apply 已开放。正式冻结规格：`docs/system-dependencies-ui-v1-https-8443.md` v1.1；依赖 #2272（Server 端双修订事务）和 #2278（Web/Desktop/Agent 单请求传输）。

## 已实现的共享 MUI UI 范围

- `CaddyDetailV1` 常驻 HTTPS + AliDNS 两个编辑区域，保留旧 status/verify/config/history 锚点；只有**一个** `保存配置` 操作及明确确认对话框。原两个子面板在 `atomicMode` 下不再提供单独 Save，也不允许缺失新 Server/Agent 能力时退回旧两个写接口。
- 由两子面板向父页提供仅驻内存的完整草稿；仅在两项配置状态已经读取、双修订为 JS 安全整数、同一 Server/account `source`、无 Host Pending、未在保存、编辑字段合法时允许保存。单组变更也携带**两项** expected revisions；两组都改时只发一次请求。
- HTTPS 保留现有 FQDN/RFC1918 IPv4 校验、域名/LAN 两开关禁止同时关闭、大小写规范化以及 LAN 编辑。AliDNS 空白不更改；填写合规双凭据才显式 `replace`；`clear` 必须先确认加入待保存草稿，清除不是立即网络写入；可以取消待清除状态。
- 保存响应必须 `saved=true`、`host_applied=false`、`apply_supported=false`，两项 revision 分别严格递增已变更组的 1。其他任意响应均拒绝展示为成功。保存/放弃后分别重新加载两组目标；失败原草稿保留，409/断线由管理员明确处理。
- 旧账号/旧 Server 的异步响应通过 source identity + request epoch 排除，双点击通过同步提交锁拒绝。AliDNS 原临时 `reveal` 30 秒上限、失焦/隐藏清理仍保留，明文不进入状态/审计/URL/日志。
- 不向 Desktop Agent 注入 Docker socket，不操作 Caddy、8443、Compose、证书、CA、AliDNS DNS 或 Host 部署。单页继续显示独立「重新部署尚不可用」原因，不提供假操作。`apply_supported=false`。

## 需在依赖合入后验收

#2270、#2272、#2278 各自先经自身完整准确 HEAD CI/Final Gate 及 clean 合并。本 PR 届时必须以完整新 master 重建，只保留本增量独立修改和完整历史 `AGENTS.md`，实测 Web/390px Mobile Web/Desktop 统一保存、单组/双组、过期双 CAS 409、Host Pending、AliDNS 显式 clear、服务端/Agent 不支持及旧账号结果丢弃。还需完整 Linux/Windows Go、真实 PostgreSQL API Race、Web/Desktop、Rootless/Host/制品及 Final Gate。

用户决定：生产环境专属安全验收**按用户决定跳过（未验收）**；不索取生产账号、密钥、JWT/Cookie、HAR 或人工生产网络测量，也不把它当源码/CI 合并门禁。源代码安全测试和模拟故障验收必须执行。

## 补充：原子保存进行中的双组冻结与错误消息脱敏

- 父页面只在发起唯一单次 Save 时设置 `savingAtomic`，同步锁阻止第二次提交；将提交状态传给 HTTPS、AliDNS 两个编辑子面板。请求未取得终态前禁止修改目标开关、FQDN、LAN IP、AK/SK，以及子面板重读、管理折叠、凭据临时显示；避免在请求进行中写入新草稿却被成功后的 GET 覆盖。失败后解除锁并保留原草稿。
- 错误只按明确 HTTP 状态返回固定、无敏感信息的中文提示：400/422 格式、401/403 会话或权限、404/501 旧 Agent、不兼容、409 修订冲突/Host Pending、429 限流。绝不直出 Server、Agent、网络、代理的原始 `Error.message`、域名、IP、密钥、路径或 URL。
- 网络失败或响应合同不完整时**不推断事务失败**：服务端可能已提交而回复丢失；草稿保留，明确提示先核对当前 HTTPS/AliDNS 两修订、不要盲目重复提交；任何成功仍须校验 `saved=true, host_applied=false, apply_supported=false` 和两修订的预期递增。
- 本次只补强 P0-SAVE-C 已有单页前端与 Node 源码合同测试，不影响 Server 数据库事务、其他系统依赖、Desktop Agent 权限或 Host Apply。正式验收仍要求 #2270/#2272/#2278 合入后在当前完整 master 上执行新准确 HEAD 的全量 CI、真 PostgreSQL API Race、各端构建和 Final Gate；生产专属验收按用户决定跳过（未验收）。

## 准确 CI #39580504239 原有源码断言修正（2026-10-21）

- 本 PR 新首次完整 CI 的 `desktop-tests` 真实失败共四项：原 Caddy compact-config 测试仍匹配旧 `reload` busy/dirty 表达式和旧 AliDNS 凭据面板禁用条件；原三 Tab 回归测试仍匹配未加入 `atomicSaving` 的父子组件传参；系统依赖导航测试仍将「草稿变脏」仅定义为 AK/SK 输入而遗漏待清除凭据。失败记录保留，不冒充通过。
- 仅调整相应三份**原测试**的源码合同，验证更严格的 `atomicSaving` 执行中锁、`pendingClear` 待清除保护、`host_pending` 围栏、配置/历史旧入口兼容；原新建 P0-SAVE-C 测试、权限、HTTPS 双入口合法性、AliDNS 临时显示 TTL、无 Host Apply 等断言不删除、不降级。其他 Owner 业务代码不变。
- 新增本次修正后必须独立重跑新 SHA 全量 CI，包括 Desktop Node 合同、Web/Windows/Linux/真 PostgreSQL API Race、Rootless/Host、制品和 Final Gate，fresh clean 后方可合入；生产专属验收按用户决定跳过（未验收），源码安全 CI 不跳过。

## 本轮准确 HEAD 桌面回归修正（2026-10-21）

- 源码 HEAD `d44e0f8a362164d10bb03e53c94c759304f63e0a` 的真实 [CI #39581826908](https://github.com/lazyxu/xdrive/actions/runs/39581826908) 在 `desktop-tests` 中出现 `SD-UI-V1.5` 断言失败：原测试仍匹配旧 `busy || changed` 刷新锁，但共享 HTTPS 编辑器已经实质加强为 `busy || atomicSaving || changed`，原断言错误地把增强保护当回归。
- 保留原 `SD-UI-V1.5` 测试及全部检查，只将**两个**旧源码精确断言更新为要求 `atomicSaving` 参与程序化 `reload` 禁入及重读按钮禁用；没有放宽双入口、防草稿覆盖、配置历史懒读取、AliDNS 凭据和 Host Apply 的任何门禁。
- 在本轮完整主线重建后，仍须对新工作提交的真实 Desktop、Web、Go/PostgreSQL API Race、Host/Rootless、制品及 Final Gate 重新验收；历史红灯与旧 SHA 全绿不能代替当前新 SHA 的证据。生产环境专属验收按用户决定跳过（未验收）。
