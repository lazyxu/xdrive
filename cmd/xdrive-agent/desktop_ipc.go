package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	_ "time/tzdata"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/conflictstate"
	"github.com/lazyxu/xdrive/internal/diagnostics"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/mount"
	"github.com/lazyxu/xdrive/internal/transfer"
	"github.com/lazyxu/xdrive/internal/userconfig"
	"github.com/lazyxu/xdrive/internal/version"
)

const (
	desktopIPCAPIVersion                    = 1
	desktopIPCProtocolMin                   = 2
	desktopIPCProtocolMax                   = 2
	desktopIPCDiscoveryName                 = "desktop-ipc.json"
	desktopIPCMaxBodyBytes                  = 64 << 10
	desktopIPCTransferLifecycleMaxBodyBytes = 1 << 20
	desktopIPCTransferLifecycleMaxChildren  = 1000
	desktopIPCDefaultEventWait              = 25 * time.Second
	desktopIPCMaxEventWait                  = 30 * time.Second
)

type desktopIPCDiscovery struct {
	Version int    `json:"version"`
	BaseURL string `json:"base_url"`
	Token   string `json:"token"`
	PID     int    `json:"pid"`
}

type desktopIPCHello struct {
	DiscoveryVersion int      `json:"discovery_version"`
	ProtocolMin      int      `json:"protocol_min"`
	ProtocolMax      int      `json:"protocol_max"`
	AgentVersion     string   `json:"agent_version"`
	PID              int      `json:"pid"`
	Platform         string   `json:"platform"`
	Arch             string   `json:"arch"`
	Capabilities     []string `json:"capabilities"`
}

var desktopIPCCapabilities = []string{
	"status",
	"status-events",
	"auth",
	"sync-control",
	"settings",
	"client-update",
	"client-update-cancel",
	"selective-sync",
	"file-availability",
	"file-availability-batch",
	"storage-tree",
	"cache-management",
	"local-disk-space",
	"cloud-files",
	"cloud-change-feed",
	"background-tasks",
	"background-task-summary",
	"admin-services",
	"file-text-preview",
	"file-preview-stream",
	"archive-download",
	"folder-download-tree",
	"file-operation-conflict-resolution",
	"file-operation-undo",
	"file-operation-redo",
	"file-quick-access",
	"file-tags",
	"file-saved-searches",
	"file-favorites",
	"file-recent",
	"file-properties-stats",
	"file-media-details",
	"media-item-properties",
	"node-location",
	"media-timezone",
	"upload-conflict-preflight",
	"upload-conflict-preflight-batch",
	"upload-conflict-policy",
	"server-update",
	"media-gallery",
	"baidu-static-map",
	"media-index-status",
	"media-selection-snapshot",
	"media-selection-jobs",
	"media-folder-recursive",
	"media-duplicate-organize-plan",
	"media-duplicate-organize-apply",
	"media-album-folders",
	"external-sources",
	"storage-intelligence",
	"storage-cache-cleanup",
	"conflicts",
	"transfers",
	"transfer-events",
	"transfer-retry",
	"transfer-lifecycle",
	"transfer-lifecycle-child-batch",
	"transfer-history-scope",
	"diagnostics",
	"diagnostic-actions",
	"open-folder",
	"open-path",
	"lifecycle-shutdown",
}

func desktopIPCHelloCapabilities() []string {
	capabilities := append([]string(nil), desktopIPCCapabilities...)
	if runtime.GOOS == "windows" || runtime.GOOS == "linux" {
		capabilities = append(capabilities, "local-folder-root-grants")
	}
	if openWithSupportedPlatform() {
		capabilities = append(capabilities, "open-with")
	}
	return capabilities
}

type desktopIPCStatus struct {
	Revision           uint64              `json:"revision"`
	Configured         bool                `json:"configured"`
	Username           string              `json:"username,omitempty"`
	Role               string              `json:"role,omitempty"`
	Server             string              `json:"server,omitempty"`
	MountPath          string              `json:"mount_path,omitempty"`
	AuthStatus         string              `json:"auth_status"`
	SyncStatus         string              `json:"sync_status"`
	Paused             bool                `json:"paused"`
	MustChangePassword bool                `json:"must_change_password"`
	LastError          string              `json:"last_error,omitempty"`
	HasConflict        bool                `json:"has_conflict"`
	ConflictCount      int                 `json:"conflict_count"`
	Version            string              `json:"version"`
	ServerBuild        *client.VersionInfo `json:"server_build,omitempty"`
}

type desktopIPCEvent struct {
	Type     string           `json:"type"`
	Revision uint64           `json:"revision"`
	Status   desktopIPCStatus `json:"status"`
}

type desktopIPCTransfers struct {
	Revision  uint64          `json:"revision"`
	Transfers []transfer.Task `json:"transfers"`
}

type desktopIPCTransferEvent struct {
	Type      string          `json:"type"`
	Revision  uint64          `json:"revision"`
	Transfers []transfer.Task `json:"transfers"`
}

type desktopIPCSettings struct {
	MountPath       string                `json:"mount_path"`
	CacheLimitBytes int64                 `json:"cache_limit_bytes"`
	SyncRules       []userconfig.SyncRule `json:"sync_rules"`
}

type desktopIPCFileAvailabilityBatchItem struct {
	Path         string                  `json:"path"`
	Availability *mount.FileAvailability `json:"availability,omitempty"`
	Error        string                  `json:"error,omitempty"`
}

type desktopIPCFileAvailabilityBatch struct {
	Items []desktopIPCFileAvailabilityBatchItem `json:"items"`
}

type desktopIPCController interface {
	SnapshotWithRevision() (agentSnapshot, uint64)
	WaitSnapshot(context.Context, uint64) (agentSnapshot, uint64, bool)
	Authenticate(server, username, password, mountPath string) error
	ChangePassword(currentPassword, newPassword string) error
	Logout() error
	SetPaused(bool) error
	SyncNow() error
	Settings() (userconfig.Config, string, error)
	UpdateSettings(mountPath *string, cacheLimitBytes *int64) error
	UpdateState() clientUpdateState
	SetUpdateMode(string) (clientUpdateState, error)
	SetUpdateSource(string) (clientUpdateState, error)
	CheckClientUpdate(context.Context) (clientUpdateState, error)
	DownloadClientUpdate(context.Context) (clientUpdateState, error)
	InstallClientUpdate(context.Context) (clientUpdateState, error)
	CancelClientUpdate() (clientUpdateState, error)
	SetSelectiveSyncRule(path, mode string) error
	StorageTree(context.Context) (agentStorageTreeNode, error)
	CacheStats() (mount.CacheStats, error)
	LocalDiskSpace() diagnostics.DiskSpaceInfo
	ReleaseReclaimableCache() (mount.CacheReleaseResult, error)
	CloudRoot(context.Context) (client.Node, error)
	CloudList(context.Context, uint64) ([]client.Node, error)
	CloudListPage(context.Context, uint64, client.ChildrenOptions) (client.ChildrenPage, error)
	CloudListRange(context.Context, uint64, client.ChildrenRangeOptions) (client.ChildrenRange, error)
	CloudNodeChanges(context.Context, uint64, int) (client.NodeChangePage, error)
	CloudFileQuickAccess(context.Context) ([]client.FileQuickAccessItem, error)
	CloudPinFileQuickAccess(context.Context, uint64) (client.FileQuickAccessItem, error)
	CloudUnpinFileQuickAccess(context.Context, uint64) error
	CloudReorderFileQuickAccess(context.Context, []uint64) error
	CloudFileTags(context.Context) ([]client.FileTag, error)
	CloudCreateFileTag(context.Context, string, string) (client.FileTag, error)
	CloudUpdateFileTag(context.Context, uint64, map[string]string) (client.FileTag, error)
	CloudDeleteFileTag(context.Context, uint64) error
	CloudQueryFileNodeTags(context.Context, []uint64) ([]client.FileNodeTags, error)
	CloudSetFileTagNodes(context.Context, uint64, []uint64, bool) error
	CloudFileSavedSearches(context.Context) ([]client.FileSavedSearch, error)
	CloudCreateFileSavedSearch(context.Context, client.FileSavedSearchInput) (client.FileSavedSearch, error)
	CloudUpdateFileSavedSearch(context.Context, uint64, client.FileSavedSearchInput) (client.FileSavedSearch, error)
	CloudDeleteFileSavedSearch(context.Context, uint64) error
	CloudReorderFileSavedSearches(context.Context, []uint64) error
	CloudFileFavorites(context.Context) ([]client.FileFavoriteItem, error)
	CloudFavoriteFile(context.Context, uint64) (client.FileFavoriteItem, error)
	CloudUnfavoriteFile(context.Context, uint64) error
	CloudFileRecent(context.Context, int) ([]client.FileRecentItem, error)
	CloudTouchFileRecent(context.Context, uint64) (client.FileRecentItem, error)
	CloudClearFileRecent(context.Context) error
	CloudCreateDir(context.Context, uint64, string) (client.Node, error)
	CloudRename(context.Context, uint64, uint64, string) (client.Node, error)
	CloudCopy(context.Context, uint64, uint64) (client.Node, error)
	CloudMove(context.Context, uint64, uint64, uint64) (client.Node, error)
	CloudDelete(context.Context, uint64, uint64) error
	CloudBatchCopy(context.Context, []client.BatchNodeRef, uint64) (client.BatchNodesResult, error)
	CloudBatchMove(context.Context, []client.BatchNodeRef, uint64) (client.BatchNodesResult, error)
	CloudBatchDelete(context.Context, []client.BatchNodeRef) (client.BatchNodesResult, error)
	CloudFilePropertiesStats(context.Context, []client.BatchNodeRef) (client.FilePropertiesStats, error)
	CloudCreateFileOperation(context.Context, string, []client.BatchNodeRef, uint64) (client.FileOperation, error)
	CloudBackgroundTaskActiveSummary(context.Context) (client.BackgroundTaskActiveSummary, error)
	CloudBackgroundTaskPage(context.Context, bool, int, string) (client.BackgroundTaskPage, error)
	CloudBackgroundTasks(context.Context, bool, int) ([]client.BackgroundTask, error)
	CloudControlBackgroundTask(context.Context, bool, string, string) (client.BackgroundTaskControlResult, error)
	CloudFileOperations(context.Context, int) ([]client.FileOperation, error)
	CloudClearFileOperationHistory(context.Context) error
	CloudFileOperation(context.Context, string) (client.FileOperation, error)
	CloudCancelFileOperation(context.Context, string) (client.FileOperation, error)
	CloudRetryFileOperation(context.Context, string) (client.FileOperation, error)
	CloudUndoFileOperation(context.Context, string) (client.FileOperation, error)
	CloudRedoFileOperation(context.Context, string) (client.FileOperation, error)
	CloudResolveFileOperationConflict(context.Context, string, string) (client.FileOperation, error)
	CloudUploadConflictPreflight(context.Context, uint64, string) (client.UploadConflictPreflight, error)
	CloudUploadConflictPreflightBatch(context.Context, []client.UploadConflictPreflightRequest) ([]client.UploadConflictPreflight, error)
	CloudUploadWithConflictPolicy(context.Context, uint64, string, string, string) (agentCloudUploadResult, error)
	CloudUploadWithConflictPolicyTracked(context.Context, uint64, string, string, string, string) (agentCloudUploadResult, error)
	CloudUpload(context.Context, uint64, string, string) (client.Node, error)
	CloudFileTextPreview(context.Context, uint64) (client.FileTextPreview, error)
	CloudFilePreviewTicket(context.Context, uint64) (client.FilePreviewTicket, error)
	CloudDownload(context.Context, uint64, string) error
	CloudDownloadFolder(context.Context, uint64, uint64, string) (agentCloudFolderDownloadResult, error)
	CloudDownloadArchive(context.Context, []uint64, string) (agentCloudArchiveDownloadResult, error)
	CloudSearch(context.Context, string, string, string, string, agentCloudSearchFilters) (agentCloudSearchPage, error)
	CloudSearchRange(context.Context, string, int, int, string, string, agentCloudSearchFilters, client.FileExplorerGroupingOptions) (agentCloudSearchRange, error)
	CloudQuota(context.Context) (client.QuotaUsage, error)
	CloudServerUpdateState(context.Context) (client.ServerUpdateState, error)
	CloudStartServerUpdate(context.Context, string, string, bool) (client.ServerUpdateState, error)
	CloudStorageStats(context.Context) (client.StorageStats, error)
	CloudCleanupStorageCache(context.Context, string) (client.StorageCacheCleanup, error)
	CloudTrash(context.Context) ([]client.Node, error)
	CloudTrashRange(context.Context, int, int, string, string, bool) (client.TrashRange, error)
	CloudRestoreTrash(context.Context, uint64, uint64) (client.Node, error)
	CloudDeleteTrash(context.Context, uint64, uint64) error
	CloudVersions(context.Context, uint64) ([]client.FileVersion, error)
	CloudRestoreVersion(context.Context, uint64, uint64, uint64) (client.Node, error)
	CloudShares(context.Context, uint64) ([]client.FileShare, error)
	CloudCreateShare(context.Context, uint64, client.CreateShareInput) (agentCreatedShare, error)
	CloudRevokeShare(context.Context, uint64) error
	CloudMediaItems(context.Context, client.MediaQuery, int, int) ([]client.MediaItem, error)
	CloudMediaItemsRange(context.Context, client.MediaQuery, int, int) (client.MediaItemRange, error)
	CloudMediaFacets(context.Context, client.MediaQuery, string) (client.MediaGalleryFacets, error)
	CloudMediaSyncFolders(context.Context) ([]client.MediaSyncFolder, error)
	CloudMediaSyncFolder(context.Context, uint64, uint64) (client.MediaFolderView, error)
	CloudMediaTrash(context.Context, int, int) (client.MediaItemRange, error)
	CloudMediaAlbums(context.Context) ([]client.MediaAlbum, error)
	CloudMediaPlaces(context.Context, int) ([]client.MediaPlaceFacet, error)
	CloudMediaMemories(context.Context, string, int) ([]client.MediaMemory, error)
	CloudMediaMemoryItemsRange(context.Context, string, int, int) (client.MediaItemRange, error)
	CloudMediaDuplicateGroups(context.Context, int) (client.MediaDuplicateGroupList, error)
	CloudMediaDuplicateItemsRange(context.Context, string, int, int) (client.MediaItemRange, error)
	CloudMediaBurstReviews(context.Context, int) (client.MediaBurstReviewList, error)
	CloudMediaBurstReviewItemsRange(context.Context, string, int, int) (client.MediaItemRange, error)
	CloudMediaPets(context.Context) ([]client.MediaPetFacet, error)
	CloudMediaPetItemsRange(context.Context, string, int, int) (client.MediaItemRange, error)
	CloudMediaSuggestedPeople(context.Context, int) ([]client.MediaSuggestedPerson, error)
	CloudMediaSuggestedPeopleWithReview(context.Context, bool, int) ([]client.MediaSuggestedPerson, error)
	CloudMediaSuggestedPersonItems(context.Context, string, client.MediaQuery, int, int) ([]client.MediaItem, error)
	CloudMediaSuggestedPersonItemsRange(context.Context, string, client.MediaQuery, int, int) (client.MediaItemRange, error)
	CloudMediaPeople(context.Context, bool, int, int) ([]client.MediaPersonIdentity, error)
	CloudMediaPersonItems(context.Context, string, client.MediaQuery, int, int) ([]client.MediaItem, error)
	CloudMediaPersonItemsRange(context.Context, string, client.MediaQuery, int, int) (client.MediaItemRange, error)
	CloudReviewMediaSuggestedPerson(context.Context, string, string) (client.MediaPersonSuggestionReview, error)
	CloudAddMediaSuggestedPersonToIdentity(context.Context, string, uint64, string) (client.MediaPersonIdentity, error)
	CloudAdoptMediaSuggestedPerson(context.Context, string, string) (client.MediaPersonIdentity, error)
	CloudUpdateMediaPerson(context.Context, string, uint64, client.UpdateMediaPersonIdentityInput) (client.MediaPersonIdentity, error)
	CloudMergeMediaPeople(context.Context, string, uint64, []string) (client.MediaPersonIdentity, error)
	CloudSplitMediaPerson(context.Context, string, uint64, []uint64, string) (client.MediaPersonSplit, error)
	CloudCreateMediaAlbum(context.Context, string) (client.MediaAlbum, error)
	CloudRenameMediaAlbum(context.Context, string, uint64, string) (client.MediaAlbum, error)
	CloudDeleteMediaAlbum(context.Context, string, uint64) error
	CloudCreateSmartMediaAlbum(context.Context, string, client.MediaSmartAlbumQuery) (client.MediaAlbum, error)
	CloudUpdateSmartMediaAlbum(context.Context, string, uint64, *string, *client.MediaSmartAlbumQuery) (client.MediaAlbum, error)
	CloudDeleteSmartMediaAlbum(context.Context, string, uint64) error
	CloudAddMediaAlbumItems(context.Context, string, uint64, []uint64) (client.MediaAlbum, error)
	CloudRemoveMediaAlbumItem(context.Context, string, uint64, uint64) (client.MediaAlbum, error)
	CloudMediaAlbumItems(context.Context, string, client.MediaQuery, int, int) ([]client.MediaItem, error)
	CloudMediaAlbumItemsRange(context.Context, string, client.MediaQuery, int, int) (client.MediaItemRange, error)
	CloudSetMediaFavorite(context.Context, uint64, bool) (client.MediaFavorite, error)
	CloudSetMediaFavoriteBatch(context.Context, []uint64, bool) (client.MediaBatchFavorite, error)
	CloudAddMediaTagsBatch(context.Context, []uint64, []string) (client.MediaBatchTags, error)
	CloudSetMediaTags(context.Context, uint64, []string) (client.MediaTags, error)
	CloudSetMediaPeople(context.Context, uint64, []string) (client.MediaPeople, error)
	CloudSetMediaDescription(context.Context, uint64, string) (client.MediaDescription, error)
	CloudMediaEditRecipe(context.Context, uint64) (client.MediaEditRecipe, error)
	CloudSaveMediaEditRecipe(context.Context, uint64, client.MediaEditRecipeInput) (client.MediaEditRecipe, error)
	CloudResetMediaEditRecipe(context.Context, uint64, uint64) (client.MediaEditRecipe, error)
	CloudCreateMediaCreativeGeneration(context.Context, uint64, client.MediaCreativeInput) (client.MediaCreativeGeneration, error)
	CloudMediaCreativeGeneration(context.Context, string) (client.MediaCreativeGeneration, error)
	CloudCancelMediaCreativeGeneration(context.Context, string) (client.MediaCreativeGeneration, error)
	CloudMediaThumbnail(context.Context, uint64, ...uint64) (agentMediaThumbnail, error)
	CloudMediaAnalysisPreview(context.Context, uint64) (agentMediaThumbnail, error)
	CloudMediaLivePhotoStillTicket(context.Context, uint64) (client.FilePreviewTicket, error)
	CloudMediaLivePhotoMotionTicket(context.Context, uint64) (client.FilePreviewTicket, error)
	CloudSources(context.Context) ([]client.Source, error)
	CloudSourceRuns(context.Context, uint64, int, int) ([]client.SyncRun, error)
	CloudSourceRunFailures(context.Context, uint64, string, int, int) ([]client.SourceRunFailure, error)
	CloudCancelSourceRun(context.Context, uint64, string) (client.SyncRun, error)
	CloudSourceItems(context.Context, uint64, string, int, int) ([]client.SourceItem, error)
	CloudSourceCollections(context.Context, uint64, string) ([]client.SourceCollection, error)
	CloudSourceCollectionItems(context.Context, uint64, uint64, int, int) ([]client.SourceCollectionItem, error)
	CloudSourceCredentialStatus(context.Context, uint64) (client.SourceCredentialStatus, error)
	CloudRevealSourceCredential(context.Context, uint64) (client.SourceCredentialReveal, error)
	CloudTestSourceCredential(context.Context, string, map[string]string) (client.SourceCredentialTestResult, error)
	CloudTestStoredSourceCredential(context.Context, uint64) (client.SourceCredentialTestResult, error)
	CloudPutSourceCredential(context.Context, uint64, map[string]string) (client.SourceCredentialStatus, error)
	CloudDeleteSourceCredential(context.Context, uint64) error
	CloudSourceConnectorConfig(context.Context, uint64) (client.SourceConnectorConfig, error)
	CloudBrowseSourceDirectories(context.Context, uint64, string, int, int) (client.SourceBrowsePage, error)
	CloudPutSourceConnectorConfig(context.Context, uint64, uint64, map[string]any) (client.SourceConnectorConfig, error)
	CloudCreateSource(context.Context, client.CreateSourceInput) (client.Source, error)
	CloudUpdateSource(context.Context, uint64, uint64, client.UpdateSourceInput) (client.Source, error)
	CloudDeleteSource(context.Context, uint64, uint64) error
	CloudTriggerSource(context.Context, uint64) (client.Source, error)
	FileAvailability(path string) (mount.FileAvailability, error)
	SetFileAvailability(path, action string) error
	Transfers() (uint64, []transfer.Task)
	WaitTransfers(context.Context, uint64) (uint64, []transfer.Task, bool)
	RetryTransfer(context.Context, string) error
	StartTransferGroup(transfer.Spec) (string, error)
	StartTransferChild(string, transfer.Spec) (string, error)
	StartTransferChildren(string, []transfer.Spec) ([]string, error)
	BeginTransfer(string, *transfer.GroupProgress) error
	ProgressTransfer(string, int64, int64) error
	UpdateTransferGroup(string, transfer.GroupProgress) error
	FinishTransfer(string, string, string, bool) error
	ClearTransferHistory(...string) (uint64, []transfer.Task)
	Diagnostics(context.Context) diagnostics.Report
	Reconnect(context.Context) error
	RepairSyncRoot(context.Context) error
	OpenLogs() error
	Conflicts() []conflictstate.Record
	OpenConflict(id string, both bool) error
	ResolveConflict(id, choice string) error
	OpenFolder() error
	OpenManagedPath(path string, reveal bool) error
	OpenManagedPathWith(path string) error
}

type desktopIPCServer struct {
	server        *http.Server
	discoveryPath string
	token         string
	cleanupOnce   sync.Once
}

