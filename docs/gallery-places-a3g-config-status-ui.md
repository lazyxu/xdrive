# P0-Places-A3g · 百度 JSAPI4 六字段状态配置界面（2026-10-20）

## 使用步骤
升级包含本 PR 的 xDrive Server/Web/Desktop 兼容版本，登录管理员后台 → 系统依赖 → 地理位置与地图 → 百度地图 → 配置与修改。共享 Web/Mobile Web/Desktop MUI 页面新增 **Server 配置与运行状态**，直接呈现 `configured`、`desired_enabled`、`runtime_enabled`、`activation_state`、`release_blockers`、`requires_restart` 六个已存在的 Server API 字段、保存修订号和最近成功读取时间。点击 **刷新 Server 实时状态** 重新向 Server 获取，不做本地伪造，不触发百度网络请求；存在未保存的 AK/开关草稿时禁止刷新以防丢草稿，失败保留上一次成功快照且报错。

`desired_enabled` 可通过已有 **启用 JSAPI 4.0** Switch 修改、保存并应用；`configured` 由密钥是否已使用 Server 加密保存决定，沿用密码框安全轮换/清除 Browser AK；其它四项为只读 **Server 运行结果**，不可直接改成 `true` 或覆写为 `[]`。管理员保存成功时按返回修订刷新全部字段，无须再次提供现有 Server/Browser AK。当前 `requires_restart=false` 表示配置保存无需重启，不等于旧版本二进制可无需升级。除非当前签名发布真实验证通过，否则 `runtime_enabled` 不能当作期望开关。

## 范围与验收
保持已有正式 Go Owner 授权、自动 Ed25519、受限百度 serviceHost 资源代理、Server AK/Browser AK 隔离、Caddy/CSP 与 Map-only Cookie 不变；不提供原始配置/密钥/环境变量自由编辑器。沿用唯一共享 `XDriveBaiduJSAPIDesiredPanel` 和 `GET/PUT /api/v1/admin/services/baidu-jsapi`，因此三端同一实现、52px App Frame、Gallery Range/VirtualCollection/Viewer、Static 百度回退不变。Node 源契约检查覆盖六字段和只读门禁；真实生产百度流量/HAR、iOS 27 1:1 真机/Web-Mobile-Desktop、AK 保密和许可证仍未实测，不能宣称生产 GO。

下一独立阶段 P0-Places-A4：通过现有受权 Server Media Range 实现有界 bbox/radius WGS84 附近照片查询、精确统计、Viewer 和 AbortSignal 到 Go context。保留独立 PR/单工作提交/原始完整 AGENTS 历史；不能修改其他 owner 正在处理的 P103 Mobile Gallery 状态。
