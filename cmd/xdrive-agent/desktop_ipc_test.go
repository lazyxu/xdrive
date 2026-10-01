package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/conflictstate"
	"github.com/lazyxu/xdrive/internal/diagnostics"
	"github.com/lazyxu/xdrive/internal/mount"
	"github.com/lazyxu/xdrive/internal/transfer"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

type fakeDesktopIPCController struct {
	snapshot agentSnapshot
	revision uint64
	settings userconfig.Config
	root     string
	items    []conflictstate.Record

	loginServer                string
	loginUsername              string
	loginPassword              string
	loginMount                 string
	currentPass                string
	newPass                    string
	logouts                    int
	paused                     *bool
	syncs                      int
	updateMount                *string
	updateCache                *int64
	updateState                clientUpdateState
	updateMode                 string
	updateSource               string
	updateChecks               int
	updateDownloads            int
	updateInstalls             int
	updateCancels              int
	rulePath                   string
	ruleMode                   string
	filePath                   string
	fileAction                 string
	fileState                  mount.FileAvailability
	openFolderN                int
	openManagedPath            string
	openManagedReveal          bool
	openID                     string
	openBoth                   bool
	resolveID                  string
	resolveChoice              string
	err                        error
	transfers                  *transfer.Manager
	diagnosticReport           diagnostics.Report
	reconnectN                 int
	repairN                    int
	openLogsN                  int
	storageTree                agentStorageTreeNode
	cacheStats                 mount.CacheStats
	cacheRelease               mount.CacheReleaseResult
	cloudRoot                  client.Node
	cloudChildren              []client.Node
	cloudCreatedDir            client.Node
	cloudCreateParent          uint64
	cloudCreateName            string
	cloudRenamed               client.Node
	cloudRenameID              uint64
	cloudRenameRev             uint64
	cloudRenameName            string
	cloudCopied                client.Node
	cloudCopyID                uint64
	cloudCopyParent            uint64
	cloudMoved                 client.Node
	cloudMoveID                uint64
	cloudMoveRev               uint64
	cloudMoveParent            uint64
	cloudMutationDeleteID      uint64
	cloudMutationDeleteRev     uint64
	cloudUploaded              client.Node
	cloudUploadParent          uint64
	cloudUploadPath            string
	cloudUploadName            string
	cloudDownloadID            uint64
	cloudDownloadDestination   string
	cloudSearch                []agentCloudSearchResult
	cloudQuota                 client.QuotaUsage
	cloudServerUpdate          client.ServerUpdateState
	cloudServerUpdateSource    string
	cloudServerUpdateChannel   string
	cloudStorage               client.StorageStats
	cloudTrash                 []client.Node
	cloudVersions              []client.FileVersion
	cloudShares                []client.FileShare
	cloudCreated               agentCreatedShare
	cloudRestored              client.Node
	cloudRevokeID              uint64
	cloudDeleteID              uint64
	cloudDeleteRev             uint64
	cloudMediaItems            []client.MediaItem
	cloudMediaAlbums           []client.MediaAlbum
	cloudMediaAlbumItems       []client.MediaItem
	cloudMediaThumbnail        agentMediaThumbnail
	cloudMediaKind             string
	cloudMediaLimit            int
	cloudMediaOffset           int
	cloudMediaAlbumID          string
	cloudMediaThumbnailID      uint64
	cloudSources               []client.Source
	cloudSourceRuns            []client.SyncRun
	cloudSourceRunFailures     []client.SourceRunFailure
	cloudCancelledRun          client.SyncRun
	cloudCancelSourceID        uint64
	cloudCancelRunID           string
	cloudSourceItems           []client.SourceItem
	cloudSourceCollections     []client.SourceCollection
	cloudSourceCollectionItems []client.SourceCollectionItem
	cloudSourceCredential      client.SourceCredentialStatus
	cloudCredentialTest        client.SourceCredentialTestResult
	cloudCredentialReveal      client.SourceCredentialReveal
	cloudRevealCredentialID    uint64
	cloudTestCredentialKind    string
	cloudTestCredentialPayload map[string]string
	cloudTestStoredID          uint64
	cloudPutCredential         client.SourceCredentialStatus
	cloudPutCredentialID       uint64
	cloudPutCredentialPayload  map[string]string
	cloudDeleteCredential      uint64
	cloudConnectorConfig       client.SourceConnectorConfig
	cloudSourceBrowse          client.SourceBrowsePage
	cloudBrowseSourceID        uint64
	cloudBrowsePath            string
	cloudBrowseLimit           int
	cloudBrowseOffset          int
	cloudPutConnectorConfig    client.SourceConnectorConfig
	cloudConnectorConfigID     uint64
	cloudPutConnectorID        uint64
	cloudPutConnectorRevision  uint64
	cloudPutConnectorPayload   map[string]any

	cloudCreatedSource   client.Source
	cloudUpdatedSource   client.Source
	cloudTriggeredSource client.Source
	cloudCreateInput     client.CreateSourceInput
	cloudUpdateID        uint64
	cloudUpdateRevision  uint64
	cloudUpdateInput     client.UpdateSourceInput
	cloudDeleteSourceID  uint64
	cloudDeleteSourceRev uint64
	cloudTriggerID       uint64
}

func (f *fakeDesktopIPCController) SnapshotWithRevision() (agentSnapshot, uint64) {
	return f.snapshot, f.revision
}

func (f *fakeDesktopIPCController) WaitSnapshot(_ context.Context, after uint64) (agentSnapshot, uint64, bool) {
	return f.snapshot, f.revision, f.revision != after
}

func (f *fakeDesktopIPCController) Authenticate(server, username, password, mountPath string) error {
	f.loginServer, f.loginUsername, f.loginPassword, f.loginMount = server, username, password, mountPath
	return f.err
}

func (f *fakeDesktopIPCController) ChangePassword(currentPassword, newPassword string) error {
	f.currentPass, f.newPass = currentPassword, newPassword
	return f.err
}

func (f *fakeDesktopIPCController) Logout() error {
	f.logouts++
	return f.err
}

func (f *fakeDesktopIPCController) SetPaused(paused bool) error {
	f.paused = &paused
	return f.err
}

func (f *fakeDesktopIPCController) SyncNow() error {
	f.syncs++
	return f.err
}

func (f *fakeDesktopIPCController) Settings() (userconfig.Config, string, error) {
	return f.settings, f.root, f.err
}

func (f *fakeDesktopIPCController) UpdateSettings(mountPath *string, cacheLimitBytes *int64) error {
	f.updateMount, f.updateCache = mountPath, cacheLimitBytes
	return f.err
}

func (f *fakeDesktopIPCController) UpdateState() clientUpdateState {
	return f.updateState
}

func (f *fakeDesktopIPCController) SetUpdateMode(mode string) (clientUpdateState, error) {
	f.updateMode = mode
	f.updateState.Mode = mode
	return f.updateState, f.err
}

func (f *fakeDesktopIPCController) SetUpdateSource(source string) (clientUpdateState, error) {
	f.updateSource = source
	f.updateState.Source = source
	return f.updateState, f.err
}

func (f *fakeDesktopIPCController) CheckClientUpdate(context.Context) (clientUpdateState, error) {
	f.updateChecks++
	return f.updateState, f.err
}

func (f *fakeDesktopIPCController) DownloadClientUpdate(context.Context) (clientUpdateState, error) {
	f.updateDownloads++
	return f.updateState, f.err
}

func (f *fakeDesktopIPCController) InstallClientUpdate(context.Context) (clientUpdateState, error) {
	f.updateInstalls++
	return f.updateState, f.err
}

func (f *fakeDesktopIPCController) CancelClientUpdate() (clientUpdateState, error) {
	f.updateCancels++
	return f.updateState, f.err
}

func (f *fakeDesktopIPCController) SetSelectiveSyncRule(path, mode string) error {
	f.rulePath, f.ruleMode = path, mode
	return f.err
}

func (f *fakeDesktopIPCController) StorageTree(context.Context) (agentStorageTreeNode, error) {
	return f.storageTree, f.err
}

func (f *fakeDesktopIPCController) CacheStats() (mount.CacheStats, error) {
	return f.cacheStats, f.err
}

func (f *fakeDesktopIPCController) ReleaseReclaimableCache() (mount.CacheReleaseResult, error) {
	return f.cacheRelease, f.err
}

func (f *fakeDesktopIPCController) CloudRoot(context.Context) (client.Node, error) {
	return f.cloudRoot, f.err
}

func (f *fakeDesktopIPCController) CloudList(context.Context, uint64) ([]client.Node, error) {
	return append([]client.Node(nil), f.cloudChildren...), f.err
}

func (f *fakeDesktopIPCController) CloudListPage(_ context.Context, _ uint64, options client.ChildrenOptions) (client.ChildrenPage, error) {
	items := append([]client.Node(nil), f.cloudChildren...)
	return client.ChildrenPage{
		Items:      items,
		NextCursor: "next-page",
		HasMore:    true,
		Sort:       options.Sort,
		Order:      options.Order,
	}, f.err
}

