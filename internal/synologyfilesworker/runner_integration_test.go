package synologyfilesworker_test

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http/httptest"
	"net/url"
	"os"
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
	"github.com/lazyxu/xdrive/internal/synology"
	"github.com/lazyxu/xdrive/internal/synologyfilesworker"
	"github.com/lazyxu/xdrive/internal/synologyfilesync"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type integrationRemote struct {
	folders       map[string][]synology.FileStationEntry
	payloads      map[string][]byte
	downloadOpens int
	closed        bool
}

func (r *integrationRemote) ListFolderPage(_ context.Context, folder string, offset, limit int) (synology.FileStationPage, error) {
	list := r.folders[folder]
	if offset >= len(list) {
		return synology.FileStationPage{Offset: offset, Total: len(list)}, nil
	}
	end := offset + limit
	if end > len(list) {
		end = len(list)
	}
	return synology.FileStationPage{
		Offset:  offset,
		Total:   len(list),
		Entries: append([]synology.FileStationEntry(nil), list[offset:end]...),
	}, nil
}

func (r *integrationRemote) OpenPath(_ context.Context, remotePath string, offset int64) (io.ReadCloser, error) {
	data, ok := r.payloads[remotePath]
	if !ok {
		return nil, fmt.Errorf("missing payload for %s", remotePath)
	}
	if offset < 0 || offset > int64(len(data)) {
		return nil, fmt.Errorf("invalid offset %d for %s", offset, remotePath)
	}
	r.downloadOpens++
	return io.NopCloser(bytes.NewReader(data[offset:])), nil
}

func (r *integrationRemote) Close(context.Context) error {
	r.closed = true
	return nil
}

