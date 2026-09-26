package yikeworker_test

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/api"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourcecredential"
	"github.com/lazyxu/xdrive/internal/storage"
	"github.com/lazyxu/xdrive/internal/yike"
	"github.com/lazyxu/xdrive/internal/yikesync"
	"github.com/lazyxu/xdrive/internal/yikeworker"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type integrationRemote struct {
	files         []yike.File
	albums        []yike.Album
	albumFiles    map[string][]yike.AlbumFile
	payloads      map[int64][]byte
	linkErrors    map[int64]error
	downloadOpens int
}

func (r *integrationRemote) UserInfo(context.Context) (yike.UserInfo, error) {
	return yike.UserInfo{YouaID: "123"}, nil
}

func (r *integrationRemote) ListFilesPage(_ context.Context, cursor string) (yike.FileList, error) {
	if cursor != "" {
		return yike.FileList{}, fmt.Errorf("unexpected root cursor %q", cursor)
	}
	return yike.FileList{Page: yike.Page{HasMore: 0}, List: append([]yike.File(nil), r.files...)}, nil
}

func (r *integrationRemote) ListAlbumsPage(_ context.Context, cursor string) (yike.AlbumList, error) {
	if cursor != "" {
		return yike.AlbumList{}, fmt.Errorf("unexpected album cursor %q", cursor)
	}
	return yike.AlbumList{Page: yike.Page{HasMore: 0}, List: append([]yike.Album(nil), r.albums...)}, nil
}

func (r *integrationRemote) ListAlbumFilesPage(_ context.Context, albumID, cursor string) (yike.AlbumFileList, error) {
	if cursor != "" {
		return yike.AlbumFileList{}, fmt.Errorf("unexpected album-file cursor %q", cursor)
	}
	return yike.AlbumFileList{
		Page: yike.Page{HasMore: 0},
		List: append([]yike.AlbumFile(nil), r.albumFiles[albumID]...),
	}, nil
}

func (r *integrationRemote) DownloadFileLink(_ context.Context, fsid int64) (yike.DownloadLink, error) {
	if _, ok := r.payloads[fsid]; !ok {
		return yike.DownloadLink{}, fmt.Errorf("missing payload for fsid %d", fsid)
	}
	return yike.DownloadLink{URL: strconv.FormatInt(fsid, 10)}, nil
}

func (r *integrationRemote) DownloadAlbumFileLink(_ context.Context, _ int64, file yike.AlbumFile) (yike.DownloadLink, error) {
	if err := r.linkErrors[file.FSID]; err != nil {
		return yike.DownloadLink{}, err
	}
	if _, ok := r.payloads[file.FSID]; !ok {
		return yike.DownloadLink{}, fmt.Errorf("missing shared payload for fsid %d", file.FSID)
	}
	return yike.DownloadLink{URL: strconv.FormatInt(file.FSID, 10)}, nil
}

func (r *integrationRemote) OpenDownload(_ context.Context, link yike.DownloadLink, offset int64) (io.ReadCloser, error) {
	fsid, err := strconv.ParseInt(link.URL, 10, 64)
	if err != nil {
		return nil, err
	}
	data, ok := r.payloads[fsid]
	if !ok {
		return nil, fmt.Errorf("missing download payload for fsid %d", fsid)
	}
	if offset < 0 || offset > int64(len(data)) {
		return nil, fmt.Errorf("invalid offset %d for fsid %d", offset, fsid)
	}
	r.downloadOpens++
	return io.NopCloser(bytes.NewReader(data[offset:])), nil
}