func (f *fakeDesktopIPCController) CloudCreateDir(_ context.Context, parentID uint64, name string) (client.Node, error) {
	f.cloudCreateParent, f.cloudCreateName = parentID, name
	return f.cloudCreatedDir, f.err
}

func (f *fakeDesktopIPCController) CloudRename(_ context.Context, id, revision uint64, name string) (client.Node, error) {
	f.cloudRenameID, f.cloudRenameRev, f.cloudRenameName = id, revision, name
	return f.cloudRenamed, f.err
}

func (f *fakeDesktopIPCController) CloudCopy(_ context.Context, id, parentID uint64) (client.Node, error) {
	f.cloudCopyID, f.cloudCopyParent = id, parentID
	return f.cloudCopied, f.err
}

func (f *fakeDesktopIPCController) CloudMove(_ context.Context, id, revision, parentID uint64) (client.Node, error) {
	f.cloudMoveID, f.cloudMoveRev, f.cloudMoveParent = id, revision, parentID
	return f.cloudMoved, f.err
}

func (f *fakeDesktopIPCController) CloudDelete(_ context.Context, id, revision uint64) error {
	f.cloudMutationDeleteID, f.cloudMutationDeleteRev = id, revision
	return f.err
}

func (f *fakeDesktopIPCController) CloudBatchCopy(_ context.Context, items []client.BatchNodeRef, parentID uint64) (client.BatchNodesResult, error) {
	return client.BatchNodesResult{OperationID: "copy-op", Items: []client.Node{{ID: 21, ParentID: &parentID, Name: "copy.txt", Type: "file", Revision: 1}}}, f.err
}

func (f *fakeDesktopIPCController) CloudBatchMove(_ context.Context, items []client.BatchNodeRef, parentID uint64) (client.BatchNodesResult, error) {
	return client.BatchNodesResult{OperationID: "move-op", Items: []client.Node{{ID: items[0].ID, ParentID: &parentID, Name: "moved.txt", Type: "file", Revision: items[0].Revision + 1}}}, f.err
}

func (f *fakeDesktopIPCController) CloudBatchDelete(_ context.Context, items []client.BatchNodeRef) (client.BatchNodesResult, error) {
	ids := make([]uint64, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	return client.BatchNodesResult{OperationID: "delete-op", DeletedIDs: ids}, f.err
}

func (f *fakeDesktopIPCController) CloudUpload(_ context.Context, parentID uint64, localPath, name string) (client.Node, error) {
	f.cloudUploadParent, f.cloudUploadPath, f.cloudUploadName = parentID, localPath, name
	return f.cloudUploaded, f.err
}

func (f *fakeDesktopIPCController) CloudDownload(_ context.Context, id uint64, destination string) error {
	f.cloudDownloadID, f.cloudDownloadDestination = id, destination
	return f.err
}

func (f *fakeDesktopIPCController) CloudSearch(context.Context, string) ([]agentCloudSearchResult, error) {
	return append([]agentCloudSearchResult(nil), f.cloudSearch...), f.err
}

func (f *fakeDesktopIPCController) CloudQuota(context.Context) (client.QuotaUsage, error) {
	return f.cloudQuota, f.err
}

func (f *fakeDesktopIPCController) CloudServerUpdateState(context.Context) (client.ServerUpdateState, error) {
	return f.cloudServerUpdate, f.err
}

func (f *fakeDesktopIPCController) CloudStartServerUpdate(_ context.Context, source, channel string) (client.ServerUpdateState, error) {
	f.cloudServerUpdateSource = source
	f.cloudServerUpdateChannel = channel
	return f.cloudServerUpdate, f.err
}

func (f *fakeDesktopIPCController) CloudStorageStats(context.Context) (client.StorageStats, error) {
	return f.cloudStorage, f.err
}

func (f *fakeDesktopIPCController) CloudTrash(context.Context) ([]client.Node, error) {
	return append([]client.Node(nil), f.cloudTrash...), f.err
}

func (f *fakeDesktopIPCController) CloudRestoreTrash(_ context.Context, _, _ uint64) (client.Node, error) {
	return f.cloudRestored, f.err
}

func (f *fakeDesktopIPCController) CloudDeleteTrash(_ context.Context, id, revision uint64) error {
	f.cloudDeleteID, f.cloudDeleteRev = id, revision
	return f.err
}

func (f *fakeDesktopIPCController) CloudVersions(context.Context, uint64) ([]client.FileVersion, error) {
	return append([]client.FileVersion(nil), f.cloudVersions...), f.err
}

func (f *fakeDesktopIPCController) CloudRestoreVersion(context.Context, uint64, uint64, uint64) (client.Node, error) {
	return f.cloudRestored, f.err
}

func (f *fakeDesktopIPCController) CloudShares(context.Context, uint64) ([]client.FileShare, error) {
	return append([]client.FileShare(nil), f.cloudShares...), f.err
}

func (f *fakeDesktopIPCController) CloudCreateShare(context.Context, uint64, client.CreateShareInput) (agentCreatedShare, error) {
	return f.cloudCreated, f.err
}

func (f *fakeDesktopIPCController) CloudRevokeShare(_ context.Context, id uint64) error {
	f.cloudRevokeID = id
	return f.err
}

func (f *fakeDesktopIPCController) CloudMediaItems(_ context.Context, kind string, limit, offset int) ([]client.MediaItem, error) {
	f.cloudMediaKind = kind
	f.cloudMediaLimit = limit
	f.cloudMediaOffset = offset
	return append([]client.MediaItem(nil), f.cloudMediaItems...), f.err
}

func (f *fakeDesktopIPCController) CloudMediaAlbums(context.Context) ([]client.MediaAlbum, error) {
	return append([]client.MediaAlbum(nil), f.cloudMediaAlbums...), f.err
}

func (f *fakeDesktopIPCController) CloudMediaAlbumItems(_ context.Context, albumID string, limit, offset int) ([]client.MediaItem, error) {
	f.cloudMediaAlbumID = albumID
	f.cloudMediaLimit = limit
	f.cloudMediaOffset = offset
	return append([]client.MediaItem(nil), f.cloudMediaAlbumItems...), f.err
}

func (f *fakeDesktopIPCController) CloudMediaThumbnail(_ context.Context, nodeID uint64) (agentMediaThumbnail, error) {
	f.cloudMediaThumbnailID = nodeID
	return f.cloudMediaThumbnail, f.err
}

func (f *fakeDesktopIPCController) CloudSources(context.Context) ([]client.Source, error) {
	return append([]client.Source(nil), f.cloudSources...), f.err
}

func (f *fakeDesktopIPCController) CloudSourceRuns(context.Context, uint64, int, int) ([]client.SyncRun, error) {
	return append([]client.SyncRun(nil), f.cloudSourceRuns...), f.err
}

func (f *fakeDesktopIPCController) CloudSourceRunFailures(context.Context, uint64, string, int, int) ([]client.SourceRunFailure, error) {
	return append([]client.SourceRunFailure(nil), f.cloudSourceRunFailures...), f.err
}

func (f *fakeDesktopIPCController) CloudCancelSourceRun(_ context.Context, sourceID uint64, runID string) (client.SyncRun, error) {
	f.cloudCancelSourceID, f.cloudCancelRunID = sourceID, runID
	return f.cloudCancelledRun, f.err
}

func (f *fakeDesktopIPCController) CloudSourceItems(context.Context, uint64, string, int, int) ([]client.SourceItem, error) {
	return append([]client.SourceItem(nil), f.cloudSourceItems...), f.err
}

func (f *fakeDesktopIPCController) CloudSourceCollections(context.Context, uint64, string) ([]client.SourceCollection, error) {
	return append([]client.SourceCollection(nil), f.cloudSourceCollections...), f.err
}

func (f *fakeDesktopIPCController) CloudSourceCollectionItems(context.Context, uint64, uint64, int, int) ([]client.SourceCollectionItem, error) {
	return append([]client.SourceCollectionItem(nil), f.cloudSourceCollectionItems...), f.err
}

func (f *fakeDesktopIPCController) CloudSourceCredentialStatus(context.Context, uint64) (client.SourceCredentialStatus, error) {
	return f.cloudSourceCredential, f.err
}

func (f *fakeDesktopIPCController) CloudRevealSourceCredential(_ context.Context, sourceID uint64) (client.SourceCredentialReveal, error) {
	f.cloudRevealCredentialID = sourceID
	return f.cloudCredentialReveal, f.err
}

func (f *fakeDesktopIPCController) CloudTestSourceCredential(_ context.Context, kind string, payload map[string]string) (client.SourceCredentialTestResult, error) {
	f.cloudTestCredentialKind = kind
	f.cloudTestCredentialPayload = maps.Clone(payload)
	return f.cloudCredentialTest, f.err
}

func (f *fakeDesktopIPCController) CloudTestStoredSourceCredential(_ context.Context, sourceID uint64) (client.SourceCredentialTestResult, error) {
	f.cloudTestStoredID = sourceID
	return f.cloudCredentialTest, f.err
}

func (f *fakeDesktopIPCController) CloudPutSourceCredential(_ context.Context, sourceID uint64, payload map[string]string) (client.SourceCredentialStatus, error) {
	f.cloudPutCredentialID = sourceID
	f.cloudPutCredentialPayload = maps.Clone(payload)
	return f.cloudPutCredential, f.err
}

func (f *fakeDesktopIPCController) CloudDeleteSourceCredential(_ context.Context, sourceID uint64) error {
	f.cloudDeleteCredential = sourceID
	return f.err
}

func (f *fakeDesktopIPCController) CloudSourceConnectorConfig(_ context.Context, sourceID uint64) (client.SourceConnectorConfig, error) {
	f.cloudConnectorConfigID = sourceID
	return f.cloudConnectorConfig, f.err
}

func (f *fakeDesktopIPCController) CloudBrowseSourceDirectories(
	_ context.Context,
	sourceID uint64,
	remotePath string,
	limit, offset int,
) (client.SourceBrowsePage, error) {
	f.cloudBrowseSourceID = sourceID
	f.cloudBrowsePath = remotePath
	f.cloudBrowseLimit = limit
	f.cloudBrowseOffset = offset
	return f.cloudSourceBrowse, f.err
}

func (f *fakeDesktopIPCController) CloudPutSourceConnectorConfig(_ context.Context, sourceID, revision uint64, payload map[string]any) (client.SourceConnectorConfig, error) {
	f.cloudPutConnectorID, f.cloudPutConnectorRevision = sourceID, revision
	f.cloudPutConnectorPayload = maps.Clone(payload)
	return f.cloudPutConnectorConfig, f.err
}

func (f *fakeDesktopIPCController) CloudCreateSource(_ context.Context, input client.CreateSourceInput) (client.Source, error) {
	f.cloudCreateInput = input
	return f.cloudCreatedSource, f.err
}

func (f *fakeDesktopIPCController) CloudUpdateSource(_ context.Context, sourceID, revision uint64, input client.UpdateSourceInput) (client.Source, error) {
	f.cloudUpdateID, f.cloudUpdateRevision, f.cloudUpdateInput = sourceID, revision, input
	return f.cloudUpdatedSource, f.err
}

func (f *fakeDesktopIPCController) CloudDeleteSource(_ context.Context, sourceID, revision uint64) error {
	f.cloudDeleteSourceID, f.cloudDeleteSourceRev = sourceID, revision
	return f.err
}

func (f *fakeDesktopIPCController) CloudTriggerSource(_ context.Context, sourceID uint64) (client.Source, error) {
	f.cloudTriggerID = sourceID
	return f.cloudTriggeredSource, f.err
}

func (f *fakeDesktopIPCController) FileAvailability(path string) (mount.FileAvailability, error) {
	f.filePath = path
	state := f.fileState
	if state.Path == "" {
		state.Path = path
	}
	return state, f.err
}

func (f *fakeDesktopIPCController) SetFileAvailability(path, action string) error {
	f.filePath, f.fileAction = path, action
	return f.err
}

func (f *fakeDesktopIPCController) Transfers() (uint64, []transfer.Task) {
	if f.transfers == nil {
		return 1, nil
	}
	return f.transfers.Snapshot()
}

func (f *fakeDesktopIPCController) WaitTransfers(ctx context.Context, after uint64) (uint64, []transfer.Task, bool) {
	if f.transfers == nil {
		return 1, nil, after != 1
	}
	return f.transfers.Wait(ctx, after)
}

func (f *fakeDesktopIPCController) RetryTransfer(ctx context.Context, id string) error {
	if f.transfers == nil {
		return errors.New("transfer manager unavailable")
	}
	return f.transfers.Retry(ctx, id)
}

func (f *fakeDesktopIPCController) Diagnostics(context.Context) diagnostics.Report {
	if len(f.diagnosticReport.Checks) == 0 {
		return diagnostics.NewReport([]diagnostics.Check{{Name: "agent process", Status: diagnostics.Pass, Detail: "test"}})
	}
	return f.diagnosticReport
}

func (f *fakeDesktopIPCController) Reconnect(context.Context) error {
	f.reconnectN++
	return f.err
}

func (f *fakeDesktopIPCController) RepairSyncRoot(context.Context) error {
	f.repairN++
	return f.err
}

func (f *fakeDesktopIPCController) OpenLogs() error {
	f.openLogsN++
	return f.err
}

func (f *fakeDesktopIPCController) Conflicts() []conflictstate.Record {
	return append([]conflictstate.Record(nil), f.items...)
}

func (f *fakeDesktopIPCController) OpenConflict(id string, both bool) error {
	f.openID, f.openBoth = id, both
	return f.err
}

func (f *fakeDesktopIPCController) ResolveConflict(id, choice string) error {
	f.resolveID, f.resolveChoice = id, choice
	return f.err
}

func (f *fakeDesktopIPCController) OpenFolder() error {
	f.openFolderN++
	return f.err
}

func (f *fakeDesktopIPCController) OpenManagedPath(path string, reveal bool) error {
	f.openManagedPath, f.openManagedReveal = path, reveal
	return f.err
}

func desktopIPCRequest(t *testing.T, handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, "http://127.0.0.1"+path, strings.NewReader(body))
	req.RemoteAddr = "127.0.0.1:43210"
	req.Header.Set("Authorization", "Bearer secret")
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	return res
}