func startDesktopIPC(ctx context.Context, ctrl desktopIPCController, shutdown func()) (*desktopIPCServer, error) {
	var tokenBytes [32]byte
	if _, err := rand.Read(tokenBytes[:]); err != nil {
		return nil, err
	}
	token := hex.EncodeToString(tokenBytes[:])
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	baseURL := "http://" + listener.Addr().String()

	configDir, err := userconfig.Dir()
	if err != nil {
		_ = listener.Close()
		return nil, err
	}
	discoveryPath, err := writeDesktopIPCDiscovery(configDir, desktopIPCDiscovery{
		Version: desktopIPCAPIVersion,
		BaseURL: baseURL,
		Token:   token,
		PID:     os.Getpid(),
	})
	if err != nil {
		_ = listener.Close()
		return nil, err
	}

	s := &desktopIPCServer{
		server: &http.Server{
			Handler:           newDesktopIPCHandler(ctrl, token, shutdown),
			ReadHeaderTimeout: 5 * time.Second,
			IdleTimeout:       35 * time.Second,
		},
		discoveryPath: discoveryPath,
		token:         token,
	}

	go func() {
		err := s.server.Serve(listener)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("desktop IPC stopped: %v", err)
		}
		s.cleanup()
	}()

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = s.server.Shutdown(shutdownCtx)
		s.cleanup()
	}()

	return s, nil
}

func (s *desktopIPCServer) Close() error {
	if s == nil || s.server == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err := s.server.Shutdown(ctx)
	s.cleanup()
	return err
}

func (s *desktopIPCServer) cleanup() {
	s.cleanupOnce.Do(func() {
		removeDesktopIPCDiscoveryIfOwned(s.discoveryPath, s.token)
	})
}

func writeDesktopIPCDiscovery(configDir string, discovery desktopIPCDiscovery) (string, error) {
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		return "", err
	}
	_ = os.Chmod(configDir, 0o700)

	data, err := json.MarshalIndent(discovery, "", "  ")
	if err != nil {
		return "", err
	}
	data = append(data, '\n')

	tmp, err := os.CreateTemp(configDir, "desktop-ipc-*.tmp")
	if err != nil {
		return "", err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return "", err
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return "", err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}

	path := filepath.Join(configDir, desktopIPCDiscoveryName)
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if err := os.Rename(tmpName, path); err != nil {
		return "", err
	}
	_ = os.Chmod(path, 0o600)
	return path, nil
}

func removeDesktopIPCDiscoveryIfOwned(path, token string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var discovery desktopIPCDiscovery
	if json.Unmarshal(data, &discovery) != nil {
		return
	}
	if subtle.ConstantTimeCompare([]byte(discovery.Token), []byte(token)) != 1 {
		return
	}
	_ = os.Remove(path)
}

func newDesktopIPCHandler(
	ctrl desktopIPCController,
	token string,
	shutdown func(),
) http.Handler {
	h := &desktopIPCHandler{ctrl: ctrl, shutdown: shutdown}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/hello", h.hello)
	mux.HandleFunc("GET /v1/status", h.status)
	mux.HandleFunc("GET /v1/events", h.events)
	mux.HandleFunc("POST /v1/auth/login", h.login)
	mux.HandleFunc("POST /v1/auth/logout", h.logout)
	mux.HandleFunc("POST /v1/auth/change-password", h.changePassword)
	mux.HandleFunc("POST /v1/sync/pause", h.pause)
	mux.HandleFunc("POST /v1/sync/resume", h.resume)
	mux.HandleFunc("POST /v1/sync/now", h.syncNow)
	mux.HandleFunc("GET /v1/settings", h.settings)
	mux.HandleFunc("PATCH /v1/settings", h.updateSettings)
	mux.HandleFunc("GET /v1/update", h.updateState)
	mux.HandleFunc("PATCH /v1/update/settings", h.updateMode)
	mux.HandleFunc("POST /v1/update/check", h.checkUpdate)
	mux.HandleFunc("POST /v1/update/download", h.downloadUpdate)
	mux.HandleFunc("POST /v1/update/install", h.installUpdate)
	mux.HandleFunc("POST /v1/update/cancel", h.cancelUpdate)
	mux.HandleFunc("PUT /v1/settings/sync-rule", h.setSyncRule)
	mux.HandleFunc("GET /v1/storage-tree", h.storageTree)
	mux.HandleFunc("GET /v1/cache", h.cacheStats)
	mux.HandleFunc("GET /v1/local-disk-space", h.localDiskSpace)
	mux.HandleFunc("POST /v1/cache/release", h.releaseCache)
	mux.HandleFunc("GET /v1/cloud/root", h.cloudRoot)
	mux.HandleFunc("GET /v1/cloud/children", h.cloudChildren)
	mux.HandleFunc("GET /v1/cloud/changes", h.cloudChanges)
	mux.HandleFunc("GET /v1/cloud/quick-access", h.cloudFileQuickAccess)
	mux.HandleFunc("POST /v1/cloud/quick-access/pin", h.cloudPinFileQuickAccess)
	mux.HandleFunc("POST /v1/cloud/quick-access/unpin", h.cloudUnpinFileQuickAccess)
	mux.HandleFunc("PUT /v1/cloud/quick-access/order", h.cloudReorderFileQuickAccess)
	mux.HandleFunc("GET /v1/cloud/tags", h.cloudFileTags)
	mux.HandleFunc("POST /v1/cloud/tags", h.cloudCreateFileTag)
	mux.HandleFunc("PATCH /v1/cloud/tags", h.cloudUpdateFileTag)
	mux.HandleFunc("DELETE /v1/cloud/tags", h.cloudDeleteFileTag)
	mux.HandleFunc("POST /v1/cloud/tags/query", h.cloudQueryFileNodeTags)
	mux.HandleFunc("PUT /v1/cloud/tags/nodes", h.cloudAddFileTagNodes)
	mux.HandleFunc("DELETE /v1/cloud/tags/nodes", h.cloudRemoveFileTagNodes)
	mux.HandleFunc("GET /v1/cloud/saved-searches", h.cloudFileSavedSearches)
	mux.HandleFunc("POST /v1/cloud/saved-searches", h.cloudCreateFileSavedSearch)
	mux.HandleFunc("PATCH /v1/cloud/saved-searches", h.cloudUpdateFileSavedSearch)
	mux.HandleFunc("DELETE /v1/cloud/saved-searches", h.cloudDeleteFileSavedSearch)
	mux.HandleFunc("PUT /v1/cloud/saved-searches/order", h.cloudReorderFileSavedSearches)
	mux.HandleFunc("GET /v1/cloud/favorites", h.cloudFileFavorites)
	mux.HandleFunc("POST /v1/cloud/favorites/favorite", h.cloudFavoriteFile)
	mux.HandleFunc("POST /v1/cloud/favorites/unfavorite", h.cloudUnfavoriteFile)
	mux.HandleFunc("GET /v1/cloud/recent", h.cloudFileRecent)
	mux.HandleFunc("POST /v1/cloud/recent/touch", h.cloudTouchFileRecent)
	mux.HandleFunc("DELETE /v1/cloud/recent", h.cloudClearFileRecent)
	mux.HandleFunc("POST /v1/cloud/directories", h.cloudCreateDir)
	mux.HandleFunc("PATCH /v1/cloud/nodes", h.cloudRename)
	mux.HandleFunc("POST /v1/cloud/copy", h.cloudCopy)
	mux.HandleFunc("PATCH /v1/cloud/move", h.cloudMove)
	mux.HandleFunc("DELETE /v1/cloud/nodes", h.cloudDelete)
	mux.HandleFunc("POST /v1/cloud/batch/copy", h.cloudBatchCopy)
	mux.HandleFunc("POST /v1/cloud/batch/move", h.cloudBatchMove)
	mux.HandleFunc("POST /v1/cloud/batch/delete", h.cloudBatchDelete)
	mux.HandleFunc("POST /v1/cloud/properties/stats", h.cloudFilePropertiesStats)
	mux.HandleFunc("POST /v1/cloud/media-details", h.cloudFileMediaDetails)
	mux.HandleFunc("POST /v1/cloud/file-operations", h.cloudCreateFileOperation)
	mux.HandleFunc("GET /v1/cloud/background-task-summary", h.cloudBackgroundTaskActiveSummary)
	mux.HandleFunc("GET /v1/cloud/admin-services", h.cloudAdminServices)
	mux.HandleFunc("GET /v1/cloud/admin-baidu-map", h.cloudAdminBaiduMap)
	mux.HandleFunc("PUT /v1/cloud/admin-baidu-map", h.cloudSetAdminBaiduMap)
	mux.HandleFunc("POST /v1/cloud/admin-baidu-map/reveal", h.cloudRevealAdminBaiduMapAK)
	mux.HandleFunc("GET /v1/cloud/admin-photo-intelligence", h.cloudAdminPhotoAuto)
	mux.HandleFunc("PUT /v1/cloud/admin-photo-intelligence", h.cloudSetAdminPhotoAuto)
	mux.HandleFunc("GET /v1/cloud/admin-geonames", h.cloudAdminGeoNames)
	mux.HandleFunc("PUT /v1/cloud/admin-geonames", h.cloudSetAdminGeoNames)
	mux.HandleFunc("POST /v1/cloud/admin-geonames/reload", h.cloudReloadAdminGeoNames)
	mux.HandleFunc("GET /v1/cloud/background-task-page", h.cloudBackgroundTaskPage)
	mux.HandleFunc("GET /v1/cloud/background-tasks", h.cloudBackgroundTasks)
	mux.HandleFunc("POST /v1/cloud/background-task-control", h.cloudBackgroundTaskControl)
	mux.HandleFunc("GET /v1/cloud/file-operations", h.cloudFileOperations)
	mux.HandleFunc("DELETE /v1/cloud/file-operations", h.cloudClearFileOperationHistory)
	mux.HandleFunc("GET /v1/cloud/file-operation", h.cloudFileOperation)
	mux.HandleFunc("POST /v1/cloud/file-operation/cancel", h.cloudCancelFileOperation)
	mux.HandleFunc("POST /v1/cloud/file-operation/retry", h.cloudRetryFileOperation)
	mux.HandleFunc("POST /v1/cloud/file-operation/undo", h.cloudUndoFileOperation)
	mux.HandleFunc("POST /v1/cloud/file-operation/redo", h.cloudRedoFileOperation)
	mux.HandleFunc("POST /v1/cloud/file-operation/resolve", h.cloudResolveFileOperationConflict)
	mux.HandleFunc("POST /v1/cloud/upload/preflight", h.cloudUploadConflictPreflight)
	mux.HandleFunc("POST /v1/cloud/upload/preflight/batch", h.cloudUploadConflictPreflightBatch)
	mux.HandleFunc("POST /v1/cloud/upload/conflict", h.cloudUploadWithConflictPolicy)
	mux.HandleFunc("POST /v1/cloud/upload", h.cloudUpload)
	mux.HandleFunc("GET /v1/cloud/text-preview", h.cloudFileTextPreview)
	mux.HandleFunc("GET /v1/cloud/file-preview-ticket", h.cloudFilePreviewTicket)
	mux.HandleFunc("POST /v1/cloud/download", h.cloudDownload)
	mux.HandleFunc("POST /v1/cloud/download/folder", h.cloudDownloadFolder)
	mux.HandleFunc("POST /v1/cloud/download/archive", h.cloudDownloadArchive)
	mux.HandleFunc("GET /v1/cloud/search", h.cloudSearch)
	mux.HandleFunc("GET /v1/cloud/quota", h.cloudQuota)
	mux.HandleFunc("GET /v1/server-update", h.serverUpdateState)
	mux.HandleFunc("POST /v1/server-update", h.startServerUpdate)
	mux.HandleFunc("GET /v1/cloud/storage-stats", h.cloudStorageStats)
	mux.HandleFunc("POST /v1/cloud/storage-cache/cleanup", h.cloudCleanupStorageCache)
	mux.HandleFunc("GET /v1/cloud/trash", h.cloudTrash)
	mux.HandleFunc("GET /v1/cloud/trash/range", h.cloudTrashRange)
	mux.HandleFunc("POST /v1/cloud/trash/restore", h.cloudRestoreTrash)
	mux.HandleFunc("POST /v1/cloud/trash/delete", h.cloudDeleteTrash)
	mux.HandleFunc("GET /v1/cloud/versions", h.cloudVersions)
	mux.HandleFunc("POST /v1/cloud/versions/restore", h.cloudRestoreVersion)
	mux.HandleFunc("GET /v1/cloud/shares", h.cloudShares)
	mux.HandleFunc("POST /v1/cloud/shares", h.cloudCreateShare)
	mux.HandleFunc("POST /v1/cloud/shares/revoke", h.cloudRevokeShare)
	mux.HandleFunc("GET /v1/media/items", h.mediaItems)
	mux.HandleFunc("GET /v1/media/item", h.mediaItem)
	mux.HandleFunc("GET /v1/cloud/node-location", h.nodeLocation)
	mux.HandleFunc("GET /v1/media/facets", h.mediaFacets)
	mux.HandleFunc("GET /v1/media/index-status", h.mediaIndexStatus)
	mux.HandleFunc("POST /v1/media/selection-snapshot", h.mediaCreateSelectionSnapshot)
	mux.HandleFunc("GET /v1/media/selection-snapshot", h.mediaGetSelectionSnapshot)
	mux.HandleFunc("PATCH /v1/media/selection-snapshot/exclusion", h.mediaSetSelectionExcluded)
	mux.HandleFunc("DELETE /v1/media/selection-snapshot", h.mediaDeleteSelectionSnapshot)
	mux.HandleFunc("POST /v1/media/selection-snapshot/job", h.mediaSubmitSelectionFavoriteJob)
	mux.HandleFunc("GET /v1/media/selection-jobs", h.mediaListSelectionJobs)
	mux.HandleFunc("GET /v1/media/selection-job", h.mediaGetSelectionJob)
	mux.HandleFunc("GET /v1/media/selection-job/failures", h.mediaSelectionJobFailures)
	mux.HandleFunc("POST /v1/media/selection-job/cancel", h.mediaCancelSelectionJob)
	mux.HandleFunc("POST /v1/media/selection-job/retry", h.mediaRetrySelectionJob)
	mux.HandleFunc("GET /v1/media/duplicate-organize/plan", h.mediaDuplicateOrganizePlan)
	mux.HandleFunc("POST /v1/media/duplicate-organize/apply", h.mediaDuplicateOrganizeApply)
	mux.HandleFunc("GET /v1/media/sync-folders", h.mediaSyncFolders)
	mux.HandleFunc("GET /v1/media/sync-folder", h.mediaSyncFolder)
	mux.HandleFunc("GET /v1/media/trash", h.mediaTrash)
	mux.HandleFunc("GET /v1/media/albums", h.mediaAlbums)
	mux.HandleFunc("GET /v1/media/album-folders", h.mediaAlbumFolders)
	mux.HandleFunc("POST /v1/media/album-folder", h.createMediaAlbumFolder)
	mux.HandleFunc("PATCH /v1/media/album-folder", h.updateMediaAlbumFolder)
	mux.HandleFunc("DELETE /v1/media/album-folder", h.deleteMediaAlbumFolder)
	mux.HandleFunc("PATCH /v1/media/album/folder", h.moveMediaAlbumToFolder)
	mux.HandleFunc("GET /v1/media/places", h.mediaPlaces)
	mux.HandleFunc("GET /v1/media/map-provider", h.mediaBaiduMapProvider)
	mux.HandleFunc("GET /v1/media/baidu-static", h.mediaBaiduStaticMap)
	mux.HandleFunc("GET /v1/media/memories", h.mediaMemories)
	mux.HandleFunc("GET /v1/media/memory-items", h.mediaMemoryItems)
	mux.HandleFunc("GET /v1/media/duplicates", h.mediaDuplicateGroups)
	mux.HandleFunc("GET /v1/media/duplicate-items", h.mediaDuplicateItems)
	mux.HandleFunc("GET /v1/media/bursts", h.mediaBurstReviews)
	mux.HandleFunc("GET /v1/media/burst-items", h.mediaBurstReviewItems)
	mux.HandleFunc("GET /v1/media/pets", h.mediaPets)
	mux.HandleFunc("GET /v1/media/pet-items", h.mediaPetItems)
	mux.HandleFunc("GET /v1/media/people/suggestions", h.mediaSuggestedPeople)
	mux.HandleFunc("GET /v1/media/people/suggestion-items", h.mediaSuggestedPersonItems)
	mux.HandleFunc("GET /v1/media/people/identities", h.mediaPersonIdentities)
	mux.HandleFunc("GET /v1/media/people/identity-items", h.mediaPersonItems)
	mux.HandleFunc("PATCH /v1/media/people/suggestion-review", h.reviewMediaSuggestedPerson)
	mux.HandleFunc("POST /v1/media/people/add-suggestion", h.addMediaSuggestedPersonToIdentity)
	mux.HandleFunc("POST /v1/media/people/adopt", h.adoptMediaSuggestedPerson)
	mux.HandleFunc("PATCH /v1/media/person", h.updateMediaPerson)
	mux.HandleFunc("POST /v1/media/person/merge", h.mergeMediaPeople)
	mux.HandleFunc("POST /v1/media/person/split", h.splitMediaPerson)
	mux.HandleFunc("POST /v1/media/albums", h.createMediaAlbum)
	mux.HandleFunc("PATCH /v1/media/album", h.renameMediaAlbum)
	mux.HandleFunc("PUT /v1/media/album/cover", h.setMediaAlbumCover)
	mux.HandleFunc("DELETE /v1/media/album", h.deleteMediaAlbum)
	mux.HandleFunc("POST /v1/media/smart-albums", h.createSmartMediaAlbum)
	mux.HandleFunc("PATCH /v1/media/smart-album", h.updateSmartMediaAlbum)
	mux.HandleFunc("DELETE /v1/media/smart-album", h.deleteSmartMediaAlbum)
	mux.HandleFunc("POST /v1/media/album/items", h.addMediaAlbumItems)
	mux.HandleFunc("DELETE /v1/media/album/item", h.removeMediaAlbumItem)
	mux.HandleFunc("GET /v1/media/albums/items", h.mediaAlbumItems)
	mux.HandleFunc("PATCH /v1/media/favorite", h.mediaFavorite)
	mux.HandleFunc("PATCH /v1/media/favorites", h.mediaFavoriteBatch)
	mux.HandleFunc("POST /v1/media/tags/batch", h.mediaTagsBatch)
	mux.HandleFunc("PATCH /v1/media/tags", h.mediaTags)
	mux.HandleFunc("PATCH /v1/media/people", h.mediaPeople)
	mux.HandleFunc("PATCH /v1/media/description", h.mediaDescription)
	mux.HandleFunc("GET /v1/media/edit", h.mediaEditRecipe)
	mux.HandleFunc("PUT /v1/media/edit", h.mediaEditRecipe)
	mux.HandleFunc("DELETE /v1/media/edit", h.mediaEditRecipe)
	mux.HandleFunc("POST /v1/media/creative", h.createMediaCreativeGeneration)
	mux.HandleFunc("GET /v1/media/creative", h.mediaCreativeGeneration)
	mux.HandleFunc("POST /v1/media/creative/cancel", h.cancelMediaCreativeGeneration)
	mux.HandleFunc("GET /v1/media/thumbnail", h.mediaThumbnail)
	mux.HandleFunc("GET /v1/media/analysis-preview", h.mediaAnalysisPreview)
	mux.HandleFunc("PUT /v1/media/video-poster", h.mediaVideoPoster)
	mux.HandleFunc("GET /v1/media/live-photo-still-ticket", h.mediaLivePhotoStillTicket)
	mux.HandleFunc("GET /v1/media/live-photo-motion-ticket", h.mediaLivePhotoMotionTicket)
	mux.HandleFunc("GET /v1/sources", h.sources)
	mux.HandleFunc("POST /v1/local-folder/authorize", h.authorizeLocalFolder)
	mux.HandleFunc("POST /v1/sources", h.createSource)
	mux.HandleFunc("PATCH /v1/sources", h.updateSource)
	mux.HandleFunc("DELETE /v1/sources", h.deleteSource)
	mux.HandleFunc("POST /v1/sources/trigger", h.triggerSource)
	mux.HandleFunc("GET /v1/sources/runs", h.sourceRuns)
	mux.HandleFunc("GET /v1/sources/runs/failures", h.sourceRunFailures)
	mux.HandleFunc("POST /v1/sources/runs/cancel", h.cancelSourceRun)
	mux.HandleFunc("GET /v1/sources/items", h.sourceItems)
	mux.HandleFunc("GET /v1/sources/collections", h.sourceCollections)
	mux.HandleFunc("GET /v1/sources/collections/items", h.sourceCollectionItems)
	mux.HandleFunc("POST /v1/source-credentials/test", h.testSourceCredential)
	mux.HandleFunc("GET /v1/sources/credential", h.sourceCredentialStatus)
	mux.HandleFunc("POST /v1/sources/credential/reveal", h.revealSourceCredential)
	mux.HandleFunc("POST /v1/sources/credential/test", h.testStoredSourceCredential)
	mux.HandleFunc("PUT /v1/sources/credential", h.putSourceCredential)
	mux.HandleFunc("DELETE /v1/sources/credential", h.deleteSourceCredential)
	mux.HandleFunc("GET /v1/sources/connector-config", h.sourceConnectorConfig)
	mux.HandleFunc("GET /v1/sources/browse", h.browseSourceDirectories)
	mux.HandleFunc("PUT /v1/sources/connector-config", h.putSourceConnectorConfig)
	mux.HandleFunc("GET /v1/file-availability", h.fileAvailability)
	mux.HandleFunc("POST /v1/file-availability", h.setFileAvailability)
	mux.HandleFunc("POST /v1/file-availability/batch", h.fileAvailabilityBatch)
	mux.HandleFunc("GET /v1/transfers", h.transfers)
	mux.HandleFunc("GET /v1/transfer-events", h.transferEvents)
	mux.HandleFunc("POST /v1/transfers/retry", h.retryTransfer)
	mux.HandleFunc("POST /v1/transfers/lifecycle", h.transferLifecycle)
	mux.HandleFunc("DELETE /v1/transfers", h.clearTransferHistory)
	mux.HandleFunc("GET /v1/diagnostics", h.diagnostics)
	mux.HandleFunc("GET /v1/diagnostics/report", h.diagnosticReport)
	mux.HandleFunc("POST /v1/diagnostics/reconnect", h.reconnect)
	mux.HandleFunc("POST /v1/diagnostics/repair-sync-root", h.repairSyncRoot)
	mux.HandleFunc("POST /v1/diagnostics/open-logs", h.openLogs)
	mux.HandleFunc("GET /v1/conflicts", h.conflicts)
	mux.HandleFunc("POST /v1/conflicts/open", h.openConflict)
	mux.HandleFunc("POST /v1/conflicts/resolve", h.resolveConflict)
	mux.HandleFunc("POST /v1/open-folder", h.openFolder)
	mux.HandleFunc("POST /v1/open-path", h.openPath)
	mux.HandleFunc("POST /v1/open-with", h.openWith)
	mux.HandleFunc("POST /v1/lifecycle/shutdown", h.shutdownAgent)
	return desktopIPCAuth(token, mux)
}

