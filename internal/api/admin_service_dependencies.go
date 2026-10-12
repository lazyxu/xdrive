package api

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/mediaworker"
)

type serviceDependency struct {
	ID                               string `json:"id"`
	Group                            string `json:"group"`
	Label                            string `json:"label"`
	Status                           string `json:"status"`
	Detail                           string `json:"detail"`
	Version                          string `json:"version,omitempty"`
	Model                            string `json:"model,omitempty"`
	ConfigMode                       string `json:"config_mode"`
	ApplyMode                        string `json:"apply_mode"`
	ConfigHint                       string `json:"config_hint,omitempty"`
	ConfigurationState               string `json:"configuration_state"`
	InstallationState                string `json:"installation_state"`
	HealthState                      string `json:"health_state"`
	ActivationState                  string `json:"activation_state"`
	AutomaticPolicyState             string `json:"automatic_policy_state,omitempty"`
	AutomaticPolicyDesiredRevision   uint64 `json:"automatic_policy_desired_revision,omitempty"`
	AutomaticPolicyEffectiveRevision uint64 `json:"automatic_policy_effective_revision,omitempty"`
	HTTPSConfigured                  *bool  `json:"https_configured,omitempty"`
	LocalTLSState                    string `json:"local_tls_state,omitempty"`
}

type serviceDependenciesSnapshot struct {
	CheckedAt string              `json:"checked_at"`
	Services  []serviceDependency `json:"services"`
}