func TestDesktopIPCHelloAndShutdown(t *testing.T) {
	ctrl := &fakeDesktopIPCController{revision: 1}
	shutdown := make(chan struct{}, 1)
	handler := newDesktopIPCHandler(ctrl, "secret", func() {
		select {
		case shutdown <- struct{}{}:
		default:
		}
	})

	res := desktopIPCRequest(t, handler, http.MethodGet, "/v1/hello", "")
	if res.Code != http.StatusOK {
		t.Fatalf("hello status=%d body=%s", res.Code, res.Body.String())
	}
	var hello desktopIPCHello
	if err := json.NewDecoder(res.Body).Decode(&hello); err != nil {
		t.Fatal(err)
	}
	if hello.ProtocolMin != desktopIPCProtocolMin || hello.ProtocolMax != desktopIPCProtocolMax {
		t.Fatalf("unexpected protocol range: %+v", hello)
	}
	if hello.DiscoveryVersion != desktopIPCAPIVersion || hello.AgentVersion == "" || hello.PID <= 0 {
		t.Fatalf("unexpected hello: %+v", hello)
	}
	if len(hello.Capabilities) == 0 {
		t.Fatal("hello capabilities are empty")
	}

	res = desktopIPCRequest(t, handler, http.MethodPost, "/v1/lifecycle/shutdown", "")
	if res.Code != http.StatusOK {
		t.Fatalf("shutdown status=%d body=%s", res.Code, res.Body.String())
	}
	select {
	case <-shutdown:
	case <-time.After(time.Second):
		t.Fatal("shutdown callback was not invoked")
	}
}

func TestDesktopIPCRequiresLoopbackAndToken(t *testing.T) {
	ctrl := &fakeDesktopIPCController{revision: 1}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})

	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/v1/status", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("missing token status=%d", res.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "http://127.0.0.1/v1/status", nil)
	req.RemoteAddr = "192.0.2.10:1234"
	req.Header.Set("Authorization", "Bearer secret")
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("non-loopback status=%d", res.Code)
	}
}

func TestDesktopIPCStatusAndEvents(t *testing.T) {
	ctrl := &fakeDesktopIPCController{
		revision: 7,
		snapshot: agentSnapshot{
			Configured:    true,
			Username:      "alice",
			AuthStatus:    "已登录",
			SyncStatus:    "同步正常",
			ConflictCount: 2,
			HasConflict:   true,
			Version:       "test",
			ServerBuild: client.VersionInfo{
				Version: "snapshot-abcdef123456",
				Channel: "master",
				Commit:  "abcdef1234567890",
			},
		},
	}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})

	res := desktopIPCRequest(t, handler, http.MethodGet, "/v1/status", "")
	if res.Code != http.StatusOK {
		t.Fatalf("status code=%d body=%s", res.Code, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "\"revision\":7") ||
		!strings.Contains(res.Body.String(), "\"username\":\"alice\"") ||
		!strings.Contains(res.Body.String(), "\"server_build\":{\"version\":\"snapshot-abcdef123456\"") ||
		!strings.Contains(res.Body.String(), "\"commit\":\"abcdef1234567890\"") {
		t.Fatalf("unexpected status body: %s", res.Body.String())
	}
	if res.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("missing no-store header")
	}

	res = desktopIPCRequest(t, handler, http.MethodGet, "/v1/events?after_revision=6&timeout_ms=10", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"type\":\"status.changed\"") {
		t.Fatalf("event response status=%d body=%s", res.Code, res.Body.String())
	}

	res = desktopIPCRequest(t, handler, http.MethodGet, "/v1/events?after_revision=7&timeout_ms=10", "")
	if res.Code != http.StatusNoContent {
		t.Fatalf("unchanged event status=%d body=%s", res.Code, res.Body.String())
	}
}