type desktopIPCHandler struct {
	ctrl     desktopIPCController
	shutdown func()
}

func desktopIPCAuth(token string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		ip := net.ParseIP(host)
		if err != nil || ip == nil || !ip.IsLoopback() {
			writeDesktopIPCError(w, http.StatusForbidden, "loopback_only", "desktop IPC accepts loopback requests only")
			return
		}
		parts := strings.Fields(r.Header.Get("Authorization"))
		authorized := len(parts) == 2 &&
			strings.EqualFold(parts[0], "Bearer") &&
			subtle.ConstantTimeCompare([]byte(parts[1]), []byte(token)) == 1
		if !authorized {
			w.Header().Set("WWW-Authenticate", "Bearer")
			writeDesktopIPCError(w, http.StatusUnauthorized, "unauthorized", "invalid desktop IPC token")
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

func (h *desktopIPCHandler) hello(w http.ResponseWriter, _ *http.Request) {
	writeDesktopIPCJSON(w, http.StatusOK, desktopIPCHello{
		DiscoveryVersion: desktopIPCAPIVersion,
		ProtocolMin:      desktopIPCProtocolMin,
		ProtocolMax:      desktopIPCProtocolMax,
		AgentVersion:     version.String(),
		PID:              os.Getpid(),
		Platform:         runtime.GOOS,
		Arch:             runtime.GOARCH,
		Capabilities:     desktopIPCHelloCapabilities(),
	})
}

func (h *desktopIPCHandler) shutdownAgent(w http.ResponseWriter, _ *http.Request) {
	if h.shutdown == nil {
		writeDesktopIPCError(w, http.StatusServiceUnavailable, "shutdown_unavailable", "agent shutdown is unavailable")
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
	go func() {
		time.Sleep(50 * time.Millisecond)
		h.shutdown()
	}()
}

func (h *desktopIPCHandler) status(w http.ResponseWriter, _ *http.Request) {
	snapshot, revision := h.ctrl.SnapshotWithRevision()
	writeDesktopIPCJSON(w, http.StatusOK, makeDesktopIPCStatus(snapshot, revision))
}

func (h *desktopIPCHandler) events(w http.ResponseWriter, r *http.Request) {
	after := uint64(0)
	if raw := strings.TrimSpace(r.URL.Query().Get("after_revision")); raw != "" {
		value, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_after_revision", "after_revision must be an unsigned integer")
			return
		}
		after = value
	}

	wait := desktopIPCDefaultEventWait
	if raw := strings.TrimSpace(r.URL.Query().Get("timeout_ms")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || time.Duration(value)*time.Millisecond > desktopIPCMaxEventWait {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_timeout", "timeout_ms must be between 1 and 30000")
			return
		}
		wait = time.Duration(value) * time.Millisecond
	}

	ctx, cancel := context.WithTimeout(r.Context(), wait)
	defer cancel()
	snapshot, revision, changed := h.ctrl.WaitSnapshot(ctx, after)
	w.Header().Set("X-XDrive-Revision", strconv.FormatUint(revision, 10))
	if !changed {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, desktopIPCEvent{
		Type:     "status.changed",
		Revision: revision,
		Status:   makeDesktopIPCStatus(snapshot, revision),
	})
}

func (h *desktopIPCHandler) login(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Server    string `json:"server"`
		Username  string `json:"username"`
		Password  string `json:"password"`
		MountPath string `json:"mount_path,omitempty"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if err := h.ctrl.Authenticate(input.Server, input.Username, input.Password, input.MountPath); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	h.writeStatus(w)
}

func (h *desktopIPCHandler) logout(w http.ResponseWriter, _ *http.Request) {
	if err := h.ctrl.Logout(); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	h.writeStatus(w)
}

func (h *desktopIPCHandler) changePassword(w http.ResponseWriter, r *http.Request) {
	var input struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.CurrentPassword) == "" || strings.TrimSpace(input.NewPassword) == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_password", "current_password and new_password are required")
		return
	}
	if err := h.ctrl.ChangePassword(input.CurrentPassword, input.NewPassword); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	h.writeStatus(w)
}

func (h *desktopIPCHandler) pause(w http.ResponseWriter, _ *http.Request) {
	if err := h.ctrl.SetPaused(true); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	h.writeStatus(w)
}

func (h *desktopIPCHandler) resume(w http.ResponseWriter, _ *http.Request) {
	if err := h.ctrl.SetPaused(false); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	h.writeStatus(w)
}

func (h *desktopIPCHandler) syncNow(w http.ResponseWriter, _ *http.Request) {
	if err := h.ctrl.SyncNow(); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	h.writeStatus(w)
}

func (h *desktopIPCHandler) settings(w http.ResponseWriter, _ *http.Request) {
	cfg, root, err := h.ctrl.Settings()
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, desktopIPCSettings{
		MountPath:       root,
		CacheLimitBytes: cfg.CacheLimitBytes,
		SyncRules:       append([]userconfig.SyncRule(nil), cfg.SyncRules...),
	})
}

func (h *desktopIPCHandler) updateSettings(w http.ResponseWriter, r *http.Request) {
	var input struct {
		MountPath       *string `json:"mount_path"`
		CacheLimitBytes *int64  `json:"cache_limit_bytes"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.MountPath == nil && input.CacheLimitBytes == nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "empty_settings", "at least one setting is required")
		return
	}
	if err := h.ctrl.UpdateSettings(input.MountPath, input.CacheLimitBytes); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	h.settings(w, r)
}

func (h *desktopIPCHandler) updateState(w http.ResponseWriter, _ *http.Request) {
	writeDesktopIPCJSON(w, http.StatusOK, h.ctrl.UpdateState())
}

func (h *desktopIPCHandler) updateMode(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Mode   *string `json:"mode"`
		Source *string `json:"source"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.Mode == nil && input.Source == nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "empty_update_settings", "mode or source is required")
		return
	}
	state := h.ctrl.UpdateState()
	var err error
	if input.Mode != nil {
		state, err = h.ctrl.SetUpdateMode(*input.Mode)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
	}
	if input.Source != nil {
		state, err = h.ctrl.SetUpdateSource(*input.Source)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
	}
	writeDesktopIPCJSON(w, http.StatusOK, state)
}

func (h *desktopIPCHandler) checkUpdate(w http.ResponseWriter, r *http.Request) {
	state, err := h.ctrl.CheckClientUpdate(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, state)
}

func (h *desktopIPCHandler) downloadUpdate(w http.ResponseWriter, r *http.Request) {
	state, err := h.ctrl.DownloadClientUpdate(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, state)
}

func (h *desktopIPCHandler) installUpdate(w http.ResponseWriter, r *http.Request) {
	state, err := h.ctrl.InstallClientUpdate(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, state)
}

func (h *desktopIPCHandler) cancelUpdate(w http.ResponseWriter, _ *http.Request) {
	state, err := h.ctrl.CancelClientUpdate()
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, state)
}

func (h *desktopIPCHandler) setSyncRule(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Path string `json:"path"`
		Mode string `json:"mode"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Path) == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_sync_rule", "path is required")
		return
	}
	if err := h.ctrl.SetSelectiveSyncRule(input.Path, input.Mode); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	h.settings(w, r)
}

func (h *desktopIPCHandler) storageTree(w http.ResponseWriter, r *http.Request) {
	tree, err := h.ctrl.StorageTree(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, tree)
}

func (h *desktopIPCHandler) cacheStats(w http.ResponseWriter, _ *http.Request) {
	stats, err := h.ctrl.CacheStats()
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, stats)
}

func (h *desktopIPCHandler) localDiskSpace(w http.ResponseWriter, _ *http.Request) {
	writeDesktopIPCJSON(w, http.StatusOK, h.ctrl.LocalDiskSpace())
}

func (h *desktopIPCHandler) releaseCache(w http.ResponseWriter, _ *http.Request) {
	result, err := h.ctrl.ReleaseReclaimableCache()
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) cloudRoot(w http.ResponseWriter, r *http.Request) {
	node, err := h.ctrl.CloudRoot(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, node)
}

func desktopIPCFileExplorerGrouping(
	w http.ResponseWriter,
	r *http.Request,
) (client.FileExplorerGroupingOptions, bool) {
	query := r.URL.Query()
	group := strings.TrimSpace(strings.ToLower(query.Get("group")))
	switch group {
	case "", "none", "type", "modified", "size":
	default:
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_file_group", "group must be none, type, modified, or size")
		return client.FileExplorerGroupingOptions{}, false
	}
	var foldersFirst *bool
	if rawValues, exists := query["folders_first"]; exists {
		raw := ""
		if len(rawValues) > 0 {
			raw = strings.TrimSpace(strings.ToLower(rawValues[0]))
		}
		value, err := strconv.ParseBool(raw)
		if err != nil {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_folders_first", "folders_first must be true or false")
			return client.FileExplorerGroupingOptions{}, false
		}
		foldersFirst = &value
	}
	return client.FileExplorerGroupingOptions{
		Group:        group,
		FoldersFirst: foldersFirst,
	}, true
}

func (h *desktopIPCHandler) cloudChildren(w http.ResponseWriter, r *http.Request) {
	parentID, ok := desktopIPCUint64Query(w, r, "parent_id")
	if !ok {
		return
	}
	query := r.URL.Query()
	if rawValues, rangeRequested := query["offset"]; rangeRequested {
		rawOffset := ""
		if len(rawValues) > 0 {
			rawOffset = strings.TrimSpace(rawValues[0])
		}
		offset, err := strconv.Atoi(rawOffset)
		if err != nil || offset < 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_cloud_children_offset", "offset must be zero or greater")
			return
		}
		if strings.TrimSpace(query.Get("cursor")) != "" || query.Get("name") != "" || query.Get("name_ci") != "" {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_cloud_children_range", "range requests do not accept cursor or name filters")
			return
		}
		grouping, ok := desktopIPCFileExplorerGrouping(w, r)
		if !ok {
			return
		}
		options := client.ChildrenRangeOptions{
			Offset:   offset,
			Sort:     strings.TrimSpace(query.Get("sort")),
			Order:    strings.TrimSpace(query.Get("order")),
			Grouping: grouping,
		}
		if raw := strings.TrimSpace(strings.ToLower(query.Get("include_count"))); raw != "" {
			switch raw {
			case "true":
				options.OmitTotalCount = false
			case "false":
				options.OmitTotalCount = true
			default:
				writeDesktopIPCError(w, http.StatusBadRequest, "invalid_cloud_children_include_count", "include_count must be true or false")
				return
			}
		}
		if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
			limit, err := strconv.Atoi(raw)
			if err != nil || limit < 1 || limit > 500 {
				writeDesktopIPCError(w, http.StatusBadRequest, "invalid_cloud_children_limit", "limit must be between 1 and 500")
				return
			}
			options.Limit = limit
		}
		page, err := h.ctrl.CloudListRange(r.Context(), parentID, options)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, page)
		return
	}

	if query.Get("include_count") != "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_cloud_children_include_count", "include_count requires offset")
		return
	}
	if query.Get("group") != "" || query.Get("folders_first") != "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_cloud_children_group", "group and folders_first require offset")
		return
	}

	paged := query.Get("limit") != "" || query.Get("cursor") != "" || query.Get("sort") != "" || query.Get("order") != "" || query.Get("name") != "" || query.Get("name_ci") != ""
	if !paged {
		items, err := h.ctrl.CloudList(r.Context(), parentID)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, items)
		return
	}
	options := client.ChildrenOptions{
		Cursor: strings.TrimSpace(query.Get("cursor")),
		Sort:   strings.TrimSpace(query.Get("sort")),
		Order:  strings.TrimSpace(query.Get("order")),
		Name:   query.Get("name"),
		NameCI: query.Get("name_ci"),
	}
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 500 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_cloud_children_limit", "limit must be between 1 and 500")
			return
		}
		options.Limit = limit
	}
	page, err := h.ctrl.CloudListPage(r.Context(), parentID, options)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, page)
}

func (h *desktopIPCHandler) cloudChanges(w http.ResponseWriter, r *http.Request) {
	values := r.URL.Query()
	var after uint64
	if raw := strings.TrimSpace(values.Get("after")); raw != "" {
		value, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_cloud_change_cursor", "after must be a non-negative integer")
			return
		}
		after = value
	}
	limit := 200
	if raw := strings.TrimSpace(values.Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 1000 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_cloud_change_limit", "limit must be between 1 and 1000")
			return
		}
		limit = value
	}
	page, err := h.ctrl.CloudNodeChanges(r.Context(), after, limit)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, page)
}

func (h *desktopIPCHandler) cloudFileQuickAccess(w http.ResponseWriter, r *http.Request) {
	items, err := h.ctrl.CloudFileQuickAccess(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) cloudPinFileQuickAccess(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID uint64 `json:"id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.ID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_quick_access", "id is required")
		return
	}
	item, err := h.ctrl.CloudPinFileQuickAccess(r.Context(), input.ID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, item)
}

func (h *desktopIPCHandler) cloudUnpinFileQuickAccess(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID uint64 `json:"id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.ID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_quick_access", "id is required")
		return
	}
	if err := h.ctrl.CloudUnpinFileQuickAccess(r.Context(), input.ID); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) cloudReorderFileQuickAccess(w http.ResponseWriter, r *http.Request) {
	var input struct {
		NodeIDs []uint64 `json:"node_ids"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if err := h.ctrl.CloudReorderFileQuickAccess(r.Context(), input.NodeIDs); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) cloudFileTags(w http.ResponseWriter, r *http.Request) {
	items, err := h.ctrl.CloudFileTags(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) cloudCreateFileTag(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	item, err := h.ctrl.CloudCreateFileTag(r.Context(), input.Name, input.Color)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, item)
}

func (h *desktopIPCHandler) cloudUpdateFileTag(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID    uint64  `json:"id"`
		Name  *string `json:"name"`
		Color *string `json:"color"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.ID == 0 || (input.Name == nil && input.Color == nil) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_file_tag", "id and at least one update are required")
		return
	}
	updates := map[string]string{}
	if input.Name != nil {
		updates["name"] = *input.Name
	}
	if input.Color != nil {
		updates["color"] = *input.Color
	}
	item, err := h.ctrl.CloudUpdateFileTag(r.Context(), input.ID, updates)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, item)
}

func (h *desktopIPCHandler) cloudDeleteFileTag(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID uint64 `json:"id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.ID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_file_tag", "id is required")
		return
	}
	if err := h.ctrl.CloudDeleteFileTag(r.Context(), input.ID); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) cloudQueryFileNodeTags(w http.ResponseWriter, r *http.Request) {
	var input struct {
		NodeIDs []uint64 `json:"node_ids"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if len(input.NodeIDs) == 0 || len(input.NodeIDs) > 500 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_file_tag_nodes", "node_ids must contain 1 to 500 ids")
		return
	}
	items, err := h.ctrl.CloudQueryFileNodeTags(r.Context(), input.NodeIDs)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) cloudMutateFileTagNodes(w http.ResponseWriter, r *http.Request, assigned bool) {
	var input struct {
		TagID   uint64   `json:"tag_id"`
		NodeIDs []uint64 `json:"node_ids"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.TagID == 0 || len(input.NodeIDs) == 0 || len(input.NodeIDs) > 500 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_file_tag_nodes", "tag_id and 1 to 500 node_ids are required")
		return
	}
	if err := h.ctrl.CloudSetFileTagNodes(r.Context(), input.TagID, input.NodeIDs, assigned); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) cloudAddFileTagNodes(w http.ResponseWriter, r *http.Request) {
	h.cloudMutateFileTagNodes(w, r, true)
}

func (h *desktopIPCHandler) cloudRemoveFileTagNodes(w http.ResponseWriter, r *http.Request) {
	h.cloudMutateFileTagNodes(w, r, false)
}

func (h *desktopIPCHandler) cloudFileSavedSearches(w http.ResponseWriter, r *http.Request) {
	items, err := h.ctrl.CloudFileSavedSearches(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) cloudCreateFileSavedSearch(w http.ResponseWriter, r *http.Request) {
	var input client.FileSavedSearchInput
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	item, err := h.ctrl.CloudCreateFileSavedSearch(r.Context(), input)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, item)
}

func (h *desktopIPCHandler) cloudUpdateFileSavedSearch(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID    uint64                      `json:"id"`
		Value client.FileSavedSearchInput `json:"value"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.ID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_saved_search", "id is required")
		return
	}
	item, err := h.ctrl.CloudUpdateFileSavedSearch(r.Context(), input.ID, input.Value)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, item)
}

func (h *desktopIPCHandler) cloudDeleteFileSavedSearch(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID uint64 `json:"id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.ID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_saved_search", "id is required")
		return
	}
	if err := h.ctrl.CloudDeleteFileSavedSearch(r.Context(), input.ID); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) cloudReorderFileSavedSearches(w http.ResponseWriter, r *http.Request) {
	var input struct {
		IDs []uint64 `json:"ids"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if err := h.ctrl.CloudReorderFileSavedSearches(r.Context(), input.IDs); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) cloudFileFavorites(w http.ResponseWriter, r *http.Request) {
	items, err := h.ctrl.CloudFileFavorites(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) cloudFavoriteFile(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID uint64 `json:"id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.ID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_file_favorite", "id is required")
		return
	}
	item, err := h.ctrl.CloudFavoriteFile(r.Context(), input.ID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, item)
}

func (h *desktopIPCHandler) cloudUnfavoriteFile(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID uint64 `json:"id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.ID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_file_favorite", "id is required")
		return
	}
	if err := h.ctrl.CloudUnfavoriteFile(r.Context(), input.ID); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) cloudFileRecent(w http.ResponseWriter, r *http.Request) {
	limit := 16
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 50 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_recent_limit", "limit must be between 1 and 50")
			return
		}
		limit = value
	}
	items, err := h.ctrl.CloudFileRecent(r.Context(), limit)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) cloudTouchFileRecent(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID uint64 `json:"id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.ID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_recent", "id is required")
		return
	}
	item, err := h.ctrl.CloudTouchFileRecent(r.Context(), input.ID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, item)
}

func (h *desktopIPCHandler) cloudClearFileRecent(w http.ResponseWriter, r *http.Request) {
	if err := h.ctrl.CloudClearFileRecent(r.Context()); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) cloudCreateDir(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ParentID uint64 `json:"parent_id"`
		Name     string `json:"name"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.ParentID == 0 || input.Name == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_cloud_directory", "parent_id and name are required")
		return
	}
	node, err := h.ctrl.CloudCreateDir(r.Context(), input.ParentID, input.Name)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, node)
}

func (h *desktopIPCHandler) cloudRename(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID       uint64 `json:"id"`
		Revision uint64 `json:"revision"`
		Name     string `json:"name"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.ID == 0 || input.Revision == 0 || input.Name == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_cloud_rename", "id, revision, and name are required")
		return
	}
	node, err := h.ctrl.CloudRename(r.Context(), input.ID, input.Revision, input.Name)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, node)
}

func (h *desktopIPCHandler) cloudCopy(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID       uint64 `json:"id"`
		ParentID uint64 `json:"parent_id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.ID == 0 || input.ParentID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_cloud_copy", "id and parent_id are required")
		return
	}
	node, err := h.ctrl.CloudCopy(r.Context(), input.ID, input.ParentID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, node)
}

func (h *desktopIPCHandler) cloudMove(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID       uint64 `json:"id"`
		Revision uint64 `json:"revision"`
		ParentID uint64 `json:"parent_id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.ID == 0 || input.Revision == 0 || input.ParentID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_cloud_move", "id, revision, and parent_id are required")
		return
	}
	node, err := h.ctrl.CloudMove(r.Context(), input.ID, input.Revision, input.ParentID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, node)
}

func (h *desktopIPCHandler) cloudDelete(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID       uint64 `json:"id"`
		Revision uint64 `json:"revision"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.ID == 0 || input.Revision == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_cloud_delete", "id and revision are required")
		return
	}
	if err := h.ctrl.CloudDelete(r.Context(), input.ID, input.Revision); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) cloudBatchCopy(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Items    []client.BatchNodeRef `json:"items"`
		ParentID uint64                `json:"parent_id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	result, err := h.ctrl.CloudBatchCopy(r.Context(), input.Items, input.ParentID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) cloudBatchMove(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Items    []client.BatchNodeRef `json:"items"`
		ParentID uint64                `json:"parent_id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	result, err := h.ctrl.CloudBatchMove(r.Context(), input.Items, input.ParentID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) cloudBatchDelete(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Items []client.BatchNodeRef `json:"items"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	result, err := h.ctrl.CloudBatchDelete(r.Context(), input.Items)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) cloudFilePropertiesStats(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Items []client.BatchNodeRef `json:"items"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	result, err := h.ctrl.CloudFilePropertiesStats(r.Context(), input.Items)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

type desktopIPCFileMediaDetailsController interface {
	CloudFileMediaDetails(context.Context, []client.BatchNodeRef) ([]client.FileMediaDetails, error)
}

func (h *desktopIPCHandler) cloudFileMediaDetails(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Items []client.BatchNodeRef `json:"items"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	controller, ok := h.ctrl.(desktopIPCFileMediaDetailsController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "unsupported", "file media details are not supported")
		return
	}
	result, err := controller.CloudFileMediaDetails(r.Context(), input.Items)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) cloudCreateFileOperation(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Type     string                `json:"type"`
		Items    []client.BatchNodeRef `json:"items"`
		ParentID uint64                `json:"parent_id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.Type = strings.ToLower(strings.TrimSpace(input.Type))
	if input.Type == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_file_operation", "type is required")
		return
	}
	operation, err := h.ctrl.CloudCreateFileOperation(r.Context(), input.Type, input.Items, input.ParentID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusAccepted, operation)
}

