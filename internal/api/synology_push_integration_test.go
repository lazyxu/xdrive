//go:build linux

package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceagent"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestSynologyPushCreateUpdateMoveAndMissing(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)

	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "synology_push_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
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
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.ContentBlob{},
		&meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{}, &meta.AuditEvent{},
		&meta.Source{}, &meta.SourceItem{}, &meta.SyncRun{},
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

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	router := (&Server{
		DB: db, Store: store,
		Auth:           auth.New("synology-push-integration-secret", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 32 << 20,
	}).Router()

	token := createTestUser(t, db, router, "synology-push-user", "password-a")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	target := requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID),
		token, strings.NewReader(`{"name":"Synology"}`), http.StatusCreated)

	createBody := fmt.Sprintf(`{
		"name":"Synology Photos",
		"kind":"synology_photos",
		"direction":"push",
		"sync_mode":"backup",
		"run_mode":"sync",
		"target_node_id":%d,
		"ignore_rules":"@eaDir/\n"
	}`, target.ID)
	createdRes := request(t, router, http.MethodPost, "/api/v1/sources", token, strings.NewReader(createBody), http.StatusCreated)
	var source sourceDTO
	if err := json.Unmarshal(createdRes.Body.Bytes(), &source); err != nil {
		t.Fatal(err)
	}

	httpServer := httptest.NewServer(router)
	defer httpServer.Close()
	cli := client.New(httpServer.URL, token)

	shared := t.TempDir()
	local := filepath.Join(shared, "photo.jpg")
	if err := os.WriteFile(local, []byte("first"), 0o600); err != nil {
		t.Fatal(err)
	}
	sharedID, err := sourceagent.RootIdentity("shared", shared)
	if err != nil {
		t.Fatal(err)
	}
	scanner := sourceagent.Scanner{
		API: cli, ExecutionAPI: cli, SourceID: source.ID,
		Roots: sourceagent.RootsWithIdentities("", "", shared, sharedID),
	}

	run1, err := scanner.Run(context.Background(), meta.SyncRunTriggerManual)
	if err != nil {
		t.Fatal(err)
	}
	if run1.Status != meta.SyncRunStatusCompleted || run1.CreatedItems != 2 ||
		run1.TransferredItems != 1 || run1.TransferredBytes != int64(len("first")) {
		t.Fatalf("unexpected create run: %+v", run1)
	}
	sharedNode := mustChild(t, cli, target.ID, "Shared", meta.NodeTypeDir)
	fileNode := mustChild(t, cli, sharedNode.ID, "photo.jpg", meta.NodeTypeFile)
	firstNodeID := fileNode.ID
	if got := mustDownload(t, cli, fileNode.ID); got != "first" {
		t.Fatalf("created content=%q", got)
	}

	if err := os.WriteFile(local, []byte("second-content"), 0o600); err != nil {
		t.Fatal(err)
	}
	now := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(local, now, now); err != nil {
		t.Fatal(err)
	}
	run2, err := scanner.Run(context.Background(), meta.SyncRunTriggerManual)
	if err != nil {
		t.Fatal(err)
	}
	if run2.Status != meta.SyncRunStatusCompleted || run2.UpdatedItems < 1 ||
		run2.TransferredItems != 1 || run2.TransferredBytes != int64(len("second-content")) {
		t.Fatalf("unexpected update run: %+v", run2)
	}
	fileNode = mustChild(t, cli, sharedNode.ID, "photo.jpg", meta.NodeTypeFile)
	if fileNode.ID != firstNodeID {
		t.Fatalf("overwrite changed node id: got=%d want=%d", fileNode.ID, firstNodeID)
	}
	if got := mustDownload(t, cli, fileNode.ID); got != "second-content" {
		t.Fatalf("updated content=%q", got)
	}

	renamed := filepath.Join(shared, "renamed.jpg")
	if err := os.Rename(local, renamed); err != nil {
		t.Fatal(err)
	}
	run3, err := scanner.Run(context.Background(), meta.SyncRunTriggerManual)
	if err != nil {
		t.Fatal(err)
	}
	if run3.Status != meta.SyncRunStatusCompleted || run3.MovedItems < 1 ||
		run3.TransferredItems != 0 || run3.TransferredBytes != 0 {
		t.Fatalf("unexpected move run: %+v", run3)
	}
	fileNode = mustChild(t, cli, sharedNode.ID, "renamed.jpg", meta.NodeTypeFile)
	if fileNode.ID != firstNodeID {
		t.Fatalf("move changed node id: got=%d want=%d", fileNode.ID, firstNodeID)
	}
	if got := mustDownload(t, cli, fileNode.ID); got != "second-content" {
		t.Fatalf("moved content=%q", got)
	}

	if err := os.Remove(renamed); err != nil {
		t.Fatal(err)
	}
	run4, err := scanner.Run(context.Background(), meta.SyncRunTriggerManual)
	if err != nil {
		t.Fatal(err)
	}
	if run4.Status != meta.SyncRunStatusCompleted || run4.MissingItems != 1 {
		t.Fatalf("unexpected missing run: %+v", run4)
	}
	fileNode = mustChild(t, cli, sharedNode.ID, "renamed.jpg", meta.NodeTypeFile)
	if fileNode.ID != firstNodeID {
		t.Fatalf("source deletion changed remote node: got=%d want=%d", fileNode.ID, firstNodeID)
	}
	var item meta.SourceItem
	if err := db.Where("source_id = ? AND path = ?", source.ID, "Shared/renamed.jpg").First(&item).Error; err != nil {
		t.Fatal(err)
	}
	if item.State != meta.SourceItemStateMissing || item.NodeID == nil || *item.NodeID != firstNodeID {
		t.Fatalf("unexpected missing source item: %+v", item)
	}
}

func mustChild(t *testing.T, cli *client.Client, parentID uint64, name, nodeType string) client.Node {
	t.Helper()
	children, err := cli.List(context.Background(), parentID)
	if err != nil {
		t.Fatal(err)
	}
	for _, child := range children {
		if child.Name == name {
			if child.Type != nodeType {
				t.Fatalf("child %q type=%q want=%q", name, child.Type, nodeType)
			}
			return child
		}
	}
	t.Fatalf("child %q not found under %d: %+v", name, parentID, children)
	return client.Node{}
}

func mustDownload(t *testing.T, cli *client.Client, nodeID uint64) string {
	t.Helper()
	var out bytes.Buffer
	if err := cli.DownloadTo(context.Background(), nodeID, &out); err != nil {
		t.Fatal(err)
	}
	return out.String()
}
