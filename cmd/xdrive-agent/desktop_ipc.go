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
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

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
	desktopIPCAPIVersion       = 1
	desktopIPCProtocolMin      = 2
	desktopIPCProtocolMax      = 2
	desktopIPCDiscoveryName    = "desktop-ipc.json"
	desktopIPCMaxBodyBytes     = 64 << 10
	desktopIPCDefaultEventWait = 25 * time.Second
	desktopIPCMaxEventWait     = 30 * time.Second
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
	"storage-tree",
	"cache-management",
	"cloud-files",
	"background-tasks",
	"file-text-preview",
	"file-preview-stream",
	"archive-download",
	"folder-download-tree",
	"file-operation-conflict-resolution",
	"file-operation-undo",
	"file-operation-redo",
	"file-quick-access",
	"file-recent",
	"upload-conflict-preflight",
	"upload-conflict-policy",
	"server-update",
	"media-gallery",
	"external-sources",
	"storage-intelligence",
	"conflicts",
	"transfers",
	"transfer-events",
	"transfer-retry",
	"transfer-lifecycle",
	"diagnostics",
	"diagnostic-actions",
	"open-folder",
	"open-path",
	"lifecycle-shutdown",
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
	ReleaseReclaimableCache() (mount.CacheReleaseResult, error)
	CloudRoot(context.Context) (client.Node, error)
	CloudList(context.Context, uint64) ([]client.Node, error)
	CloudListPage(context.Context, uint64, client.ChildrenOptions) (client.ChildrenPage, error)
	CloudListRange(context.Context, uint64, client.ChildrenRangeOptions) (client.ChildrenRange, error)
	CloudFileQuickAccess(context.Context) ([]client.FileQuickAccessItem, error)
	CloudPinFileQuickAccess(context.Context, uint64) (client.FileQuickAccessItem, error)
	CloudUnpinFileQuickAccess(context.Context, uint64) error
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
	CloudCreateFileOperation(context.Context, string, []client.BatchNodeRef, uint64) (client.FileOperation, error)
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
	CloudUploadWithConflictPolicy(context.Context, uint64, string, string, string) (agentCloudUploadResult, error)
	CloudUploadWithConflictPolicyTracked(context.Context, uint64, string, string, string, string) (agentCloudUploadResult, error)
	CloudUpload(context.Context, uint64, string, string) (client.Node, error)
	CloudFileTextPreview(context.Context, uint64) (client.FileTextPreview, error)
	CloudFilePreviewTicket(context.Context, uint64) (client.FilePreviewTicket, error)
	CloudDownload(context.Context, uint64, string) error
	CloudDownloadFolder(context.Context, uint64, uint64, string) (agentCloudFolderDownloadResult, error)
	CloudDownloadArchive(context.Context, []uint64, string) (agentCloudArchiveDownloadResult, error)
	CloudSearch(context.Context, string, string, string, string) (agentCloudSearchPage, error)
	CloudSearchRange(context.Context, string, int, int, string, string) (agentCloudSearchRange, error)
	CloudQuota(context.Context) (client.QuotaUsage, error)
	CloudServerUpdateState(context.Context) (client.ServerUpdateState, error)
	CloudStartServerUpdate(context.Context, string, string, bool) (client.ServerUpdateState, error)
	CloudStorageStats(context.Context) (client.StorageStats, error)
	CloudTrash(context.Context) ([]client.Node, error)
	CloudRestoreTrash(context.Context, uint64, uint64) (client.Node, error)
	CloudDeleteTrash(context.Context, uint64, uint64) error
	CloudVersions(context.Context, uint64) ([]client.FileVersion, error)
	CloudRestoreVersion(context.Context, uint64, uint64, uint64) (client.Node, error)
	CloudShares(context.Context, uint64) ([]client.FileShare, error)
	CloudCreateShare(context.Context, uint64, client.CreateShareInput) (agentCreatedShare, error)
	CloudRevokeShare(context.Context, uint64) error
	CloudMediaItems(context.Context, client.MediaQuery, int, int) ([]client.MediaItem, error)
	CloudMediaAlbums(context.Context) ([]client.MediaAlbum, error)
	CloudMediaPlaces(context.Context, int) ([]client.MediaPlaceFacet, error)
	CloudMediaSuggestedPeople(context.Context, int) ([]client.MediaSuggestedPerson, error)
	CloudMediaSuggestedPersonItems(context.Context, string, client.MediaQuery, int, int) ([]client.MediaItem, error)
	CloudMediaPeople(context.Context, bool, int, int) ([]client.MediaPersonIdentity, error)
	CloudMediaPersonItems(context.Context, string, client.MediaQuery, int, int) ([]client.MediaItem, error)
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
	CloudSetMediaFavorite(context.Context, uint64, bool) (client.MediaFavorite, error)
	CloudSetMediaTags(context.Context, uint64, []string) (client.MediaTags, error)
	CloudSetMediaPeople(context.Context, uint64, []string) (client.MediaPeople, error)
	CloudSetMediaDescription(context.Context, uint64, string) (client.MediaDescription, error)
	CloudMediaThumbnail(context.Context, uint64) (agentMediaThumbnail, error)
	CloudMediaLivePhotoMotion(context.Context, uint64) (agentMediaMotion, error)
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
	BeginTransfer(string, *transfer.GroupProgress) error
	ProgressTransfer(string, int64, int64) error
	UpdateTransferGroup(string, transfer.GroupProgress) error
	FinishTransfer(string, string, string, bool) error
	ClearTransferHistory() (uint64, []transfer.Task)
	Diagnostics(context.Context) diagnostics.Report
	Reconnect(context.Context) error
	RepairSyncRoot(context.Context) error
	OpenLogs() error
	Conflicts() []conflictstate.Record
	OpenConflict(id string, both bool) error
	ResolveConflict(id, choice string) error
	OpenFolder() error
	OpenManagedPath(path string, reveal bool) error
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
	mux.HandleFunc("POST /v1/cache/release", h.releaseCache)
	mux.HandleFunc("GET /v1/cloud/root", h.cloudRoot)
	mux.HandleFunc("GET /v1/cloud/children", h.cloudChildren)
	mux.HandleFunc("GET /v1/cloud/quick-access", h.cloudFileQuickAccess)
	mux.HandleFunc("POST /v1/cloud/quick-access/pin", h.cloudPinFileQuickAccess)
	mux.HandleFunc("POST /v1/cloud/quick-access/unpin", h.cloudUnpinFileQuickAccess)
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
	mux.HandleFunc("POST /v1/cloud/file-operations", h.cloudCreateFileOperation)
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
	mux.HandleFunc("GET /v1/cloud/trash", h.cloudTrash)
	mux.HandleFunc("POST /v1/cloud/trash/restore", h.cloudRestoreTrash)
	mux.HandleFunc("POST /v1/cloud/trash/delete", h.cloudDeleteTrash)
	mux.HandleFunc("GET /v1/cloud/versions", h.cloudVersions)
	mux.HandleFunc("POST /v1/cloud/versions/restore", h.cloudRestoreVersion)
	mux.HandleFunc("GET /v1/cloud/shares", h.cloudShares)
	mux.HandleFunc("POST /v1/cloud/shares", h.cloudCreateShare)
	mux.HandleFunc("POST /v1/cloud/shares/revoke", h.cloudRevokeShare)
	mux.HandleFunc("GET /v1/media/items", h.mediaItems)
	mux.HandleFunc("GET /v1/media/albums", h.mediaAlbums)
	mux.HandleFunc("GET /v1/media/places", h.mediaPlaces)
	mux.HandleFunc("GET /v1/media/people/suggestions", h.mediaSuggestedPeople)
	mux.HandleFunc("GET /v1/media/people/suggestion-items", h.mediaSuggestedPersonItems)
	mux.HandleFunc("GET /v1/media/people/identities", h.mediaPersonIdentities)
	mux.HandleFunc("GET /v1/media/people/identity-items", h.mediaPersonItems)
	mux.HandleFunc("POST /v1/media/people/adopt", h.adoptMediaSuggestedPerson)
	mux.HandleFunc("PATCH /v1/media/person", h.updateMediaPerson)
	mux.HandleFunc("POST /v1/media/person/merge", h.mergeMediaPeople)
	mux.HandleFunc("POST /v1/media/person/split", h.splitMediaPerson)
	mux.HandleFunc("POST /v1/media/albums", h.createMediaAlbum)
	mux.HandleFunc("PATCH /v1/media/album", h.renameMediaAlbum)
	mux.HandleFunc("DELETE /v1/media/album", h.deleteMediaAlbum)
	mux.HandleFunc("POST /v1/media/smart-albums", h.createSmartMediaAlbum)
	mux.HandleFunc("PATCH /v1/media/smart-album", h.updateSmartMediaAlbum)
	mux.HandleFunc("DELETE /v1/media/smart-album", h.deleteSmartMediaAlbum)
	mux.HandleFunc("POST /v1/media/album/items", h.addMediaAlbumItems)
	mux.HandleFunc("DELETE /v1/media/album/item", h.removeMediaAlbumItem)
	mux.HandleFunc("GET /v1/media/albums/items", h.mediaAlbumItems)
	mux.HandleFunc("PATCH /v1/media/favorite", h.mediaFavorite)
	mux.HandleFunc("PATCH /v1/media/tags", h.mediaTags)
	mux.HandleFunc("PATCH /v1/media/people", h.mediaPeople)
	mux.HandleFunc("PATCH /v1/media/description", h.mediaDescription)
	mux.HandleFunc("GET /v1/media/thumbnail", h.mediaThumbnail)
	mux.HandleFunc("GET /v1/media/live-photo-motion", h.mediaLivePhotoMotion)
	mux.HandleFunc("GET /v1/sources", h.sources)
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
		Capabilities:     append([]string(nil), desktopIPCCapabilities...),
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
		options := client.ChildrenRangeOptions{
			Offset: offset,
			Sort:   strings.TrimSpace(query.Get("sort")),
			Order:  strings.TrimSpace(query.Get("order")),
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
	if input.ConflictPolicy != "skip" && input.ConflictPolicy != "keep_both" {
		writeDesktopIPCError(
			w,
			http.StatusBadRequest,
			"invalid_file_operation_conflict_policy",
			"conflict_policy must be skip or keep_both",
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

func (h *desktopIPCHandler) cloudSearch(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(query)) < 2 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_search_query", "q must contain at least 2 characters")
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
		page, err := h.ctrl.CloudSearchRange(
			r.Context(),
			query,
			offset,
			limit,
			strings.TrimSpace(values.Get("sort")),
			strings.TrimSpace(values.Get("order")),
		)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, page)
		return
	}
	page, err := h.ctrl.CloudSearch(
		r.Context(),
		query,
		strings.TrimSpace(values.Get("cursor")),
		strings.TrimSpace(values.Get("sort")),
		strings.TrimSpace(values.Get("order")),
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

func (h *desktopIPCHandler) cloudTrash(w http.ResponseWriter, r *http.Request) {
	items, err := h.ctrl.CloudTrash(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
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

func (h *desktopIPCHandler) mediaItems(w http.ResponseWriter, r *http.Request) {
	query, ok := desktopIPCMediaQuery(w, r)
	if !ok {
		return
	}
	limit, offset, ok := desktopIPCMediaWindow(w, r)
	if !ok {
		return
	}
	items, err := h.ctrl.CloudMediaItems(r.Context(), query, limit, offset)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) mediaAlbums(w http.ResponseWriter, r *http.Request) {
	items, err := h.ctrl.CloudMediaAlbums(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) mediaPlaces(w http.ResponseWriter, r *http.Request) {
	limit := 24
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 100 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_place_limit", "limit must be between 1 and 100")
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
	items, err := h.ctrl.CloudMediaSuggestedPeople(r.Context(), limit)
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
		writeDesktopIPCError(
			w,
			http.StatusBadRequest,
			"invalid_media_suggested_person",
			"valid person_id is required",
		)
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
	items, err := h.ctrl.CloudMediaSuggestedPersonItems(
		r.Context(),
		personID,
		query,
		limit,
		offset,
	)
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
	items, err := h.ctrl.CloudMediaPersonItems(r.Context(), personID, query, limit, offset)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
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

func (h *desktopIPCHandler) mediaThumbnail(w http.ResponseWriter, r *http.Request) {
	nodeID, ok := desktopIPCUint64Query(w, r, "node_id")
	if !ok {
		return
	}
	thumbnail, err := h.ctrl.CloudMediaThumbnail(r.Context(), nodeID)
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

func (h *desktopIPCHandler) mediaLivePhotoMotion(w http.ResponseWriter, r *http.Request) {
	nodeID, ok := desktopIPCUint64Query(w, r, "node_id")
	if !ok {
		return
	}
	motion, err := h.ctrl.CloudMediaLivePhotoMotion(r.Context(), nodeID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, motion)
}

func desktopIPCMediaQuery(w http.ResponseWriter, r *http.Request) (client.MediaQuery, bool) {
	var out client.MediaQuery
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

	var ok bool
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

func desktopIPCUint64Query(w http.ResponseWriter, r *http.Request, name string) (uint64, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	value, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || value == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_"+name, name+" must be a positive integer")
		return 0, false
	}
	return value, true
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
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
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

func (h *desktopIPCHandler) clearTransferHistory(w http.ResponseWriter, _ *http.Request) {
	revision, items := h.ctrl.ClearTransferHistory()
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
	r.Body = http.MaxBytesReader(w, r.Body, desktopIPCMaxBodyBytes)
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