func TestRunnerScansSyncsEncryptedYikeCredentialAndMarksMissing(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "yike_worker_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = baseDB.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error
	}()

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.ContentBlob{},
		&meta.UploadSession{}, &meta.UploadPart{},
		&meta.Source{}, &meta.SourceItem{}, &meta.SyncRun{}, &meta.SourceCredential{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_sources_owner_name ON xd_sources(owner_id, lower(name))`).Error; err != nil {
		t.Fatal(err)
	}

	owner := meta.User{
		Username: "yike-owner", PasswordHash: "not-used",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "Yike Photos", Kind: yikesync.SourceKind,
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &root.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	keyring, err := connectorsecret.NewKeyring(1, map[uint32]string{
		1: strings.Repeat("11", 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := sourcecredential.Put(context.Background(), db, keyring, source,
		[]byte(`{"cookie":"BDUSS=integration-cookie"}`)); err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	jwtSecret := "yike-worker-integration-secret-that-is-long-enough"
	authManager := auth.New(jwtSecret, time.Hour)
	apiServer := &api.Server{
		DB: db, Store: store,
		Auth: authManager, RefreshTTL: time.Hour,
		AllowedOrigin: "http://localhost", MaxUploadBytes: 32 << 20,
	}
	httpServer := httptest.NewServer(apiServer.Router())
	defer httpServer.Close()

	rootPayload := bytes.Repeat([]byte("r"), 100)
	sharedPayload := bytes.Repeat([]byte("s"), 200)
	remote := &integrationRemote{
		files: []yike.File{
			{FSID: 1, Path: "/root.jpg", Size: int64(len(rootPayload)), MTime: 1000, MD5: "aaaa"},
		},
		albums: []yike.Album{{AlbumID: "shared", Title: "Shared"}},
		albumFiles: map[string][]yike.AlbumFile{
			"shared": {
				{File: yike.File{FSID: 1, Path: "/root.jpg", Size: int64(len(rootPayload)), MTime: 1000, MD5: "aaaa"}, AlbumID: "shared", UK: 123},
				{File: yike.File{FSID: 2, Path: "/shared.jpg", Size: int64(len(sharedPayload)), MTime: 2000}, AlbumID: "shared", TID: 7, UK: 999},
			},
		},
		payloads:   map[int64][]byte{1: rootPayload, 2: sharedPayload},
		linkErrors: map[int64]error{},
	}
	runner := &yikeworker.Runner{
		DB: db, Keyring: keyring, ServerURL: httpServer.URL, JWTSecret: jwtSecret,
		RemoteFactory: func(cookie string) (yikesync.Remote, error) {
			if cookie != "BDUSS=integration-cookie" {
				return nil, fmt.Errorf("unexpected cookie %q", cookie)
			}
			return remote, nil
		},
	}

	// Phase 1: scan-only must discover/plan without opening media.
	scanRun, scanResult, err := runner.RunSource(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	if scanRun.Status != meta.SyncRunStatusCompleted ||
		scanRun.ScannedItems != 2 || scanRun.NewItems != 2 || scanRun.PlannedTransferBytes != 300 {
		t.Fatalf("unexpected scan run: %+v result=%+v", scanRun, scanResult)
	}
	if remote.downloadOpens != 0 {
		t.Fatalf("scan-only opened media %d times", remote.downloadOpens)
	}
	if scanResult.DuplicateMemberships != 1 || scanResult.SharedItems != 1 {
		t.Fatalf("unexpected scan discovery result: %+v", scanResult)
	}

	var refreshedSource meta.Source
	if err := db.First(&refreshedSource, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshedSource.LastRunAt == nil {
		t.Fatal("source last_run_at was not updated")
	}
	notDue, err := runner.RunDue(context.Background(), refreshedSource.LastRunAt.Add(time.Minute), 6*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if notDue.Eligible != 0 {
		t.Fatalf("recent source was unexpectedly due: %+v", notDue)
	}

	// Phase 2: switch to sync. A shared direct-link failure must produce a
	// partial run without blocking the account-owned root item.
	if err := db.Model(&meta.Source{}).Where("id = ?", source.ID).
		Update("run_mode", meta.SourceRunModeSync).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&source, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	remote.linkErrors[2] = fmt.Errorf("shared direct link unavailable")
	partialRun, partialResult, err := runner.RunSource(context.Background(), source)
	if err == nil {
		t.Fatal("shared direct-link failure unexpectedly completed")
	}
	if partialRun.Status != meta.SyncRunStatusPartial || partialRun.CreatedItems != 1 ||
		partialRun.TransferredItems != 1 || partialRun.TransferredBytes != 100 ||
		partialRun.FailedItems < 1 || len(partialResult.Errors) != 1 {
		t.Fatalf("unexpected partial run: %+v result=%+v err=%v", partialRun, partialResult, err)
	}
	if remote.downloadOpens != 1 {
		t.Fatalf("partial sync opened media %d times want=1", remote.downloadOpens)
	}
	delete(remote.linkErrors, 2)

	token, err := authManager.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	cli := client.New(httpServer.URL, token)
	nodes, err := cli.Walk(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	rootNode, ok := nodes["Library/root.jpg [1]"]
	if !ok {
		t.Fatalf("root media node missing after partial sync: %+v", nodes)
	}
	if _, exists := nodes["Shared/999/shared.jpg [2]"]; exists {
		t.Fatalf("failed shared item unexpectedly materialized: %+v", nodes)
	}

	// Retry after direct-link recovery. Root is unchanged; only shared media is pulled.
	syncRun, syncResult, err := runner.RunSource(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	if syncRun.Status != meta.SyncRunStatusCompleted ||
		syncRun.CreatedItems != 1 || syncRun.TransferredItems != 1 || syncRun.TransferredBytes != 200 {
		t.Fatalf("unexpected recovery sync run: %+v result=%+v", syncRun, syncResult)
	}
	if remote.downloadOpens != 2 {
		t.Fatalf("recovery sync opened media %d times want=2 total", remote.downloadOpens)
	}

	var items []meta.SourceItem
	if err := db.Where("source_id = ?", source.ID).Order("external_id ASC").Find(&items).Error; err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("source items=%d want=2: %+v", len(items), items)
	}
	for _, item := range items {
		if item.State != meta.SourceItemStateSynced || item.NodeID == nil || item.NodeRevision == 0 || item.SHA256 == "" {
			t.Fatalf("source item was not committed: %+v", item)
		}
	}

	nodes, err = cli.Walk(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	rootNode = nodes["Library/root.jpg [1]"]
	sharedNode, ok := nodes["Shared/999/shared.jpg [2]"]
	if !ok {
		t.Fatalf("shared media node missing after recovery: %+v", nodes)
	}
	if got := downloadNode(t, cli, rootNode.ID); !bytes.Equal(got, rootPayload) {
		t.Fatalf("root content length=%d", len(got))
	}
	if got := downloadNode(t, cli, sharedNode.ID); !bytes.Equal(got, sharedPayload) {
		t.Fatalf("shared content length=%d", len(got))
	}
	sharedNodeID := sharedNode.ID

	// Phase 3: source disappearance becomes missing but does not delete xDrive.
	remote.albumFiles["shared"] = []yike.AlbumFile{
		{File: yike.File{FSID: 1, Path: "/root.jpg", Size: int64(len(rootPayload)), MTime: 1000, MD5: "aaaa"}, AlbumID: "shared", UK: 123},
	}
	missingRun, _, err := runner.RunSource(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	if missingRun.Status != meta.SyncRunStatusCompleted || missingRun.MissingItems != 1 ||
		missingRun.TransferredItems != 0 || missingRun.TransferredBytes != 0 {
		t.Fatalf("unexpected missing run: %+v", missingRun)
	}
	var missing meta.SourceItem
	if err := db.Where("source_id = ? AND external_id = ?", source.ID, "yike:999:2").First(&missing).Error; err != nil {
		t.Fatal(err)
	}
	if missing.State != meta.SourceItemStateMissing || missing.NodeID == nil || *missing.NodeID != sharedNodeID {
		t.Fatalf("unexpected missing item: %+v", missing)
	}
	nodes, err = cli.Walk(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if node, ok := nodes["Shared/999/shared.jpg [2]"]; !ok || node.ID != sharedNodeID {
		t.Fatalf("source-side deletion propagated to xDrive: %+v", nodes)
	}

	// Credential/preflight failures remain throttled and do not spin every poll.
	if err := sourcecredential.Delete(context.Background(), db, source.ID); err != nil {
		t.Fatal(err)
	}
	report, err := runner.RunAll(context.Background())
	if err == nil {
		t.Fatal("missing credential cycle unexpectedly succeeded")
	}
	if report.Eligible != 1 || report.Failed != 1 || report.Completed != 0 {
		t.Fatalf("missing credential report=%+v", report)
	}
	var latest meta.SyncRun
	if err := db.Where("source_id = ?", source.ID).Order("started_at DESC").First(&latest).Error; err != nil {
		t.Fatal(err)
	}
	if latest.Status != meta.SyncRunStatusFailed || !strings.Contains(latest.Error, "credential is not configured") {
		t.Fatalf("missing credential run=%+v", latest)
	}

	if err := sourcecredential.Put(context.Background(), db, keyring, source,
		[]byte(`{"cookie":"BDUSS=integration-cookie"}`)); err != nil {
		t.Fatal(err)
	}
	disabledAt := time.Now().UTC()
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Update("disabled_at", disabledAt).Error; err != nil {
		t.Fatal(err)
	}
	attemptStarted := time.Now().UTC()
	report, err = runner.RunAll(context.Background())
	if err == nil {
		t.Fatal("disabled-owner cycle unexpectedly succeeded")
	}
	if report.Eligible != 1 || report.Failed != 1 {
		t.Fatalf("disabled-owner report=%+v", report)
	}
	var throttled meta.Source
	if err := db.First(&throttled, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if throttled.LastRunAt == nil || throttled.LastRunAt.Before(attemptStarted) ||
		!strings.Contains(throttled.LastError, "owner account is disabled") {
		t.Fatalf("preflight failure was not throttled: %+v", throttled)
	}
}

func downloadNode(t *testing.T, cli *client.Client, nodeID uint64) []byte {
	t.Helper()
	var out bytes.Buffer
	if err := cli.DownloadTo(context.Background(), nodeID, &out); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}
