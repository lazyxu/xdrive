package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

type Server struct {
	DB             *gorm.DB
	Store          storage.Store
	Auth           auth.Manager
	RefreshTTL     time.Duration
	AllowedOrigin  string
	MaxUploadBytes int64
}

func (s *Server) Router() *gin.Engine {
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery(), s.cors())
	r.MaxMultipartMemory = 8 << 20

	v1 := r.Group("/api/v1")
	v1.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
	v1.POST("/auth/register", s.register)
	v1.POST("/auth/login", s.login)
	v1.POST("/auth/refresh", s.refresh)
	v1.POST("/auth/logout", s.logout)

	authed := v1.Group("")
	authed.Use(s.requireAuth())
	authed.GET("/me", s.me)
	authed.GET("/nodes/root", s.root)
	authed.GET("/nodes/:id/children", s.children)
	authed.POST("/nodes/:id/directories", s.createDirectory)
	authed.POST("/nodes/:id/files", s.uploadFile)
	authed.PATCH("/nodes/:id", s.updateNode)
	authed.DELETE("/nodes/:id", s.deleteNode)
	authed.GET("/files/:id/content", s.downloadFile)
	authed.PUT("/files/:id/content", s.overwriteFile)
	return r
}

func (s *Server) cors() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" && (s.AllowedOrigin == "*" || origin == s.AllowedOrigin) {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func (s *Server) requireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		h := strings.TrimSpace(c.GetHeader("Authorization"))
		if !strings.HasPrefix(strings.ToLower(h), "bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing bearer token"})
			return
		}
		uid, err := s.Auth.Parse(strings.TrimSpace(h[7:]))
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid bearer token"})
			return
		}
		c.Set("userID", uid)
		c.Next()
	}
}

func userID(c *gin.Context) uint64 {
	v, _ := c.Get("userID")
	uid, _ := v.(uint64)
	return uid
}