// adminServiceDependencies reports observed service health only. It neither starts
// containers nor exposes Docker, socket locations, credentials, or analyzer errors.
func (s *Server) adminServiceDependencies(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()

	services := []serviceDependency{
		{ID: "database", Group: "core", Label: "PostgreSQL", Status: "unavailable", Detail: "数据库未连接"},
		{ID: "storage", Group: "core", Label: "文件存储", Status: "unavailable", Detail: "存储不可用"},
		{ID: "media-worker", Group: "media", Label: "FFmpeg Media Worker", Status: "disabled", Detail: "尚未配置独立媒体运行时的私有 Unix Socket；现有视频播放不依赖它"},
		{ID: "photo-face", Group: "intelligence", Label: "人脸检测与人物聚类", Status: "disabled", Detail: "未配置本地人脸分析器"},
		{ID: "photo-smart", Group: "intelligence", Label: "动物／物体识别与 OCR", Status: "disabled", Detail: "未配置本地智能识别分析器"},
		{ID: "photo-semantic", Group: "intelligence", Label: "图片语义搜索", Status: "disabled", Detail: "未配置本地语义分析器"},
		{ID: "geonames", Group: "location", Label: "GeoNames 离线地名", Status: "disabled", Detail: "未配置离线地名数据"},
		{ID: "baidu-map", Group: "location", Label: "百度地图 Server API", Status: "disabled", Detail: "尚未启用百度地图；不使用其他地图底图"},
		{ID: "photo-creative", Group: "intelligence", Label: "照片创作处理", Status: "disabled", Detail: "未配置抠图、照片电影与拼图分析器"},
		{ID: "background-worker", Group: "core", Label: "后台 Worker", Status: "unknown", Detail: "尚未确认独立 Pull Worker 的心跳状态"},
		{ID: "caddy", Group: "core", Label: "Caddy / HTTPS 网关", Status: "unknown", Detail: "当前 Server 未提供独立网关进程健康探针"},
	}

	cfg, configErr := s.effectiveBaiduMapConfig(ctx)
	switch {
	case configErr != nil:
		services[7].Status = "unavailable"
		services[7].Detail = "百度地图配置无法读取，请检查加密密钥或数据库"
	case cfg.Enabled && cfg.Configured:
		services[7].Status = "unknown"
		services[7].Detail = "百度地图 AK 已配置且启用，按需取图验证，不消耗额外 API 配额"
		services[7].Version = "Static Map v2 · WGS84"
	case cfg.Enabled && !cfg.Configured:
		services[7].Status = "disabled"
		services[7].Detail = "尚未填写百度地图 Server AK"
	default:
		services[7].Status = "disabled"
		services[7].Detail = "百度地图未启用；不会回退到其他地图"
	}
	if s.PhotoPlaceResolver != nil {
		services[6].Status = "ready"
		services[6].Detail = "离线地名索引已加载"
		services[6].Version = s.PhotoPlaceResolver.Version()
	}

	var wg sync.WaitGroup
	mediaManaged := false
	mediaConfigUnreadable := false
	if s.DB != nil {
		desired, err := s.readMediaWorkerDesired(ctx)
		if err != nil {
			mediaConfigUnreadable = true
			// Corrupt or inaccessible desired configuration cannot be reported ready
			// merely because a separately installed FFmpeg executable responds.
			mediaManaged = true
			services[2].Status = "unavailable"
			services[2].Detail = "Media Worker 管理配置不可读取；无法确认实际生效"
		} else if desired.Revision != 0 {
			mediaManaged = true
			host := s.readMediaWorkerHostStatus()
			if desired.Enabled {
				services[2].Status = "unavailable"
				services[2].Detail = "Media Worker 期望启用；等待宿主机对内存、CPU、PID 及运行健康完成验证"
				if host.Supported && host.ObservedEnabled &&
					mediaWorkerApplied(desired, host, s.mediaWorkerRuntimeReady(ctx)) {
					services[2].Status = "ready"
					services[2].Detail = "容器启动、内存/CPU/PID 限制和 FFmpeg/FFprobe 均已验证；媒体作业尚未接入"
				}
			} else {
				services[2].Status = "unavailable"
				services[2].Detail = "管理员期望停用；等待宿主机确认容器已停止及资源限制已保存"
				if mediaWorkerApplied(desired, host, false) {
					services[2].Status = "disabled"
					services[2].Detail = "容器停止且下次启用的内存、CPU、PID 限制已核验"
				}
			}
		}
	}
	if s.MediaWorkerConfigured && !mediaManaged {
		services[2].Status = "unavailable"
		services[2].Detail = "媒体运行时已配置，但 FFmpeg/FFprobe 实际健康检查未通过"
		if s.MediaWorkerProbe != nil {
			wg.Add(1)
			go func() {
				defer wg.Done()
				info, err := s.MediaWorkerProbe.Info(ctx)
				if err != nil || !mediaworker.ValidInfo(info) {
					return
				}
				services[2].Status = "ready"
				services[2].Detail = "FFmpeg 与 FFprobe 子进程探针通过；媒体作业队列尚未接入"
				services[2].Version = info.FFmpegVersion
				services[2].Model = info.FFprobeVersion
			}()
		}
	}
	if s.DB != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sqlDB, err := s.DB.DB()
			if err == nil {
				err = sqlDB.PingContext(ctx)
			}
			if err == nil {
				services[0].Status = "ready"
				services[0].Detail = "数据库连接正常"
			}
		}()
	}
	if s.Store != nil {
		if checker, ok := s.Store.(interface{ Ready(context.Context) error }); ok {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if checker.Ready(ctx) == nil {
					services[1].Status = "ready"
					services[1].Detail = "存储就绪探针通过"
				}
			}()
		} else {
			services[1].Status = "unknown"
			services[1].Detail = "当前存储后端未提供就绪探针"
		}
	}
	if s.PhotoFaceAnalyzer != nil {
		services[3].Status = "unavailable"
		services[3].Detail = "分析器已配置，但健康检查未通过"
		wg.Add(1)
		go func() {
			defer wg.Done()
			info, err := s.PhotoFaceAnalyzer.Info(ctx)
			if err != nil {
				return
			}
			services[3].Status = "ready"
			services[3].Detail = "人脸检测／特征模型已连接"
			services[3].Version = info.PipelineVersion
			services[3].Model = info.Detector.Name + " / " + info.Embedding.Name
		}()
	}
	if s.PhotoSmartAnalyzer != nil {
		services[4].Status = "unavailable"
		services[4].Detail = "分析器已配置，但健康检查未通过"
		wg.Add(1)
		go func() {
			defer wg.Done()
			info, err := s.PhotoSmartAnalyzer.Info(ctx)
			if err != nil {
				return
			}
			services[4].Status = "ready"
			services[4].Detail = "物体分类／OCR 模型已连接"
			services[4].Version = info.PipelineVersion
			services[4].Model = info.Classifier.Name + " / " + info.TextRecognizer.Name
		}()
	}
	if s.PhotoSemanticAnalyzer != nil {
		services[5].Status = "unavailable"
		services[5].Detail = "分析器已配置，但健康检查未通过"
		wg.Add(1)
		go func() {
			defer wg.Done()
			info, err := s.PhotoSemanticAnalyzer.Info(ctx)
			if err != nil {
				return
			}
			services[5].Status = "ready"
			services[5].Detail = "图文向量模型已连接"
			services[5].Version = info.PipelineVersion
			services[5].Model = info.VisionModel.Name + " / " + info.TextModel.Name
		}()
	}
	if s.PhotoCreativeAnalyzer != nil {
		services[8].Status = "unavailable"
		services[8].Detail = "创作分析器已配置，但健康检查未通过"
		wg.Add(1)
		go func() {
			defer wg.Done()
			info, err := s.PhotoCreativeAnalyzer.Info(ctx)
			if err != nil {
				return
			}
			services[8].Status = "ready"
			services[8].Detail = "抠图、照片电影与拼图分析器已连接"
			services[8].Version = info.PipelineVersion
			services[8].Model = info.SegmentModel.Name
		}()
	}
	// Observe Caddy from the restricted host's fixed-container Docker health
	// probe, not a Server-to-itself HTTP proxy request. A configured domain
	// is deployment intent only: it does not prove ACME/TLS or public reachability.
	caddyContainerObserved := false
	if gateway, valid := s.readCaddyHostStatus(); valid {
		caddyContainerObserved = gateway.State != "unknown"
		services[10].HTTPSConfigured = &gateway.HTTPSConfigured
		if gateway.TLSCheckSupported {
			services[10].LocalTLSState = gateway.TLSState
		}
		mode := "宿主机配置未要求自定义 HTTPS 域名"
		if gateway.HTTPSConfigured {
			mode = "宿主机配置要求 HTTPS 域名，但未独立验证证书及公网可达性"
		}
		switch gateway.State {
		case "healthy":
			services[10].Status = "ready"
			services[10].Detail = "Caddy 容器健康检查通过，内部 HTTP 反向代理可用；" + mode
			if gateway.HTTPSConfigured {
				switch {
				case !gateway.TLSCheckSupported || gateway.TLSState == "unavailable":
					services[10].Status = "unknown"
					services[10].Detail = "内部 HTTP 代理健康，但本机 HTTPS 证书验证不可用；未确认 HTTPS 实际生效及公网可达性"
				case gateway.TLSState == "verified":
					services[10].Detail = "内部 HTTP 代理健康；本机 HTTPS TLS 握手、证书信任链及域名校验通过；公网访问未验证"
				case gateway.TLSState == "failed":
					services[10].Status = "unavailable"
					services[10].Detail = "内部 HTTP 代理健康，但本机 HTTPS 握手或证书域名校验失败；HTTPS 未生效"
				case gateway.TLSState == "invalid-config":
					services[10].Status = "unavailable"
					services[10].Detail = "内部 HTTP 代理健康，但 HTTPS 域名或端口配置不合法；未进行 TLS 探测"
				default:
					services[10].Status = "unknown"
					services[10].Detail = "内部 HTTP 代理健康，但宿主机尚未报告可信 HTTPS 证书验证状态"
				}
			}
		case "unhealthy":
			services[10].Status = "unavailable"
			services[10].Detail = "Caddy 容器健康检查失败；" + mode
		case "stopped":
			services[10].Status = "unavailable"
			services[10].Detail = "Caddy 容器已停止；" + mode
		case "starting":
			services[10].Detail = "Caddy 容器启动中，尚未通过健康检查；" + mode
		case "running-unverified":
			services[10].Detail = "Caddy 容器在运行，但尚无可信的健康检查结果；" + mode
		default:
			services[10].Detail = "Host Manager 无法获取可信 Caddy 容器健康状态；" + mode
		}
	}

	if s.DB != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			services[9].Status, services[9].Detail = s.sourceWorkerServiceStatus(ctx, time.Now().UTC())
		}()
	}
	wg.Wait()
	for i := range services {
		services[i].ConfigMode, services[i].ApplyMode, services[i].ConfigHint =
			serviceDependencyConfigContract(services[i].ID)
	}
	// Preserve legacy status. Each new axis uses only its own proof.
	s.setServiceLifecycleStates(ctx, services, cfg, configErr, mediaManaged, mediaConfigUnreadable, caddyContainerObserved)
	c.JSON(http.StatusOK, serviceDependenciesSnapshot{
		CheckedAt: time.Now().UTC().Format(time.RFC3339),
		Services:  services,
	})
}
