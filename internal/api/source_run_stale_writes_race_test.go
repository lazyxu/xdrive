package api

import (
	"fmt"
	"net/http"
	"net/url"
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

// A Source revision change invalidates an old running SyncRun's mutation
// authority, not merely its final checkpoint. The old run history remains
// readable/finishable, but stale progress, heartbeat, failure and commit
// requests must not mutate metadata for the revised active Source.
func TestOldSourceRunMutationEndpointsRejectRevisedActiveSource(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("XD_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "source_stale_writes_race_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = baseDB.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error })
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	params := u.Query()
	params.Set("search_path", schema)
	u.RawQuery = params.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(4)
	sqlDB.SetMaxIdleConns(0)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{}, &meta.Source{},
		&meta.SyncRun{}, &meta.SourceItem{}, &meta.SourceItemAlias{}, &meta.SourceRunFailure{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{Username: "stale-writes-owner", PasswordHash: "not-used", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	oldTarget := meta.Node{OwnerID: owner.ID, Name: "old-target", Type: meta.NodeTypeDir, Revision: 1}
	newTarget := meta.Node{OwnerID: owner.ID, Name: "new-target", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&oldTarget).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&newTarget).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "Stale active run mutations", Kind: "race_pull", Direction: meta.SourceDirectionPull,
		SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync,
		Status: meta.SourceStatusActive, Revision: 1, ScheduleType: "interval", ScheduleExpression: "6h",
		TargetNodeID: &oldTarget.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	manager := auth.New("stale-writes-race-secret", time.Hour)
	token, err := manager.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := (&Server{DB: db, Auth: manager, AllowedOrigin: "http://localhost"}).Router()
	root := fmt.Sprintf("/api/v1/sources/%d", source.ID)
	runID := uuid.NewString()
	request(t, router, http.MethodPost, root+"/runs", token,
		strings.NewReader(fmt.Sprintf(`{"run_id":%q,"trigger":"scheduled"}`, runID)), http.StatusCreated)

	// Prepare a real, valid pending SourceItem/Node so both failed-item and
	// commit handlers would change persistent data without a revision fence.
	hash := strings.Repeat("a", 64)
	node := meta.Node{OwnerID: owner.ID, ParentID: &oldTarget.ID, Name: "legacy.jpg", Type: meta.NodeTypeFile, Revision: 1}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{NodeID: node.ID, Size: 5, StorageKey: "test-cas-stale-writes", SHA256: hash}).Error; err != nil {
		t.Fatal(err)
	}
	item := meta.SourceItem{
		SourceID: source.ID, ExternalID: "legacy", NodeID: &node.ID, NodeRevision: node.Revision,
		Kind: meta.SourceItemKindFile, Path: "legacy.jpg", Size: 5, SHA256: hash,
		State: meta.SourceItemStatePending, LastSeenRunID: runID, LastSeenAt: time.Now().UTC(),
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	var beforeRun meta.SyncRun
	if err := db.Where("id = ?", runID).First(&beforeRun).Error; err != nil {
		t.Fatal(err)
	}
	if beforeRun.Status != meta.SyncRunStatusRunning || beforeRun.SourceRevision != 1 {
		t.Fatalf("old run fixture invalid: %+v", beforeRun)
	}

	// Same active Source, but revision 2 and a distinct target. No new SyncRun
	// begins; the old run is still recorded as running in the database.
	requestWithHeaders(t, router, http.MethodPatch, root, token,
		strings.NewReader(fmt.Sprintf(`{"target_node_id":%d}`, newTarget.ID)), http.StatusOK,
		map[string]string{"If-Match": `"1"`})
	var current meta.Source
	if err := db.First(&current, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if current.Revision != 2 || current.Status != meta.SourceStatusActive ||
		current.TargetNodeID == nil || *current.TargetNodeID != newTarget.ID {
		t.Fatalf("new active Source revision did not persist: %+v", current)
	}

	// All requests are fully valid for revision 1: a test expecting a 409
	// solely because of a malformed body would not prove lifecycle fencing.
	mutations := []struct {
		name  string
		route string
		body  string
	}{
		{"progress", "/progress", `{"summary":{"scanned_items":7}}`},
		{"heartbeat", "/heartbeat", `{}`},
		{"failed-item", "/failures", `{"items":[{"external_id":"legacy","error":"original source transfer failed"}]}`},
		{"commit", "/commit", fmt.Sprintf(`{"items":[{"external_id":"legacy","action":"update","node_id":%d,"node_revision":1,"kind":"file","path":"legacy.jpg","size":5,"sha256":%q,"transferred":true,"transferred_bytes":5}]}`, node.ID, hash)},
	}
	for _, mutation := range mutations {
		t.Run(mutation.name, func(t *testing.T) {
			request(t, router, http.MethodPost,
				fmt.Sprintf("%s/runs/%s%s", root, runID, mutation.route), token,
				strings.NewReader(mutation.body), http.StatusConflict)
		})
	}

	var afterRun meta.SyncRun
	if err := db.Where("id = ?", runID).First(&afterRun).Error; err != nil {
		t.Fatal(err)
	}
	if afterRun.Status != meta.SyncRunStatusRunning || afterRun.ScannedItems != 0 ||
		afterRun.TransferredBytes != 0 || !afterRun.UpdatedAt.Equal(beforeRun.UpdatedAt) {
		t.Fatalf("old run received stale progress/heartbeat/commit writes: before=%+v after=%+v", beforeRun, afterRun)
	}
	var afterItem meta.SourceItem
	if err := db.Where("id = ?", item.ID).First(&afterItem).Error; err != nil {
		t.Fatal(err)
	}
	if afterItem.State != meta.SourceItemStatePending || afterItem.LastSyncedRunID != "" || afterItem.LastError != "" {
		t.Fatalf("stale item failure/commit mutated newer Source index: %+v", afterItem)
	}
	var failures int64
	if err := db.Model(&meta.SourceRunFailure{}).Where("source_id = ?", source.ID).Count(&failures).Error; err != nil {
		t.Fatal(err)
	}
	if failures != 0 {
		t.Fatalf("old run created %d failure history entries after Source revision change", failures)
	}
}