func TestDesktopIPCActions(t *testing.T) {
	mountPath := "/tmp/xdrive"
	cache := int64(5 << 30)
	ctrl := &fakeDesktopIPCController{
		revision: 1,
		settings: userconfig.Config{
			CacheLimitBytes: 2 << 30,
			SyncRules:       []userconfig.SyncRule{{Path: "archive", Mode: userconfig.SyncModeExclude}},
		},
		root: "/existing",
		updateState: clientUpdateState{
			Mode:            userconfig.UpdateModeManual,
			Source:          userconfig.UpdateSourceGitHub,
			Status:          clientUpdateStatusAvailable,
			CurrentVersion:  "snapshot-old",
			LatestVersion:   "snapshot-new",
			UpdateAvailable: true,
		},
		fileState: mount.FileAvailability{Path: "/tmp/xdrive/a.txt", Mode: "always-local", Placeholder: true, Pinned: true, InSync: true},
		items:     []conflictstate.Record{{ID: "c1", OriginalPath: "a.txt", ConflictPath: "a-conflict.txt"}},
	}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})

	cases := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodPost, "/v1/auth/login", `{"server":"https://drive.test","username":"alice","password":"pw","mount_path":"/mnt/x"}`},
		{http.MethodPost, "/v1/auth/change-password", `{"current_password":"old","new_password":"new"}`},
		{http.MethodPost, "/v1/auth/logout", ""},
		{http.MethodPost, "/v1/sync/pause", ""},
		{http.MethodPost, "/v1/sync/resume", ""},
		{http.MethodPost, "/v1/sync/now", ""},
		{http.MethodGet, "/v1/settings", ""},
		{http.MethodPatch, "/v1/settings", `{"mount_path":"/tmp/xdrive","cache_limit_bytes":5368709120}`},
		{http.MethodGet, "/v1/update", ""},
		{http.MethodPatch, "/v1/update/settings", `{"mode":"download"}`},
		{http.MethodPatch, "/v1/update/settings", `{"source":"gitlab"}`},
		{http.MethodPost, "/v1/update/check", ""},
		{http.MethodPost, "/v1/update/download", ""},
		{http.MethodPost, "/v1/update/install", ""},
		{http.MethodPost, "/v1/update/cancel", ""},
		{http.MethodPut, "/v1/settings/sync-rule", `{"path":"Projects/Archive","mode":"exclude"}`},
		{http.MethodGet, "/v1/file-availability?path=%2Ftmp%2Fxdrive%2Fa.txt", ""},
		{http.MethodPost, "/v1/file-availability", `{"path":"/tmp/xdrive/a.txt","action":"keep"}`},
		{http.MethodGet, "/v1/conflicts", ""},
		{http.MethodPost, "/v1/conflicts/open", `{"id":"c1","both":true}`},
		{http.MethodPost, "/v1/conflicts/resolve", `{"id":"c1","choice":"server"}`},
		{http.MethodPost, "/v1/open-folder", ""},
		{http.MethodPost, "/v1/open-path", `{"path":"Projects/report.pdf","reveal":true}`},
	}
	for _, tc := range cases {
		res := desktopIPCRequest(t, handler, tc.method, tc.path, tc.body)
		if res.Code != http.StatusOK {
			t.Fatalf("%s %s status=%d body=%s", tc.method, tc.path, res.Code, res.Body.String())
		}
	}

	if ctrl.loginServer != "https://drive.test" || ctrl.loginUsername != "alice" || ctrl.loginPassword != "pw" || ctrl.loginMount != "/mnt/x" {
		t.Fatalf("login args not forwarded")
	}
	if ctrl.currentPass != "old" || ctrl.newPass != "new" || ctrl.logouts != 1 || ctrl.syncs != 1 {
		t.Fatalf("auth/sync actions not forwarded")
	}
	if ctrl.paused == nil || *ctrl.paused {
		t.Fatalf("resume did not leave paused=false")
	}
	if ctrl.updateMount == nil || *ctrl.updateMount != mountPath || ctrl.updateCache == nil || *ctrl.updateCache != cache {
		t.Fatalf("settings update not forwarded: mount=%v cache=%v", ctrl.updateMount, ctrl.updateCache)
	}
	if ctrl.updateMode != userconfig.UpdateModeDownload || ctrl.updateSource != userconfig.UpdateSourceGitLab || ctrl.updateChecks != 1 || ctrl.updateDownloads != 1 || ctrl.updateInstalls != 1 || ctrl.updateCancels != 1 {
		t.Fatalf("update actions not forwarded: mode=%q source=%q check=%d download=%d install=%d cancel=%d",
			ctrl.updateMode, ctrl.updateSource, ctrl.updateChecks, ctrl.updateDownloads, ctrl.updateInstalls, ctrl.updateCancels)
	}
	if ctrl.rulePath != "Projects/Archive" || ctrl.ruleMode != "exclude" {
		t.Fatalf("sync rule not forwarded: path=%q mode=%q", ctrl.rulePath, ctrl.ruleMode)
	}
	if ctrl.filePath != "/tmp/xdrive/a.txt" || ctrl.fileAction != "keep" {
		t.Fatalf("file availability action not forwarded: path=%q action=%q", ctrl.filePath, ctrl.fileAction)
	}
	if ctrl.openID != "c1" || !ctrl.openBoth || ctrl.resolveID != "c1" || ctrl.resolveChoice != "server" || ctrl.openFolderN != 1 {
		t.Fatalf("conflict/folder actions not forwarded")
	}
	if ctrl.openManagedPath != "Projects/report.pdf" || !ctrl.openManagedReveal {
		t.Fatalf("managed path action not forwarded: path=%q reveal=%v", ctrl.openManagedPath, ctrl.openManagedReveal)
	}
}

func TestDesktopIPCRejectsAbsoluteManagedPath(t *testing.T) {
	ctrl := &fakeDesktopIPCController{revision: 1}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})
	absolutePath := "/tmp/outside.txt"
	if filepath.Separator == '\\' {
		absolutePath = `C:\outside.txt`
	}
	res := desktopIPCRequest(t, handler, http.MethodPost, "/v1/open-path", fmt.Sprintf(`{"path":%q}`, absolutePath))
	if res.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
	if ctrl.openManagedPath != "" {
		t.Fatalf("absolute path should not reach controller: %q", ctrl.openManagedPath)
	}
}

func TestDesktopIPCStorageAndCache(t *testing.T) {
	ctrl := &fakeDesktopIPCController{
		revision: 1,
		storageTree: agentStorageTreeNode{
			Name: "xDrive",
			Children: []agentStorageTreeNode{{
				Path: "Projects", Name: "Projects", Mode: "default", EffectiveMode: "default", FileCount: 2, TotalBytes: 30,
			}},
		},
		cacheStats: mount.CacheStats{
			Supported: true, UsedBytes: 100, LimitBytes: 200, ReclaimableBytes: 40, PinnedBytes: 60,
		},
		cacheRelease: mount.CacheReleaseResult{
			Stats:         mount.CacheStats{Supported: true, UsedBytes: 60, LimitBytes: 200, PinnedBytes: 60},
			ReleasedBytes: 40, ReleasedFiles: 2,
		},
	}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})

	res := desktopIPCRequest(t, handler, http.MethodGet, "/v1/storage-tree", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"Projects\"") {
		t.Fatalf("storage tree status=%d body=%s", res.Code, res.Body.String())
	}
	res = desktopIPCRequest(t, handler, http.MethodGet, "/v1/cache", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"reclaimable_bytes\":40") {
		t.Fatalf("cache status=%d body=%s", res.Code, res.Body.String())
	}
	res = desktopIPCRequest(t, handler, http.MethodPost, "/v1/cache/release", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"released_bytes\":40") {
		t.Fatalf("cache release status=%d body=%s", res.Code, res.Body.String())
	}
}

