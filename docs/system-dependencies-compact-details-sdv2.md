# SD-UX-V2 · 系统依赖详情的第二轮紧凑化（全部 11 项）

2026-10-20 · 用于继承已合入 SD-UX-V1 #2186 后的共享 MUI 详情页，不新增管理员后端或地图 Provider。

## 问题与实际改动

第一轮已把动态 JSAPI4 的六项 Server 只读字段从配置编辑区移到「检测与生效证据」按需技术披露，但详情屏仍存在标题重复（页标题与状态行标题）和四轴指标下方无条件堆叠配置来源、`config_hint`、生效模式、版本、未检测免责声明等说明。

本次继续仅修改共享的 `ServiceDependenciesPage`：
- **页面标题唯一**：选中服务仅在页面顶部显示一次标题，底部的可折叠状态行不再复制它；选中服务不再重复显示对应分组说明。
- **状态默认紧凑**：服务的一次状态描述 + 配置/部署/健康/生效四项独立 Server 证据；全部依赖的配置来源、部署限制、配置建议、生效模式和版本统一在显式「查看状态依据」中呈现。
- **百度专属**：Static Map v2 已配置不等于已在线健康；默认四轴如实为「健康未检测」。Static AK 的凭据保管和操作按钮在配置中，主动点击 Static 在线验证才请求固定 128×128 图像并消耗配额；Browser AK 的配置仅编辑 desired/替换/清除，而当前 signed runtime 六字段只在检测区的技术披露中出现一次。两者互不冒充。
- 保留配置草稿 CAS 修订、主动显示 Server AK 30 秒隐藏、权限审计、手动 Loader probe、按需历史请求；展开/导航不得隐式保存、宿主操作或百度外网调用。

## 实施与验收

同一共享 MUI React 页面直接用于 Web/Mobile Web/PWA/Desktop，11 个依赖和单独全局策略沿用现有 API。增加源结构测试 `system-dependencies-compact-details-sdv2.cjs` 并保留原有 SD-UX-V1/Server AK/JSAPI4 测试；需要当前准确 HEAD 全量 Go+Web/Desktop+真实 PG Race/Final Gate。没有真实 iOS27/Android/Electron 或生产 AK/负载执行，因此不能仅凭 CI 宣称最终实际 UI 1:1 或生产已升级。
