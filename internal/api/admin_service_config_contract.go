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
		return "deployment", "manual-reload",
			"将 cities500.txt、admin1CodesASCII.txt、countryInfo.txt 安装到只读 /geonames；管理员可在本页校验并热加载更新后的数据集，任务按不可变索引版本完成。初始目录与搜索半径仍由部署配置决定，修改它们须受控部署；不提供地图"
	case "photo-face", "photo-smart", "photo-semantic", "photo-creative":
		return "deployment", "controlled-restart",
			"统一使用可选 photo-intelligence 容器；配置 COMPOSE_PROFILES、XD_PHOTO_FACE_ANALYZER_SOCKET 及模型镜像。容器/Socket 变更需部署操作；本页只检测实际模型连接，不假装开关可启动容器"
	case "media-worker":
		return "planned", "not-available",
			"独立可选 Media Worker（FFmpeg/FFprobe）仍待实现真实协议、队列、取消、资源隔离及健康探针；当前不能在页面启用"
	case "database":
		return "deployment", "controlled-restart",
			"PostgreSQL 连接、版本和数据卷由部署配置管理；迁移或更新前需要备份及维护窗口，不允许应用在运行中修改自己的数据库连接"
	case "storage":
		return "deployment", "controlled-restart",
			"本地存储根目录和挂载由宿主部署管理；迁移、重新挂载或存储引擎切换应经过备份与受控维护，不提供在线假开关"
	case "background-worker":
		return "deployment", "controlled-restart",
			"后台 Worker 是独立 Compose 服务；配置、镜像和资源限制需要受控部署，当前没有可证明的独立进程健康状态或在线启动接口"
	case "caddy":
		return "deployment", "controlled-restart",
			"Caddy、HTTPS 证书、域名与端口由部署配置和受限 Host Manager 管理；修改可能要求网关重载或重建，不能从 Server 直接调用 Docker"
	default:
		return "planned", "not-available", "尚无受支持的安全配置与应用合同"
	}
}