func (h *desktopIPCHandler) cloudBackgroundTaskActiveSummary(
	w http.ResponseWriter,
	r *http.Request,
) {
	summary, err := h.ctrl.CloudBackgroundTaskActiveSummary(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, summary)
}

type desktopIPCAdminPhotoAutoController interface {
	CloudAdminPhotoAutoConfig(context.Context) (client.AdminPhotoAutoConfig, error)
	CloudSetAdminPhotoAutoConfig(context.Context, client.AdminPhotoAutoUpdate) (client.AdminPhotoAutoConfig, error)
}

func (h *desktopIPCHandler) cloudAdminPhotoAuto(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(desktopIPCAdminPhotoAutoController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_photo_auto_unavailable", "Photo Intelligence policy is unsupported")
		return
	}
	result, err := provider.CloudAdminPhotoAutoConfig(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) cloudSetAdminPhotoAuto(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(desktopIPCAdminPhotoAutoController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_photo_auto_unavailable", "Photo Intelligence policy is unsupported")
		return
	}
	var input struct {
		Revision    *uint64 `json:"revision"`
		AutoEnabled *bool   `json:"auto_enabled"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.Revision == nil || input.AutoEnabled == nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_photo_auto_policy", "Revision and auto_enabled are required")
		return
	}
	result, err := provider.CloudSetAdminPhotoAutoConfig(r.Context(), client.AdminPhotoAutoUpdate{
		Revision: *input.Revision, AutoEnabled: *input.AutoEnabled,
	})
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

type desktopIPCAdminGeoNamesController interface {
	CloudAdminGeoNamesConfig(context.Context) (client.AdminGeoNamesConfig, error)
	CloudSetAdminGeoNamesConfig(context.Context, client.AdminGeoNamesUpdate) (client.AdminGeoNamesConfig, error)
	CloudReloadAdminGeoNames(context.Context, string) (client.AdminGeoNamesReloadResult, error)
}

func (h *desktopIPCHandler) cloudAdminGeoNames(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(desktopIPCAdminGeoNamesController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_geonames_unavailable", "GeoNames management is unsupported")
		return
	}
	result, err := provider.CloudAdminGeoNamesConfig(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
func (h *desktopIPCHandler) cloudSetAdminGeoNames(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(desktopIPCAdminGeoNamesController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_geonames_unavailable", "GeoNames management is unsupported")
		return
	}
	var input struct {
		Revision      *uint64  `json:"revision"`
		MaxDistanceKM *float64 `json:"max_distance_km"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.Revision == nil || input.MaxDistanceKM == nil ||
		!validGeoNamesIPCMaxDistance(*input.MaxDistanceKM) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_geonames_setting", "invalid radius or revision")
		return
	}
	result, err := provider.CloudSetAdminGeoNamesConfig(r.Context(), client.AdminGeoNamesUpdate{
		Revision: *input.Revision, MaxDistanceKM: *input.MaxDistanceKM,
	})
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func validGeoNamesIPCMaxDistance(value float64) bool {
	return value > 0 && value <= 500
}

func (h *desktopIPCHandler) cloudReloadAdminGeoNames(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(desktopIPCAdminGeoNamesController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_geonames_unavailable", "GeoNames management is unsupported")
		return
	}
	var input struct {
		ExpectedVersion string `json:"expected_version"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.ExpectedVersion == "" || len(input.ExpectedVersion) > 128 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_geonames_version", "valid expected version is required")
		return
	}
	result, err := provider.CloudReloadAdminGeoNames(r.Context(), input.ExpectedVersion)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

type desktopIPCAdminBaiduMapController interface {
	CloudAdminBaiduMapConfig(context.Context) (client.AdminBaiduMapConfig, error)
	CloudSetAdminBaiduMapConfig(context.Context, client.AdminBaiduMapUpdate) (client.AdminBaiduMapConfig, error)
	CloudRevealAdminBaiduMapAK(context.Context, uint64) (client.AdminBaiduMapAKReveal, error)
}

func (h *desktopIPCHandler) cloudRevealAdminBaiduMapAK(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(desktopIPCAdminBaiduMapController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_baidu_map_unavailable", "baidu map configuration is not supported")
		return
	}
	var input struct {
		Revision *uint64 `json:"revision"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.Revision == nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_baidu_map_revision", "revision is required")
		return
	}
	result, err := provider.CloudRevealAdminBaiduMapAK(r.Context(), *input.Revision)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) cloudAdminBaiduMap(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(desktopIPCAdminBaiduMapController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_baidu_map_unavailable", "baidu map configuration is not supported")
		return
	}
	result, err := provider.CloudAdminBaiduMapConfig(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) cloudSetAdminBaiduMap(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(desktopIPCAdminBaiduMapController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_baidu_map_unavailable", "baidu map configuration is not supported")
		return
	}
	var input struct {
		Enabled  *bool   `json:"enabled"`
		Revision *uint64 `json:"revision"`
		AK       string  `json:"ak,omitempty"`
		ClearAK  bool    `json:"clear_ak,omitempty"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.Enabled == nil || input.Revision == nil || len(input.AK) > 256 || (input.ClearAK && input.AK != "") {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_baidu_map_config", "invalid map configuration")
		return
	}
	result, err := provider.CloudSetAdminBaiduMapConfig(r.Context(), client.AdminBaiduMapUpdate{
		Enabled:  *input.Enabled,
		Revision: *input.Revision,
		AK:       input.AK,
		ClearAK:  input.ClearAK,
	})
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) cloudAdminServices(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(interface {
		CloudAdminServices(context.Context) (client.ServiceDependenciesSnapshot, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_services_unavailable", "service dependencies are not supported by this agent")
		return
	}
	result, err := provider.CloudAdminServices(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) cloudBackgroundTaskPage(
	w http.ResponseWriter,
	r *http.Request,
) {
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 200 {
			writeDesktopIPCError(
				w,
				http.StatusBadRequest,
				"invalid_background_task_limit",
				"limit must be between 1 and 200",
			)
			return
		}
		limit = parsed
	}
	global := strings.EqualFold(
		strings.TrimSpace(r.URL.Query().Get("global")),
		"true",
	)
	page, err := h.ctrl.CloudBackgroundTaskPage(
		r.Context(),
		global,
		limit,
		strings.TrimSpace(r.URL.Query().Get("cursor")),
	)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, page)
}

func (h *desktopIPCHandler) cloudBackgroundTasks(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 200 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_background_task_limit", "limit must be between 1 and 200")
			return
		}
		limit = parsed
	}
	global := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("global")), "true")
	tasks, err := h.ctrl.CloudBackgroundTasks(r.Context(), global, limit)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, tasks)
}

func (h *desktopIPCHandler) cloudBackgroundTaskControl(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID     string `json:"id"`
		Action string `json:"action"`
		Global bool   `json:"global"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.ID = strings.TrimSpace(input.ID)
	input.Action = strings.ToLower(strings.TrimSpace(input.Action))
	if input.ID == "" || input.Action == "" {
		writeDesktopIPCError(
			w,
			http.StatusBadRequest,
			"invalid_background_task_control",
			"id and action are required",
		)
		return
	}
	result, err := h.ctrl.CloudControlBackgroundTask(
		r.Context(),
		input.Global,
		input.ID,
		input.Action,
	)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusAccepted, result)
}

func (h *desktopIPCHandler) cloudFileOperations(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 200 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_file_operation_limit", "limit must be between 1 and 200")
			return
		}
		limit = parsed
	}
	operations, err := h.ctrl.CloudFileOperations(r.Context(), limit)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, operations)
}

func (h *desktopIPCHandler) cloudClearFileOperationHistory(w http.ResponseWriter, r *http.Request) {
	if err := h.ctrl.CloudClearFileOperationHistory(r.Context()); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *desktopIPCHandler) cloudFileOperation(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_file_operation", "id is required")
		return
	}
	operation, err := h.ctrl.CloudFileOperation(r.Context(), id)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, operation)
}

func (h *desktopIPCHandler) cloudCancelFileOperation(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID string `json:"id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.ID = strings.TrimSpace(input.ID)
	if input.ID == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_file_operation", "id is required")
		return
	}
	operation, err := h.ctrl.CloudCancelFileOperation(r.Context(), input.ID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, operation)
}

func (h *desktopIPCHandler) cloudRetryFileOperation(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID string `json:"id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.ID = strings.TrimSpace(input.ID)
	if input.ID == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_file_operation", "id is required")
		return
	}
	operation, err := h.ctrl.CloudRetryFileOperation(r.Context(), input.ID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusAccepted, operation)
}

func (h *desktopIPCHandler) cloudUndoFileOperation(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID string `json:"id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.ID = strings.TrimSpace(input.ID)
	if input.ID == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_file_operation", "id is required")
		return
	}
	operation, err := h.ctrl.CloudUndoFileOperation(r.Context(), input.ID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusAccepted, operation)
}

func (h *desktopIPCHandler) cloudRedoFileOperation(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID string `json:"id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.ID = strings.TrimSpace(input.ID)
	if input.ID == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_file_operation", "id is required")
		return
	}
	operation, err := h.ctrl.CloudRedoFileOperation(r.Context(), input.ID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusAccepted, operation)
}

func (h *desktopIPCHandler) cloudResolveFileOperationConflict(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID             string `json:"id"`
		ConflictPolicy string `json:"conflict_policy"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.ID = strings.TrimSpace(input.ID)
	input.ConflictPolicy = strings.TrimSpace(input.ConflictPolicy)
	if input.ID == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_file_operation", "id is required")
		return
	}
	if input.ConflictPolicy != "skip" && input.ConflictPolicy != "keep_both" && input.ConflictPolicy != "replace" {
		writeDesktopIPCError(
			w,
			http.StatusBadRequest,
			"invalid_file_operation_conflict_policy",
			"conflict_policy must be skip, keep_both, or replace",
		)
		return
	}
	operation, err := h.ctrl.CloudResolveFileOperationConflict(
		r.Context(),
		input.ID,
		input.ConflictPolicy,
	)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusAccepted, operation)
}

func (h *desktopIPCHandler) cloudUploadConflictPreflight(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ParentID uint64 `json:"parent_id"`
		Name     string `json:"name"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.ParentID == 0 || input.Name == "" {
		writeDesktopIPCError(
			w,
			http.StatusBadRequest,
			"invalid_cloud_upload_preflight",
			"parent_id and name are required",
		)
		return
	}
	result, err := h.ctrl.CloudUploadConflictPreflight(r.Context(), input.ParentID, input.Name)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) cloudUploadConflictPreflightBatch(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Items []client.UploadConflictPreflightRequest `json:"items"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if len(input.Items) == 0 || len(input.Items) > client.UploadConflictPreflightBatchLimit {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_cloud_upload_preflight_batch", "items must contain between 1 and 200 entries")
		return
	}
	for index := range input.Items {
		input.Items[index].Name = strings.TrimSpace(input.Items[index].Name)
	}
	results, err := h.ctrl.CloudUploadConflictPreflightBatch(r.Context(), input.Items)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, results)
}

func (h *desktopIPCHandler) cloudUploadWithConflictPolicy(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ParentID       uint64 `json:"parent_id"`
		LocalPath      string `json:"local_path"`
		Name           string `json:"name"`
		ConflictPolicy string `json:"conflict_policy"`
		TransferID     string `json:"transfer_id,omitempty"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.LocalPath = strings.TrimSpace(input.LocalPath)
	input.Name = strings.TrimSpace(input.Name)
	input.ConflictPolicy = strings.TrimSpace(input.ConflictPolicy)
	input.TransferID = strings.TrimSpace(input.TransferID)
	if input.ParentID == 0 || input.LocalPath == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_cloud_upload", "parent_id and local_path are required")
		return
	}
	if input.ConflictPolicy != "fail" &&
		input.ConflictPolicy != "skip" &&
		input.ConflictPolicy != "keep_both" &&
		input.ConflictPolicy != "overwrite" {
		writeDesktopIPCError(
			w,
			http.StatusBadRequest,
			"invalid_upload_conflict_policy",
			"conflict_policy must be fail, skip, keep_both, or overwrite",
		)
		return
	}
	var result agentCloudUploadResult
	var err error
	if input.TransferID != "" {
		result, err = h.ctrl.CloudUploadWithConflictPolicyTracked(
			r.Context(),
			input.ParentID,
			input.LocalPath,
			input.Name,
			input.ConflictPolicy,
			input.TransferID,
		)
	} else {
		result, err = h.ctrl.CloudUploadWithConflictPolicy(
			r.Context(),
			input.ParentID,
			input.LocalPath,
			input.Name,
			input.ConflictPolicy,
		)
	}
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) cloudUpload(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ParentID  uint64 `json:"parent_id"`
		LocalPath string `json:"local_path"`
		Name      string `json:"name"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.LocalPath = strings.TrimSpace(input.LocalPath)
	input.Name = strings.TrimSpace(input.Name)
	if input.ParentID == 0 || input.LocalPath == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_cloud_upload", "parent_id and local_path are required")
		return
	}
	node, err := h.ctrl.CloudUpload(r.Context(), input.ParentID, input.LocalPath, input.Name)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, node)
}

func (h *desktopIPCHandler) cloudFileTextPreview(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("id")), 10, 64)
	if err != nil || id == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_file_id", "id must be a positive integer")
		return
	}
	preview, err := h.ctrl.CloudFileTextPreview(r.Context(), id)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, preview)
}

func (h *desktopIPCHandler) cloudFilePreviewTicket(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("node_id")), 10, 64)
	if err != nil || id == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_file_id", "node_id must be a positive integer")
		return
	}
	ticket, err := h.ctrl.CloudFilePreviewTicket(r.Context(), id)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, ticket)
}

func (h *desktopIPCHandler) cloudDownload(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID          uint64 `json:"id"`
		Destination string `json:"destination"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.Destination = strings.TrimSpace(input.Destination)
	if input.ID == 0 || input.Destination == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_cloud_download", "id and destination are required")
		return
	}
	if err := h.ctrl.CloudDownload(r.Context(), input.ID, input.Destination); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) cloudDownloadFolder(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID          uint64 `json:"id"`
		ParentID    uint64 `json:"parent_id"`
		Destination string `json:"destination"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.Destination = filepath.Clean(strings.TrimSpace(input.Destination))
	if input.ID == 0 || input.ParentID == 0 || input.Destination == "." || !filepath.IsAbs(input.Destination) {
		writeDesktopIPCError(
			w,
			http.StatusBadRequest,
			"invalid_cloud_folder_download",
			"id, parent_id and an absolute destination directory are required",
		)
		return
	}
	result, err := h.ctrl.CloudDownloadFolder(r.Context(), input.ID, input.ParentID, input.Destination)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) cloudDownloadArchive(w http.ResponseWriter, r *http.Request) {
	var input struct {
		IDs         []uint64 `json:"ids"`
		Destination string   `json:"destination"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.Destination = filepath.Clean(strings.TrimSpace(input.Destination))
	if len(input.IDs) == 0 || len(input.IDs) > 1000 || input.Destination == "." || !filepath.IsAbs(input.Destination) {
		writeDesktopIPCError(
			w,
			http.StatusBadRequest,
			"invalid_cloud_archive_download",
			"ids and an absolute destination directory are required",
		)
		return
	}
	for _, id := range input.IDs {
		if id == 0 {
			writeDesktopIPCError(
				w,
				http.StatusBadRequest,
				"invalid_cloud_archive_download",
				"archive node ids must be non-zero",
			)
			return
		}
	}
	result, err := h.ctrl.CloudDownloadArchive(r.Context(), input.IDs, input.Destination)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func desktopIPCSearchFilters(w http.ResponseWriter, r *http.Request) (agentCloudSearchFilters, bool) {
	values := r.URL.Query()
	filters := agentCloudSearchFilters{Server: client.SearchFilters{
		Kind:         strings.TrimSpace(values.Get("kind")),
		ModifiedFrom: strings.TrimSpace(values.Get("modified_from")),
		ModifiedTo:   strings.TrimSpace(values.Get("modified_to")),
	}}
	parseInt64 := func(name string) (*int64, bool) {
		raw := strings.TrimSpace(values.Get(name))
		if raw == "" {
			return nil, true
		}
		value, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || value < 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_search_filter", name+" must be zero or greater")
			return nil, false
		}
		return &value, true
	}
	var ok bool
	if filters.Server.MinSize, ok = parseInt64("min_size"); !ok {
		return agentCloudSearchFilters{}, false
	}
	if filters.Server.MaxSize, ok = parseInt64("max_size"); !ok {
		return agentCloudSearchFilters{}, false
	}
	if raw := strings.TrimSpace(values.Get("source_id")); raw != "" {
		sourceID, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || sourceID == 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_search_filter", "source_id must be a positive integer")
			return agentCloudSearchFilters{}, false
		}
		filters.Server.SourceID = sourceID
	}
	if raw := strings.TrimSpace(values.Get("tag_id")); raw != "" {
		tagID, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || tagID == 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_search_filter", "tag_id must be a positive integer")
			return agentCloudSearchFilters{}, false
		}
		filters.Server.TagID = tagID
	}
	if raw := strings.TrimSpace(values.Get("availability")); raw != "" {
		availability, err := normalizeAgentAvailabilityFilter(raw)
		if err != nil || availability == "" {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_search_filter", "availability is invalid")
			return agentCloudSearchFilters{}, false
		}
		filters.Availability = availability
	}
	return filters, true
}

func (h *desktopIPCHandler) cloudSearch(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	filters, ok := desktopIPCSearchFilters(w, r)
	if !ok {
		return
	}
	if (query == "" && !filters.Active()) || (query != "" && len([]rune(query)) < 2) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_search_query", "search requires at least 2 query characters or a structured filter")
		return
	}
	values := r.URL.Query()
	if rawValues, rangeRequested := values["offset"]; rangeRequested {
		rawOffset := ""
		if len(rawValues) > 0 {
			rawOffset = strings.TrimSpace(rawValues[0])
		}
		offset, err := strconv.Atoi(rawOffset)
		if rawOffset == "" || err != nil || offset < 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_search_offset", "offset must be zero or greater")
			return
		}
		if strings.TrimSpace(values.Get("cursor")) != "" {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_search_range", "range requests do not accept cursor")
			return
		}
		limit := cloudSearchLimit
		if raw := strings.TrimSpace(values.Get("limit")); raw != "" {
			value, err := strconv.Atoi(raw)
			if err != nil || value < 1 || value > cloudSearchLimit {
				writeDesktopIPCError(w, http.StatusBadRequest, "invalid_search_limit", "limit must be between 1 and 200")
				return
			}
			limit = value
		}
		grouping, ok := desktopIPCFileExplorerGrouping(w, r)
		if !ok {
			return
		}
		page, err := h.ctrl.CloudSearchRange(
			r.Context(),
			query,
			offset,
			limit,
			strings.TrimSpace(values.Get("sort")),
			strings.TrimSpace(values.Get("order")),
			filters,
			grouping,
		)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, page)
		return
	}
	if values.Get("group") != "" || values.Get("folders_first") != "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_search_group", "group and folders_first require offset")
		return
	}
	if filters.Availability != "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_search_filter", "availability requires offset")
		return
	}
	page, err := h.ctrl.CloudSearch(
		r.Context(),
		query,
		strings.TrimSpace(values.Get("cursor")),
		strings.TrimSpace(values.Get("sort")),
		strings.TrimSpace(values.Get("order")),
		filters,
	)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, page)
}
func (h *desktopIPCHandler) cloudQuota(w http.ResponseWriter, r *http.Request) {
	quota, err := h.ctrl.CloudQuota(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, quota)
}

func (h *desktopIPCHandler) serverUpdateState(w http.ResponseWriter, r *http.Request) {
	state, err := h.ctrl.CloudServerUpdateState(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, state)
}

func (h *desktopIPCHandler) startServerUpdate(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Source         string `json:"source"`
		Channel        string `json:"channel"`
		BackupFileData bool   `json:"backup_file_data"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.Source = strings.ToLower(strings.TrimSpace(input.Source))
	input.Channel = strings.ToLower(strings.TrimSpace(input.Channel))
	if (input.Source != "github" && input.Source != "gitlab") ||
		(input.Channel != "stable" && input.Channel != "master") {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_server_update", "source/channel are invalid")
		return
	}
	state, err := h.ctrl.CloudStartServerUpdate(r.Context(), input.Source, input.Channel, input.BackupFileData)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusAccepted, state)
}

func (h *desktopIPCHandler) cloudStorageStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.ctrl.CloudStorageStats(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, stats)
}

func (h *desktopIPCHandler) cloudCleanupStorageCache(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Kind string `json:"kind"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.Kind = strings.TrimSpace(input.Kind)
	switch input.Kind {
	case "media_thumbnail", "analysis_preview", "upload_staging", "storage_temp", "all":
	default:
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_storage_cleanup", "storage cleanup kind is invalid")
		return
	}
	result, err := h.ctrl.CloudCleanupStorageCache(r.Context(), input.Kind)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) cloudTrash(w http.ResponseWriter, r *http.Request) {
	items, err := h.ctrl.CloudTrash(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) cloudTrashRange(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	offset, err := strconv.Atoi(query.Get("offset"))
	if err != nil || offset < 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_trash_range", "offset must be zero or greater")
		return
	}
	limit, err := strconv.Atoi(query.Get("limit"))
	if err != nil || limit < 1 || limit > 500 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_trash_range", "limit must be between 1 and 500")
		return
	}
	sortKey := strings.TrimSpace(query.Get("sort"))
	order := strings.TrimSpace(query.Get("order"))
	if sortKey == "" {
		sortKey = "name"
	}
	if order == "" {
		order = "asc"
	}
	if sortKey != "name" && sortKey != "updated" && sortKey != "size" && sortKey != "type" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_trash_range", "sort is invalid")
		return
	}
	if order != "asc" && order != "desc" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_trash_range", "order is invalid")
		return
	}
	includeCount := true
	if raw := strings.TrimSpace(query.Get("include_count")); raw != "" {
		includeCount, err = strconv.ParseBool(raw)
		if err != nil {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_trash_range", "include_count must be true or false")
			return
		}
	}
	page, err := h.ctrl.CloudTrashRange(r.Context(), offset, limit, sortKey, order, includeCount)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, page)
}

