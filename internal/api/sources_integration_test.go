package api

import (
	"encoding/json"
	"errors"
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

func TestSourceControlPlaneAndIsolation(t *testing.T) {
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
		&meta.SyncRun{}, &meta.SourceItem{}, &meta.Source{}, &meta.AuditEvent{}, &meta.Share{},
		&meta.UploadPart{}, &meta.UploadSession{}, &meta.ContentBlob{}, &meta.FileVersion{}, &meta.File{},
		&meta.Node{}, &meta.RefreshToken{}, &meta.User{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.AuditEvent{},
		&meta.Source{}, &meta.SourceItem{}, &meta.SyncRun{},
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
		DB: db, Auth: auth.New("source-test-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
	}).Router()

	tokenA := createTestUser(t, db, router, "source-alice", "password-a")
	tokenB := createTestUser(t, db, router, "source-bob", "password-b")
	rootA := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenA, nil, http.StatusOK)
	rootB := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenB, nil, http.StatusOK)
	targetA := requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", rootA.ID),
		tokenA, strings.NewReader(`{"name":"Synology"}`), http.StatusCreated)

	createBody := fmt.Sprintf(`{
		"name":"Synology Photos",
		"kind":"synology_photos",
		"direction":"push",
		"sync_mode":"backup",
		"run_mode":"scan",
		"target_node_id":%d,
		"ignore_rules":"@eaDir/\n\\#recycle/\n*.tmp\n"
	}`, targetA.ID)
	createdRes := request(t, router, http.MethodPost, "/api/v1/sources", tokenA, strings.NewReader(createBody), http.StatusCreated)
	var created sourceDTO
	if err := json.Unmarshal(createdRes.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == 0 || created.Revision != 1 || created.RunMode != meta.SourceRunModeScan ||
		created.SyncMode != meta.SourceSyncModeBackup || created.Status != meta.SourceStatusActive ||
		created.TargetNodeID == nil || *created.TargetNodeID != targetA.ID {
		t.Fatalf("unexpected created source: %+v", created)
	}

	// Mirror is deliberately not exposed while source-side deletion is unsupported.
	mirrorBody := fmt.Sprintf(`{"name":"Mirror","kind":"test","direction":"push","sync_mode":"mirror","target_node_id":%d}`, targetA.ID)
	request(t, router, http.MethodPost, "/api/v1/sources", tokenA, strings.NewReader(mirrorBody), http.StatusBadRequest)

	// A source cannot target another user's directory.
	foreignBody := fmt.Sprintf(`{"name":"Foreign","kind":"test","direction":"pull","target_node_id":%d}`, rootB.ID)
	request(t, router, http.MethodPost, "/api/v1/sources", tokenA, strings.NewReader(foreignBody), http.StatusBadRequest)

	// Names are unique per owner, case-insensitively.
	duplicateBody := fmt.Sprintf(`{"name":"synology photos","kind":"test","direction":"push","target_node_id":%d}`, targetA.ID)
	request(t, router, http.MethodPost, "/api/v1/sources", tokenA, strings.NewReader(duplicateBody), http.StatusConflict)

	listA := request(t, router, http.MethodGet, "/api/v1/sources", tokenA, nil, http.StatusOK)
	var sourcesA []sourceDTO
	if err := json.Unmarshal(listA.Body.Bytes(), &sourcesA); err != nil {
		t.Fatal(err)
	}
	if len(sourcesA) != 1 || sourcesA[0].ID != created.ID {
		t.Fatalf("unexpected owner source list: %+v", sourcesA)
	}
	listB := request(t, router, http.MethodGet, "/api/v1/sources", tokenB, nil, http.StatusOK)
	var sourcesB []sourceDTO
	if err := json.Unmarshal(listB.Body.Bytes(), &sourcesB); err != nil {
		t.Fatal(err)
	}
	if len(sourcesB) != 0 {
		t.Fatalf("other user saw sources: %+v", sourcesB)
	}
	request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/sources/%d", created.ID), tokenB, nil, http.StatusNotFound)

	triggeredRes := request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/trigger", created.ID),
		tokenA, nil, http.StatusAccepted)
	var triggered sourceDTO
	if err := json.Unmarshal(triggeredRes.Body.Bytes(), &triggered); err != nil {
		t.Fatal(err)
	}
	if triggered.RunRequestedAt == nil || triggered.Revision != created.Revision {
		t.Fatalf("unexpected triggered source: %+v", triggered)
	}
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/trigger", created.ID),
		tokenB, nil, http.StatusNotFound)
	var triggeredStored meta.Source
	if err := db.First(&triggeredStored, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if triggeredStored.RunRequestedAt == nil {
		t.Fatal("manual run request was not persisted")
	}

	// Source mutations use the same optimistic revision contract as node mutations.
	request(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/sources/%d", created.ID), tokenA,
		strings.NewReader(`{"run_mode":"sync"}`), http.StatusPreconditionRequired)
	updatedRes := requestWithHeaders(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/sources/%d", created.ID), tokenA,
		strings.NewReader(`{"run_mode":"sync","status":"paused","ignore_rules":"*.tmp\n"}`), http.StatusOK,
		map[string]string{"If-Match": `"1"`})
	var updated sourceDTO
	if err := json.Unmarshal(updatedRes.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Revision != 2 || updated.RunMode != meta.SourceRunModeSync ||
		updated.Status != meta.SourceStatusPaused || updated.IgnoreRules != "*.tmp\n" {
		t.Fatalf("unexpected updated source: %+v", updated)
	}
	requestWithHeaders(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/sources/%d", created.ID), tokenA,
		strings.NewReader(`{"status":"active"}`), http.StatusConflict, map[string]string{"If-Match": `"1"`})

	now := time.Now().UTC().Truncate(time.Second)
	finished := now.Add(time.Minute)
	run := meta.SyncRun{
		ID: uuid.NewString(), SourceID: created.ID, Mode: meta.SourceRunModeScan,
		Trigger: meta.SyncRunTriggerScheduled, Status: meta.SyncRunStatusCompleted,
		ScannedItems: 100, ScannedBytes: 1000, IgnoredItems: 10, IgnoredBytes: 100,
		NewItems: 20, NewBytes: 300, ChangedItems: 5, ChangedBytes: 200,
		UnchangedItems: 65, UnchangedBytes: 400, MissingItems: 2, MissingBytes: 20,
		PlannedTransferItems: 25, PlannedTransferBytes: 500,
		StartedAt: now, FinishedAt: &finished,
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}

	runsRes := request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/sources/%d/runs?limit=10", created.ID),
		tokenA, nil, http.StatusOK)
	var runs []syncRunDTO
	if err := json.Unmarshal(runsRes.Body.Bytes(), &runs); err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || runs[0].ID != run.ID || runs[0].PlannedTransferBytes != 500 ||
		runs[0].IgnoredItems != 10 {
		t.Fatalf("unexpected source runs: %+v", runs)
	}
	request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/sources/%d/runs/%s", created.ID, run.ID),
		tokenA, nil, http.StatusOK)
	request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/sources/%d/runs", created.ID),
		tokenB, nil, http.StatusNotFound)

	// Source deletion removes only source metadata/history. The target xDrive node remains.
	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/sources/%d", created.ID), tokenA,
		nil, http.StatusNoContent, map[string]string{"If-Match": `"2"`})
	if err := db.First(&meta.Source{}, created.ID).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("source survived deletion: %v", err)
	}
	if err := db.First(&meta.Node{}, targetA.ID).Error; err != nil {
		t.Fatalf("source deletion removed target node: %v", err)
	}
	var runCount int64
	if err := db.Model(&meta.SyncRun{}).Where("source_id = ?", created.ID).Count(&runCount).Error; err != nil {
		t.Fatal(err)
	}
	if runCount != 0 {
		t.Fatalf("source runs survived source deletion: %d", runCount)
	}
}
