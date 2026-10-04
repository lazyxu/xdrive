package api

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"github.com/lazyxu/xdrive/internal/version"
	"gorm.io/gorm"
)

type Server struct {
	DB                        *gorm.DB
	Store                     storage.Store
	Auth                      auth.Manager
	RefreshTTL                time.Duration
	AllowedOrigin             string
	MaxUploadBytes            int64
	SourceRunFailureRetention time.Duration
	ConnectorSecrets          *connectorsecret.Keyring
	HostControlDir            string
	credentialTest            sourceCredentialTester
	fileStationBrowse         sourceFileStationBrowser
	obs                       *serverObservability
	stagingCacheMu            sync.Mutex
	stagingCacheAt            time.Time
	stagingCache              uploadStagingInventory
	fileOperationCancelMu     sync.Mutex
	fileOperationCancels      map[string]context.CancelCauseFunc
}

func (s *Server) Router() *gin.Engine {
	s.ensureObservability()
	r := gin.New()
	r.Use(s.requestID(), s.observeHTTP(), s.recovery(), s.cors())
	r.MaxMultipartMemory = 8 << 20
	r.GET("/metrics", s.metrics)

	v1 := r.Group("/api/v1")
	v1.GET("/healthz", s.healthz)
	v1.GET("/readyz", s.readyz)
	v1.GET("/version", s.versionInfo)
	v1.POST("/auth/login", s.login)
	v1.POST("/auth/refresh", s.refresh)
	v1.POST("/auth/logout", s.logout)
	v1.GET("/public/share", s.publicShareMetadata)
	v1.POST("/public/share/download", s.publicShareDownload)
	v1.GET("/media/play/:id", s.mediaVideoTicketStream)

	authed := v1.Group("")
	authed.Use(s.requireAuth())
	authed.GET("/me", s.me)
	authed.GET("/me/quota", s.quotaUsage)
	authed.GET("/me/storage", s.storageStats)
	authed.POST("/me/change-password", s.changePassword)
	authed.GET("/search", s.searchNodes)
	authed.GET("/changes", s.listNodeChanges)
	authed.GET("/nodes/root", s.root)
	authed.GET("/nodes/:id/children", s.children)
	authed.POST("/nodes/:id/directories", s.createDirectory)
	authed.POST("/nodes/:id/files", s.uploadFile)
	authed.POST("/nodes/:id/copy", s.copyNode)
	authed.POST("/nodes/batch/copy", s.batchCopyNodes)
	authed.POST("/nodes/batch/move", s.batchMoveNodes)
	authed.POST("/nodes/batch/delete", s.batchDeleteNodes)
	authed.POST("/file-operations", s.createFileOperation)
	authed.GET("/file-operations", s.listFileOperations)
	authed.DELETE("/file-operations", s.clearFileOperationHistory)
	authed.GET("/file-operations/:id", s.getFileOperation)
	authed.POST("/file-operations/:id/cancel", s.cancelFileOperation)
	authed.POST("/file-operations/:id/retry", s.retryFileOperation)
	authed.POST("/file-operations/:id/resolve", s.resolveFileOperationConflict)
	authed.PATCH("/nodes/:id", s.updateNode)
	authed.DELETE("/nodes/:id", s.deleteNode)
	authed.GET("/trash", s.trashList)
	authed.POST("/trash/:id/restore", s.trashRestore)
	authed.DELETE("/trash/:id", s.trashDeletePermanently)
	authed.GET("/files/:id/content", s.downloadFile)
	authed.POST("/download/archive", s.downloadArchive)
	authed.GET("/media/items", s.listMediaItems)
	authed.GET("/media/items/:id", s.getMediaItem)
	authed.PATCH("/media/items/:id/favorite", s.setMediaFavorite)
	authed.PATCH("/media/items/:id/tags", s.setMediaTags)
	authed.PATCH("/media/items/:id/description", s.setMediaDescription)
	authed.GET("/media/items/:id/thumbnail", s.mediaThumbnail)
	authed.GET("/media/items/:id/live-photo-motion", s.mediaLivePhotoMotion)
	authed.GET("/media/items/:id/video", s.mediaVideo)
	authed.POST("/media/items/:id/video-ticket", s.mediaVideoTicket)
	authed.GET("/media/items/:id/playback", s.mediaPlayback)
	authed.POST("/media/items/:id/playback-ticket", s.mediaPlaybackTicket)
	authed.GET("/media/items/:id/resources/:role", s.mediaDerivedResourceContent)
	authed.GET("/media/albums", s.listMediaAlbums)
	authed.GET("/media/places", s.listMediaPlaces)
	authed.POST("/media/albums", s.createMediaAlbum)
	authed.PATCH("/media/albums/:albumID", s.renameMediaAlbum)
	authed.DELETE("/media/albums/:albumID", s.deleteMediaAlbum)
	authed.GET("/media/albums/:albumID/items", s.listMediaAlbumItems)
	authed.POST("/media/albums/:albumID/items", s.addMediaAlbumItems)
	authed.DELETE("/media/albums/:albumID/items/:nodeID", s.removeMediaAlbumItem)
	authed.POST("/media/smart-albums", s.createSmartMediaAlbum)
	authed.PATCH("/media/smart-albums/:albumID", s.updateSmartMediaAlbum)
	authed.DELETE("/media/smart-albums/:albumID", s.deleteSmartMediaAlbum)
	authed.PUT("/files/:id/content", s.overwriteFile)
	authed.POST("/uploads/preflight", s.preflightUploadConflict)
	authed.POST("/uploads", s.createUploadSession)
	authed.GET("/uploads/:id", s.getUploadSession)
	authed.PUT("/uploads/:id/chunks/:index", s.putUploadChunk)
	authed.POST("/uploads/:id/finalize", s.finalizeUploadSession)
	authed.DELETE("/uploads/:id", s.abortUploadSession)
	authed.GET("/files/:id/versions", s.fileVersions)
	authed.GET("/files/:id/versions/:versionID/content", s.downloadFileVersion)
	authed.POST("/files/:id/versions/:versionID/restore", s.restoreFileVersion)
	authed.POST("/files/:id/shares", s.createFileShare)
	authed.GET("/files/:id/shares", s.listFileShares)
	authed.DELETE("/shares/:id", s.revokeShare)

	authed.POST("/source-credentials/test", s.testSourceCredential)

	authed.GET("/sources", s.listSources)
	authed.GET("/sources/overview", s.listSourceOverview)
	authed.POST("/sources", s.createSource)
	authed.GET("/sources/:id", s.getSource)
	authed.PATCH("/sources/:id", s.updateSource)
	authed.DELETE("/sources/:id", s.deleteSource)
	authed.POST("/sources/:id/trigger", s.triggerSource)
	authed.GET("/sources/:id/credential", s.getSourceCredentialStatus)
	authed.PUT("/sources/:id/credential", s.putSourceCredential)
	authed.POST("/sources/:id/credential/test", s.testStoredSourceCredential)
	authed.POST("/sources/:id/credential/reveal", s.revealSourceCredential)
	authed.DELETE("/sources/:id/credential", s.deleteSourceCredential)
	authed.GET("/sources/:id/connector-config", s.getSourceConnectorConfig)
	authed.PUT("/sources/:id/connector-config", s.putSourceConnectorConfig)
	authed.GET("/sources/:id/browse", s.browseSourceDirectories)
	authed.GET("/sources/:id/items", s.listSourceItems)
	authed.GET("/sources/:id/collections", s.listSourceCollections)
	authed.GET("/sources/:id/collections/:collectionID/items", s.listSourceCollectionItems)
	authed.GET("/sources/:id/runs", s.listSourceRuns)
	authed.POST("/sources/:id/runs", s.beginSourceRun)
	authed.GET("/sources/:id/runs/:runID", s.getSourceRun)
	authed.GET("/sources/:id/runs/:runID/failures", s.listSourceRunFailures)
	authed.POST("/sources/:id/runs/:runID/observe", s.observeSourceRun)
	authed.POST("/sources/:id/runs/:runID/commit", s.commitSourceRun)
	authed.POST("/sources/:id/runs/:runID/failures", s.failSourceRunItems)
	authed.POST("/sources/:id/runs/:runID/progress", s.progressSourceRun)
	authed.POST("/sources/:id/runs/:runID/cancel", s.cancelSourceRun)
	authed.POST("/sources/:id/runs/:runID/heartbeat", s.heartbeatSourceRun)
	authed.POST("/sources/:id/runs/:runID/finish", s.finishSourceRun)

	admin := authed.Group("/admin")
	admin.Use(s.requireAdmin())
	admin.GET("/users", s.adminListUsers)
	admin.GET("/audit", s.adminAuditEvents)
	admin.GET("/update", s.adminServerUpdateStatus)
	admin.POST("/update", s.adminStartServerUpdate)
	admin.GET("/storage", s.adminStorageStats)
	admin.GET("/storage/health", s.adminStorageHealth)
	admin.GET("/storage/history", s.adminStorageHistory)
	admin.GET("/storage/staging", s.adminUploadStaging)
	admin.POST("/storage/staging/cleanup", s.adminCleanupUploadStaging)
	admin.GET("/storage/staging/cleanup-runs", s.adminStagingCleanupRuns)
	admin.GET("/storage/staging/cleanup-runs/:runID/failures", s.adminStagingCleanupFailures)
	admin.POST("/users", s.adminCreateUser)
	admin.PATCH("/users/:id", s.adminUpdateUser)
	admin.DELETE("/users/:id", s.adminDeleteUser)
	admin.POST("/users/:id/reset-password", s.adminResetPassword)
	admin.POST("/users/:id/revoke-sessions", s.adminRevokeSessions)
	return r
}

