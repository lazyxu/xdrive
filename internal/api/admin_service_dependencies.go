package api

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type serviceDependency struct {
	ID         string `json:"id"`
	Group      string `json:"group"`
	Label      string `json:"label"`
	Status     string `json:"status"`
	Detail     string `json:"detail"`
	Version    string `json:"version,omitempty"`
	Model      string `json:"model,omitempty"`
	ConfigMode string `json:"config_mode"`
	ApplyMode  string `json:"apply_mode"`
	ConfigHint string `json:"config_hint,omitempty"`
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
		{ID: "media-worker", Group: "media", Label: "FFmpeg Media Worker", Status: "planned", Detail: "尚未接入媒体处理服务与健康探针；普通视频播放不依赖此服务"},
		{ID: "photo-face", Group: "intelligence", Label: "人脸检测与人物聚类", Status: "disabled", Detail: "未配置本地人脸分析器"},
		{ID: "photo-smart", Group: "intelligence", Label: "动物／物体识别与 OCR", Status: "disabled", Detail: "未配置本地智能识别分析器"},
		{ID: "photo-semantic", Group: "intelligence", Label: "图片语义搜索", Status: "disabled", Detail: "未配置本地语义分析器"},
		{ID: "geonames", Group: "location", Label: "GeoNames 离线地名", Status: "disabled", Detail: "未配置离线地名数据"},
		{ID: "baidu-map", Group: "location", Label: "百度地图 Server API", Status: "disabled", Detail: "尚未启用百度地图；不使用其他地图底图"},
		{ID: "photo-creative", Group: "intelligence", Label: "照片创作处理", Status: "disabled", Detail: "未配置抠图、照片电影与拼图分析器"},
		{ID: "background-worker", Group: "core", Label: "后台 Worker", Status: "unknown", Detail: "当前 Server 未提供独立 Worker 进程健康探针"},
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
	wg.Wait()
	for i := range services {
		services[i].ConfigMode, services[i].ApplyMode, services[i].ConfigHint =
			serviceDependencyConfigContract(services[i].ID)
	}
	c.JSON(http.StatusOK, serviceDependenciesSnapshot{
		CheckedAt: time.Now().UTC().Format(time.RFC3339),
		Services:  services,
	})
}