func (h *desktopIPCHandler) cloudRestoreTrash(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID       uint64 `json:"id"`
		Revision uint64 `json:"revision"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.ID == 0 || input.Revision == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_trash_item", "id and revision are required")
		return
	}
	node, err := h.ctrl.CloudRestoreTrash(r.Context(), input.ID, input.Revision)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, node)
}

func (h *desktopIPCHandler) cloudDeleteTrash(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID       uint64 `json:"id"`
		Revision uint64 `json:"revision"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.ID == 0 || input.Revision == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_trash_item", "id and revision are required")
		return
	}
	if err := h.ctrl.CloudDeleteTrash(r.Context(), input.ID, input.Revision); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) cloudVersions(w http.ResponseWriter, r *http.Request) {
	nodeID, ok := desktopIPCUint64Query(w, r, "node_id")
	if !ok {
		return
	}
	items, err := h.ctrl.CloudVersions(r.Context(), nodeID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) cloudRestoreVersion(w http.ResponseWriter, r *http.Request) {
	var input struct {
		NodeID          uint64 `json:"node_id"`
		CurrentRevision uint64 `json:"current_revision"`
		VersionID       uint64 `json:"version_id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.NodeID == 0 || input.CurrentRevision == 0 || input.VersionID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_version_restore", "node_id, current_revision, and version_id are required")
		return
	}
	node, err := h.ctrl.CloudRestoreVersion(r.Context(), input.NodeID, input.CurrentRevision, input.VersionID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, node)
}

func (h *desktopIPCHandler) cloudShares(w http.ResponseWriter, r *http.Request) {
	nodeID, ok := desktopIPCUint64Query(w, r, "node_id")
	if !ok {
		return
	}
	items, err := h.ctrl.CloudShares(r.Context(), nodeID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) cloudCreateShare(w http.ResponseWriter, r *http.Request) {
	var input struct {
		NodeID       uint64 `json:"node_id"`
		ExpiresAt    string `json:"expires_at,omitempty"`
		Password     string `json:"password,omitempty"`
		MaxDownloads int64  `json:"max_downloads,omitempty"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.NodeID == 0 || input.MaxDownloads < 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_share", "node_id is required and max_downloads must be non-negative")
		return
	}
	var expiresAt *time.Time
	if value := strings.TrimSpace(input.ExpiresAt); value != "" {
		parsed, err := time.Parse(time.RFC3339, value)
		if err != nil || !parsed.After(time.Now()) {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_share_expiry", "expires_at must be a future RFC3339 timestamp")
			return
		}
		expiresAt = &parsed
	}
	created, err := h.ctrl.CloudCreateShare(r.Context(), input.NodeID, client.CreateShareInput{
		ExpiresAt: expiresAt, Password: input.Password, MaxDownloads: input.MaxDownloads,
	})
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusCreated, created)
}

func (h *desktopIPCHandler) cloudRevokeShare(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID uint64 `json:"id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.ID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_share", "id is required")
		return
	}
	if err := h.ctrl.CloudRevokeShare(r.Context(), input.ID); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type desktopIPCMediaItemController interface {
	CloudMediaItem(context.Context, uint64) (client.MediaItem, error)
}

func (h *desktopIPCHandler) mediaItem(w http.ResponseWriter, r *http.Request) {
	nodeID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("node_id")), 10, 64)
	if err != nil || nodeID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_node", "node_id must be a positive integer")
		return
	}
	controller, ok := h.ctrl.(desktopIPCMediaItemController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "media_item_unavailable", "single-media lookup is unavailable")
		return
	}
	item, err := controller.CloudMediaItem(r.Context(), nodeID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, item)
}

type desktopIPCNodeLocationController interface {
	CloudNodeLocation(context.Context, uint64) (client.NodeLocation, error)
}

func (h *desktopIPCHandler) nodeLocation(w http.ResponseWriter, r *http.Request) {
	nodeID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("node_id")), 10, 64)
	if err != nil || nodeID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_node_id", "node_id must be a positive integer")
		return
	}
	provider, ok := h.ctrl.(desktopIPCNodeLocationController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "node_location_unavailable", "this Agent does not support Node location")
		return
	}
	location, err := provider.CloudNodeLocation(r.Context(), nodeID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, location)
}

func (h *desktopIPCHandler) mediaItems(w http.ResponseWriter, r *http.Request) {
	query, ok := desktopIPCMediaQuery(w, r)
	if !ok {
		return
	}
	limit, offset, ok := desktopIPCMediaWindow(w, r)
	if !ok {
		return
	}
	rangeRequested, ok := desktopIPCMediaRangeRequested(w, r)
	if !ok {
		return
	}
	if rangeRequested {
		page, err := h.ctrl.CloudMediaItemsRange(r.Context(), query, limit, offset)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, page)
		return
	}
	items, err := h.ctrl.CloudMediaItems(r.Context(), query, limit, offset)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) mediaFacets(w http.ResponseWriter, r *http.Request) {
	query, ok := desktopIPCMediaQuery(w, r)
	if !ok {
		return
	}
	albumID := strings.TrimSpace(r.URL.Query().Get("album_id"))
	if albumID != "" && !desktopIPCValidMediaAlbumID(albumID, false) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_album_id", "album_id must be a Gallery album id")
		return
	}
	facets, err := h.ctrl.CloudMediaFacets(r.Context(), query, albumID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, facets)
}

func (h *desktopIPCHandler) mediaDuplicateOrganizePlan(w http.ResponseWriter, r *http.Request) {
	keeperID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("keeper_id")), 10, 64)
	if err != nil || keeperID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_organize_keeper",
			"keeper_id must be a positive node ID")
		return
	}
	rawIDs := r.URL.Query()["node_id"]
	if len(rawIDs) < 2 || len(rawIDs) > 32 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_organize_members",
			"node_id must include 2–32 members")
		return
	}
	nodeIDs := make([]uint64, 0, len(rawIDs))
	seen := make(map[uint64]struct{}, len(rawIDs))
	keeperFound := false
	for _, rawID := range rawIDs {
		nodeID, err := strconv.ParseUint(strings.TrimSpace(rawID), 10, 64)
		if err != nil || nodeID == 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_organize_members",
				"node_id must be a positive node ID")
			return
		}
		if _, exists := seen[nodeID]; exists {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_organize_members",
				"node_id values must be distinct")
			return
		}
		seen[nodeID] = struct{}{}
		nodeIDs = append(nodeIDs, nodeID)
		keeperFound = keeperFound || nodeID == keeperID
	}
	if !keeperFound {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_organize_keeper",
			"keeper_id must be among node_id values")
		return
	}
	provider, ok := h.ctrl.(interface {
		CloudMediaDuplicateOrganizePlan(context.Context, uint64, []uint64) (client.MediaDuplicateOrganizePlan, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "media_duplicate_organize_unavailable",
			"update Agent to review duplicate organization")
		return
	}
	plan, err := provider.CloudMediaDuplicateOrganizePlan(r.Context(), keeperID, nodeIDs)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, plan)
}

// Do not silently fall back to read-only plan on legacy Agents.
func (h *desktopIPCHandler) mediaDuplicateOrganizeApply(w http.ResponseWriter, r *http.Request) {
	var input client.MediaDuplicateOrganizeApplyInput
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if !input.Confirm || input.KeeperNodeID == 0 ||
		len(input.NodeIDs) < 2 || len(input.NodeIDs) > 32 ||
		len(input.ExpectedPlanRevision) != 64 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_organize_apply",
			"explicit keeper, 2–32 distinct Node IDs, plan revision and confirmation required")
		return
	}
	if _, err := hex.DecodeString(input.ExpectedPlanRevision); err != nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_organize_apply",
			"plan revision must be a SHA-256 hex digest")
		return
	}
	if input.SelectedDescription != nil && len([]rune(*input.SelectedDescription)) > 4096 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_organize_apply",
			"selected description is too long")
		return
	}
	seen := make(map[uint64]struct{}, len(input.NodeIDs))
	for _, id := range input.NodeIDs {
		if id == 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_organize_apply",
				"node IDs must be positive")
			return
		}
		if _, duplicate := seen[id]; duplicate {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_organize_apply",
				"node IDs must be distinct")
			return
		}
		seen[id] = struct{}{}
	}
	if _, found := seen[input.KeeperNodeID]; !found {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_organize_apply",
			"keeper must be one of the selected Nodes")
		return
	}
	provider, ok := h.ctrl.(interface {
		CloudMediaDuplicateOrganizeApply(context.Context, client.MediaDuplicateOrganizeApplyInput) (client.MediaDuplicateOrganizeApplyResult, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "media_duplicate_organize_apply_unavailable",
			"update Agent to confirm duplicate annotation organization")
		return
	}
	result, err := provider.CloudMediaDuplicateOrganizeApply(r.Context(), input)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) mediaIndexStatus(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(interface {
		CloudMediaIndexStatus(context.Context) (client.MediaGalleryIndexStatus, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "media_index_status_unavailable", "this Agent does not support Gallery index coverage")
		return
	}
	status, err := provider.CloudMediaIndexStatus(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, status)
}

func desktopIPCSelectionToken(w http.ResponseWriter, r *http.Request) (string, bool) {
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if _, err := uuid.Parse(token); err != nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_selection", "a valid selection token is required")
		return "", false
	}
	return token, true
}

func (h *desktopIPCHandler) mediaCreateSelectionSnapshot(w http.ResponseWriter, r *http.Request) {
	query, ok := desktopIPCMediaQuery(w, r)
	if !ok {
		return
	}
	if query.FoldDuplicates || len(query.FoldMemberIDs) > 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_selection", "turn off duplicate folding before query selection")
		return
	}
	albumID := strings.TrimSpace(r.URL.Query().Get("album_id"))
	if albumID != "" && !desktopIPCValidMediaAlbumID(albumID, false) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_album_id", "album_id must be a Gallery album id")
		return
	}
	day := strings.TrimSpace(r.URL.Query().Get("day"))
	if day != "" {
		parsed, err := time.Parse("2006-01-02", day)
		if err != nil || parsed.Format("2006-01-02") != day {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_selection_day", "day must be YYYY-MM-DD")
			return
		}
	}
	provider, ok := h.ctrl.(interface {
		CloudMediaCreateSelectionSnapshot(context.Context, client.MediaQuery, string, string) (client.MediaSelectionSnapshot, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "media_selection_unavailable", "update Desktop Agent for Gallery query selection")
		return
	}
	value, err := provider.CloudMediaCreateSelectionSnapshot(r.Context(), query, albumID, day)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusCreated, value)
}

func (h *desktopIPCHandler) mediaGetSelectionSnapshot(w http.ResponseWriter, r *http.Request) {
	token, ok := desktopIPCSelectionToken(w, r)
	if !ok {
		return
	}
	offset, limit := 0, 100
	if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_selection_page", "offset must be nonnegative")
			return
		}
		offset = value
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 200 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_selection_page", "limit must be 1..200")
			return
		}
		limit = value
	}
	provider, ok := h.ctrl.(interface {
		CloudMediaGetSelectionSnapshot(context.Context, string, int, int) (client.MediaSelectionSnapshotPage, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "media_selection_unavailable", "update Desktop Agent for Gallery query selection")
		return
	}
	page, err := provider.CloudMediaGetSelectionSnapshot(r.Context(), token, offset, limit)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, page)
}

func (h *desktopIPCHandler) mediaSetSelectionExcluded(w http.ResponseWriter, r *http.Request) {
	token, ok := desktopIPCSelectionToken(w, r)
	if !ok {
		return
	}
	var input struct {
		NodeID   uint64 `json:"node_id"`
		Excluded *bool  `json:"excluded"`
		Version  uint64 `json:"version"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.NodeID == 0 || input.Excluded == nil || input.Version == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_selection_exclusion", "node_id, excluded and version are required")
		return
	}
	provider, ok := h.ctrl.(interface {
		CloudMediaSetSelectionExcluded(context.Context, string, uint64, bool, uint64) (client.MediaSelectionSnapshot, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "media_selection_unavailable", "update Desktop Agent for Gallery query selection")
		return
	}
	value, err := provider.CloudMediaSetSelectionExcluded(r.Context(), token, input.NodeID, *input.Excluded, input.Version)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, value)
}

func (h *desktopIPCHandler) mediaDeleteSelectionSnapshot(w http.ResponseWriter, r *http.Request) {
	token, ok := desktopIPCSelectionToken(w, r)
	if !ok {
		return
	}
	provider, ok := h.ctrl.(interface {
		CloudMediaDeleteSelectionSnapshot(context.Context, string) error
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "media_selection_unavailable", "update Desktop Agent for Gallery query selection")
		return
	}
	if err := provider.CloudMediaDeleteSelectionSnapshot(r.Context(), token); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func desktopIPCMediaSelectionJobID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if _, err := uuid.Parse(id); err != nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_selection_job", "valid media job id is required")
		return "", false
	}
	return id, true
}

func (h *desktopIPCHandler) mediaSubmitSelectionFavoriteJob(w http.ResponseWriter, r *http.Request) {
	token, ok := desktopIPCSelectionToken(w, r)
	if !ok {
		return
	}
	var input struct {
		Version  uint64 `json:"version"`
		Favorite *bool  `json:"favorite"`
		Confirm  bool   `json:"confirm"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.Version == 0 || input.Favorite == nil || !input.Confirm {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_selection_job", "confirmation, version and favorite are required")
		return
	}
	provider, ok := h.ctrl.(interface {
		CloudMediaSubmitSelectionFavoriteJob(context.Context, string, uint64, bool) (client.MediaSelectionJob, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "media_selection_jobs_unavailable", "update Agent to run Gallery selection jobs")
		return
	}
	value, err := provider.CloudMediaSubmitSelectionFavoriteJob(r.Context(), token, input.Version, *input.Favorite)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusAccepted, value)
}

func (h *desktopIPCHandler) mediaListSelectionJobs(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(interface {
		CloudMediaListSelectionJobs(context.Context) ([]client.MediaSelectionJob, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "media_selection_jobs_unavailable", "update Agent to list Gallery selection jobs")
		return
	}
	jobs, err := provider.CloudMediaListSelectionJobs(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, jobs)
}

func (h *desktopIPCHandler) mediaGetSelectionJob(w http.ResponseWriter, r *http.Request) {
	id, ok := desktopIPCMediaSelectionJobID(w, r)
	if !ok {
		return
	}
	provider, ok := h.ctrl.(interface {
		CloudMediaGetSelectionJob(context.Context, string) (client.MediaSelectionJob, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "media_selection_jobs_unavailable", "update Agent to read Gallery selection jobs")
		return
	}
	job, err := provider.CloudMediaGetSelectionJob(r.Context(), id)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, job)
}

func (h *desktopIPCHandler) mediaCancelSelectionJob(w http.ResponseWriter, r *http.Request) {
	id, ok := desktopIPCMediaSelectionJobID(w, r)
	if !ok {
		return
	}
	provider, ok := h.ctrl.(interface {
		CloudMediaCancelSelectionJob(context.Context, string) error
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "media_selection_jobs_unavailable", "update Agent to cancel Gallery selection jobs")
		return
	}
	if err := provider.CloudMediaCancelSelectionJob(r.Context(), id); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (h *desktopIPCHandler) mediaRetrySelectionJob(w http.ResponseWriter, r *http.Request) {
	id, ok := desktopIPCMediaSelectionJobID(w, r)
	if !ok {
		return
	}
	provider, ok := h.ctrl.(interface {
		CloudMediaRetrySelectionJob(context.Context, string) (client.MediaSelectionJob, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "media_selection_jobs_unavailable", "update Agent to retry Gallery selection jobs")
		return
	}
	job, err := provider.CloudMediaRetrySelectionJob(r.Context(), id)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusAccepted, job)
}

func (h *desktopIPCHandler) mediaSelectionJobFailures(w http.ResponseWriter, r *http.Request) {
	id, ok := desktopIPCMediaSelectionJobID(w, r)
	if !ok {
		return
	}
	offset, limit := 0, 100
	if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_selection_job_page", "offset must be nonnegative")
			return
		}
		offset = value
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 200 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_selection_job_page", "limit must be 1..200")
			return
		}
		limit = value
	}
	provider, ok := h.ctrl.(interface {
		CloudMediaSelectionJobFailures(context.Context, string, int, int) (client.MediaSelectionJobFailurePage, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "media_selection_jobs_unavailable", "update Agent to inspect Gallery selection job failures")
		return
	}
	page, err := provider.CloudMediaSelectionJobFailures(r.Context(), id, offset, limit)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, page)
}

func (h *desktopIPCHandler) mediaSyncFolders(w http.ResponseWriter, r *http.Request) {
	items, err := h.ctrl.CloudMediaSyncFolders(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) mediaSyncFolder(w http.ResponseWriter, r *http.Request) {
	sourceID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("source_id")), 10, 64)
	if err != nil || sourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_source", "source_id must be a positive integer")
		return
	}
	folderID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("folder_id")), 10, 64)
	if err != nil || folderID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_folder", "folder_id must be a positive integer")
		return
	}
	view, err := h.ctrl.CloudMediaSyncFolder(r.Context(), sourceID, folderID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, view)
}

func (h *desktopIPCHandler) mediaTrash(w http.ResponseWriter, r *http.Request) {
	limit, offset, ok := desktopIPCMediaWindow(w, r)
	if !ok {
		return
	}
	page, err := h.ctrl.CloudMediaTrash(r.Context(), limit, offset)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, page)
}

func (h *desktopIPCHandler) mediaAlbums(w http.ResponseWriter, r *http.Request) {
	items, err := h.ctrl.CloudMediaAlbums(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

// Album-folder operations are optional on the generic desktopIPCController
// interface so existing test agents retain their previous capability contract.
type desktopIPCMediaAlbumFolderController interface {
	CloudMediaAlbumFolders(context.Context) ([]client.MediaAlbumFolder, error)
	CloudCreateMediaAlbumFolder(context.Context, string, uint64) (client.MediaAlbumFolder, error)
	CloudUpdateMediaAlbumFolder(context.Context, uint64, uint64, *string, *uint64) (client.MediaAlbumFolder, error)
	CloudDeleteMediaAlbumFolder(context.Context, uint64, uint64) error
	CloudMoveMediaAlbumToFolder(context.Context, string, uint64, uint64) (client.MediaAlbum, error)
}

func (h *desktopIPCHandler) mediaAlbumFolderController(w http.ResponseWriter) (desktopIPCMediaAlbumFolderController, bool) {
	controller, ok := h.ctrl.(desktopIPCMediaAlbumFolderController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "media_album_folders_unavailable", "upgrade Agent to manage album folders")
	}
	return controller, ok
}

func desktopIPCValidAlbumFolderID(value uint64, allowRoot bool) bool {
	return value <= (1<<53)-1 && (allowRoot || value > 0)
}

func (h *desktopIPCHandler) mediaAlbumFolders(w http.ResponseWriter, r *http.Request) {
	controller, ok := h.mediaAlbumFolderController(w)
	if !ok {
		return
	}
	folders, err := controller.CloudMediaAlbumFolders(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, folders)
}

func (h *desktopIPCHandler) createMediaAlbumFolder(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name     string `json:"name"`
		ParentID uint64 `json:"parent_id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Name) == "" || !desktopIPCValidAlbumFolderID(input.ParentID, true) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_album_folder", "name and safe parent_id are required")
		return
	}
	controller, ok := h.mediaAlbumFolderController(w)
	if !ok {
		return
	}
	folder, err := controller.CloudCreateMediaAlbumFolder(r.Context(), input.Name, input.ParentID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusCreated, folder)
}

