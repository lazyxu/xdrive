package api

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type serviceDependency struct {
	ID      string `json:"id"`
	Group   string `json:"group"`
	Label   string `json:"label"`
	Status  string `json:"status"`
	Detail  string `json:"detail"`
	Version string `json:"version,omitempty"`
	Model   string `json:"model,omitempty"`
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
		{ID: "map-tiles", Group: "location", Label: "地图瓦片 Provider", Status: "planned", Detail: "在线／自托管瓦片尚未接入；现有 Places 本地地图不受影响"},
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
	wg.Wait()
	c.JSON(http.StatusOK, serviceDependenciesSnapshot{
		CheckedAt: time.Now().UTC().Format(time.RFC3339),
		Services:  services,
	})
}