func (s *Server) healthz(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s *Server) versionInfo(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, version.Metadata())
}

type storageReadinessChecker interface {
	Ready(context.Context) error
}

func (s *Server) readyz(c *gin.Context) {
	databaseStatus := "ok"
	storageStatus := "ok"

	dbCtx, dbCancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	sqlDB, err := s.DB.DB()
	if err != nil || sqlDB.PingContext(dbCtx) != nil {
		databaseStatus = "unavailable"
	}
	dbCancel()

	if checker, ok := s.Store.(storageReadinessChecker); ok {
		storageCtx, storageCancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		if err := checker.Ready(storageCtx); err != nil {
			storageStatus = "unavailable"
		}
		storageCancel()
	}

	status := http.StatusOK
	if databaseStatus != "ok" || storageStatus != "ok" {
		status = http.StatusServiceUnavailable
	}
	c.JSON(status, gin.H{
		"ok":       status == http.StatusOK,
		"database": databaseStatus,
		"storage":  storageStatus,
	})
}

func (s *Server) cors() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" && (s.AllowedOrigin == "*" || origin == s.AllowedOrigin) {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match, X-Chunk-SHA256, X-XDrive-Share-Token, X-Request-ID")
			c.Header("Access-Control-Expose-Headers", "ETag, X-Content-SHA256, Content-Range, X-Request-ID")
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