func TestDesktopIPCCloudFiles(t *testing.T) {
	now := time.Now().UTC()
	ctrl := &fakeDesktopIPCController{
		revision:      1,
		cloudRoot:     client.Node{ID: 1, Name: "root", Type: "dir", Revision: 1},
		cloudChildren: []client.Node{{ID: 2, ParentID: ptrUint64(1), Name: "Projects", Type: "dir", Revision: 1}},
		cloudSearch: []agentCloudSearchResult{{
			Node:   client.Node{ID: 3, Name: "report.pdf", Type: "file", Revision: 2},
			Path:   "Projects/report.pdf",
			Crumbs: []agentCloudCrumb{{ID: 1, Name: "My files"}, {ID: 2, Name: "Projects"}},
		}},
		cloudCreatedDir: client.Node{ID: 8, ParentID: ptrUint64(1), Name: "New Folder", Type: "dir", Revision: 1},
		cloudRenamed:    client.Node{ID: 3, ParentID: ptrUint64(2), Name: "renamed.pdf", Type: "file", Revision: 3},
		cloudCopied:     client.Node{ID: 10, ParentID: ptrUint64(8), Name: "report.pdf", Type: "file", Revision: 1},
		cloudMoved:      client.Node{ID: 3, ParentID: ptrUint64(8), Name: "report.pdf", Type: "file", Revision: 3},
		cloudUploaded:   client.Node{ID: 9, ParentID: ptrUint64(2), Name: "upload.txt", Type: "file", Revision: 1},
		cloudQuota:      client.QuotaUsage{QuotaBytes: 1000, PhysicalUsedBytes: 400, AvailableBytes: 600, LogicalFileBytes: 300, TrashBytes: 50, HistoryBytes: 50},
		cloudStorage:    client.StorageStats{Scope: "self", CASBlobCount: 9, CASPhysicalBytes: 400, CASLogicalReferencedBytes: 600, CASDedupSavedBytes: 200, CASDedupRatio: 1.5, P50BlobSizeBytes: 12},
		cloudTrash:      []client.Node{{ID: 4, Name: "old.txt", Type: "file", Revision: 3, DeletedAt: &now}},
		cloudVersions:   []client.FileVersion{{ID: 5, NodeID: 3, Revision: 1, Size: 12, CreatedAt: now}},
		cloudShares:     []client.FileShare{{ID: 6, NodeID: 3, Status: "active"}},
		cloudCreated: agentCreatedShare{
			Share: client.CreatedFileShare{FileShare: client.FileShare{ID: 7, NodeID: 3, Status: "active"}, Token: "token"},
			URL:   "https://drive.example/#/s/token",
		},
		cloudRestored: client.Node{ID: 3, Name: "report.pdf", Type: "file", Revision: 4},
	}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})

	cases := []struct {
		method string
		path   string
		body   string
		want   string
	}{
		{http.MethodGet, "/v1/cloud/root", "", "\"id\":1"},
		{http.MethodGet, "/v1/cloud/children?parent_id=1", "", "\"Projects\""},
		{http.MethodGet, "/v1/cloud/children?parent_id=1&limit=200&sort=name&order=asc", "", "\"next_cursor\":\"next-page\""},
		{http.MethodPost, "/v1/cloud/directories", `{"parent_id":1,"name":"New Folder"}`, "\"New Folder\""},
		{http.MethodPatch, "/v1/cloud/nodes", `{"id":3,"revision":2,"name":"renamed.pdf"}`, "\"renamed.pdf\""},
		{http.MethodPost, "/v1/cloud/copy", `{"id":3,"parent_id":8}`, "\"id\":10"},
		{http.MethodPatch, "/v1/cloud/move", `{"id":3,"revision":2,"parent_id":8}`, "\"parent_id\":8"},
		{http.MethodDelete, "/v1/cloud/nodes", `{"id":3,"revision":2}`, "\"ok\":true"},
		{http.MethodPost, "/v1/cloud/batch/copy", `{"items":[{"id":3,"revision":2}],"parent_id":8}`, "\"operation_id\":\"copy-op\""},
		{http.MethodPost, "/v1/cloud/batch/move", `{"items":[{"id":3,"revision":2}],"parent_id":8}`, "\"operation_id\":\"move-op\""},
		{http.MethodPost, "/v1/cloud/batch/delete", `{"items":[{"id":3,"revision":2}]}`, "\"operation_id\":\"delete-op\""},
		{http.MethodPost, "/v1/cloud/upload", `{"parent_id":2,"local_path":"/tmp/upload.txt","name":"upload.txt"}`, "\"upload.txt\""},
		{http.MethodPost, "/v1/cloud/download", `{"id":3,"destination":"/tmp/report.pdf"}`, "\"ok\":true"},
		{http.MethodGet, "/v1/cloud/search?q=report", "", "\"Projects/report.pdf\""},
		{http.MethodGet, "/v1/cloud/quota", "", "\"available_bytes\":600"},
		{http.MethodGet, "/v1/cloud/storage-stats", "", "\"cas_blob_count\":9"},
		{http.MethodGet, "/v1/cloud/trash", "", "\"old.txt\""},
		{http.MethodPost, "/v1/cloud/trash/restore", `{"id":4,"revision":3}`, "\"revision\":4"},
		{http.MethodPost, "/v1/cloud/trash/delete", `{"id":4,"revision":3}`, "\"ok\":true"},
		{http.MethodGet, "/v1/cloud/versions?node_id=3", "", "\"revision\":1"},
		{http.MethodPost, "/v1/cloud/versions/restore", `{"node_id":3,"current_revision":3,"version_id":5}`, "\"revision\":4"},
		{http.MethodGet, "/v1/cloud/shares?node_id=3", "", "\"status\":\"active\""},
		{http.MethodPost, "/v1/cloud/shares", `{"node_id":3,"password":"password123","max_downloads":2}`, "\"url\":\"https://drive.example/#/s/token\""},
		{http.MethodPost, "/v1/cloud/shares/revoke", `{"id":6}`, "\"ok\":true"},
	}
	for _, tc := range cases {
		res := desktopIPCRequest(t, handler, tc.method, tc.path, tc.body)
		if res.Code < 200 || res.Code >= 300 || !strings.Contains(res.Body.String(), tc.want) {
			t.Fatalf("%s %s status=%d body=%s", tc.method, tc.path, res.Code, res.Body.String())
		}
	}
	if ctrl.cloudDeleteID != 4 || ctrl.cloudDeleteRev != 3 || ctrl.cloudRevokeID != 6 {
		t.Fatalf("cloud mutations not forwarded: delete=%d/%d revoke=%d", ctrl.cloudDeleteID, ctrl.cloudDeleteRev, ctrl.cloudRevokeID)
	}
	if ctrl.cloudCreateParent != 1 || ctrl.cloudCreateName != "New Folder" {
		t.Fatalf("cloud create not forwarded: parent=%d name=%q", ctrl.cloudCreateParent, ctrl.cloudCreateName)
	}
	if ctrl.cloudRenameID != 3 || ctrl.cloudRenameRev != 2 || ctrl.cloudRenameName != "renamed.pdf" {
		t.Fatalf("cloud rename not forwarded: id=%d revision=%d name=%q", ctrl.cloudRenameID, ctrl.cloudRenameRev, ctrl.cloudRenameName)
	}
	if ctrl.cloudCopyID != 3 || ctrl.cloudCopyParent != 8 {
		t.Fatalf("cloud copy not forwarded: id=%d parent=%d", ctrl.cloudCopyID, ctrl.cloudCopyParent)
	}
	if ctrl.cloudMoveID != 3 || ctrl.cloudMoveRev != 2 || ctrl.cloudMoveParent != 8 {
		t.Fatalf("cloud move not forwarded: id=%d revision=%d parent=%d", ctrl.cloudMoveID, ctrl.cloudMoveRev, ctrl.cloudMoveParent)
	}
	if ctrl.cloudMutationDeleteID != 3 || ctrl.cloudMutationDeleteRev != 2 {
		t.Fatalf("cloud delete not forwarded: id=%d revision=%d", ctrl.cloudMutationDeleteID, ctrl.cloudMutationDeleteRev)
	}
	if ctrl.cloudUploadParent != 2 || ctrl.cloudUploadPath != "/tmp/upload.txt" || ctrl.cloudUploadName != "upload.txt" {
		t.Fatalf("cloud upload not forwarded: parent=%d path=%q name=%q", ctrl.cloudUploadParent, ctrl.cloudUploadPath, ctrl.cloudUploadName)
	}
	if ctrl.cloudDownloadID != 3 || ctrl.cloudDownloadDestination != "/tmp/report.pdf" {
		t.Fatalf("cloud download not forwarded: id=%d destination=%q", ctrl.cloudDownloadID, ctrl.cloudDownloadDestination)
	}
}