func TestRunnerSyncsArbitraryFilesAndPreservesEmptyDirectories(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "synology_files_worker_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		&meta.User{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.ContentBlob{}, &meta.ContentDigestAlias{},
		&meta.UploadSession{}, &meta.UploadPart{},
		&meta.Source{}, &meta.SourceItem{}, &meta.SourceItemAlias{}, &meta.SourceItemMetadata{}, &meta.SyncRun{}, &meta.SourceRunFailure{}, &meta.SourceCredential{},
		&meta.SourceConnectorConfig{},
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

	owner := meta.User{Username: "synology-files-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "Synology Files Pull", Kind: synologyfilesync.SourceKind,
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive,
		ScheduleType: "interval", ScheduleExpression: "6h",
		Revision: 1, TargetNodeID: &root.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.SourceConnectorConfig{
		SourceID: source.ID, Payload: `{"roots":["/documents"]}`, Revision: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}

	keyring, err := connectorsecret.NewKeyring(1, map[uint32]string{1: strings.Repeat("11", 32)})
	if err != nil {
		t.Fatal(err)
	}
	if err := sourcecredential.Put(context.Background(), db, keyring, source,
		[]byte(`{"base_url":"https://nas.example","username":"alice","password":"secret"}`)); err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	jwtSecret := "synology-files-worker-integration-secret-long-enough"
	authManager := auth.New(jwtSecret, time.Hour)
	httpServer := httptest.NewServer((&api.Server{
		DB: db, Store: store,
		Auth: authManager, RefreshTTL: time.Hour,
		AllowedOrigin: "http://localhost", MaxUploadBytes: 32 << 20,
	}).Router())
	defer httpServer.Close()

	notePayload := []byte("note")
	zipPayload := []byte("zip-data")
	pdfPayload := []byte("pdf-report-data!!")
	modified := int64(1_700_000_000)
	remote := &integrationRemote{
		folders: map[string][]synology.FileStationEntry{
			"/documents": {
				{Name: "Empty", Path: "/documents/Empty", IsDir: true, Additional: synology.FileStationAdditional{Time: synology.FileStationTime{MTime: modified}}},
				{Name: "Reports", Path: "/documents/Reports", IsDir: true, Additional: synology.FileStationAdditional{Time: synology.FileStationTime{MTime: modified}}},
				{Name: "notes.txt", Path: "/documents/notes.txt", Additional: synology.FileStationAdditional{Size: int64(len(notePayload)), Time: synology.FileStationTime{MTime: modified}, Type: "txt"}},
				{Name: "archive.zip", Path: "/documents/archive.zip", Additional: synology.FileStationAdditional{Size: int64(len(zipPayload)), Time: synology.FileStationTime{MTime: modified}, Type: "zip"}},
			},
			"/documents/Empty": {},
			"/documents/Reports": {
				{Name: "report.pdf", Path: "/documents/Reports/report.pdf", Additional: synology.FileStationAdditional{Size: int64(len(pdfPayload)), Time: synology.FileStationTime{MTime: modified}, Type: "pdf"}},
			},
		},
		payloads: map[string][]byte{
			"/documents/notes.txt":          notePayload,
			"/documents/archive.zip":        zipPayload,
			"/documents/Reports/report.pdf": pdfPayload,
		},
	}
	runner := &synologyfilesworker.Runner{
		DB: db, Keyring: keyring, ServerURL: httpServer.URL, JWTSecret: jwtSecret,
		RemoteFactory: func(_ context.Context, credential synology.Credential) (synologyfilesworker.RemoteSession, error) {
			if credential.BaseURL != "https://nas.example" || credential.Username != "alice" || credential.Password != "secret" {
				return nil, fmt.Errorf("unexpected credential: %+v", credential)
			}
			return remote, nil
		},
	}

	run, result, err := runner.RunSource(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != meta.SyncRunStatusCompleted || run.ScannedItems != 6 || run.NewItems != 6 ||
		run.TransferredItems != 3 || run.TransferredBytes != int64(len(notePayload)+len(zipPayload)+len(pdfPayload)) {
		t.Fatalf("unexpected run=%+v result=%+v", run, result)
	}
	if result.Files != 3 || result.Directories != 3 || remote.downloadOpens != 3 || !remote.closed {
		t.Fatalf("unexpected result=%+v downloads=%d closed=%v", result, remote.downloadOpens, remote.closed)
	}

	token, err := authManager.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	cli := client.New(httpServer.URL, token)
	nodes, err := cli.Walk(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, directory := range []string{"documents", "documents/Empty", "documents/Reports"} {
		node, ok := nodes[directory]
		if !ok || node.Type != meta.NodeTypeDir {
			t.Fatalf("directory %q missing: %+v", directory, nodes)
		}
	}
	for path, payload := range map[string][]byte{
		"documents/notes.txt":          notePayload,
		"documents/archive.zip":        zipPayload,
		"documents/Reports/report.pdf": pdfPayload,
	} {
		node, ok := nodes[path]
		if !ok || node.Type != meta.NodeTypeFile {
			t.Fatalf("file %q missing: %+v", path, nodes)
		}
		if got := downloadNode(t, cli, node.ID); !bytes.Equal(got, payload) {
			t.Fatalf("file %q content=%q want=%q", path, got, payload)
		}
	}

	var mediaRows int64
	if db.Migrator().HasTable(&meta.MediaMetadata{}) {
		if err := db.Model(&meta.MediaMetadata{}).Count(&mediaRows).Error; err != nil {
			t.Fatal(err)
		}
	}
	if mediaRows != 0 {
		t.Fatalf("generic File Station worker unexpectedly created media metadata rows=%d", mediaRows)
	}

	// Backup semantics: a remote disappearance marks the SourceItem missing but
	// leaves the xDrive Node/File intact.
	delete(remote.payloads, "/documents/archive.zip")
	remote.folders["/documents"] = []synology.FileStationEntry{
		{Name: "Empty", Path: "/documents/Empty", IsDir: true, Additional: synology.FileStationAdditional{Time: synology.FileStationTime{MTime: modified}}},
		{Name: "Reports", Path: "/documents/Reports", IsDir: true, Additional: synology.FileStationAdditional{Time: synology.FileStationTime{MTime: modified}}},
		{Name: "notes.txt", Path: "/documents/notes.txt", Additional: synology.FileStationAdditional{Size: int64(len(notePayload)), Time: synology.FileStationTime{MTime: modified}, Type: "txt"}},
	}
	reconcile, _, err := runner.RunSource(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	if reconcile.Status != meta.SyncRunStatusCompleted || reconcile.MissingItems != 1 {
		t.Fatalf("unexpected reconcile=%+v", reconcile)
	}
	nodes, err = cli.Walk(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := nodes["documents/archive.zip"]; !ok {
		t.Fatalf("backup semantics deleted missing remote file: %+v", nodes)
	}
	var missing meta.SourceItem
	if err := db.Where("source_id = ? AND path = ?", source.ID, "documents/archive.zip").First(&missing).Error; err != nil {
		t.Fatal(err)
	}
	if missing.State != meta.SourceItemStateMissing || missing.NodeID == nil {
		t.Fatalf("missing source item=%+v", missing)
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