func (h *desktopIPCHandler) updateMediaAlbumFolder(w http.ResponseWriter, r *http.Request) {
	var input struct {
		FolderID uint64  `json:"folder_id"`
		Revision uint64  `json:"revision"`
		Name     *string `json:"name"`
		ParentID *uint64 `json:"parent_id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if !desktopIPCValidAlbumFolderID(input.FolderID, false) || input.Revision == 0 ||
		(input.Name == nil && input.ParentID == nil) ||
		(input.ParentID != nil && !desktopIPCValidAlbumFolderID(*input.ParentID, true)) ||
		(input.Name != nil && strings.TrimSpace(*input.Name) == "") {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_album_folder", "folder id, revision and valid changes are required")
		return
	}
	controller, ok := h.mediaAlbumFolderController(w)
	if !ok {
		return
	}
	folder, err := controller.CloudUpdateMediaAlbumFolder(r.Context(), input.FolderID, input.Revision, input.Name, input.ParentID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, folder)
}

func (h *desktopIPCHandler) deleteMediaAlbumFolder(w http.ResponseWriter, r *http.Request) {
	var input struct {
		FolderID uint64 `json:"folder_id"`
		Revision uint64 `json:"revision"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if !desktopIPCValidAlbumFolderID(input.FolderID, false) || input.Revision == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_album_folder", "folder id and revision are required")
		return
	}
	controller, ok := h.mediaAlbumFolderController(w)
	if !ok {
		return
	}
	if err := controller.CloudDeleteMediaAlbumFolder(r.Context(), input.FolderID, input.Revision); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *desktopIPCHandler) moveMediaAlbumToFolder(w http.ResponseWriter, r *http.Request) {
	var input struct {
		AlbumID  string  `json:"album_id"`
		Revision uint64  `json:"revision"`
		FolderID *uint64 `json:"folder_id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if !(strings.HasPrefix(input.AlbumID, "manual:") || strings.HasPrefix(input.AlbumID, "smart:")) ||
		input.Revision == 0 || input.FolderID == nil ||
		!desktopIPCValidAlbumFolderID(*input.FolderID, true) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_album_folder", "local album, revision and safe folder_id are required")
		return
	}
	controller, ok := h.mediaAlbumFolderController(w)
	if !ok {
		return
	}
	album, err := controller.CloudMoveMediaAlbumToFolder(r.Context(), input.AlbumID, input.Revision, *input.FolderID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, album)
}

type desktopIPCBaiduMapController interface {
	CloudBaiduMapProvider(context.Context) (client.BaiduMapProvider, error)
	CloudBaiduStaticMap(context.Context, float64, float64, int, int, int) (agentMediaThumbnail, error)
}

func (h *desktopIPCHandler) mediaBaiduMapProvider(w http.ResponseWriter, r *http.Request) {
	controller, ok := h.ctrl.(desktopIPCBaiduMapController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "map_unavailable", "map service is not supported")
		return
	}
	provider, err := controller.CloudBaiduMapProvider(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, provider)
}

func (h *desktopIPCHandler) mediaBaiduStaticMap(w http.ResponseWriter, r *http.Request) {
	controller, ok := h.ctrl.(desktopIPCBaiduMapController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "map_unavailable", "map service is not supported")
		return
	}
	q := r.URL.Query()
	latitude, errLat := strconv.ParseFloat(q.Get("lat"), 64)
	longitude, errLng := strconv.ParseFloat(q.Get("lng"), 64)
	zoom, errZoom := strconv.Atoi(q.Get("zoom"))
	width, errWidth := strconv.Atoi(q.Get("width"))
	height, errHeight := strconv.Atoi(q.Get("height"))
	if errLat != nil || errLng != nil || errZoom != nil || errWidth != nil ||
		errHeight != nil || math.IsNaN(latitude) || math.IsInf(latitude, 0) ||
		math.IsNaN(longitude) || math.IsInf(longitude, 0) ||
		latitude < -85 || latitude > 85 || longitude < -180 || longitude > 180 ||
		zoom < 3 || zoom > 18 || width < 128 || width > 512 ||
		height < 128 || height > 512 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_map_parameters", "invalid map parameters")
		return
	}
	result, err := controller.CloudBaiduStaticMap(r.Context(), latitude, longitude, zoom, width, height)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", strconv.Itoa(len(result.Data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(result.Data)
}

func (h *desktopIPCHandler) mediaPlaces(w http.ResponseWriter, r *http.Request) {
	limit := 24
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 1000 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_place_limit", "limit must be between 1 and 1000")
			return
		}
		limit = value
	}
	items, err := h.ctrl.CloudMediaPlaces(r.Context(), limit)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) mediaMemories(w http.ResponseWriter, r *http.Request) {
	zone, ok := desktopIPCMediaTimeZone(w, r)
	if !ok {
		return
	}
	limit := 24
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 100 {
			writeDesktopIPCError(
				w,
				http.StatusBadRequest,
				"invalid_media_memory_limit",
				"limit must be between 1 and 100",
			)
			return
		}
		limit = value
	}
	anchorDate := strings.TrimSpace(r.URL.Query().Get("anchor_date"))
	if anchorDate != "" {
		if _, err := time.Parse("2006-01-02", anchorDate); err != nil {
			writeDesktopIPCError(
				w,
				http.StatusBadRequest,
				"invalid_media_memory_anchor_date",
				"anchor_date must use YYYY-MM-DD",
			)
			return
		}
	}
	var items []client.MediaMemory
	var err error
	if zone == "UTC" {
		items, err = h.ctrl.CloudMediaMemories(r.Context(), anchorDate, limit)
	} else if zoned, supported := h.ctrl.(interface {
		CloudMediaMemoriesInZone(context.Context, string, int, string) ([]client.MediaMemory, error)
	}); supported {
		items, err = zoned.CloudMediaMemoriesInZone(r.Context(), anchorDate, limit, zone)
	} else {
		writeDesktopIPCError(w, http.StatusNotImplemented, "media_timezone_unavailable", "upgrade Agent to use a custom media time zone")
		return
	}
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) mediaMemoryItems(w http.ResponseWriter, r *http.Request) {
	zone, ok := desktopIPCMediaTimeZone(w, r)
	if !ok {
		return
	}
	memoryID := strings.TrimSpace(r.URL.Query().Get("memory_id"))
	if memoryID == "" || len(memoryID) > 128 {
		writeDesktopIPCError(
			w,
			http.StatusBadRequest,
			"invalid_media_memory",
			"valid memory_id is required",
		)
		return
	}
	limit, offset, ok := desktopIPCMediaWindow(w, r)
	if !ok {
		return
	}
	var page client.MediaItemRange
	var err error
	if zone == "UTC" {
		page, err = h.ctrl.CloudMediaMemoryItemsRange(r.Context(), memoryID, limit, offset)
	} else if zoned, supported := h.ctrl.(interface {
		CloudMediaMemoryItemsRangeInZone(context.Context, string, int, int, string) (client.MediaItemRange, error)
	}); supported {
		page, err = zoned.CloudMediaMemoryItemsRangeInZone(r.Context(), memoryID, limit, offset, zone)
	} else {
		writeDesktopIPCError(w, http.StatusNotImplemented, "media_timezone_unavailable", "upgrade Agent to use a custom media time zone")
		return
	}
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, page)
}

func desktopIPCMediaCleanupLimit(w http.ResponseWriter, r *http.Request) (int, bool) {
	limit := 24
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 100 {
			writeDesktopIPCError(
				w,
				http.StatusBadRequest,
				"invalid_media_cleanup_limit",
				"limit must be between 1 and 100",
			)
			return 0, false
		}
		limit = value
	}
	return limit, true
}

func desktopIPCMediaCleanupOffset(w http.ResponseWriter, r *http.Request) (int, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get("offset"))
	if raw == "" {
		return 0, true
	}
	offset, err := strconv.Atoi(raw)
	if err != nil || offset < 0 || offset > 10000000 {
		writeDesktopIPCError(
			w, http.StatusBadRequest, "invalid_media_cleanup_offset",
			"offset must be between 0 and 10000000",
		)
		return 0, false
	}
	return offset, true
}

func (h *desktopIPCHandler) mediaDuplicateGroups(w http.ResponseWriter, r *http.Request) {
	limit, ok := desktopIPCMediaCleanupLimit(w, r)
	if !ok {
		return
	}
	offset, ok := desktopIPCMediaCleanupOffset(w, r)
	if !ok {
		return
	}
	var result client.MediaDuplicateGroupList
	var err error
	if offset == 0 {
		result, err = h.ctrl.CloudMediaDuplicateGroups(r.Context(), limit)
	} else if pager, supported := h.ctrl.(interface {
		CloudMediaDuplicateGroupsPage(context.Context, int, int) (client.MediaDuplicateGroupList, error)
	}); supported {
		result, err = pager.CloudMediaDuplicateGroupsPage(r.Context(), limit, offset)
	} else {
		writeDesktopIPCError(w, http.StatusNotImplemented, "media_cleanup_paging_unavailable",
			"upgrade Agent to review additional duplicate groups")
		return
	}
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) mediaDuplicateItems(w http.ResponseWriter, r *http.Request) {
	duplicateID := strings.TrimSpace(r.URL.Query().Get("duplicate_id"))
	if duplicateID == "" || len(duplicateID) > 96 {
		writeDesktopIPCError(
			w,
			http.StatusBadRequest,
			"invalid_media_duplicate",
			"valid duplicate_id is required",
		)
		return
	}
	limit, offset, ok := desktopIPCMediaWindow(w, r)
	if !ok {
		return
	}
	page, err := h.ctrl.CloudMediaDuplicateItemsRange(
		r.Context(),
		duplicateID,
		limit,
		offset,
	)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, page)
}

func (h *desktopIPCHandler) mediaBurstReviews(w http.ResponseWriter, r *http.Request) {
	limit, ok := desktopIPCMediaCleanupLimit(w, r)
	if !ok {
		return
	}
	offset, ok := desktopIPCMediaCleanupOffset(w, r)
	if !ok {
		return
	}
	var result client.MediaBurstReviewList
	var err error
	if offset == 0 {
		result, err = h.ctrl.CloudMediaBurstReviews(r.Context(), limit)
	} else if pager, supported := h.ctrl.(interface {
		CloudMediaBurstReviewsPage(context.Context, int, int) (client.MediaBurstReviewList, error)
	}); supported {
		result, err = pager.CloudMediaBurstReviewsPage(r.Context(), limit, offset)
	} else {
		writeDesktopIPCError(w, http.StatusNotImplemented, "media_cleanup_paging_unavailable",
			"upgrade Agent to review additional burst groups")
		return
	}
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) mediaBurstReviewItems(w http.ResponseWriter, r *http.Request) {
	burstID := strings.TrimSpace(r.URL.Query().Get("burst_id"))
	if burstID == "" || len(burstID) > 64 {
		writeDesktopIPCError(
			w,
			http.StatusBadRequest,
			"invalid_media_burst",
			"valid burst_id is required",
		)
		return
	}
	limit, offset, ok := desktopIPCMediaWindow(w, r)
	if !ok {
		return
	}
	page, err := h.ctrl.CloudMediaBurstReviewItemsRange(
		r.Context(),
		burstID,
		limit,
		offset,
	)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, page)
}

func (h *desktopIPCHandler) mediaPets(w http.ResponseWriter, r *http.Request) {
	items, err := h.ctrl.CloudMediaPets(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) mediaPetItems(w http.ResponseWriter, r *http.Request) {
	petKind := strings.TrimSpace(r.URL.Query().Get("pet_kind"))
	if petKind != "dog" && petKind != "cat" {
		writeDesktopIPCError(
			w,
			http.StatusBadRequest,
			"invalid_media_pet_kind",
			"pet_kind must be dog or cat",
		)
		return
	}
	limit, offset, ok := desktopIPCMediaWindow(w, r)
	if !ok {
		return
	}
	page, err := h.ctrl.CloudMediaPetItemsRange(
		r.Context(),
		petKind,
		limit,
		offset,
	)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, page)
}

func (h *desktopIPCHandler) mediaSuggestedPeople(w http.ResponseWriter, r *http.Request) {
	limit := 24
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 100 {
			writeDesktopIPCError(
				w,
				http.StatusBadRequest,
				"invalid_media_suggested_people_limit",
				"limit must be between 1 and 100",
			)
			return
		}
		limit = value
	}
	includeReviewed := false
	if raw := strings.TrimSpace(r.URL.Query().Get("include_reviewed")); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			writeDesktopIPCError(
				w,
				http.StatusBadRequest,
				"invalid_media_suggestion_review_filter",
				"include_reviewed must be true or false",
			)
			return
		}
		includeReviewed = value
	}
	var items []client.MediaSuggestedPerson
	var err error
	if includeReviewed {
		items, err = h.ctrl.CloudMediaSuggestedPeopleWithReview(
			r.Context(),
			true,
			limit,
		)
	} else {
		items, err = h.ctrl.CloudMediaSuggestedPeople(r.Context(), limit)
	}
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func desktopIPCValidSuggestedPersonID(value string) bool {
	value = strings.TrimSpace(value)
	const prefix = "auto:v1:"
	if !strings.HasPrefix(value, prefix) {
		return false
	}
	raw := strings.TrimPrefix(value, prefix)
	if len(raw) != 64 {
		return false
	}
	_, err := hex.DecodeString(raw)
	return err == nil
}

func (h *desktopIPCHandler) mediaSuggestedPersonItems(
	w http.ResponseWriter,
	r *http.Request,
) {
	personID := strings.TrimSpace(r.URL.Query().Get("person_id"))
	if !desktopIPCValidSuggestedPersonID(personID) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_suggested_person", "valid person_id is required")
		return
	}
	query, ok := desktopIPCMediaQuery(w, r)
	if !ok {
		return
	}
	limit, offset, ok := desktopIPCMediaWindow(w, r)
	if !ok {
		return
	}
	rangeRequested, ok := desktopIPCMediaRangeRequested(w, r)
	if !ok {
		return
	}
	if rangeRequested {
		page, err := h.ctrl.CloudMediaSuggestedPersonItemsRange(r.Context(), personID, query, limit, offset)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, page)
		return
	}
	items, err := h.ctrl.CloudMediaSuggestedPersonItems(r.Context(), personID, query, limit, offset)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}
func desktopIPCValidPersonIdentityID(value string) bool {
	value = strings.TrimSpace(value)
	const prefix = "person:v1:"
	if !strings.HasPrefix(value, prefix) {
		return false
	}
	_, err := uuid.Parse(strings.TrimPrefix(value, prefix))
	return err == nil
}

func (h *desktopIPCHandler) mediaPersonIdentities(w http.ResponseWriter, r *http.Request) {
	includeHidden := false
	if raw := strings.TrimSpace(r.URL.Query().Get("include_hidden")); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_people_hidden", "include_hidden must be true or false")
			return
		}
		includeHidden = value
	}
	limit, offset, ok := desktopIPCMediaWindow(w, r)
	if !ok {
		return
	}
	if limit > 100 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_people_limit", "limit must be between 1 and 100")
		return
	}
	items, err := h.ctrl.CloudMediaPeople(r.Context(), includeHidden, limit, offset)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) mediaPersonItems(w http.ResponseWriter, r *http.Request) {
	personID := strings.TrimSpace(r.URL.Query().Get("person_id"))
	if !desktopIPCValidPersonIdentityID(personID) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_person", "valid person_id is required")
		return
	}
	query, ok := desktopIPCMediaQuery(w, r)
	if !ok {
		return
	}
	limit, offset, ok := desktopIPCMediaWindow(w, r)
	if !ok {
		return
	}
	rangeRequested, ok := desktopIPCMediaRangeRequested(w, r)
	if !ok {
		return
	}
	if rangeRequested {
		page, err := h.ctrl.CloudMediaPersonItemsRange(r.Context(), personID, query, limit, offset)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, page)
		return
	}
	items, err := h.ctrl.CloudMediaPersonItems(r.Context(), personID, query, limit, offset)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) reviewMediaSuggestedPerson(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SuggestionID string `json:"suggestion_id"`
		State        string `json:"state"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if !desktopIPCValidSuggestedPersonID(input.SuggestionID) {
		writeDesktopIPCError(
			w,
			http.StatusBadRequest,
			"invalid_media_suggested_person",
			"valid suggestion_id is required",
		)
		return
	}
	if input.State != "pending" && input.State != "dismissed" {
		writeDesktopIPCError(
			w,
			http.StatusBadRequest,
			"invalid_media_suggestion_review_state",
			"state must be pending or dismissed",
		)
		return
	}
	review, err := h.ctrl.CloudReviewMediaSuggestedPerson(
		r.Context(),
		input.SuggestionID,
		input.State,
	)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, review)
}

func (h *desktopIPCHandler) addMediaSuggestedPersonToIdentity(
	w http.ResponseWriter,
	r *http.Request,
) {
	var input struct {
		PersonID     string `json:"person_id"`
		Revision     uint64 `json:"revision"`
		SuggestionID string `json:"suggestion_id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if !desktopIPCValidPersonIdentityID(input.PersonID) ||
		!desktopIPCValidSuggestedPersonID(input.SuggestionID) ||
		input.Revision == 0 {
		writeDesktopIPCError(
			w,
			http.StatusBadRequest,
			"invalid_media_person_suggestion",
			"valid person_id, suggestion_id, and revision are required",
		)
		return
	}
	person, err := h.ctrl.CloudAddMediaSuggestedPersonToIdentity(
		r.Context(),
		input.PersonID,
		input.Revision,
		input.SuggestionID,
	)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, person)
}

func (h *desktopIPCHandler) adoptMediaSuggestedPerson(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SuggestionID string `json:"suggestion_id"`
		Name         string `json:"name"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if !desktopIPCValidSuggestedPersonID(input.SuggestionID) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_suggested_person", "valid suggestion_id is required")
		return
	}
	person, err := h.ctrl.CloudAdoptMediaSuggestedPerson(r.Context(), input.SuggestionID, input.Name)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusCreated, person)
}

func (h *desktopIPCHandler) updateMediaPerson(w http.ResponseWriter, r *http.Request) {
	var input struct {
		PersonID    string  `json:"person_id"`
		Revision    uint64  `json:"revision"`
		Name        *string `json:"name,omitempty"`
		Hidden      *bool   `json:"hidden,omitempty"`
		CoverNodeID *uint64 `json:"cover_node_id,omitempty"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if !desktopIPCValidPersonIdentityID(input.PersonID) ||
		input.Revision == 0 ||
		(input.Name == nil && input.Hidden == nil && input.CoverNodeID == nil) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_person", "person_id, revision, and update fields are required")
		return
	}
	person, err := h.ctrl.CloudUpdateMediaPerson(
		r.Context(),
		input.PersonID,
		input.Revision,
		client.UpdateMediaPersonIdentityInput{
			Name: input.Name, Hidden: input.Hidden, CoverNodeID: input.CoverNodeID,
		},
	)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, person)
}

func (h *desktopIPCHandler) mergeMediaPeople(w http.ResponseWriter, r *http.Request) {
	var input struct {
		TargetID  string   `json:"target_id"`
		Revision  uint64   `json:"revision"`
		SourceIDs []string `json:"source_ids"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if !desktopIPCValidPersonIdentityID(input.TargetID) ||
		input.Revision == 0 || len(input.SourceIDs) == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_person_merge", "target_id, revision, and source_ids are required")
		return
	}
	for _, sourceID := range input.SourceIDs {
		if !desktopIPCValidPersonIdentityID(sourceID) || sourceID == input.TargetID {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_person_merge", "source_ids contains an invalid person")
			return
		}
	}
	person, err := h.ctrl.CloudMergeMediaPeople(
		r.Context(),
		input.TargetID,
		input.Revision,
		input.SourceIDs,
	)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, person)
}

func (h *desktopIPCHandler) splitMediaPerson(w http.ResponseWriter, r *http.Request) {
	var input struct {
		PersonID string   `json:"person_id"`
		Revision uint64   `json:"revision"`
		NodeIDs  []uint64 `json:"node_ids"`
		Name     string   `json:"name"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if !desktopIPCValidPersonIdentityID(input.PersonID) ||
		input.Revision == 0 || len(input.NodeIDs) == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_person_split", "person_id, revision, and node_ids are required")
		return
	}
	result, err := h.ctrl.CloudSplitMediaPerson(
		r.Context(),
		input.PersonID,
		input.Revision,
		input.NodeIDs,
		input.Name,
	)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func desktopIPCValidMediaAlbumID(value string, manualOnly bool) bool {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, "manual:") && len(value) > len("manual:") {
		return true
	}
	if manualOnly {
		return false
	}
	return (strings.HasPrefix(value, "folder:") && len(value) > len("folder:")) ||
		(strings.HasPrefix(value, "source:") && len(value) > len("source:")) ||
		(strings.HasPrefix(value, "smart:") && len(value) > len("smart:"))
}

func (h *desktopIPCHandler) createMediaAlbum(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name string `json:"name"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Name) == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_album_name", "name is required")
		return
	}
	album, err := h.ctrl.CloudCreateMediaAlbum(r.Context(), input.Name)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusCreated, album)
}

func (h *desktopIPCHandler) renameMediaAlbum(w http.ResponseWriter, r *http.Request) {
	var input struct {
		AlbumID  string `json:"album_id"`
		Revision uint64 `json:"revision"`
		Name     string `json:"name"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if !desktopIPCValidMediaAlbumID(input.AlbumID, true) ||
		input.Revision == 0 || strings.TrimSpace(input.Name) == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_album", "manual album id, revision, and name are required")
		return
	}
	album, err := h.ctrl.CloudRenameMediaAlbum(
		r.Context(), input.AlbumID, input.Revision, input.Name,
	)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, album)
}

func (h *desktopIPCHandler) setMediaAlbumCover(w http.ResponseWriter, r *http.Request) {
	var input struct {
		AlbumID  string  `json:"album_id"`
		Revision uint64  `json:"revision"`
		NodeID   *uint64 `json:"node_id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if !desktopIPCValidMediaAlbumID(input.AlbumID, true) || input.Revision == 0 || input.NodeID == nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_album_cover", "manual album id, revision, and node_id (0 for automatic) are required")
		return
	}
	controller, ok := h.ctrl.(interface {
		CloudSetMediaAlbumCover(context.Context, string, uint64, uint64) (client.MediaAlbum, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "media_album_cover_unavailable", "upgrade Agent to set custom album covers")
		return
	}
	album, err := controller.CloudSetMediaAlbumCover(r.Context(), input.AlbumID, input.Revision, *input.NodeID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, album)
}

func (h *desktopIPCHandler) deleteMediaAlbum(w http.ResponseWriter, r *http.Request) {
	var input struct {
		AlbumID  string `json:"album_id"`
		Revision uint64 `json:"revision"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if !desktopIPCValidMediaAlbumID(input.AlbumID, true) || input.Revision == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_album", "manual album id and revision are required")
		return
	}
	if err := h.ctrl.CloudDeleteMediaAlbum(r.Context(), input.AlbumID, input.Revision); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *desktopIPCHandler) createSmartMediaAlbum(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name  string                      `json:"name"`
		Query client.MediaSmartAlbumQuery `json:"query"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Name) == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_smart_media_album", "name is required")
		return
	}
	album, err := h.ctrl.CloudCreateSmartMediaAlbum(
		r.Context(),
		input.Name,
		input.Query,
	)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusCreated, album)
}

