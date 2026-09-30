package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestSourceIdentityAliasPromotionWorksForGenericFiles(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(
		&meta.SourceItemAlias{}, &meta.SourceRunFailure{}, &meta.SyncRun{}, &meta.SourceItem{}, &meta.Source{},
		&meta.AuditEvent{}, &meta.Share{}, &meta.UploadPart{}, &meta.UploadSession{}, &meta.ContentBlob{},
		&meta.FileVersion{}, &meta.File{}, &meta.Node{}, &meta.RefreshToken{}, &meta.User{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.AuditEvent{},
		&meta.Source{}, &meta.SourceItem{}, &meta.SourceItemAlias{}, &meta.SyncRun{}, &meta.SourceRunFailure{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_sources_owner_name ON xd_sources(owner_id, lower(name))`).Error; err != nil {
		t.Fatal(err)
	}

	router := (&Server{
		DB: db, Auth: auth.New("source-identity-test-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
	}).Router()
	token := createTestUser(t, db, router, "source-identity-user", "password-a")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	target := requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID),
		token, strings.NewReader(`{"name":"Synology files"}`), http.StatusCreated)

	createBody := fmt.Sprintf(`{
		"name":"Generic Synology files",
		"kind":"synology_files",
		"direction":"push",
		"sync_mode":"backup",
		"run_mode":"sync",
		"target_node_id":%d
	}`, target.ID)
	createdRes := request(t, router, http.MethodPost, "/api/v1/sources", token, strings.NewReader(createBody), http.StatusCreated)
	var source sourceDTO
	if err := json.Unmarshal(createdRes.Body.Bytes(), &source); err != nil {
		t.Fatal(err)
	}
	var owner meta.User
	if err := db.Where("username = ?", "source-identity-user").First(&owner).Error; err != nil {
		t.Fatal(err)
	}

	const oldID = "fs:documents:11:22"
	const canonicalID = "provider-file:documents:9001"
	const sourceHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	base := time.Date(2026, 9, 30, 10, 0, 0, 0, time.UTC)
	node := meta.Node{
		ParentID: &target.ID, Name: "notes.txt", Type: meta.NodeTypeFile,
		OwnerID: owner.ID, Revision: 1,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID: node.ID, Size: 4, StorageKey: "test/notes.txt", SHA256: sourceHash,
	}).Error; err != nil {
		t.Fatal(err)
	}
	item := meta.SourceItem{
		SourceID: source.ID, ExternalID: oldID, NodeID: &node.ID, NodeRevision: 1,
		Kind: meta.SourceItemKindFile, Path: "notes.txt", Size: 4, ModifiedAt: &base,
		SHA256: sourceHash, State: meta.SourceItemStateSynced,
		LastSeenAt: base, LastSyncedAt: &base,
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}

	run1 := uuid.NewString()
	begin1 := fmt.Sprintf(`{"run_id":%q,"trigger":"scheduled"}`, run1)
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/runs", source.ID),
		token, strings.NewReader(begin1), http.StatusCreated)
	observePath1 := fmt.Sprintf("/api/v1/sources/%d/runs/%s/observe", source.ID, run1)
	promoteBody := fmt.Sprintf(`{"items":[{
		"external_id":%q,
		"external_id_aliases":[%q],
		"promote_external_id":true,
		"kind":"file",
		"path":"notes.txt",
		"size":4,
		"modified_at":%q
	}]}`, canonicalID, oldID, base.Format(time.RFC3339Nano))
	promoted := request(t, router, http.MethodPost, observePath1, token, strings.NewReader(promoteBody), http.StatusOK)
	var promotedPlans observeSourceRunResponse
	if err := json.Unmarshal(promoted.Body.Bytes(), &promotedPlans); err != nil {
		t.Fatal(err)
	}
	if len(promotedPlans.Plans) != 1 || promotedPlans.Plans[0].Action != "unchanged" ||
		promotedPlans.Plans[0].NodeID == nil || *promotedPlans.Plans[0].NodeID != node.ID {
		t.Fatalf("unexpected promoted plan: %+v", promotedPlans.Plans)
	}

	// Lost observe responses are safe to retry and do not duplicate aliases.
	request(t, router, http.MethodPost, observePath1, token, strings.NewReader(promoteBody), http.StatusOK)

	var promotedItem meta.SourceItem
	if err := db.First(&promotedItem, item.ID).Error; err != nil {
		t.Fatal(err)
	}
	if promotedItem.ExternalID != canonicalID || promotedItem.NodeID == nil || *promotedItem.NodeID != node.ID {
		t.Fatalf("canonical promotion recreated or detached item: %+v", promotedItem)
	}
	var aliases []meta.SourceItemAlias
	if err := db.Where("source_id = ? AND source_item_id = ?", source.ID, item.ID).Find(&aliases).Error; err != nil {
		t.Fatal(err)
	}
	if len(aliases) != 1 || aliases[0].AliasExternalID != oldID {
		t.Fatalf("unexpected aliases after promotion: %+v", aliases)
	}

	finish1 := `{"status":"completed","complete_inventory":true,"summary":{"scanned_items":1,"scanned_bytes":4,"unchanged_items":1,"unchanged_bytes":4}}`
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/runs/%s/finish", source.ID, run1),
		token, strings.NewReader(finish1), http.StatusOK)

	// Simulate a rolled-back/older connector that still observes and commits by
	// the filesystem alias. Canonical identity must not downgrade.
	run2 := uuid.NewString()
	begin2 := fmt.Sprintf(`{"run_id":%q,"trigger":"scheduled"}`, run2)
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/runs", source.ID),
		token, strings.NewReader(begin2), http.StatusCreated)
	observePath2 := fmt.Sprintf("/api/v1/sources/%d/runs/%s/observe", source.ID, run2)
	oldClientBody := fmt.Sprintf(`{"items":[{
		"external_id":%q,
		"external_id_aliases":[%q],
		"kind":"file",
		"path":"renamed.txt",
		"size":4,
		"modified_at":%q
	}]}`, oldID, canonicalID, base.Format(time.RFC3339Nano))
	oldObserved := request(t, router, http.MethodPost, observePath2, token, strings.NewReader(oldClientBody), http.StatusOK)
	var oldPlans observeSourceRunResponse
	if err := json.Unmarshal(oldObserved.Body.Bytes(), &oldPlans); err != nil {
		t.Fatal(err)
	}
	if len(oldPlans.Plans) != 1 || oldPlans.Plans[0].Action != "move" ||
		oldPlans.Plans[0].NodeID == nil || *oldPlans.Plans[0].NodeID != node.ID {
		t.Fatalf("old alias did not resolve existing node: %+v", oldPlans.Plans)
	}

	if err := db.Model(&meta.Node{}).Where("id = ?", node.ID).
		Updates(map[string]any{"name": "renamed.txt", "revision": 2}).Error; err != nil {
		t.Fatal(err)
	}
	commitBody := fmt.Sprintf(`{"items":[{
		"external_id":%q,
		"action":"move",
		"node_id":%d,
		"node_revision":2,
		"kind":"file",
		"path":"renamed.txt",
		"size":4,
		"modified_at":%q
	}]}`, oldID, node.ID, base.Format(time.RFC3339Nano))
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/runs/%s/commit", source.ID, run2),
		token, strings.NewReader(commitBody), http.StatusNoContent)

	if err := db.First(&promotedItem, item.ID).Error; err != nil {
		t.Fatal(err)
	}
	if promotedItem.ExternalID != canonicalID || promotedItem.Path != "renamed.txt" ||
		promotedItem.NodeID == nil || *promotedItem.NodeID != node.ID || promotedItem.NodeRevision != 2 {
		t.Fatalf("old alias commit changed canonical identity or node mapping: %+v", promotedItem)
	}
	finish2 := `{"status":"completed","complete_inventory":true,"summary":{"scanned_items":1,"scanned_bytes":4,"moved_items":1}}`
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/runs/%s/finish", source.ID, run2),
		token, strings.NewReader(finish2), http.StatusOK)

	// Conflicting evidence must never merge two distinct SourceItems.
	otherNode := meta.Node{
		ParentID: &target.ID, Name: "other.txt", Type: meta.NodeTypeFile,
		OwnerID: owner.ID, Revision: 1,
	}
	if err := db.Create(&otherNode).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID: otherNode.ID, Size: 5, StorageKey: "test/other.txt", SHA256: sourceHash,
	}).Error; err != nil {
		t.Fatal(err)
	}
	other := meta.SourceItem{
		SourceID: source.ID, ExternalID: "provider-file:documents:9002",
		NodeID: &otherNode.ID, NodeRevision: 1, Kind: meta.SourceItemKindFile,
		Path: "other.txt", Size: 5, ModifiedAt: &base, SHA256: sourceHash,
		State: meta.SourceItemStateSynced, LastSeenAt: base, LastSyncedAt: &base,
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}

	run3 := uuid.NewString()
	begin3 := fmt.Sprintf(`{"run_id":%q,"trigger":"scheduled"}`, run3)
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/runs", source.ID),
		token, strings.NewReader(begin3), http.StatusCreated)
	conflictBody := fmt.Sprintf(`{"items":[{
		"external_id":"provider-file:documents:9999",
		"external_id_aliases":[%q,%q],
		"promote_external_id":true,
		"kind":"file",
		"path":"notes.txt",
		"size":4,
		"modified_at":%q
	}]}`, oldID, other.ExternalID, base.Format(time.RFC3339Nano))
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/runs/%s/observe", source.ID, run3),
		token, strings.NewReader(conflictBody), http.StatusConflict)

	if err := db.First(&promotedItem, item.ID).Error; err != nil {
		t.Fatal(err)
	}
	if promotedItem.ExternalID != canonicalID {
		t.Fatalf("conflicting promotion changed canonical identity: %+v", promotedItem)
	}
	cleanup := `{"status":"failed","complete_inventory":false,"error":"test cleanup","summary":{}}`
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/runs/%s/finish", source.ID, run3),
		token, strings.NewReader(cleanup), http.StatusOK)
}
