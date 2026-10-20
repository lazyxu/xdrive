package api

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/mediaworker"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"github.com/lazyxu/xdrive/internal/storage"
	"github.com/lazyxu/xdrive/internal/version"
	"gorm.io/gorm"
)

type Server struct {
	DB                             *gorm.DB
	localPushCIOnlyFirstLeaf       bool
	localPushCIOnlyFirstDirectory  bool
	postgresPoolSaveMu             sync.Mutex
	mediaWorkerConfigSaveMu        sync.Mutex
	caddyHTTPSSaveMu               sync.Mutex
	caddyAliDNSSaveMu              sync.Mutex
	caddyAliDNSProbeMu             sync.Mutex
	caddyAliDNSProbeAt             time.Time
	CaddyAliDNSProbeTransport      http.RoundTripper
	postgresPoolApplied            atomic.Pointer[postgresPoolRuntime]
	Store                          storage.Store
	MediaWorkerConfigured          bool
	MediaWorkerProbe               mediaworker.Prober
	Auth                           auth.Manager
	RefreshTTL                     time.Duration
	AllowedOrigin                  string
	MaxUploadBytes                 int64
	SourceRunFailureRetention      time.Duration
	ConnectorSecrets               *connectorsecret.Keyring
	PhotoPlaceResolver             photointelligence.PlaceResolver
	GeoNamesRuntime                *photointelligence.ReloadablePlaceResolver
	GeoNamesDataDir                string
	GeoNamesSnapshotDir            string
	GeoNamesMaxDistanceKM          float64
	GeoNamesAppliedRevision        atomic.Uint64
	geoNamesActiveDataset          atomic.Pointer[geoNamesActiveDataset]
	geoNamesReloadMu               sync.Mutex
	geoNamesSnapshotMu             sync.Mutex
	BaiduMapAK                     string
	BaiduMapEnabled                bool
	BaiduMapHTTPClient             *http.Client
	BaiduJSAPIProbeHTTPClient      *http.Client
	baiduJSAPIProbeMu              sync.Mutex
	baiduJSAPIProbeAt              time.Time
	baiduJSAPI4Authority           atomic.Pointer[baiduJSAPI4LiveAuthority]
	baiduMapLimiter                baiduMapLimiter
	baiduMapVerifyMu               sync.Mutex
	baiduMapVerifyAt               time.Time
	PhotoFaceAnalyzer              photointelligence.FaceAnalyzer
	PhotoSmartAnalyzer             photointelligence.SmartAnalyzer
	PhotoSemanticAnalyzer          photointelligence.SemanticAnalyzer
	PhotoCreativeAnalyzer          photointelligence.CreativeAnalyzer
	PhotoModelBearerConfigured     bool
	PhotoHostTrustAnchorPath       string
	PhotoHostTrustAnchorSHA256     string
	PhotoHostTrustRootSHA256       string
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
	storagePerformanceSamples      storagePerformanceSampleRing
	stagingCacheMu                 sync.Mutex
	stagingCacheAt                 time.Time
	stagingCache                   uploadStagingInventory
	fileOperationCancelMu          sync.Mutex
	fileOperationCancels           map[string]context.CancelCauseFunc
	archiveProgressMu              sync.Mutex
	archiveProgress                map[string]*archiveDownloadProgressState
	mediaIndexMu                   sync.Mutex
	mediaIndexOwners               map[uint64]*mediaIndexOwnerState
	mediaSelectionMu               sync.Mutex
	mediaSelections                map[string]*mediaSelectionSnapshot
	sourceWorkerConfigSaveMu       sync.Mutex
	photoHostDesiredSaveMu         sync.Mutex
	photoAutoSaveMu                sync.Mutex
	photoAutoPolicy                atomic.Pointer[photoAutoRuntime]
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
	// The single source-owned Baidu serviceHost family is dispatched INSIDE
	// Go, with mandatory method/path/query/Owner Cookie/release/quota/MIME/AK
	// validation. It is never a Caddy or arbitrary-upstream open proxy.
	if paths := baidumapjsapi.ApprovedJSAPI4ChildPaths(); len(paths) != 0 {
		for _, path := range paths {
			r.GET(path, s.baiduJSAPI4RuntimeResourceHTTP)
		}
	} else {
		r.GET(baidumapjsapi.LoaderPath, s.baiduJSAPI4LoaderHTTP)
	}
	r.GET("/metrics", s.metrics)

	v1 := r.Group("/api/v1")
	v1.GET("/healthz", s.healthz)
	v1.GET("/readyz", s.readyz)
	v1.GET("/version", s.versionInfo)
	v1.POST("/auth/login", s.login)
	v1.POST("/auth/refresh", s.refresh)
	v1.POST("/auth/logout", s.logout)
	v1.GET("/public/share", s.publicShareMetadata)
	v1.POST("/public/share/children", s.publicFolderShareChildren)
	v1.POST("/public/share/download", s.publicShareDownload)
	v1.POST("/public/share/download-ticket", s.publicShareDownloadTicket)
	v1.POST("/public/share/preview-ticket", s.publicSharePreviewTicket)
	v1.POST("/public/share/archive/prepare", s.publicShareArchivePrepare)
	v1.POST("/public/share/archive/status", s.publicShareArchiveStatus)
	v1.POST("/public/share/archive/cancel", s.publicShareArchiveCancel)
	v1.POST("/public/share/archive/download-ticket", s.publicShareArchiveTicket)
	v1.GET("/public-share-archive/:id", s.publicShareArchiveStream)
	v1.GET("/public-share-download/:id", s.publicShareDownloadTicketStream)
	v1.HEAD("/public-share-download/:id", s.publicShareDownloadTicketStream)
	v1.GET("/public-share-preview/:id", s.publicSharePreviewStream)
	v1.HEAD("/public-share-preview/:id", s.publicSharePreviewStream)
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
	authed.GET("/nodes/:id/children/position", s.childrenPosition)
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
	authed.GET("/nodes/:id/location", s.getNodeLocation)
	authed.GET("/media/items", s.listMediaItems)
	authed.POST("/media/selection-snapshots", s.createMediaSelectionSnapshot)
	authed.GET("/media/selection-snapshots/:token", s.getMediaSelectionSnapshot)
	authed.PATCH("/media/selection-snapshots/:token/exclusion", s.updateMediaSelectionExclusion)
	authed.DELETE("/media/selection-snapshots/:token", s.deleteMediaSelectionSnapshot)
	authed.POST("/media/selection-snapshots/:token/jobs", s.createMediaSelectionJob)
	authed.GET("/media/selection-jobs", s.listMediaSelectionJobs)
	authed.GET("/media/selection-jobs/:id", s.getMediaSelectionJob)
	authed.GET("/media/selection-jobs/:id/failures", s.listMediaSelectionJobFailures)
	authed.POST("/media/selection-jobs/:id/cancel", s.cancelMediaSelectionJob)
	authed.POST("/media/selection-jobs/:id/retry", s.retryMediaSelectionJob)
	authed.GET("/media/facets", s.listMediaFacets)
	authed.GET("/media/index-status", s.listMediaIndexStatus)
	authed.GET("/media/sync-folders", s.listMediaSyncFolders)
	authed.GET("/media/sync-folders/:sourceID/folders/:folderID", s.getMediaSyncFolder)
	authed.GET("/media/trash", s.listMediaTrash)
	authed.GET("/media/items/:id", s.getMediaItem)
	authed.PATCH("/media/items/:id/favorite", s.setMediaFavorite)
	authed.PATCH("/media/items/:id/tags", s.setMediaTags)
	authed.PATCH("/media/batch/favorite", s.setMediaFavoriteBatch)
	authed.POST("/media/batch/tags", s.addMediaTagsBatch)
	authed.PATCH("/media/items/:id/people", s.setMediaPeople)
	authed.PATCH("/media/items/:id/description", s.setMediaDescription)
	// A3d2l2b: explicit Owner-scoped source-bound map consent, not JSAPI runtime.
	authed.GET("/media/items/:id/baidu-map-consent", s.getMediaBaiduConsent)
	authed.PUT("/media/items/:id/baidu-map-consent", s.putMediaBaiduConsent)
	authed.DELETE("/media/items/:id/baidu-map-consent", s.deleteMediaBaiduConsent)
	// A3d2m1b2b1: Owner-only explicit index intent, no provider egress or worker.
	authed.GET("/media/items/:id/baidu-map-index-job", s.getMediaBaiduMapIndexJob)
	authed.POST("/media/items/:id/baidu-map-index-job", s.postMediaBaiduMapIndexJob)
	authed.DELETE("/media/items/:id/baidu-map-index-job", s.deleteMediaBaiduMapIndexJob)
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
	authed.GET("/media/places/page", s.listMediaPlacesPage)
	// A3b3a1: Owner-only bounded WGS84 viewport cells; no Baidu JSAPI proxy.
	authed.GET("/media/places/viewport", s.listMediaPlacesViewport)
	authed.GET("/media/places/map-provider", s.mediaMapProviderStatus)
	authed.GET("/media/places/baidu-static", s.mediaBaiduStaticMap)
	// JSAPI 4.0 remains blocked until proxy, licence and native bridges pass review.
	authed.GET("/media/places/baidu-jsapi/status", s.mediaBaiduJSAPIStatus)
	// A3c13: signed-release gated exact BD09 Owner opt-in viewport, not WGS84.
	authed.GET("/media/places/baidu-jsapi/viewport", s.listBaiduNativeMapViewport)
	// A3c19: exact Owner BD09 8x8 aggregate, never 100k raw photo coordinates.
	authed.GET("/media/places/baidu-jsapi/cells", s.listBaiduNativeMapCells)
	// A signed release is required before the authenticated Owner can mint a map Cookie.
	authed.POST("/media/places/baidu-jsapi/session", s.baiduJSAPI4SessionHTTP)
	authed.GET("/media/memories", s.listMediaMemories)
	authed.GET("/media/memories/:memoryID/items", s.listMediaMemoryItems)
	authed.GET("/media/duplicate-organize/plan", s.mediaDuplicateOrganizePlan)
	authed.POST("/media/duplicate-organize/apply", s.applyMediaDuplicateOrganize)
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
	authed.GET("/media/album-folders", s.listMediaAlbumFolders)
	authed.POST("/media/album-folders", s.createMediaAlbumFolder)
	authed.PATCH("/media/album-folders/:folderID", s.updateMediaAlbumFolder)
	authed.DELETE("/media/album-folders/:folderID", s.deleteMediaAlbumFolder)
	authed.POST("/media/albums", s.createMediaAlbum)
	authed.PATCH("/media/albums/:albumID", s.renameMediaAlbum)
	authed.PATCH("/media/albums/:albumID/folder", s.moveMediaAlbumToFolder)
	authed.PUT("/media/albums/:albumID/cover", s.setMediaAlbumCover)
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
	authed.POST("/nodes/:id/shares", s.createFileShare)
	authed.GET("/nodes/:id/shares", s.listFileShares)
	authed.POST("/files/:id/shares", s.createFileShare)
	authed.GET("/files/:id/shares", s.listFileShares)
	authed.DELETE("/shares/:id", s.revokeShare)

	authed.POST("/source-credentials/test", s.testSourceCredential)

	authed.GET("/device-backups", s.listDeviceBackupOverview)
	authed.GET("/device-backups/folders", s.listDeviceBackupFolderPage)
	authed.GET("/device-backups/local-drafts", s.listOwningLocalSourceDrafts)
	authed.GET("/device-backups/:sourceID/runs", s.listDeviceBackupRunSummaries)
	authed.GET("/devices", s.listClientDevices)
	authed.GET("/devices/self", s.verifyCurrentClientDevice)
	authed.POST("/devices/self/heartbeat", s.heartbeatClientDevice)
	authed.POST("/devices", s.registerClientDevice)
	authed.POST("/devices/:id/revoke", s.revokeClientDevice)
	authed.GET("/sources", s.listSources)
	authed.GET("/sources/overview", s.listSourceOverview)
	authed.POST("/sources", s.createSource)
	authed.GET("/sources/:id", s.getSource)
	// Raw local ignore rules are available ONLY to the credential-verified bound Agent.
	authed.GET("/sources/:id/local-rules", s.requireLocalSourceExecutor(), s.getLocalSourceIgnoreRules)
	// Planned local schedule is visible only to its authenticated owning Agent.
	authed.GET("/sources/:id/local-schedule", s.requireLocalSourceExecutor(), s.getLocalSourceSchedule)
	// Bound-device-only read of existing canonical SourceItem identity. No writes or activation.
	authed.POST("/sources/:id/local-identity/lookup", s.requireLocalSourceExecutor(), s.localSourceIdentityLookup)
	// Private, device-bound advisory identity evidence; no alias/SourceItem/Run changes.
	authed.POST("/sources/:id/local-identity/evidence", s.requireLocalSourceExecutor(), s.recordLocalSourceItemEvidence)
	// Owning-Agent-only, bounded current-generation advisory COUNT; no mutation.
	authed.POST("/sources/:id/local-identity/evidence-summary", s.requireLocalSourceExecutor(), s.readLocalSourceItemEvidenceSummary)
	// Native owning-Agent only: ordered, capped private advisory candidate readback.
	authed.POST("/sources/:id/local-identity/evidence-page", s.requireLocalSourceExecutor(), s.readLocalSourceItemEvidencePage)
	// Private, device-bound, read-only SourceItem/Node/alias consistency preflight.
	authed.POST("/sources/:id/local-identity/evidence-preflight", s.requireLocalSourceExecutor(), s.preflightLocalSourceItemEvidence)
	// Owning-Agent-only comparison to current File/FileVersion/CAS database metadata.
	authed.POST("/sources/:id/local-identity/evidence-cloud-metadata", s.requireLocalSourceExecutor(), s.readLocalSourceEvidenceCloudMetadata)
	// One bounded owning-Agent-only actual CAS object read (not a durable proof).
	authed.POST("/sources/:id/local-identity/evidence-cloud-bytes", s.requireLocalSourceExecutor(), s.readLocalSourceEvidenceCloudBytes)
	// Private owning-Agent only: durable QUARANTINE, never identity/CAS commit authority.
	authed.POST("/sources/:id/local-identity/commit-intents", s.requireLocalSourceExecutor(), s.quarantineLocalSourceCommitIntents)
	// Native owning-Agent only: bounded QUARANTINED recovery read, never commit authority.
	authed.POST("/sources/:id/local-identity/commit-intents/page", s.requireLocalSourceExecutor(), s.readLocalSourceCommitIntentPage)
	// L03-E1a: private bounded physical CAS check of exact quarantined IDs; never a commit token.
	authed.POST("/sources/:id/local-identity/commit-intents/content-preflight", s.requireLocalSourceExecutor(), s.preflightLocalQuarantinedContent)
	// Owning-Agent-only temporary byte transfer. No canonical upload, Node, SourceItem or Run writes.
	authed.POST("/sources/:id/local-operation/prepare", localPushOperationNoStore, s.requireLocalSourceExecutor(), s.prepareLocalPushOperation)
	authed.POST("/sources/:id/local-operation/abort", localPushOperationNoStore, s.requireLocalSourceExecutor(), s.abortLocalPushOperation)
	authed.POST("/sources/:id/local-operation/observe", localPushOperationNoStore, s.requireLocalSourceExecutor(), s.observeLocalPushOperation)
	// Owning-Agent-only exact request-key terminal-reservation proof. Never a backup completion.
	authed.POST("/sources/:id/local-operation/terminal-proof", localPushOperationNoStore, s.requireLocalSourceExecutor(), s.materializeLocalPushTerminalProof)
	authed.POST("/sources/:id/local-staging", s.requireLocalSourceExecutor(), s.createLocalPushStage)
	authed.GET("/sources/:id/local-staging/:stageID", s.requireLocalSourceExecutor(), s.getLocalPushStage)
	// Read-only, owning-Agent, point-in-time physical bytes; NEVER canonical commit authority.
	authed.GET("/sources/:id/local-staging/:stageID/content-preflight", s.requireLocalSourceExecutor(), s.preflightLocalPushStagePhysical)
	// Owning Agent only: historical physically pinned CAS + SQL receipt; read-only, never a SourceRun or native provenance.
	authed.POST("/sources/:id/local-staging/:stageID/physical-receipt", s.requireLocalSourceExecutor(), s.readLocalPushFirstLeafCommittedPhysicalReceipt)
	// Exact keyed SQL COMMIT + real historical CAS read, never a Push executor.
	authed.POST("/sources/:id/local-staging/:stageID/operation-physical-receipt", localPushOperationNoStore, s.requireLocalSourceExecutor(), s.readLocalPushHistoricalOperationPhysical)
	// G2b1: Agent-authenticated IMMUTABLE Stage/Operation SQL correlation only.
	// Does not commit Node/CAS, activate local Push, retire keys or start SourceRun.
	authed.POST("/sources/:id/local-staging/:stageID/operation-bind", localPushOperationNoStore, s.requireLocalSourceExecutor(), s.bindLocalPushOperationStage)
	// G2b2a: physical first-file CAS/SQL COMMIT, only with exact current
	// owning-Agent Stage + durable Operation proof, no SourceRun/scheduler.
	authed.POST("/sources/:id/local-staging/:stageID/operation-first-leaf-commit", localPushOperationNoStore, s.requireLocalSourceExecutor(), s.commitLocalPushFirstLeafOperation)
	// This test-only route is OMITTED from all production Routers. No config,
	// environment or user setting can turn on this internal first-file writer.
	if s.localPushCIOnlyFirstLeaf {
		authed.POST("/sources/:id/local-staging/:stageID/ci-first-leaf-commit",
			s.requireLocalSourceExecutor(), s.ciOnlyCommitLocalPushFirstLeaf)
	}
	// Test-only first-directory transaction. Intentionally absent from normal
	// production Routers; this independent bit has no configuration or setter.
	if s.localPushCIOnlyFirstDirectory {
		authed.POST("/sources/:id/ci-first-directory-commit",
			s.requireLocalSourceExecutor(), s.ciOnlyCommitLocalPushFirstDirectory)
	}
	authed.PUT("/sources/:id/local-staging/:stageID/content", s.requireLocalSourceExecutor(), s.putLocalPushStageBytes)
	authed.DELETE("/sources/:id/local-staging/:stageID", s.requireLocalSourceExecutor(), s.cancelLocalPushStage)
	authed.PATCH("/sources/:id", s.requireLocalSourceExecutor(), s.updateSource)
	authed.DELETE("/sources/:id", s.requireLocalSourceExecutor(), s.deleteSource)
	// Only the enrolled creator Agent may discard a never-bound, empty draft.
	authed.DELETE("/sources/:id/local-draft", s.discardLocalSourceDraft)
	authed.POST("/sources/:id/trigger", s.requireLocalSourceExecutor(), s.triggerSource)
	authed.GET("/sources/:id/local-binding", s.getLocalSourceBinding)
	authed.POST("/sources/:id/local-binding", s.bindLocalSource)
	authed.DELETE("/sources/:id/local-binding", s.requireLocalSourceExecutor(), s.unbindLocalSource)
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
	authed.POST("/sources/:id/runs", s.requireLocalSourceExecutor(), s.beginSourceRun)
	authed.GET("/sources/:id/runs/:runID", s.getSourceRun)
	authed.GET("/sources/:id/runs/:runID/failures", s.listSourceRunFailures)
	authed.GET("/sources/:id/runs/:runID/skips", s.listSourceRunSkips)
	authed.POST("/sources/:id/runs/:runID/observe", s.requireLocalSourceExecutor(), s.observeSourceRun)
	authed.POST("/sources/:id/runs/:runID/commit", s.requireLocalSourceExecutor(), s.commitSourceRun)
	authed.POST("/sources/:id/runs/:runID/failures", s.requireLocalSourceExecutor(), s.failSourceRunItems)
	authed.POST("/sources/:id/runs/:runID/progress", s.requireLocalSourceExecutor(), s.progressSourceRun)
	authed.POST("/sources/:id/runs/:runID/cancel", s.requireLocalSourceExecutor(), s.cancelSourceRun)
	authed.POST("/sources/:id/runs/:runID/heartbeat", s.requireLocalSourceExecutor(), s.heartbeatSourceRun)
	authed.POST("/sources/:id/runs/:runID/finish", s.requireLocalSourceExecutor(), s.finishSourceRun)

	admin := authed.Group("/admin")
	admin.Use(s.requireAdmin())
	admin.GET("/users", s.adminListUsers)
	admin.GET("/services", s.adminServiceDependencies)
	admin.GET("/services/caddy/https", s.adminCaddyHTTPSConfig)
	admin.PUT("/services/caddy/https", s.adminSaveCaddyHTTPS)
	admin.GET("/services/caddy/https/revisions", s.adminCaddyHTTPSRevisions)
	admin.POST("/services/caddy/https/rollback", s.adminRollbackCaddyHTTPS)
	admin.GET("/services/caddy/alidns", s.adminCaddyAliDNSConfig)
	admin.PUT("/services/caddy/alidns", s.adminSaveCaddyAliDNS)
	admin.POST("/services/caddy/alidns/reveal", s.adminRevealCaddyAliDNS)
	admin.POST("/services/caddy/alidns/verify-read", s.adminVerifyCaddyAliDNSRead)
	admin.GET("/services/caddy/https/preflight", s.adminCaddyHTTPSPreflight)
	admin.GET("/services/caddy/https/host-plan", s.adminCaddyHTTPSHostPlan)
	admin.GET("/services/media-worker", s.adminMediaWorkerConfig)
	admin.PUT("/services/media-worker", s.adminSaveMediaWorkerConfig)
	admin.POST("/services/media-worker/apply", s.adminApplyMediaWorker)
	admin.GET("/services/media-worker/revisions", s.adminMediaWorkerRevisions)
	admin.POST("/services/media-worker/rollback", s.adminRollbackMediaWorker)
	admin.GET("/services/postgresql/pool", s.adminPostgresPoolConfig)
	admin.PUT("/services/postgresql/pool", s.adminSavePostgresPool)
	admin.GET("/services/postgresql/pool/revisions", s.adminPostgresPoolRevisions)
	admin.POST("/services/postgresql/pool/rollback", s.adminRollbackPostgresPool)
	admin.GET("/services/source-worker", s.adminSourceWorkerConfig)
	admin.PUT("/services/source-worker", s.adminSaveSourceWorkerConfig)
	admin.GET("/services/source-worker/revisions", s.adminSourceWorkerRevisions)
	admin.POST("/services/source-worker/rollback", s.adminRollbackSourceWorkerConfig)
	admin.GET("/services/photo-intelligence/host", s.adminPhotoHostConfig)
	admin.GET("/services/photo-intelligence/host/preflight", s.adminPhotoHostPreflight)
	admin.POST("/services/photo-intelligence/host/apply", s.adminPhotoHostApply)
	admin.PUT("/services/photo-intelligence/host", s.adminSavePhotoHostDesired)
	admin.GET("/services/photo-intelligence/host/revisions", s.adminPhotoHostRevisions)
	admin.POST("/services/photo-intelligence/host/rollback", s.adminRollbackPhotoHostDesired)
	admin.GET("/services/photo-intelligence", s.adminPhotoAutoConfig)
	admin.PUT("/services/photo-intelligence", s.adminSavePhotoAutoConfig)
	admin.GET("/services/photo-intelligence/revisions", s.adminPhotoAutoRevisions)
	admin.POST("/services/photo-intelligence/rollback", s.adminRollbackPhotoAutoConfig)
	admin.GET("/services/baidu-map", s.adminBaiduMapConfig)
	admin.PUT("/services/baidu-map", s.adminSaveBaiduMapConfig)
	admin.POST("/services/baidu-map/reveal", s.adminRevealBaiduMapAK)
	admin.POST("/services/baidu-map/verify", s.adminVerifyBaiduMap)
	admin.GET("/services/baidu-jsapi", s.adminBaiduJSAPIConfig)
	admin.PUT("/services/baidu-jsapi", s.adminSaveBaiduJSAPIConfig)
	// A3d1: fixed one-shot ADMIN probe; no JS body, Cookie or child proxy route.
	admin.POST("/services/baidu-jsapi/verify-loader", s.adminVerifyBaiduJSAPI4Loader)
	admin.GET("/services/geonames", s.adminGeoNamesConfig)
	admin.PUT("/services/geonames", s.adminSaveGeoNamesConfig)
	admin.POST("/services/geonames/reload", s.adminGeoNamesReload)
	admin.POST("/services/geonames/dataset-snapshots", s.adminStageGeoNamesSnapshot)
	admin.POST("/services/geonames/dataset-snapshots/apply", s.adminApplyGeoNamesDatasetSnapshot)
	admin.POST("/services/geonames/dataset-snapshots/restore-missing", s.adminRestoreMissingGeoNamesSnapshot)
	admin.GET("/services/geonames/revisions", s.adminGeoNamesRevisions)
	admin.POST("/services/geonames/rollback", s.adminRollbackGeoNamesConfig)
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
			c.Header("Access-Control-Expose-Headers", "ETag, X-Content-SHA256, Content-Range, X-Request-ID, Retry-After, X-XDrive-Thumbnail-Alpha-Mask, X-XDrive-Thumbnail-Alpha-State")
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