func (h *desktopIPCHandler) updateSmartMediaAlbum(w http.ResponseWriter, r *http.Request) {
	var input struct {
		AlbumID  string                       `json:"album_id"`
		Revision uint64                       `json:"revision"`
		Name     *string                      `json:"name,omitempty"`
		Query    *client.MediaSmartAlbumQuery `json:"query,omitempty"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if !strings.HasPrefix(strings.TrimSpace(input.AlbumID), "smart:") ||
		len(strings.TrimSpace(input.AlbumID)) <= len("smart:") ||
		input.Revision == 0 ||
		(input.Name == nil && input.Query == nil) {
		writeDesktopIPCError(
			w,
			http.StatusBadRequest,
			"invalid_smart_media_album",
			"smart album id, revision, and name or query are required",
		)
		return
	}
	if input.Name != nil && strings.TrimSpace(*input.Name) == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_smart_media_album", "name cannot be empty")
		return
	}
	album, err := h.ctrl.CloudUpdateSmartMediaAlbum(
		r.Context(),
		input.AlbumID,
		input.Revision,
		input.Name,
		input.Query,
	)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, album)
}

func (h *desktopIPCHandler) deleteSmartMediaAlbum(w http.ResponseWriter, r *http.Request) {
	var input struct {
		AlbumID  string `json:"album_id"`
		Revision uint64 `json:"revision"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if !strings.HasPrefix(strings.TrimSpace(input.AlbumID), "smart:") ||
		len(strings.TrimSpace(input.AlbumID)) <= len("smart:") ||
		input.Revision == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_smart_media_album", "smart album id and revision are required")
		return
	}
	if err := h.ctrl.CloudDeleteSmartMediaAlbum(r.Context(), input.AlbumID, input.Revision); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *desktopIPCHandler) addMediaAlbumItems(w http.ResponseWriter, r *http.Request) {
	var input struct {
		AlbumID  string   `json:"album_id"`
		Revision uint64   `json:"revision"`
		NodeIDs  []uint64 `json:"node_ids"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if !desktopIPCValidMediaAlbumID(input.AlbumID, true) ||
		input.Revision == 0 || len(input.NodeIDs) == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_album_items", "manual album id, revision, and node_ids are required")
		return
	}
	album, err := h.ctrl.CloudAddMediaAlbumItems(
		r.Context(), input.AlbumID, input.Revision, input.NodeIDs,
	)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, album)
}

func (h *desktopIPCHandler) removeMediaAlbumItem(w http.ResponseWriter, r *http.Request) {
	var input struct {
		AlbumID  string `json:"album_id"`
		Revision uint64 `json:"revision"`
		NodeID   uint64 `json:"node_id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if !desktopIPCValidMediaAlbumID(input.AlbumID, true) ||
		input.Revision == 0 || input.NodeID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_album_item", "manual album id, revision, and node_id are required")
		return
	}
	album, err := h.ctrl.CloudRemoveMediaAlbumItem(
		r.Context(), input.AlbumID, input.Revision, input.NodeID,
	)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, album)
}

func (h *desktopIPCHandler) mediaAlbumItems(w http.ResponseWriter, r *http.Request) {
	albumID := strings.TrimSpace(r.URL.Query().Get("album_id"))
	if !desktopIPCValidMediaAlbumID(albumID, false) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_album_id", "album_id must be a Gallery album id")
		return
	}
	query, ok := desktopIPCMediaQuery(w, r)
	if !ok {
		return
	}
	limit, offset, ok := desktopIPCMediaWindow(w, r)
	if !ok {
		return
	}
	rangeRequested, ok := desktopIPCMediaRangeRequested(w, r)
	if !ok {
		return
	}
	if rangeRequested {
		page, err := h.ctrl.CloudMediaAlbumItemsRange(r.Context(), albumID, query, limit, offset)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, page)
		return
	}
	items, err := h.ctrl.CloudMediaAlbumItems(r.Context(), albumID, query, limit, offset)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) mediaFavorite(w http.ResponseWriter, r *http.Request) {
	var input struct {
		NodeID   uint64 `json:"node_id"`
		Favorite *bool  `json:"favorite"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.NodeID == 0 || input.Favorite == nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_favorite", "node_id and favorite are required")
		return
	}
	result, err := h.ctrl.CloudSetMediaFavorite(r.Context(), input.NodeID, *input.Favorite)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) mediaFavoriteBatch(w http.ResponseWriter, r *http.Request) {
	var input struct {
		NodeIDs  []uint64 `json:"node_ids"`
		Favorite *bool    `json:"favorite"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if len(input.NodeIDs) == 0 || len(input.NodeIDs) > 1000 || input.Favorite == nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_favorites", "node_ids and favorite are required")
		return
	}
	result, err := h.ctrl.CloudSetMediaFavoriteBatch(r.Context(), input.NodeIDs, *input.Favorite)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) mediaTagsBatch(w http.ResponseWriter, r *http.Request) {
	var input struct {
		NodeIDs []uint64 `json:"node_ids"`
		Tags    []string `json:"tags"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if len(input.NodeIDs) == 0 || len(input.NodeIDs) > 1000 || len(input.Tags) == 0 || len(input.Tags) > 32 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_tags_batch", "node_ids and up to 32 tags are required")
		return
	}
	result, err := h.ctrl.CloudAddMediaTagsBatch(r.Context(), input.NodeIDs, input.Tags)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) mediaTags(w http.ResponseWriter, r *http.Request) {
	var input struct {
		NodeID uint64   `json:"node_id"`
		Tags   []string `json:"tags"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.NodeID == 0 || input.Tags == nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_tags", "node_id and tags are required")
		return
	}
	result, err := h.ctrl.CloudSetMediaTags(r.Context(), input.NodeID, input.Tags)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) mediaPeople(w http.ResponseWriter, r *http.Request) {
	var input struct {
		NodeID uint64   `json:"node_id"`
		People []string `json:"people"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.NodeID == 0 || input.People == nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_people", "node_id and people are required")
		return
	}
	result, err := h.ctrl.CloudSetMediaPeople(r.Context(), input.NodeID, input.People)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) mediaDescription(w http.ResponseWriter, r *http.Request) {
	var input struct {
		NodeID      uint64  `json:"node_id"`
		Description *string `json:"description"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.NodeID == 0 || input.Description == nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_description", "node_id and description are required")
		return
	}
	result, err := h.ctrl.CloudSetMediaDescription(r.Context(), input.NodeID, *input.Description)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) mediaEditRecipe(w http.ResponseWriter, r *http.Request) {
	nodeID, ok := desktopIPCUint64Query(w, r, "node_id")
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		result, err := h.ctrl.CloudMediaEditRecipe(r.Context(), nodeID)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, result)
	case http.MethodPut:
		var input client.MediaEditRecipeInput
		if !decodeDesktopIPCJSON(w, r, &input) {
			return
		}
		result, err := h.ctrl.CloudSaveMediaEditRecipe(r.Context(), nodeID, input)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, result)
	case http.MethodDelete:
		revision, ok := desktopIPCUint64Query(w, r, "revision")
		if !ok {
			return
		}
		result, err := h.ctrl.CloudResetMediaEditRecipe(
			r.Context(),
			nodeID,
			revision,
		)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, result)
	default:
		writeDesktopIPCError(
			w,
			http.StatusMethodNotAllowed,
			"method_not_allowed",
			"method is not allowed",
		)
	}
}

func desktopIPCCreativeGenerationID(w http.ResponseWriter, r *http.Request) (string, bool) {
	generationID := strings.TrimSpace(r.URL.Query().Get("generation_id"))
	if generationID == "" || len(generationID) > 64 {
		writeDesktopIPCError(
			w,
			http.StatusBadRequest,
			"invalid_media_creative_generation",
			"valid creative generation id is required",
		)
		return "", false
	}
	return generationID, true
}

func (h *desktopIPCHandler) createMediaCreativeGeneration(
	w http.ResponseWriter,
	r *http.Request,
) {
	nodeID, ok := desktopIPCUint64Query(w, r, "node_id")
	if !ok {
		return
	}
	var input client.MediaCreativeInput
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	result, err := h.ctrl.CloudCreateMediaCreativeGeneration(
		r.Context(),
		nodeID,
		input,
	)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusAccepted, result)
}

func (h *desktopIPCHandler) mediaCreativeGeneration(
	w http.ResponseWriter,
	r *http.Request,
) {
	generationID, ok := desktopIPCCreativeGenerationID(w, r)
	if !ok {
		return
	}
	result, err := h.ctrl.CloudMediaCreativeGeneration(
		r.Context(),
		generationID,
	)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) cancelMediaCreativeGeneration(
	w http.ResponseWriter,
	r *http.Request,
) {
	generationID, ok := desktopIPCCreativeGenerationID(w, r)
	if !ok {
		return
	}
	result, err := h.ctrl.CloudCancelMediaCreativeGeneration(
		r.Context(),
		generationID,
	)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

type desktopIPCMediaVideoPosterController interface {
	CloudPutMediaVideoPoster(context.Context, uint64, uint64, []byte) error
}

func (h *desktopIPCHandler) mediaThumbnail(w http.ResponseWriter, r *http.Request) {
	nodeID, ok := desktopIPCUint64Query(w, r, "node_id")
	if !ok {
		return
	}
	revision := uint64(0)
	if raw := strings.TrimSpace(r.URL.Query().Get("revision")); raw != "" {
		parsed, parseErr := strconv.ParseUint(raw, 10, 64)
		if parseErr != nil || parsed == 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_revision", "revision must be a positive integer")
			return
		}
		revision = parsed
	}
	thumbnail, err := h.ctrl.CloudMediaThumbnail(r.Context(), nodeID, revision)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	contentType := strings.TrimSpace(thumbnail.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(thumbnail.Data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(thumbnail.Data)
}

// mediaAnalysisPreview forwards only the bounded JPEG derivative; RAW bytes are never exposed.
func (h *desktopIPCHandler) mediaAnalysisPreview(w http.ResponseWriter, r *http.Request) {
	nodeID, ok := desktopIPCUint64Query(w, r, "node_id")
	if !ok {
		return
	}
	preview, err := h.ctrl.CloudMediaAnalysisPreview(r.Context(), nodeID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	if !strings.EqualFold(strings.TrimSpace(preview.ContentType), "image/jpeg") {
		writeDesktopIPCError(w, http.StatusBadGateway, "invalid_preview", "analysis preview must be JPEG")
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Content-Length", strconv.Itoa(len(preview.Data)))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(preview.Data)
}

func (h *desktopIPCHandler) mediaVideoPoster(w http.ResponseWriter, r *http.Request) {
	nodeID, ok := desktopIPCUint64Query(w, r, "node_id")
	if !ok {
		return
	}
	revision, ok := desktopIPCUint64Query(w, r, "revision")
	if !ok {
		return
	}
	controller, ok := h.ctrl.(desktopIPCMediaVideoPosterController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "unsupported", "video poster cache is not supported")
		return
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.SplitN(r.Header.Get("Content-Type"), ";", 2)[0]))
	if contentType != "image/jpeg" {
		writeDesktopIPCError(w, http.StatusUnsupportedMediaType, "invalid_video_poster", "video poster must be image/jpeg")
		return
	}
	const maxPosterBytes = 4 << 20
	data, err := io.ReadAll(io.LimitReader(r.Body, maxPosterBytes+1))
	if err != nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_video_poster", "unable to read video poster")
		return
	}
	if len(data) == 0 || len(data) > maxPosterBytes {
		writeDesktopIPCError(w, http.StatusRequestEntityTooLarge, "invalid_video_poster", "video poster size is invalid")
		return
	}
	if err := controller.CloudPutMediaVideoPoster(r.Context(), nodeID, revision, data); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *desktopIPCHandler) mediaLivePhotoStillTicket(w http.ResponseWriter, r *http.Request) {
	nodeID, ok := desktopIPCUint64Query(w, r, "node_id")
	if !ok {
		return
	}
	ticket, err := h.ctrl.CloudMediaLivePhotoStillTicket(r.Context(), nodeID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, ticket)
}

func (h *desktopIPCHandler) mediaLivePhotoMotionTicket(w http.ResponseWriter, r *http.Request) {
	nodeID, ok := desktopIPCUint64Query(w, r, "node_id")
	if !ok {
		return
	}
	ticket, err := h.ctrl.CloudMediaLivePhotoMotionTicket(r.Context(), nodeID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, ticket)
}

func desktopIPCMediaTimeZone(w http.ResponseWriter, r *http.Request) (string, bool) {
	zone := strings.TrimSpace(r.URL.Query().Get("time_zone"))
	if zone == "" {
		zone = "UTC"
	}
	valid := len(zone) <= 80 && (zone == "UTC" || strings.Contains(zone, "/"))
	if valid {
		valid = strings.IndexFunc(zone, func(ch rune) bool {
			return !((ch >= 'A' && ch <= 'Z') ||
				(ch >= 'a' && ch <= 'z') ||
				(ch >= '0' && ch <= '9') || ch == '_' || ch == '+' || ch == '-' || ch == '/')
		}) < 0
	}
	if valid {
		_, err := time.LoadLocation(zone)
		valid = err == nil
	}
	if !valid {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_timezone", "time_zone must be a valid IANA time zone")
		return "", false
	}
	return zone, true
}

func desktopIPCMediaQuery(w http.ResponseWriter, r *http.Request) (client.MediaQuery, bool) {
	var out client.MediaQuery
	if raw := strings.TrimSpace(r.URL.Query().Get("fold_duplicates")); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_folding", "fold_duplicates must be true or false")
			return client.MediaQuery{}, false
		}
		out.FoldDuplicates = value
	}
	if values := r.URL.Query()["fold_member_id"]; len(values) > 0 {
		if len(values) > 512 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_folding", "too many fold members")
			return client.MediaQuery{}, false
		}
		seen := make(map[uint64]struct{}, len(values))
		for _, raw := range values {
			id, err := strconv.ParseUint(strings.TrimSpace(raw), 10, 64)
			if err != nil || id == 0 {
				writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_folding", "fold_member_id must be positive")
				return client.MediaQuery{}, false
			}
			if _, ok := seen[id]; !ok {
				seen[id] = struct{}{}
				out.FoldMemberIDs = append(out.FoldMemberIDs, id)
			}
		}
		out.FoldDuplicates = false
	}
	var zoneOK bool
	if out.TimeZone, zoneOK = desktopIPCMediaTimeZone(w, r); !zoneOK {
		return client.MediaQuery{}, false
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("anchor_node_id")); raw != "" {
		id, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || id == 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_anchor", "anchor_node_id must be a positive integer")
			return client.MediaQuery{}, false
		}
		out.AnchorNodeID = id
	}
	out.SortBy = strings.TrimSpace(r.URL.Query().Get("sort_by"))
	if out.SortBy != "" && out.SortBy != "captured" && out.SortBy != "added" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_sort", "sort_by must be captured or added")
		return client.MediaQuery{}, false
	}
	out.SortDir = strings.TrimSpace(r.URL.Query().Get("sort_dir"))
	if out.SortDir != "" && out.SortDir != "asc" && out.SortDir != "desc" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_sort", "sort_dir must be asc or desc")
		return client.MediaQuery{}, false
	}
	out.MediaKind = strings.TrimSpace(r.URL.Query().Get("kind"))
	if out.MediaKind != "" &&
		out.MediaKind != meta.MediaKindImage &&
		out.MediaKind != meta.MediaKindVideo {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_kind", "kind must be image or video")
		return client.MediaQuery{}, false
	}
	out.Search = strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(out.Search)) > 200 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_query", "q must be at most 200 characters")
		return client.MediaQuery{}, false
	}
	out.AssetKind = strings.TrimSpace(r.URL.Query().Get("asset_kind"))
	if out.AssetKind != "" && !meta.ValidPhotoAssetKind(out.AssetKind) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_asset_kind", "asset_kind is invalid")
		return client.MediaQuery{}, false
	}
	out.Category = strings.TrimSpace(r.URL.Query().Get("category"))
	if out.Category != "" && out.Category != "gif" && out.Category != "panorama" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_category", "category is invalid")
		return client.MediaQuery{}, false
	}

	var ok bool
	if out.Cameras, ok = desktopIPCMediaFacetValues(w, r, "camera"); !ok {
		return client.MediaQuery{}, false
	}
	if out.Formats, ok = desktopIPCMediaFacetValues(w, r, "format"); !ok {
		return client.MediaQuery{}, false
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("folder_id")); raw != "" {
		value, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || value == 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_folder", "folder_id must be a positive integer")
			return client.MediaQuery{}, false
		}
		out.FolderID = value
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("include_descendants")); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_folder", "include_descendants must be true or false")
			return client.MediaQuery{}, false
		}
		out.IncludeDescendants = value
	}
	if out.IncludeDescendants && out.FolderID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_folder", "include_descendants requires folder_id")
		return client.MediaQuery{}, false
	}
	if out.CapturedFrom, ok = desktopIPCMediaTime(w, r, "captured_from"); !ok {
		return client.MediaQuery{}, false
	}
	if out.CapturedTo, ok = desktopIPCMediaTime(w, r, "captured_to"); !ok {
		return client.MediaQuery{}, false
	}
	if out.CapturedFrom != nil && out.CapturedTo != nil &&
		!out.CapturedFrom.Before(*out.CapturedTo) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_time", "captured_from must be before captured_to")
		return client.MediaQuery{}, false
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("has_location")); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_location", "has_location must be true or false")
			return client.MediaQuery{}, false
		}
		out.HasLocation = &value
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("favorite")); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_favorite", "favorite must be true or false")
			return client.MediaQuery{}, false
		}
		out.Favorite = &value
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("tag")); raw != "" {
		if len([]rune(raw)) > 64 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_tag", "tag must be at most 64 characters")
			return client.MediaQuery{}, false
		}
		out.Tag = raw
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("person")); raw != "" {
		if len([]rune(raw)) > 64 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_person", "person must be at most 64 characters")
			return client.MediaQuery{}, false
		}
		out.Person = raw
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("person_identity")); raw != "" {
		const prefix = "person:v1:"
		if !strings.HasPrefix(raw, prefix) {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_person_identity", "person_identity is invalid")
			return client.MediaQuery{}, false
		}
		if _, err := uuid.Parse(strings.TrimPrefix(raw, prefix)); err != nil {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_person_identity", "person_identity is invalid")
			return client.MediaQuery{}, false
		}
		out.PersonIdentity = raw
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("place")); raw != "" {
		if len(raw) > 64 || !strings.HasPrefix(raw, "place:") {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_place", "place is invalid")
			return client.MediaQuery{}, false
		}
		out.Place = raw
	}
	return out, true
}

func desktopIPCMediaFacetValues(
	w http.ResponseWriter,
	r *http.Request,
	name string,
) ([]string, bool) {
	rawValues := r.URL.Query()[name]
	if len(rawValues) > 32 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_"+name, name+" accepts at most 32 values")
		return nil, false
	}
	seen := make(map[string]struct{}, len(rawValues))
	values := make([]string, 0, len(rawValues))
	for _, raw := range rawValues {
		value := strings.ToLower(strings.TrimSpace(raw))
		if value == "" {
			continue
		}
		if strings.ContainsRune(value, 0) || len([]rune(value)) > 160 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_"+name, name+" filter is invalid")
			return nil, false
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		values = append(values, value)
	}
	sort.Strings(values)
	return values, true
}

func desktopIPCMediaTime(
	w http.ResponseWriter,
	r *http.Request,
	name string,
) (*time.Time, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	if raw == "" {
		return nil, true
	}
	value, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_time", name+" must be RFC3339")
		return nil, false
	}
	value = value.UTC()
	return &value, true
}

func desktopIPCMediaWindow(w http.ResponseWriter, r *http.Request) (int, int, bool) {
	limit := 100
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 500 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_limit", "limit must be between 1 and 500")
			return 0, 0, false
		}
		limit = value
	}
	offset := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_offset", "offset must be zero or greater")
			return 0, 0, false
		}
		offset = value
	}
	return limit, offset, true
}

func desktopIPCMediaRangeRequested(w http.ResponseWriter, r *http.Request) (bool, bool) {
	raw, exists := r.URL.Query()["range"]
	if !exists {
		return false, true
	}
	value := ""
	if len(raw) > 0 {
		value = strings.TrimSpace(raw[0])
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_range", "range must be true or false")
		return false, false
	}
	return parsed, true
}

func desktopIPCUint64Query(w http.ResponseWriter, r *http.Request, name string) (uint64, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	value, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || value == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_"+name, name+" must be a positive integer")
		return 0, false
	}
	return value, true
}

type localFolderAuthorizer interface {
	AuthorizeLocalFolder(context.Context, uint64, string) (localFolderGrantResult, error)
}

// authorizeLocalFolder is a loopback/Agent-token-protected endpoint for the
// Desktop MAIN process, never a remote Web path selection API. The path
// originates from Electron's native folder picker, not from renderer input.
func (h *desktopIPCHandler) authorizeLocalFolder(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SourceID uint64 `json:"source_id"`
		Path     string `json:"path"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.SourceID == 0 || len(input.Path) > 4096 || !filepath.IsAbs(input.Path) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_root", "Source ID and absolute local directory are required")
		return
	}
	authorizer, ok := h.ctrl.(localFolderAuthorizer)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_root_unsupported", "Agent has no local folder authorization capability")
		return
	}
	grant, err := authorizer.AuthorizeLocalFolder(r.Context(), input.SourceID, input.Path)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusCreated, grant)
}

func (h *desktopIPCHandler) sources(w http.ResponseWriter, r *http.Request) {
	items, err := h.ctrl.CloudSources(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) createSource(w http.ResponseWriter, r *http.Request) {
	var input client.CreateSourceInput
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	created, err := h.ctrl.CloudCreateSource(r.Context(), input)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusCreated, created)
}

func (h *desktopIPCHandler) updateSource(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SourceID uint64                   `json:"source_id"`
		Revision uint64                   `json:"revision"`
		Update   client.UpdateSourceInput `json:"update"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.SourceID == 0 || input.Revision == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_revision", "source_id and revision must be positive integers")
		return
	}
	updated, err := h.ctrl.CloudUpdateSource(r.Context(), input.SourceID, input.Revision, input.Update)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, updated)
}

func (h *desktopIPCHandler) deleteSource(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SourceID uint64 `json:"source_id"`
		Revision uint64 `json:"revision"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.SourceID == 0 || input.Revision == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_revision", "source_id and revision must be positive integers")
		return
	}
	if err := h.ctrl.CloudDeleteSource(r.Context(), input.SourceID, input.Revision); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) triggerSource(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SourceID uint64 `json:"source_id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.SourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_id", "source_id must be a positive integer")
		return
	}
	updated, err := h.ctrl.CloudTriggerSource(r.Context(), input.SourceID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusAccepted, updated)
}

