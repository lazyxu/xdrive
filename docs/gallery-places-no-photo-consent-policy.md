# xDrive Photo Map — no additional consent (2026-10-26)

**Permanent product policy; supersedes older Places documents, tests and AGENTS text about mandatory per-photo opt-in.**

- Any authenticated Owner's accessible indexed PhotoAsset with valid original GPS qualifies for map position indexing without another map-specific authorization. Never add per-photo/bulk consent buttons, expiring/revocable map grants, opt-in prerequisites or a consent-based 403.
- Preserve account authentication, strict Owner isolation, Gallery collection membership, live Node/metadata versions, deletion/GPS-edit invalidation, and independent iframe Origin/CSP controls. These are not new photo-map grants.
- BD-09 coordinates must be genuinely derived: a valid GPS asset that lacks a usable BD-09 derivative stays in the derived-missing category until processed. Never substitute raw WGS84 as BD-09 or claim 3,323 formerly blocked photos are already visible.
- Both Baidu SDK Hosts use the same trusted Parent, Server predicate, Cells, Range, Viewer and map UI; never provide the Child raw private photos, JWT, server AK or original GPS.
- Provider availability, entitlement, quota and server AK are service dependencies, never reasons to require a user to grant each photo. Retire old consent routes, index writer checks and any old consent-driven job conditions. Existing consent columns may remain temporarily only for compatibility.
- Legacy `consent_unavailable_assets` and `consent_source_changed_assets` wire fields are deprecated and must report zero. New UI must not display authorization error categories. Never reintroduce this mechanism in future contributions.

Required regression: no consent/expired/revoked photo has the same Owner-map eligibility as its current derived state; missing-derived reports honestly; stale GPS/Node and other-owner data remain excluded.

## 自动增量入队与服务端边界（2026-10-26）

现在照片地图使用同一条无授权的 Owner GPS 数据链：

1. 媒体索引完成时，复用 `media.index` Owner 任务，自动扫描最多 16 个待索引照片，并经原事务队列写入 `xd_baidu_photo_map_index_intents`。
2. Server 启动后由 MediaIndexer 生命周期发起有界历史补扫，约每 30 秒检查最多 8 个活跃 Owner，每 Owner 最多 4 批、每批 32 个；一次轮询只返回内部 PhotoAsset ID，不返回 GPS 或媒体 URL。无缺口的 Owner 暂停高频扫描，每约 10 分钟再检查一次，以恢复旧租约过期后新可执行的工作；新的媒体事件单独处理增量。
3. 候选只包含当前 Owner 下索引就绪、来源版本一致、有效原始 GPS、真实可显示纬度的逻辑媒体。Live Photo / RAW Pair / Burst 使用一个 PhotoAsset；Sidecar 不重复建点。已有与当前来源一致的 BD-09 派生点不入队；有效的 queued/leased/failed/cancelled 任务不会被重复制造。
4. 每个候选仍由原始 `enqueueBaiduPhotoMapIndexIntent` 事务核对 Owner/Node/媒体来源。完成任务丢失派生点可以重建；旧授权时代的 leased 任务只有在 PostgreSQL 判定租约过期后才能替换。使用原有租约、重试、取消和服务器配额，不创建另一套上传/索引系统。

**自动入队与实际转换已打通，但不能伪称历史照片已经完成派生。** 已有持久索引队列由独立于 30 秒补扫的 Server 消费循环按 Owner 轮流读取，正常情况下每秒最多处理 1 个任务（单 Server），真实失败后退避 30 秒；跨副本仍受 PostgreSQL fleet/Owner 配额约束（60 次/分钟、2 次/秒、4,000 次/UTC 日）。配额不足时照片继续排队、五分钟后按数据库时钟重试，不耗尽最多三次的真实转换失败预算；真正的 Provider 错误仍按有限重试处理。**管理员已启用百度服务且当前 Server/Web-Service AK 有效即允许自动调用官方 HTTPS Geoconv**，不要求人工许可审查、固定公钥、额外签名证明、逐照片授权或手动发布开关。旧的固定 pinned operator proof NO-GO 已移除。若服务未启用、AK 无效、配额不足、网络/Provider 返回错误，则本轮不成功落图，任务仍受既有租约、取消及有限重试规则约束，按真实状态展示；不会伪造 BD-09 或绕过 Owner ACL。Browser AK 不可替代 Server AK。

**协议范围：** Server 的 BD-09 `/viewport` 与 `/cells` 统一返回 `index_scope: "owner_gps_auto_index"`；共享 TS 数据模型、PWA/Desktop 解析器与测试都采用此值，不得恢复旧的 `explicit_opt_in_only` 限制或界面描述。该字段只描述已派生位置的 Owner 可见集合，不声明每张有效 GPS 都已经完成转换。

**运行约束与以后开发规则：** `config.enabled + 当前有效 Server AK` 是系统的唯一启用条件，不增加审核员签名、许可截图、受信证据引用、人工放行、代码中写死的 NO-GO 开关。配额/公平调度、官方目标 HTTPS、Owner/来源版本、会话、取消和 JSAPI4 资源隔离不属于人工核验开关，仍必须保留。百度的账户条款由服务使用者承担，xDrive 不应声称自己独立核验了账户许可。


**验收依据：** PostgreSQL 测试必须验证“不创建 Consent 表也能批量入队”、Owner 隔离、无效 GPS 排除、分批游标、旧租约/完成任务修复，以及源 GPS 修改后的重规划；真实百度服务和最终 3,323 张照片可见性在部署环境实测之前仍为**未验收**。
