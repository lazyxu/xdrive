package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
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
	v1.POST("/auth/login", s.login)
	v1.POST("/auth/refresh", s.refresh)
	v1.POST("/auth/logout", s.logout)

	authed := v1.Group("")
	authed.Use(s.requireAuth())
	authed.GET("/me", s.me)
	authed.POST("/me/change-password", s.changePassword)
	authed.GET("/nodes/root", s.root)
	authed.GET("/nodes/:id/children", s.children)
	authed.POST("/nodes/:id/directories", s.createDirectory)
	authed.POST("/nodes/:id/files", s.uploadFile)
	authed.PATCH("/nodes/:id", s.updateNode)
	authed.DELETE("/nodes/:id", s.deleteNode)
	authed.GET("/trash", s.trashList)
	authed.POST("/trash/:id/restore", s.trashRestore)
	authed.DELETE("/trash/:id", s.trashDeletePermanently)
	authed.GET("/files/:id/content", s.downloadFile)
	authed.PUT("/files/:id/content", s.overwriteFile)
	authed.GET("/files/:id/versions", s.fileVersions)
	authed.GET("/files/:id/versions/:versionID/content", s.downloadFileVersion)
	authed.POST("/files/:id/versions/:versionID/restore", s.restoreFileVersion)

	admin := authed.Group("/admin")
	admin.Use(s.requireAdmin())
	admin.GET("/users", s.adminListUsers)
	admin.POST("/users", s.adminCreateUser)
	admin.PATCH("/users/:id", s.adminUpdateUser)
	admin.DELETE("/users/:id", s.adminDeleteUser)
	admin.POST("/users/:id/reset-password", s.adminResetPassword)
	admin.POST("/users/:id/revoke-sessions", s.adminRevokeSessions)
	return r
}

func (s *Server) cors() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" && (s.AllowedOrigin == "*" || origin == s.AllowedOrigin) {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match")
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
		uid, tokenVersion, err := s.Auth.Parse(strings.TrimSpace(h[7:]))
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid bearer token"})
			return
		}
		var user meta.User
		if err := s.DB.First(&user, uid).Error; err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
			return
		}
		if user.DisabledAt != nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "account_disabled"})
			return
		}
		// tokenVersion=0 is accepted only for pre-session-version migration JWTs.
		if (tokenVersion == 0 && user.SessionVersion > 1) || (tokenVersion != 0 && tokenVersion != user.SessionVersion) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "session_revoked"})
			return
		}
		path := c.Request.URL.Path
		if user.MustChangePassword && path != "/api/v1/me" && path != "/api/v1/me/change-password" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "password_change_required"})
			return
		}
		c.Set("userID", uid)
		c.Set("user", user)
		c.Next()
	}
}

func (s *Server) requireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		user, ok := currentUser(c)
		if !ok || user.Role != meta.UserRoleAdmin {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "admin_required"})
			return
		}
		c.Next()
	}
}

func userID(c *gin.Context) uint64 {
	v, _ := c.Get("userID")
	uid, _ := v.(uint64)
	return uid
}

func currentUser(c *gin.Context) (meta.User, bool) {
	v, ok := c.Get("user")
	if !ok {
		return meta.User{}, false
	}
	user, ok := v.(meta.User)
	return user, ok
}