func (h *desktopIPCHandler) sourceRuns(w http.ResponseWriter, r *http.Request) {
	sourceID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("source_id")), 10, 64)
	if err != nil || sourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_id", "source_id must be a positive integer")
		return
	}
	limit := 1
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 200 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_limit", "limit must be between 1 and 200")
			return
		}
		limit = value
	}
	offset := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_offset", "offset must be zero or greater")
			return
		}
		offset = value
	}
	items, err := h.ctrl.CloudSourceRuns(r.Context(), sourceID, limit, offset)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) sourceRunFailures(w http.ResponseWriter, r *http.Request) {
	sourceID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("source_id")), 10, 64)
	if err != nil || sourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_id", "source_id must be a positive integer")
		return
	}
	runID := strings.TrimSpace(r.URL.Query().Get("run_id"))
	if runID == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_run_id", "run_id is required")
		return
	}
	limit := 20
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 1000 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_limit", "limit must be between 1 and 1000")
			return
		}
		limit = value
	}
	offset := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_offset", "offset must be zero or greater")
			return
		}
		offset = value
	}
	items, err := h.ctrl.CloudSourceRunFailures(r.Context(), sourceID, runID, limit, offset)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) cancelSourceRun(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SourceID uint64 `json:"source_id"`
		RunID    string `json:"run_id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.RunID = strings.TrimSpace(input.RunID)
	if input.SourceID == 0 || input.RunID == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_run", "source_id and run_id are required")
		return
	}
	run, err := h.ctrl.CloudCancelSourceRun(r.Context(), input.SourceID, input.RunID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusAccepted, run)
}

func (h *desktopIPCHandler) sourceItems(w http.ResponseWriter, r *http.Request) {
	sourceID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("source_id")), 10, 64)
	if err != nil || sourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_id", "source_id must be a positive integer")
		return
	}
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	limit := 1000
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 1000 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_limit", "limit must be between 1 and 1000")
			return
		}
		limit = value
	}
	offset := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_offset", "offset must be zero or greater")
			return
		}
		offset = value
	}
	items, err := h.ctrl.CloudSourceItems(r.Context(), sourceID, state, limit, offset)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) sourceCollections(w http.ResponseWriter, r *http.Request) {
	sourceID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("source_id")), 10, 64)
	if err != nil || sourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_id", "source_id must be a positive integer")
		return
	}
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	if state != "" && state != meta.SourceCollectionStateActive && state != meta.SourceCollectionStateMissing {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_collection_state", "collection state must be active or missing")
		return
	}
	collections, err := h.ctrl.CloudSourceCollections(r.Context(), sourceID, state)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, collections)
}

func (h *desktopIPCHandler) sourceCollectionItems(w http.ResponseWriter, r *http.Request) {
	sourceID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("source_id")), 10, 64)
	if err != nil || sourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_id", "source_id must be a positive integer")
		return
	}
	collectionID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("collection_id")), 10, 64)
	if err != nil || collectionID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_collection_id", "collection_id must be a positive integer")
		return
	}
	limit := 100
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 1000 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_limit", "limit must be between 1 and 1000")
			return
		}
		limit = value
	}
	offset := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_offset", "offset must be zero or greater")
			return
		}
		offset = value
	}
	items, err := h.ctrl.CloudSourceCollectionItems(r.Context(), sourceID, collectionID, limit, offset)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) testSourceCredential(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Kind    string            `json:"kind"`
		Payload map[string]string `json:"payload"`
		Cookie  string            `json:"cookie,omitempty"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.Kind = strings.TrimSpace(input.Kind)
	if len(input.Payload) == 0 && strings.TrimSpace(input.Cookie) != "" {
		input.Payload = map[string]string{"cookie": strings.TrimSpace(input.Cookie)}
	}
	if input.Kind == "" || len(input.Payload) == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_credential", "kind and credential payload are required")
		return
	}
	result, err := h.ctrl.CloudTestSourceCredential(r.Context(), input.Kind, input.Payload)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) revealSourceCredential(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SourceID uint64 `json:"source_id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.SourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_id", "source_id must be a positive integer")
		return
	}
	revealed, err := h.ctrl.CloudRevealSourceCredential(r.Context(), input.SourceID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, revealed)
}

func (h *desktopIPCHandler) testStoredSourceCredential(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SourceID uint64 `json:"source_id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.SourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_id", "source_id must be a positive integer")
		return
	}
	result, err := h.ctrl.CloudTestStoredSourceCredential(r.Context(), input.SourceID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) sourceCredentialStatus(w http.ResponseWriter, r *http.Request) {
	sourceID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("source_id")), 10, 64)
	if err != nil || sourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_id", "source_id must be a positive integer")
		return
	}
	status, err := h.ctrl.CloudSourceCredentialStatus(r.Context(), sourceID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, status)
}

func (h *desktopIPCHandler) putSourceCredential(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SourceID uint64            `json:"source_id"`
		Payload  map[string]string `json:"payload"`
		Cookie   string            `json:"cookie,omitempty"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if len(input.Payload) == 0 && strings.TrimSpace(input.Cookie) != "" {
		input.Payload = map[string]string{"cookie": strings.TrimSpace(input.Cookie)}
	}
	if input.SourceID == 0 || len(input.Payload) == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_credential", "source_id and credential payload are required")
		return
	}
	status, err := h.ctrl.CloudPutSourceCredential(r.Context(), input.SourceID, input.Payload)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, status)
}

func (h *desktopIPCHandler) deleteSourceCredential(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SourceID uint64 `json:"source_id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.SourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_id", "source_id must be a positive integer")
		return
	}
	if err := h.ctrl.CloudDeleteSourceCredential(r.Context(), input.SourceID); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) sourceConnectorConfig(w http.ResponseWriter, r *http.Request) {
	sourceID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("source_id")), 10, 64)
	if err != nil || sourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_id", "source_id must be a positive integer")
		return
	}
	config, err := h.ctrl.CloudSourceConnectorConfig(r.Context(), sourceID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, config)
}

func (h *desktopIPCHandler) browseSourceDirectories(w http.ResponseWriter, r *http.Request) {
	sourceID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("source_id")), 10, 64)
	if err != nil || sourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_id", "source_id must be a positive integer")
		return
	}
	limit := 200
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 1000 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_browse_limit", "limit must be between 1 and 1000")
			return
		}
		limit = value
	}
	offset := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_browse_offset", "offset must be zero or greater")
			return
		}
		offset = value
	}
	page, err := h.ctrl.CloudBrowseSourceDirectories(r.Context(), sourceID, r.URL.Query().Get("path"), limit, offset)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeDesktopIPCJSON(w, http.StatusOK, page)
}

func (h *desktopIPCHandler) putSourceConnectorConfig(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SourceID uint64         `json:"source_id"`
		Revision uint64         `json:"revision"`
		Payload  map[string]any `json:"payload"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.SourceID == 0 || input.Revision == 0 || input.Payload == nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_connector_config", "source_id, revision, and payload are required")
		return
	}
	config, err := h.ctrl.CloudPutSourceConnectorConfig(r.Context(), input.SourceID, input.Revision, input.Payload)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, config)
}

func (h *desktopIPCHandler) fileAvailability(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimSpace(r.URL.Query().Get("path"))
	if path == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_path", "path is required")
		return
	}
	state, err := h.ctrl.FileAvailability(path)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, state)
}

func (h *desktopIPCHandler) fileAvailabilityBatch(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Paths []string `json:"paths"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if len(input.Paths) == 0 || len(input.Paths) > 2048 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_paths", "paths must contain 1 to 2048 items")
		return
	}
	seen := make(map[string]struct{}, len(input.Paths))
	items := make([]desktopIPCFileAvailabilityBatchItem, 0, len(input.Paths))
	for _, rawPath := range input.Paths {
		path := strings.TrimSpace(rawPath)
		if path == "" {
			continue
		}
		if _, ok := seen[path]; ok {
			continue
		}
		seen[path] = struct{}{}
		state, err := h.ctrl.FileAvailability(path)
		if err != nil {
			if os.IsNotExist(err) {
				stateCopy := mount.FileAvailability{
					Path:             path,
					Mode:             "cloud",
					AvailableOffline: false,
					InSync:           true,
				}
				items = append(items, desktopIPCFileAvailabilityBatchItem{
					Path:         path,
					Availability: &stateCopy,
				})
				continue
			}
			items = append(items, desktopIPCFileAvailabilityBatchItem{
				Path:  path,
				Error: err.Error(),
			})
			continue
		}
		stateCopy := state
		items = append(items, desktopIPCFileAvailabilityBatchItem{
			Path:         path,
			Availability: &stateCopy,
		})
	}
	if len(items) == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_paths", "paths must contain at least one non-empty item")
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, desktopIPCFileAvailabilityBatch{Items: items})
}

func (h *desktopIPCHandler) setFileAvailability(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Path   string `json:"path"`
		Action string `json:"action"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Path) == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_path", "path is required")
		return
	}
	switch input.Action {
	case "keep", "release", "online", "sync":
	default:
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_file_action", "action must be keep, release, online, or sync")
		return
	}
	if err := h.ctrl.SetFileAvailability(input.Path, input.Action); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	state, err := h.ctrl.FileAvailability(input.Path)
	if err != nil {
		if input.Action == "sync" {
			writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, state)
}

func (h *desktopIPCHandler) transfers(w http.ResponseWriter, _ *http.Request) {
	revision, items := h.ctrl.Transfers()
	writeDesktopIPCJSON(w, http.StatusOK, desktopIPCTransfers{Revision: revision, Transfers: items})
}

func (h *desktopIPCHandler) transferEvents(w http.ResponseWriter, r *http.Request) {
	after := uint64(0)
	if raw := strings.TrimSpace(r.URL.Query().Get("after_revision")); raw != "" {
		value, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_after_revision", "after_revision must be an unsigned integer")
			return
		}
		after = value
	}
	wait := desktopIPCDefaultEventWait
	if raw := strings.TrimSpace(r.URL.Query().Get("timeout_ms")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || time.Duration(value)*time.Millisecond > desktopIPCMaxEventWait {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_timeout", "timeout_ms must be between 1 and 30000")
			return
		}
		wait = time.Duration(value) * time.Millisecond
	}
	ctx, cancel := context.WithTimeout(r.Context(), wait)
	defer cancel()
	revision, items, changed := h.ctrl.WaitTransfers(ctx, after)
	w.Header().Set("X-XDrive-Transfer-Revision", strconv.FormatUint(revision, 10))
	if !changed {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, desktopIPCTransferEvent{
		Type:      "transfers.changed",
		Revision:  revision,
		Transfers: items,
	})
}

func (h *desktopIPCHandler) retryTransfer(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID string `json:"id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.ID = strings.TrimSpace(input.ID)
	if input.ID == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "missing_transfer_id", "id is required")
		return
	}
	if err := h.ctrl.RetryTransfer(r.Context(), input.ID); err != nil {
		writeDesktopIPCError(w, http.StatusConflict, "transfer_retry_failed", err.Error())
		return
	}
	revision, items := h.ctrl.Transfers()
	writeDesktopIPCJSON(w, http.StatusOK, desktopIPCTransfers{Revision: revision, Transfers: items})
}

func (h *desktopIPCHandler) transferLifecycle(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Action       string `json:"action"`
		ID           string `json:"id,omitempty"`
		ParentID     string `json:"parent_id,omitempty"`
		FileName     string `json:"file_name,omitempty"`
		Path         string `json:"path,omitempty"`
		RelativePath string `json:"relative_path,omitempty"`
		Kind         string `json:"kind,omitempty"`
		Direction    string `json:"direction,omitempty"`
		BytesDone    int64  `json:"bytes_done,omitempty"`
		BytesTotal   int64  `json:"bytes_total,omitempty"`
		ItemsTotal   int64  `json:"items_total,omitempty"`
		ItemsDone    int64  `json:"items_completed,omitempty"`
		ItemsFailed  int64  `json:"items_failed,omitempty"`
		ItemsRunning int64  `json:"items_running,omitempty"`
		ItemsQueued  int64  `json:"items_queued,omitempty"`
		ScanComplete bool   `json:"scan_complete,omitempty"`
		State        string `json:"state,omitempty"`
		Error        string `json:"error,omitempty"`
		Skipped      bool   `json:"skipped,omitempty"`
		Children     []struct {
			FileName     string `json:"file_name,omitempty"`
			Path         string `json:"path,omitempty"`
			RelativePath string `json:"relative_path,omitempty"`
			Kind         string `json:"kind,omitempty"`
			Direction    string `json:"direction,omitempty"`
			BytesTotal   int64  `json:"bytes_total,omitempty"`
			ItemsTotal   int64  `json:"items_total,omitempty"`
		} `json:"children,omitempty"`
	}
	if !decodeDesktopIPCJSONLimit(w, r, &input, desktopIPCTransferLifecycleMaxBodyBytes) {
		return
	}
	input.Action = strings.TrimSpace(input.Action)
	input.ID = strings.TrimSpace(input.ID)
	input.ParentID = strings.TrimSpace(input.ParentID)
	if input.Action == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_transfer_lifecycle", "action is required")
		return
	}

	spec := transfer.Spec{
		FileName:     strings.TrimSpace(input.FileName),
		Path:         strings.TrimSpace(input.Path),
		RelativePath: strings.TrimSpace(input.RelativePath),
		Kind:         strings.TrimSpace(input.Kind),
		Direction:    strings.TrimSpace(input.Direction),
		TotalBytes:   input.BytesTotal,
		TotalItems:   input.ItemsTotal,
	}
	progress := transfer.GroupProgress{
		Phase:          transfer.PhaseTransferring,
		ScanComplete:   input.ScanComplete,
		BytesDone:      input.BytesDone,
		BytesTotal:     input.BytesTotal,
		TotalItems:     input.ItemsTotal,
		CompletedItems: input.ItemsDone,
		FailedItems:    input.ItemsFailed,
		RunningItems:   input.ItemsRunning,
		QueuedItems:    input.ItemsQueued,
	}

	switch input.Action {
	case "start_group":
		id, err := h.ctrl.StartTransferGroup(spec)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, map[string]string{"id": id})
	case "start_child":
		if input.ParentID == "" {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_transfer_parent", "parent_id is required")
			return
		}
		spec.Phase = transfer.PhaseQueued
		id, err := h.ctrl.StartTransferChild(input.ParentID, spec)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, map[string]string{"id": id})
	case "start_children":
		if input.ParentID == "" {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_transfer_parent", "parent_id is required")
			return
		}
		if len(input.Children) == 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_transfer_children", "children are required")
			return
		}
		if len(input.Children) > desktopIPCTransferLifecycleMaxChildren {
			writeDesktopIPCError(w, http.StatusBadRequest, "too_many_transfer_children", "too many transfer children")
			return
		}
		specs := make([]transfer.Spec, len(input.Children))
		for index, child := range input.Children {
			specs[index] = transfer.Spec{
				FileName:     strings.TrimSpace(child.FileName),
				Path:         strings.TrimSpace(child.Path),
				RelativePath: strings.TrimSpace(child.RelativePath),
				Kind:         strings.TrimSpace(child.Kind),
				Direction:    strings.TrimSpace(child.Direction),
				TotalBytes:   child.BytesTotal,
				TotalItems:   child.ItemsTotal,
				Phase:        transfer.PhaseQueued,
			}
		}
		ids, err := h.ctrl.StartTransferChildren(input.ParentID, specs)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, map[string][]string{"ids": ids})
	case "begin":
		if input.ID == "" {
			writeDesktopIPCError(w, http.StatusBadRequest, "missing_transfer_id", "id is required")
			return
		}
		var group *transfer.GroupProgress
		if input.ItemsTotal > 0 || input.BytesTotal > 0 || input.ScanComplete {
			group = &progress
		}
		if err := h.ctrl.BeginTransfer(input.ID, group); err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
	case "progress":
		if input.ID == "" {
			writeDesktopIPCError(w, http.StatusBadRequest, "missing_transfer_id", "id is required")
			return
		}
		if err := h.ctrl.ProgressTransfer(input.ID, input.BytesDone, input.BytesTotal); err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
	case "update_group":
		if input.ID == "" {
			writeDesktopIPCError(w, http.StatusBadRequest, "missing_transfer_id", "id is required")
			return
		}
		if err := h.ctrl.UpdateTransferGroup(input.ID, progress); err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
	case "finish":
		if input.ID == "" {
			writeDesktopIPCError(w, http.StatusBadRequest, "missing_transfer_id", "id is required")
			return
		}
		if err := h.ctrl.FinishTransfer(input.ID, strings.TrimSpace(input.State), input.Error, input.Skipped); err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_transfer_lifecycle", "unsupported transfer lifecycle action")
	}
}

func (h *desktopIPCHandler) clearTransferHistory(w http.ResponseWriter, r *http.Request) {
	scope := strings.TrimSpace(r.URL.Query().Get("scope"))
	if scope != "" && scope != "all" && scope != "network" && scope != "local" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_transfer_scope", "transfer history scope must be all, network or local")
		return
	}
	revision, items := h.ctrl.ClearTransferHistory(scope)
	writeDesktopIPCJSON(w, http.StatusOK, desktopIPCTransfers{Revision: revision, Transfers: items})
}

func (h *desktopIPCHandler) diagnostics(w http.ResponseWriter, r *http.Request) {
	report := h.ctrl.Diagnostics(r.Context())
	writeDesktopIPCJSON(w, http.StatusOK, report)
}

func (h *desktopIPCHandler) diagnosticReport(w http.ResponseWriter, r *http.Request) {
	report := h.ctrl.Diagnostics(r.Context())
	writeDesktopIPCJSON(w, http.StatusOK, map[string]string{"report": diagnostics.FormatText(report)})
}

func (h *desktopIPCHandler) reconnect(w http.ResponseWriter, r *http.Request) {
	if err := h.ctrl.Reconnect(r.Context()); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	h.writeStatus(w)
}

func (h *desktopIPCHandler) repairSyncRoot(w http.ResponseWriter, r *http.Request) {
	if err := h.ctrl.RepairSyncRoot(r.Context()); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	h.writeStatus(w)
}

func (h *desktopIPCHandler) openLogs(w http.ResponseWriter, _ *http.Request) {
	if err := h.ctrl.OpenLogs(); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) conflicts(w http.ResponseWriter, _ *http.Request) {
	writeDesktopIPCJSON(w, http.StatusOK, map[string]any{"conflicts": h.ctrl.Conflicts()})
}

func (h *desktopIPCHandler) openConflict(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID   string `json:"id"`
		Both bool   `json:"both,omitempty"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.ID) == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "missing_conflict_id", "id is required")
		return
	}
	if err := h.ctrl.OpenConflict(input.ID, input.Both); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) resolveConflict(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID     string `json:"id"`
		Choice string `json:"choice"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.ID) == "" || (input.Choice != "server" && input.Choice != "local") {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_conflict_resolution", "id and choice=server|local are required")
		return
	}
	if err := h.ctrl.ResolveConflict(input.ID, input.Choice); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) openFolder(w http.ResponseWriter, _ *http.Request) {
	if err := h.ctrl.OpenFolder(); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) openPath(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Path   string `json:"path"`
		Reveal bool   `json:"reveal"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.Path = strings.TrimSpace(input.Path)
	if input.Path == "" || filepath.IsAbs(input.Path) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_managed_path", "a relative xDrive path is required")
		return
	}
	if err := h.ctrl.OpenManagedPath(input.Path, input.Reveal); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) openWith(w http.ResponseWriter, r *http.Request) {
	if !openWithSupportedPlatform() {
		writeDesktopIPCError(w, http.StatusNotImplemented, "open_with_unsupported", "Open With is not supported on this platform")
		return
	}
	var input struct {
		Path string `json:"path"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.Path = strings.TrimSpace(input.Path)
	if input.Path == "" || filepath.IsAbs(input.Path) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_managed_path", "a relative xDrive path is required")
		return
	}
	if err := h.ctrl.OpenManagedPathWith(input.Path); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) writeStatus(w http.ResponseWriter) {
	snapshot, revision := h.ctrl.SnapshotWithRevision()
	writeDesktopIPCJSON(w, http.StatusOK, makeDesktopIPCStatus(snapshot, revision))
}

func makeDesktopIPCStatus(snapshot agentSnapshot, revision uint64) desktopIPCStatus {
	var serverBuild *client.VersionInfo
	if snapshot.ServerBuild.Version != "" {
		build := snapshot.ServerBuild
		serverBuild = &build
	}
	return desktopIPCStatus{
		Revision:           revision,
		Configured:         snapshot.Configured,
		Username:           snapshot.Username,
		Role:               snapshot.Role,
		Server:             snapshot.Server,
		MountPath:          snapshot.MountPath,
		AuthStatus:         snapshot.AuthStatus,
		SyncStatus:         snapshot.SyncStatus,
		Paused:             snapshot.Paused,
		MustChangePassword: snapshot.MustChangePassword,
		LastError:          snapshot.LastError,
		HasConflict:        snapshot.HasConflict,
		ConflictCount:      snapshot.ConflictCount,
		Version:            snapshot.Version,
		ServerBuild:        serverBuild,
	}
}

func decodeDesktopIPCJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	return decodeDesktopIPCJSONLimit(w, r, target, desktopIPCMaxBodyBytes)
}

func decodeDesktopIPCJSONLimit(w http.ResponseWriter, r *http.Request, target any, maxBytes int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_json", "request body must contain one JSON object")
		return false
	}
	return true
}

func writeDesktopIPCControllerError(w http.ResponseWriter, err error) {
	var apiErr *client.APIError
	if errors.As(err, &apiErr) {
		status := apiErr.Status
		if status < 400 || status > 599 {
			status = http.StatusBadGateway
		}
		code := strings.TrimSpace(apiErr.Msg)
		if code == "" {
			code = "server_error"
		}
		message := err.Error()
		switch code {
		case "quota_exceeded":
			message = "用户存储配额不足。请永久删除回收站内容，或联系管理员提高配额。"
		case "storage_capacity_exceeded":
			message = "服务器存储空间不足。请释放服务器磁盘空间后重试。"
		}
		writeDesktopIPCErrorDetail(w, status, code, message, apiErr.Detail)
		return
	}
	writeDesktopIPCError(w, http.StatusBadRequest, "operation_failed", err.Error())
}

func writeDesktopIPCError(w http.ResponseWriter, status int, code, message string) {
	writeDesktopIPCErrorDetail(w, status, code, message, "")
}

func writeDesktopIPCErrorDetail(w http.ResponseWriter, status int, code, message, detail string) {
	payload := map[string]string{
		"error":   code,
		"message": message,
	}
	if detail = strings.TrimSpace(detail); detail != "" {
		payload["detail"] = detail
	}
	writeDesktopIPCJSON(w, status, payload)
}

func writeDesktopIPCJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("desktop IPC response encode failed: %v", err)
	}
}
