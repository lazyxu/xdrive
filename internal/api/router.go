package api

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"github.com/lazyxu/xdrive/internal/storage"
	"github.com/lazyxu/xdrive/internal/version"
	"gorm.io/gorm"
)

type Server struct {
	DB                             *gorm.DB
	Store                          storage.Store
	Auth                           auth.Manager
	RefreshTTL                     time.Duration
	AllowedOrigin                  string
	MaxUploadBytes                 int64
	SourceRunFailureRetention      time.Duration
	ConnectorSecrets               *connectorsecret.Keyring
	PhotoPlaceResolver             photointelligence.PlaceResolver
	PhotoFaceAnalyzer              photointelligence.FaceAnalyzer
	PhotoSmartAnalyzer             photointelligence.SmartAnalyzer
	PhotoSemanticAnalyzer          photointelligence.SemanticAnalyzer
	PhotoCreativeAnalyzer          photointelligence.CreativeAnalyzer
	PhotoFacePreviewBaseURL        string
	HostControlDir                 string
	FilesDataHostPath              string
	PostgresDataHostPath           string
	BackupRootHostPath             string
	XDriveHomeHostPath             string
	CaddyDataHostPath              string
	CaddyConfigHostPath            string
	BackgroundScheduler            *background.Scheduler
	BackgroundRuntimeInstanceID    string
	MediaIndexWakeups              <-chan uint64
	FileOperationWakeups           <-chan struct{}
	credentialTest                 sourceCredentialTester
	fileStationBrowse              sourceFileStationBrowser
	obs                            *serverObservability
	stagingCacheMu                 sync.Mutex
	stagingCacheAt                 time.Time
	stagingCache                   uploadStagingInventory
	fileOperationCancelMu          sync.Mutex
	fileOperationCancels           map[string]context.CancelCauseFunc
	archiveProgressMu              sync.Mutex
	archiveProgress                map[string]*archiveDownloadProgressState
	mediaIndexMu                   sync.Mutex
	mediaIndexOwners               map[uint64]*mediaIndexOwnerState
	photoIntelligenceMu            sync.Mutex
	photoIntelligenceOwners        map[photoIntelligenceOwnerKey]*photoIntelligenceOwnerState
	photoFaceRunner                photoFaceOwnerRunner
	photoSmartRunner               photoSmartOwnerRunner
	photoSemanticRunner            photoSemanticOwnerRunner
	photoPlaceRunner               photoPlaceOwnerRunner
	photoSemanticSearch            *photoSemanticSearchEngine
	photoPersonRunner              photoPersonOwnerRunner
	systemMaintenanceSourceVerify  systemMaintenanceSourceVerifyRunner
	systemMaintenanceSourceRepair  systemMaintenanceSourceRepairRunner
	systemMaintenanceMediaVerify   systemMaintenanceMediaVerifyRunner
	systemMaintenanceMediaRepair   systemMaintenanceMediaRepairRunner
	systemMaintenanceStorageVerify systemMaintenanceStorageVerifyRunner
	systemMaintenanceStorageRepair systemMaintenanceStorageRepairRunner
	systemMaintenanceHeartbeat     time.Duration
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
	v1.GET("/file-preview/:id", s.filePreviewTicketStream)
	v1.HEAD("/file-preview/:id", s.filePreviewTicketStream)
	v1.GET("/file-download/:id", s.fileDownloadTicketStream)
	v1.HEAD("/file-download/:id", s.fileDownloadTicketStream)
	v1.GET("/file-version-download/:id/:versionID", s.fileVersionDownloadTicketStream)
	v1.HEAD("/file-version-download/:id/:versionID", s.fileVersionDownloadTicketStream)
	v1.GET("/archive-download/:id", s.archiveDownloadTicketStream)
	v1.GET("/media-analysis-preview/:id", s.mediaAnalysisPreviewTicketStream)
	v1.GET("/media-creative-preview/:id", s.mediaCreativePreviewTicketStream)
	v1.GET("/media-live-photo-still/:id", s.mediaLivePhotoStillTicketStream)
	v1.HEAD("/media-live-photo-still/:id", s.mediaLivePhotoStillTicketStream)
	v1.GET("/media-live-photo-motion/:id", s.mediaLivePhotoMotionTicketStream)
	v1.HEAD("/media-live-photo-motion/:id", s.mediaLivePhotoMotionTicketStream)

	authed := v1.Group("")
	authed.Use(s.requireAuth())
	authed.GET("/me", s.me)
	authed.GET("/me/quota", s.quotaUsage)
	authed.GET("/me/storage", s.storageStats)
	authed.POST("/me/change-password", s.changePassword)
	authed.GET("/search", s.searchNodes)
	authed.GET("/changes", s.listNodeChanges)
	authed.GET("/nodes/root", s.root)
	authed.GET("/nodes/:id", s.getNode)
	authed.GET("/nodes/:id/children", s.children)
	authed.GET("/file-quick-access", s.listFileQuickAccess)
	authed.PUT("/file-quick-access/order", s.reorderFileQuickAccess)
	authed.PUT("/file-quick-access/:id", s.pinFileQuickAccess)
	authed.DELETE("/file-quick-access/:id", s.unpinFileQuickAccess)
	authed.GET("/file-tags", s.listFileTags)
	authed.POST("/file-tags", s.createFileTag)
	authed.PATCH("/file-tags/:id", s.updateFileTag)
	authed.DELETE("/file-tags/:id", s.deleteFileTag)
	authed.POST("/nodes/tags/query", s.queryFileNodeTags)
	authed.PUT("/file-tags/:id/nodes", s.addFileTagNodes)
	authed.DELETE("/file-tags/:id/nodes", s.removeFileTagNodes)
	authed.GET("/file-saved-searches", s.listFileSavedSearches)
	authed.POST("/file-saved-searches", s.createFileSavedSearch)
	authed.PUT("/file-saved-searches/order", s.reorderFileSavedSearches)
	authed.PATCH("/file-saved-searches/:id", s.updateFileSavedSearch)
	authed.DELETE("/file-saved-searches/:id", s.deleteFileSavedSearch)
	authed.GET("/file-favorites", s.listFileFavorites)
	authed.PUT("/file-favorites/:id", s.favoriteFile)
	authed.DELETE("/file-favorites/:id", s.unfavoriteFile)
	authed.GET("/file-recent", s.listFileRecent)
	authed.GET("/background-tasks", s.listBackgroundTasks)
	authed.GET("/background-tasks/page", s.listBackgroundTaskPage)
	authed.GET("/background-tasks/active-summary", s.backgroundTaskActiveSummary)
	authed.POST("/background-tasks/control", s.controlBackgroundTask)
	authed.POST("/photo-intelligence/reanalyze", s.reanalyzePhotoIntelligence)
	authed.POST("/file-recent/:id", s.touchFileRecent)
	authed.DELETE("/file-recent", s.clearFileRecent)
	authed.POST("/nodes/:id/directories", s.createDirectory)
	authed.POST("/nodes/:id/files", s.uploadFile)
	authed.POST("/nodes/:id/copy", s.copyNode)
	authed.POST("/nodes/batch/copy", s.batchCopyNodes)
	authed.POST("/nodes/batch/move", s.batchMoveNodes)
	authed.POST("/nodes/batch/delete", s.batchDeleteNodes)
	authed.POST("/nodes/properties/stats", s.filePropertiesStats)
	authed.POST("/nodes/media-details", s.fileMediaDetails)
	authed.POST("/file-operations", s.createFileOperation)
	authed.GET("/file-operations", s.listFileOperations)
	authed.DELETE("/file-operations", s.clearFileOperationHistory)
	authed.GET("/file-operations/:id", s.getFileOperation)
	authed.POST("/file-operations/:id/cancel", s.cancelFileOperation)
	authed.POST("/file-operations/:id/retry", s.retryFileOperation)
	authed.POST("/file-operations/:id/undo", s.undoFileOperation)
	authed.POST("/file-operations/:id/redo", s.redoFileOperation)
	authed.POST("/file-operations/:id/resolve", s.resolveFileOperationConflict)
	authed.PATCH("/nodes/:id", s.updateNode)
	authed.DELETE("/nodes/:id", s.deleteNode)
	authed.GET("/trash", s.trashList)
	authed.POST("/trash/:id/restore", s.trashRestore)
	authed.DELETE("/trash/:id", s.trashDeletePermanently)
	authed.GET("/files/:id/content", s.downloadFile)
	authed.POST("/files/:id/download-ticket", s.fileDownloadTicket)
	authed.GET("/files/:id/preview/text", s.fileTextPreview)
	authed.POST("/files/:id/preview-ticket", s.filePreviewTicket)
	authed.POST("/download/archive/prepare", s.prepareArchiveDownload)
	authed.GET("/download/archive/prepare/:id", s.getArchiveDownloadPrepare)
	authed.POST("/download/archive/prepare/:id/download-ticket", s.archiveDownloadTicket)
	authed.GET("/download/archive/progress/:id", s.getArchiveDownloadProgress)
	authed.GET("/download/progress/:id", s.getDownloadProgress)
	authed.POST("/download/archive", s.downloadArchive)
	authed.GET("/media/items", s.listMediaItems)
	authed.GET("/media/trash", s.listMediaTrash)
	authed.GET("/media/items/:id", s.getMediaItem)
	authed.PATCH("/media/items/:id/favorite", s.setMediaFavorite)
	authed.PATCH("/media/items/:id/tags", s.setMediaTags)
	authed.PATCH("/media/batch/favorite", s.setMediaFavoriteBatch)
	authed.POST("/media/batch/tags", s.addMediaTagsBatch)
	authed.PATCH("/media/items/:id/people", s.setMediaPeople)
	authed.PATCH("/media/items/:id/description", s.setMediaDescription)
	authed.GET("/media/items/:id/edit", s.getMediaEditRecipe)
	authed.PUT("/media/items/:id/edit", s.putMediaEditRecipe)
	authed.DELETE("/media/items/:id/edit", s.deleteMediaEditRecipe)
	authed.POST("/media/items/:id/creative", s.createMediaCreativeGeneration)
	authed.GET("/media/creative/:generationID", s.getMediaCreativeGeneration)
	authed.POST("/media/creative/:generationID/cancel", s.cancelMediaCreativeGeneration)
	authed.GET("/media/items/:id/thumbnail", s.mediaThumbnail)
	authed.PUT("/media/items/:id/video-poster", s.putMediaVideoPoster)
	authed.GET("/media/items/:id/analysis-preview", s.mediaAnalysisPreview)
	authed.GET("/media/items/:id/live-photo-motion", s.mediaLivePhotoMotion)
	authed.POST("/media/items/:id/live-photo-still-ticket", s.mediaLivePhotoStillTicket)
	authed.POST("/media/items/:id/live-photo-motion-ticket", s.mediaLivePhotoMotionTicket)
	authed.GET("/media/items/:id/resources/:role", s.mediaDerivedResourceContent)
	authed.GET("/media/albums", s.listMediaAlbums)
	authed.GET("/media/places", s.listMediaPlaces)
	authed.GET("/media/memories", s.listMediaMemories)
	authed.GET("/media/memories/:memoryID/items", s.listMediaMemoryItems)
	authed.GET("/media/duplicates", s.listMediaDuplicateGroups)
	authed.GET("/media/duplicates/:duplicateID/items", s.listMediaDuplicateItems)
	authed.GET("/media/bursts", s.listMediaBurstReviews)
	authed.GET("/media/bursts/:burstID/items", s.listMediaBurstReviewItems)
	authed.GET("/media/pets", s.listMediaPets)
	authed.GET("/media/pets/:petKind/items", s.listMediaPetItems)
	authed.GET("/media/people/suggestions", s.listMediaSuggestedPeople)
	authed.GET("/media/people/suggestions/:clusterID/items", s.listMediaSuggestedPersonItems)
	authed.POST("/media/people/suggestions/:clusterID/adopt", s.adoptMediaSuggestedPerson)
	authed.PATCH("/media/people/suggestions/:clusterID/review", s.reviewMediaSuggestedPerson)
	authed.GET("/media/people/identities", s.listMediaPersonIdentities)
	authed.GET("/media/people/identities/:personID/items", s.listMediaPersonIdentityItems)
	authed.PATCH("/media/people/identities/:personID", s.updateMediaPersonIdentity)
	authed.POST("/media/people/identities/:personID/merge", s.mergeMediaPersonIdentities)
	authed.POST("/media/people/identities/:personID/split", s.splitMediaPersonIdentity)
	authed.POST(
		"/media/people/identities/:personID/suggestions/:clusterID",
		s.addMediaSuggestedPersonToIdentity,
	)
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
	authed.POST("/uploads/preflight/batch", s.preflightUploadConflictsBatch)
	authed.POST("/uploads", s.createUploadSession)
	authed.GET("/uploads/:id", s.getUploadSession)
	authed.PUT("/uploads/:id/chunks/:index", s.putUploadChunk)
	authed.POST("/uploads/:id/finalize", s.finalizeUploadSession)
	authed.DELETE("/uploads/:id", s.abortUploadSession)
	authed.GET("/files/:id/versions", s.fileVersions)
	authed.GET("/files/:id/versions/:versionID/content", s.downloadFileVersion)
	authed.POST("/files/:id/versions/:versionID/download-ticket", s.fileVersionDownloadTicket)
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
	admin.GET("/background-tasks", s.adminListBackgroundTasks)
	admin.GET("/background-tasks/page", s.adminListBackgroundTaskPage)
	admin.POST("/background-tasks/control", s.adminControlBackgroundTask)
	admin.GET("/update", s.adminServerUpdateStatus)
	admin.POST("/update", s.adminStartServerUpdate)
	admin.GET("/storage", s.adminStorageStats)
	admin.GET("/storage/health", s.adminStorageHealth)
	admin.GET("/storage/history", s.adminStorageHistory)
	admin.GET("/storage/legacy", s.adminStorageLegacyObjects)
	admin.GET("/storage/unreferenced-blobs", s.adminStorageUnreferencedBlobs)
	admin.GET("/storage/staging", s.adminUploadStaging)
	admin.POST("/storage/staging/cleanup", s.adminCleanupUploadStaging)
	admin.POST("/storage/cache/cleanup", s.adminCleanupStorageCache)
	admin.GET("/storage/staging/cleanup-runs", s.adminStagingCleanupRuns)
	admin.GET("/storage/staging/cleanup-runs/:runID/failures", s.adminStagingCleanupFailures)
	admin.POST("/users", s.adminCreateUser)
	admin.PATCH("/users/:id", s.adminUpdateUser)
	admin.DELETE("/users/:id", s.adminDeleteUser)
	admin.POST("/users/:id/reset-password", s.adminResetPassword)
	admin.POST("/users/:id/revoke-sessions", s.adminRevokeSessions)
	admin.POST("/users/:id/photo-intelligence/reanalyze", s.adminReanalyzePhotoIntelligence)
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