func TestDesktopIPCMediaGallery(t *testing.T) {
	now := time.Now().UTC()
	ctrl := &fakeDesktopIPCController{
		revision: 1,
		cloudMediaItems: []client.MediaItem{{
			Node: client.Node{ID: 31, Name: "photo.jpg", Type: "file", Revision: 1, Size: 123},
			Metadata: client.MediaMetadata{
				MediaKind: "image", MIMEType: "image/jpeg", Width: 1920, Height: 1080,
				IndexState: "ready", HasThumbnail: true,
			},
		}},
		cloudMediaAlbums: []client.MediaAlbum{{
			ID: "folder:8", Kind: "folder", Name: "Camera Uploads", ItemCount: 1,
			CoverNodeID: ptrUint64(31), UpdatedAt: &now,
		}},
		cloudMediaAlbumItems: []client.MediaItem{{
			Node: client.Node{ID: 31, Name: "photo.jpg", Type: "file", Revision: 1, Size: 123},
			Metadata: client.MediaMetadata{
				MediaKind: "image", MIMEType: "image/jpeg", Width: 1920, Height: 1080,
				IndexState: "ready", HasThumbnail: true,
			},
		}},
		cloudMediaThumbnail: agentMediaThumbnail{
			ContentType: "image/jpeg",
			DataBase64:  "ZmFrZS1qcGVn",
		},
	}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})

	res := desktopIPCRequest(t, handler, http.MethodGet, "/v1/media/items?kind=image&limit=25&offset=5", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"photo.jpg\"") {
		t.Fatalf("media items status=%d body=%s", res.Code, res.Body.String())
	}
	if ctrl.cloudMediaKind != "image" || ctrl.cloudMediaLimit != 25 || ctrl.cloudMediaOffset != 5 {
		t.Fatalf("media item query not forwarded: kind=%q limit=%d offset=%d",
			ctrl.cloudMediaKind, ctrl.cloudMediaLimit, ctrl.cloudMediaOffset)
	}

	res = desktopIPCRequest(t, handler, http.MethodGet, "/v1/media/albums", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"Camera Uploads\"") {
		t.Fatalf("media albums status=%d body=%s", res.Code, res.Body.String())
	}

	res = desktopIPCRequest(t, handler, http.MethodGet, "/v1/media/albums/items?album_id=folder%3A8&limit=40&offset=0", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"photo.jpg\"") {
		t.Fatalf("media album items status=%d body=%s", res.Code, res.Body.String())
	}
	if ctrl.cloudMediaAlbumID != "folder:8" || ctrl.cloudMediaLimit != 40 || ctrl.cloudMediaOffset != 0 {
		t.Fatalf("media album query not forwarded: id=%q limit=%d offset=%d",
			ctrl.cloudMediaAlbumID, ctrl.cloudMediaLimit, ctrl.cloudMediaOffset)
	}

	res = desktopIPCRequest(t, handler, http.MethodGet, "/v1/media/thumbnail?node_id=31", "")
	if res.Code != http.StatusOK ||
		!strings.Contains(res.Body.String(), "\"content_type\":\"image/jpeg\"") ||
		!strings.Contains(res.Body.String(), "\"data_base64\":\"ZmFrZS1qcGVn\"") {
		t.Fatalf("media thumbnail status=%d body=%s", res.Code, res.Body.String())
	}
	if ctrl.cloudMediaThumbnailID != 31 {
		t.Fatalf("media thumbnail id=%d want=31", ctrl.cloudMediaThumbnailID)
	}

	for _, path := range []string{
		"/v1/media/items?kind=audio",
		"/v1/media/items?limit=0",
		"/v1/media/albums/items?album_id=invalid",
		"/v1/media/thumbnail?node_id=0",
	} {
		res = desktopIPCRequest(t, handler, http.MethodGet, path, "")
		if res.Code != http.StatusBadRequest {
			t.Fatalf("invalid media query %s status=%d body=%s", path, res.Code, res.Body.String())
		}
	}
}

