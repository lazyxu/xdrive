package api

// Service configuration and activation modes intentionally describe the
// CURRENTLY IMPLEMENTED system-wide control path, not an intended future container API.
// Per-user Sync Folder connectors have their own settings and must not appear here.
// In particular, "controlled-restart" is informational: Server does NOT have
// Docker socket access and cannot arbitrarily restart its dependencies.
// "manual-reload" is reserved for a real audited, live-index reload endpoint.
func serviceDependencyConfigContract(id string) (mode, apply, hint string) {
	switch id {
	case "baidu-map":
		return "in-app", "immediate",
			"在本页配置、启用或更换 Server AK；加密保存后新请求直接生效，无须重启。已配置不等于远端服务健康"
	case "geonames":
		return "in-app", "immediate",
			"在管理员页面持久化修改匹配距离（大于0且不超过500 km）并热生效；完整数据集可手动验证重载。数据根目录仍是受信任的只读部署挂载。其他 Server 实例每 30 秒尝试读取最新匹配距离、校验现有只读数据集并热生效；失败保留旧索引并显示待生效。状态仅代表当前实例，不是集群确认；GeoNames 仅提供地名标签"
	case "photo-face", "photo-smart", "photo-semantic":
		return "deployment", "controlled-restart",
			"模型容器、Socket 和资源参数仍由受控部署管理；本页可独立配置人脸、视觉/OCR、语义、人物聚类四类自动任务的准入策略并热生效，不会启动/停止容器或取消运行中任务"
	case "photo-creative":
		return "deployment", "controlled-restart",
			"统一使用可选 photo-intelligence 容器；配置 COMPOSE_PROFILES、XD_PHOTO_FACE_ANALYZER_SOCKET 及模型镜像。容器/Socket 变更需部署操作；本页只检测实际模型连接，不假装开关可启动容器"
	case "media-worker":
		return "deployment", "controlled-restart",
			"可通过部署提供独立 FFmpeg/FFprobe 进程与私有 Unix Socket，管理员页面只读探测实际可执行性。媒体任务协议、可配置并发和动态应用尚未实现；不能在此启停容器。必须由运维预配私有目录并受控部署，不影响现有传输与同步"
	case "database":
		return "in-app", "immediate",
			"本页仅支持配置 xDrive Server 的 database/sql 最大打开连接数与最大空闲连接数，经版本校验和审计后当前实例热生效；其他 Server 定期协调并独立确认。PostgreSQL 地址、密码、版本、数据卷和服务重启仍由受控部署管理。此配置不改变数据库服务端参数"
	case "storage":
		return "deployment", "controlled-restart",
			"本地存储根目录和挂载由宿主部署管理；迁移、重新挂载或存储引擎切换应经过备份与受控维护，不提供在线假开关"
	case "background-worker":
		return "in-app", "task-boundary",
			"管理员可保存、审计、回滚独立 Pull Worker 的扫描周期、轮询周期和并发。Worker 在已运行批次结束后的安全边界热应用，心跳确认前只显示待生效；容器镜像、CPU/RAM 和启动停止仍由部署管理"
	case "caddy":
		return "deployment", "controlled-restart",
			"Caddy、HTTPS 证书、域名与端口由部署配置和受限 Host Manager 管理；修改可能要求网关重载或重建，不能从 Server 直接调用 Docker"
	default:
		return "planned", "not-available", "尚无受支持的安全配置与应用合同"
	}
}