func TestDesktopIPCExternalSources(t *testing.T) {
	now := time.Now().UTC()
	ctrl := &fakeDesktopIPCController{
		revision: 1,
		cloudSources: []client.Source{{
			ID: 9, Name: "一刻相册", Kind: "yike_photos", Direction: "pull",
			SyncMode: "backup", RunMode: "scan", Status: "active", Revision: 3,
		}},
		cloudSourceRuns: []client.SyncRun{{
			ID: "run-1", SourceID: 9, Mode: "scan", Trigger: "manual",
			Status: "completed", ScannedItems: 12, ScannedBytes: 34, StartedAt: now,
		}},
		cloudSourceRunFailures: []client.SourceRunFailure{{
			ID: 7, SourceItemID: 1, ExternalID: "yike:123:2", Kind: "file",
			Path: "Library/fail.jpg [2]", Size: 20, Error: "download unavailable", FailedAt: now,
		}},
		cloudCancelledRun: client.SyncRun{
			ID: "run-live", SourceID: 9, Mode: "sync", Trigger: "manual",
			Status: "running", ScannedItems: 20, PlannedTransferBytes: 100,
			CancelRequestedAt: &now, StartedAt: now,
		},
		cloudSourceItems: []client.SourceItem{{
			SourceItemID: 1, ExternalID: "yike:123:2", Kind: "file",
			Path: "Library/fail.jpg [2]", Size: 20, State: "error", LastError: "download unavailable",
		}},
		cloudSourceCollections: []client.SourceCollection{{
			ID: 21, ExternalID: "yike:album:family", Kind: "album", Name: "家庭",
			State: "active", ItemCount: 1, LastSeenAt: now, CreatedAt: now, UpdatedAt: now,
		}},
		cloudSourceCollectionItems: []client.SourceCollectionItem{{
			Position: 0, SourceItemID: 2, ExternalID: "yike:123:3", Kind: "file",
			Path: "family.jpg", Size: 30, State: "synced",
			Metadata: &client.SourceItemMetadata{CapturedAt: &now, OriginalPath: "/youa/web/family.jpg"},
		}},
		cloudSourceCredential: client.SourceCredentialStatus{Configured: true, KeyVersion: 2, UpdatedAt: &now},
		cloudCredentialReveal: client.SourceCredentialReveal{Field: "cookie", Value: "BDUSS=revealed", ExpiresInSeconds: 30},
		cloudCredentialTest: client.SourceCredentialTestResult{
			Valid: true, Kind: "yike_photos", AccountExternalID: "12345", AccountName: "Test User",
		},
		cloudPutCredential: client.SourceCredentialStatus{Configured: true, KeyVersion: 3, UpdatedAt: &now},
		cloudConnectorConfig: client.SourceConnectorConfig{
			Configured: true, Revision: 2, Payload: json.RawMessage(`{"spaces":["personal","shared"]}`),
		},
		cloudPutConnectorConfig: client.SourceConnectorConfig{
			Configured: true, Revision: 3, Payload: json.RawMessage(`{"spaces":["personal"]}`),
		},
		cloudSourceBrowse: client.SourceBrowsePage{
			Path:       "/documents",
			Items:      []client.SourceBrowseDirectory{{Name: "Projects", Path: "/documents/Projects"}},
			Total:      4,
			NextOffset: ptrInt(2),
		},
		cloudCreatedSource:   client.Source{ID: 10, Name: "群晖 Photos", Kind: "synology_photos", Direction: "push", SyncMode: "backup", RunMode: "scan", Status: "active", Revision: 1},
		cloudUpdatedSource:   client.Source{ID: 9, Name: "一刻相册", Kind: "yike_photos", Direction: "pull", SyncMode: "backup", RunMode: "sync", Status: "active", Revision: 4},
		cloudTriggeredSource: client.Source{ID: 9, Name: "一刻相册", Kind: "yike_photos", Direction: "pull", SyncMode: "backup", RunMode: "sync", Status: "active", Revision: 4, RunRequestedAt: &now},
	}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})

	cases := []struct {
		path string
		want string
	}{
		{"/v1/sources", "\"一刻相册\""},
		{"/v1/sources/runs?source_id=9&limit=5", "\"scanned_items\":12"},
		{"/v1/sources/runs/failures?source_id=9&run_id=run-1&limit=20&offset=0", "\"error\":\"download unavailable\""},
		{"/v1/sources/items?source_id=9&state=error&limit=1000&offset=0", "\"last_error\":\"download unavailable\""},
		{"/v1/sources/collections?source_id=9&state=active", "\"name\":\"家庭\""},
		{"/v1/sources/collections/items?source_id=9&collection_id=21&limit=50&offset=0", "\"path\":\"family.jpg\""},
		{"/v1/sources/credential?source_id=9", "\"configured\":true"},
		{"/v1/sources/connector-config?source_id=9", "\"spaces\":[\"personal\",\"shared\"]"},
		{"/v1/sources/browse?source_id=9&path=%2Fdocuments&limit=2&offset=0", "\"path\":\"/documents\""},
	}
	for _, tc := range cases {
		res := desktopIPCRequest(t, handler, http.MethodGet, tc.path, "")
		if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), tc.want) {
			t.Fatalf("GET %s status=%d body=%s", tc.path, res.Code, res.Body.String())
		}
	}

	if ctrl.cloudBrowseSourceID != 9 || ctrl.cloudBrowsePath != "/documents" || ctrl.cloudBrowseLimit != 2 || ctrl.cloudBrowseOffset != 0 {
		t.Fatalf("browse query not forwarded: source=%d path=%q limit=%d offset=%d",
			ctrl.cloudBrowseSourceID, ctrl.cloudBrowsePath, ctrl.cloudBrowseLimit, ctrl.cloudBrowseOffset)
	}

	for _, path := range []string{
		"/v1/sources/runs?source_id=0",
		"/v1/sources/runs?source_id=9&limit=201",
		"/v1/sources/runs/failures?source_id=0&run_id=run-1",
		"/v1/sources/runs/failures?source_id=9&run_id=",
		"/v1/sources/runs/failures?source_id=9&run_id=run-1&limit=1001",
		"/v1/sources/runs/failures?source_id=9&run_id=run-1&offset=-1",
		"/v1/sources/items?source_id=0",
		"/v1/sources/items?source_id=9&limit=1001",
		"/v1/sources/items?source_id=9&offset=-1",
		"/v1/sources/collections?source_id=0",
		"/v1/sources/collections?source_id=9&state=invalid",
		"/v1/sources/collections/items?source_id=9&collection_id=0",
		"/v1/sources/collections/items?source_id=9&collection_id=21&limit=1001",
		"/v1/sources/collections/items?source_id=9&collection_id=21&offset=-1",
		"/v1/sources/credential?source_id=bad",
		"/v1/sources/connector-config?source_id=bad",
		"/v1/sources/browse?source_id=0",
		"/v1/sources/browse?source_id=9&limit=1001",
		"/v1/sources/browse?source_id=9&offset=-1",
	} {
		res := desktopIPCRequest(t, handler, http.MethodGet, path, "")
		if res.Code != http.StatusBadRequest {
			t.Fatalf("GET %s status=%d body=%s", path, res.Code, res.Body.String())
		}
	}

	res := desktopIPCRequest(t, handler, http.MethodPost, "/v1/sources/runs/cancel", `{"source_id":9,"run_id":"run-live"}`)
	if res.Code != http.StatusAccepted || !strings.Contains(res.Body.String(), "\"cancel_requested_at\"") {
		t.Fatalf("cancel source run status=%d body=%s", res.Code, res.Body.String())
	}
	if ctrl.cloudCancelSourceID != 9 || ctrl.cloudCancelRunID != "run-live" {
		t.Fatalf("cancel source run not forwarded: source=%d run=%q", ctrl.cloudCancelSourceID, ctrl.cloudCancelRunID)
	}
	badCancel := desktopIPCRequest(t, handler, http.MethodPost, "/v1/sources/runs/cancel", `{"source_id":0,"run_id":""}`)
	if badCancel.Code != http.StatusBadRequest {
		t.Fatalf("invalid cancel status=%d body=%s", badCancel.Code, badCancel.Body.String())
	}

	res = desktopIPCRequest(t, handler, http.MethodPost, "/v1/source-credentials/test", `{"kind":"yike_photos","cookie":"  BDUSS=ephemeral  "}`)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"account_external_id\":\"12345\"") {
		t.Fatalf("test credential status=%d body=%s", res.Code, res.Body.String())
	}
	if ctrl.cloudTestCredentialKind != "yike_photos" || ctrl.cloudTestCredentialPayload["cookie"] != "BDUSS=ephemeral" {
		t.Fatalf("credential test not forwarded safely: kind=%q payload=%v", ctrl.cloudTestCredentialKind, ctrl.cloudTestCredentialPayload)
	}
	res = desktopIPCRequest(t, handler, http.MethodPost, "/v1/sources/credential/test", `{"source_id":9}`)
	if res.Code != http.StatusOK || ctrl.cloudTestStoredID != 9 {
		t.Fatalf("test stored credential status=%d body=%s id=%d", res.Code, res.Body.String(), ctrl.cloudTestStoredID)
	}

	res = desktopIPCRequest(t, handler, http.MethodPost, "/v1/sources/credential/reveal", `{"source_id":9}`)
	if res.Code != http.StatusOK || ctrl.cloudRevealCredentialID != 9 ||
		!strings.Contains(res.Body.String(), `"field":"cookie"`) ||
		!strings.Contains(res.Body.String(), `"value":"BDUSS=revealed"`) ||
		!strings.Contains(res.Body.String(), `"expires_in_seconds":30`) {
		t.Fatalf("reveal stored credential status=%d body=%s id=%d", res.Code, res.Body.String(), ctrl.cloudRevealCredentialID)
	}

	res = desktopIPCRequest(t, handler, http.MethodPut, "/v1/sources/credential", `{"source_id":9,"cookie":"  BDUSS=secret; STOKEN=secret  "}`)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"key_version\":3") {
		t.Fatalf("put credential status=%d body=%s", res.Code, res.Body.String())
	}
	if ctrl.cloudPutCredentialID != 9 || ctrl.cloudPutCredentialPayload["cookie"] != "BDUSS=secret; STOKEN=secret" {
		t.Fatalf("credential not forwarded safely: id=%d payload=%v", ctrl.cloudPutCredentialID, ctrl.cloudPutCredentialPayload)
	}

	res = desktopIPCRequest(t, handler, http.MethodDelete, "/v1/sources/credential", `{"source_id":9}`)
	if res.Code != http.StatusOK || ctrl.cloudDeleteCredential != 9 || !strings.Contains(res.Body.String(), "\"ok\":true") {
		t.Fatalf("delete credential status=%d body=%s id=%d", res.Code, res.Body.String(), ctrl.cloudDeleteCredential)
	}

	res = desktopIPCRequest(t, handler, http.MethodPut, "/v1/sources/connector-config",
		`{"source_id":9,"revision":2,"payload":{"spaces":["personal"]}}`)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"revision\":3") {
		t.Fatalf("put connector config status=%d body=%s", res.Code, res.Body.String())
	}
	spaces, ok := ctrl.cloudPutConnectorPayload["spaces"].([]any)
	if ctrl.cloudConnectorConfigID != 9 || ctrl.cloudPutConnectorID != 9 || ctrl.cloudPutConnectorRevision != 2 ||
		!ok || len(spaces) != 1 || spaces[0] != "personal" {
		t.Fatalf("connector config not forwarded: getID=%d putID=%d revision=%d payload=%v",
			ctrl.cloudConnectorConfigID, ctrl.cloudPutConnectorID, ctrl.cloudPutConnectorRevision, ctrl.cloudPutConnectorPayload)
	}

	res = desktopIPCRequest(t, handler, http.MethodPost, "/v1/sources/credential/reveal", `{"source_id":0}`)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("invalid reveal credential status=%d body=%s", res.Code, res.Body.String())
	}

	for _, tc := range []struct {
		method string
		body   string
	}{
		{http.MethodPut, `{"source_id":0,"cookie":"x"}`},
		{http.MethodPut, `{"source_id":9,"cookie":"   "}`},
		{http.MethodDelete, `{"source_id":0}`},
	} {
		res = desktopIPCRequest(t, handler, tc.method, "/v1/sources/credential", tc.body)
		if res.Code != http.StatusBadRequest {
			t.Fatalf("%s invalid credential status=%d body=%s", tc.method, res.Code, res.Body.String())
		}
	}

	res = desktopIPCRequest(t, handler, http.MethodPost, "/v1/sources",
		`{"name":"群晖 Photos","kind":"synology_photos","direction":"push","sync_mode":"backup","run_mode":"scan","schedule_type":"cron","schedule_expression":"0 3 * * *","schedule_timezone":"Asia/Shanghai","target_node_id":7}`)
	if res.Code != http.StatusCreated || !strings.Contains(res.Body.String(), "\"id\":10") {
		t.Fatalf("create source status=%d body=%s", res.Code, res.Body.String())
	}
	if ctrl.cloudCreateInput.Name != "群晖 Photos" || ctrl.cloudCreateInput.TargetNodeID != 7 ||
		ctrl.cloudCreateInput.ScheduleType != "cron" || ctrl.cloudCreateInput.ScheduleExpression != "0 3 * * *" ||
		ctrl.cloudCreateInput.ScheduleTimezone != "Asia/Shanghai" {
		t.Fatalf("create input not forwarded: %+v", ctrl.cloudCreateInput)
	}

	res = desktopIPCRequest(t, handler, http.MethodPatch, "/v1/sources",
		`{"source_id":9,"revision":3,"update":{"run_mode":"sync","status":"active","schedule_type":"interval","schedule_expression":"12h","schedule_timezone":""}}`)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"revision\":4") {
		t.Fatalf("update source status=%d body=%s", res.Code, res.Body.String())
	}
	if ctrl.cloudUpdateID != 9 || ctrl.cloudUpdateRevision != 3 || ctrl.cloudUpdateInput.RunMode == nil || *ctrl.cloudUpdateInput.RunMode != "sync" ||
		ctrl.cloudUpdateInput.ScheduleType == nil || *ctrl.cloudUpdateInput.ScheduleType != "interval" ||
		ctrl.cloudUpdateInput.ScheduleExpression == nil || *ctrl.cloudUpdateInput.ScheduleExpression != "12h" {
		t.Fatalf("update input not forwarded: id=%d revision=%d input=%+v", ctrl.cloudUpdateID, ctrl.cloudUpdateRevision, ctrl.cloudUpdateInput)
	}

	res = desktopIPCRequest(t, handler, http.MethodDelete, "/v1/sources", `{"source_id":9,"revision":4}`)
	if res.Code != http.StatusOK || ctrl.cloudDeleteSourceID != 9 || ctrl.cloudDeleteSourceRev != 4 ||
		!strings.Contains(res.Body.String(), "\"ok\":true") {
		t.Fatalf("delete source status=%d body=%s id=%d revision=%d", res.Code, res.Body.String(), ctrl.cloudDeleteSourceID, ctrl.cloudDeleteSourceRev)
	}

	res = desktopIPCRequest(t, handler, http.MethodPost, "/v1/sources/trigger", `{"source_id":9}`)
	if res.Code != http.StatusAccepted || ctrl.cloudTriggerID != 9 || !strings.Contains(res.Body.String(), "run_requested_at") {
		t.Fatalf("trigger source status=%d body=%s id=%d", res.Code, res.Body.String(), ctrl.cloudTriggerID)
	}

	for _, tc := range []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodPatch, "/v1/sources", `{"source_id":0,"revision":1,"update":{}}`},
		{http.MethodPatch, "/v1/sources", `{"source_id":9,"revision":0,"update":{}}`},
		{http.MethodDelete, "/v1/sources", `{"source_id":9,"revision":0}`},
		{http.MethodPost, "/v1/sources/trigger", `{"source_id":0}`},
	} {
		res = desktopIPCRequest(t, handler, tc.method, tc.path, tc.body)
		if res.Code != http.StatusBadRequest {
			t.Fatalf("%s %s status=%d body=%s", tc.method, tc.path, res.Code, res.Body.String())
		}
	}
}

func ptrUint64(value uint64) *uint64 { return &value }
func ptrInt(value int) *int          { return &value }

func TestDesktopIPCTransfers(t *testing.T) {
	manager := transfer.NewManager(10)
	task := manager.Start(transfer.Spec{
		FileName:   "demo.bin",
		Path:       "docs/demo.bin",
		Kind:       transfer.KindUpload,
		Direction:  "upload",
		TotalBytes: 100,
		Retry:      func(context.Context) error { return nil },
	})
	task.Progress(40, 100)
	task.Fail(errors.New("network down"))

	ctrl := &fakeDesktopIPCController{revision: 1, transfers: manager}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})

	res := desktopIPCRequest(t, handler, http.MethodGet, "/v1/transfers", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"file_name\":\"demo.bin\"") {
		t.Fatalf("transfers status=%d body=%s", res.Code, res.Body.String())
	}
	var snapshot desktopIPCTransfers
	if err := json.NewDecoder(res.Body).Decode(&snapshot); err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Transfers) != 1 || snapshot.Transfers[0].State != transfer.StateFailed {
		t.Fatalf("unexpected transfer snapshot: %+v", snapshot)
	}

	res = desktopIPCRequest(t, handler, http.MethodGet, "/v1/transfer-events?after_revision=1&timeout_ms=10", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"type\":\"transfers.changed\"") {
		t.Fatalf("transfer event status=%d body=%s", res.Code, res.Body.String())
	}

	res = desktopIPCRequest(t, handler, http.MethodPost, "/v1/transfers/retry", `{"id":"`+task.ID()+`"}`)
	if res.Code != http.StatusOK {
		t.Fatalf("retry status=%d body=%s", res.Code, res.Body.String())
	}
	_, items := manager.Snapshot()
	if len(items) != 1 || items[0].State != transfer.StateCompleted || items[0].RetryCount != 1 {
		t.Fatalf("unexpected retried transfer: %+v", items)
	}
}

func TestDesktopIPCDiagnostics(t *testing.T) {
	ctrl := &fakeDesktopIPCController{
		revision: 1,
		diagnosticReport: diagnostics.NewReport([]diagnostics.Check{
			{Name: "server health", Status: diagnostics.Pass, Detail: "HTTP 200"},
		}),
	}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})

	res := desktopIPCRequest(t, handler, http.MethodGet, "/v1/diagnostics", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"server health\"") {
		t.Fatalf("diagnostics status=%d body=%s", res.Code, res.Body.String())
	}

	res = desktopIPCRequest(t, handler, http.MethodGet, "/v1/diagnostics/report", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "xDrive diagnostic report") {
		t.Fatalf("diagnostic report status=%d body=%s", res.Code, res.Body.String())
	}

	for _, path := range []string{
		"/v1/diagnostics/reconnect",
		"/v1/diagnostics/repair-sync-root",
		"/v1/diagnostics/open-logs",
	} {
		res = desktopIPCRequest(t, handler, http.MethodPost, path, "")
		if res.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", path, res.Code, res.Body.String())
		}
	}
	if ctrl.reconnectN != 1 || ctrl.repairN != 1 || ctrl.openLogsN != 1 {
		t.Fatalf("diagnostic actions not forwarded: reconnect=%d repair=%d logs=%d", ctrl.reconnectN, ctrl.repairN, ctrl.openLogsN)
	}
}

func TestDesktopIPCRejectsUnknownJSONFields(t *testing.T) {
	ctrl := &fakeDesktopIPCController{revision: 1}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})
	res := desktopIPCRequest(t, handler, http.MethodPost, "/v1/auth/login", `{"server":"x","username":"u","password":"p","unexpected":true}`)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
}

func TestAgentSnapshotRevisionAndWait(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctrl := newAgentController(ctx, cancel)
	_, revision := ctrl.SnapshotWithRevision()

	ctrl.setSnapshot(func(s *agentSnapshot) {})
	_, same := ctrl.SnapshotWithRevision()
	if same != revision {
		t.Fatalf("no-op snapshot changed revision: %d -> %d", revision, same)
	}

	result := make(chan uint64, 1)
	go func() {
		waitCtx, waitCancel := context.WithTimeout(context.Background(), time.Second)
		defer waitCancel()
		_, next, changed := ctrl.WaitSnapshot(waitCtx, revision)
		if changed {
			result <- next
			return
		}
		result <- 0
	}()
	ctrl.setSnapshot(func(s *agentSnapshot) { s.SyncStatus = "changed" })
	if next := <-result; next <= revision {
		t.Fatalf("wait did not observe revision change: old=%d next=%d", revision, next)
	}
}

func TestDesktopIPCDiscoveryFileOwnership(t *testing.T) {
	dir := t.TempDir()
	path, err := writeDesktopIPCDiscovery(dir, desktopIPCDiscovery{
		Version: 1,
		BaseURL: "http://127.0.0.1:12345",
		Token:   "owner-token",
		PID:     42,
	})
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var discovery desktopIPCDiscovery
	if err := json.NewDecoder(bytes.NewReader(data)).Decode(&discovery); err != nil {
		t.Fatal(err)
	}
	if discovery.Token != "owner-token" || discovery.Version != 1 {
		t.Fatalf("unexpected discovery: %+v", discovery)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("discovery permissions=%o", info.Mode().Perm())
		}
	}

	removeDesktopIPCDiscoveryIfOwned(path, "other-token")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("foreign owner removed discovery: %v", err)
	}
	removeDesktopIPCDiscoveryIfOwned(path, "owner-token")
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("owned discovery still exists: %v", err)
	}
}

func TestDesktopIPCTranslatesStorage507Errors(t *testing.T) {
	tests := []struct {
		code string
		want string
	}{
		{code: "quota_exceeded", want: "用户存储配额不足"},
		{code: "storage_capacity_exceeded", want: "服务器存储空间不足"},
	}
	for _, tc := range tests {
		t.Run(tc.code, func(t *testing.T) {
			ctrl := &fakeDesktopIPCController{
				revision: 1,
				err:      &client.APIError{Status: http.StatusInsufficientStorage, Msg: tc.code},
			}
			handler := newDesktopIPCHandler(ctrl, "secret", func() {})
			res := desktopIPCRequest(t, handler, http.MethodGet, "/v1/cloud/quota", "")
			if res.Code != http.StatusInsufficientStorage ||
				!strings.Contains(res.Body.String(), `"error":"`+tc.code+`"`) ||
				!strings.Contains(res.Body.String(), tc.want) {
				t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
			}
		})
	}
}

func TestDesktopIPCPreservesAPIDetail(t *testing.T) {
	ctrl := &fakeDesktopIPCController{
		revision: 1,
		err: &client.APIError{
			Status: http.StatusBadGateway,
			Msg:    "synology_tls_unknown_authority",
			Detail: "DSM HTTPS 证书不受 xDrive Server 信任。",
		},
	}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})
	res := desktopIPCRequest(t, handler, http.MethodGet, "/v1/cloud/quota", "")
	if res.Code != http.StatusBadGateway ||
		!strings.Contains(res.Body.String(), `"error":"synology_tls_unknown_authority"`) ||
		!strings.Contains(res.Body.String(), `"detail":"DSM HTTPS 证书不受 xDrive Server 信任。"`) {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
}
