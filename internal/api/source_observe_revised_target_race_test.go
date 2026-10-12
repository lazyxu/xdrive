package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
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

// R-SYNC-007: A running SyncRun holds a revision-1 target snapshot. After an
// authenticated owner switches that still-active Source to target B/revision 2,
// the old worker must not write observations into B's current SourceItem index.
func TestOldRunObserveCannotCreateItemsAfterActiveSourceTargetRevision(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("XD_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	rootDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "source_observe_revision_race_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := rootDB.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = rootDB.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error
	})
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
		&meta.User{}, &meta.Node{}, &meta.Source{},
		&meta.SyncRun{}, &meta.SourceItem{}, &meta.SourceItemAlias{}, &meta.SourceRunFailure{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{
		Username:     "stale-observe-revision-owner",
		PasswordHash: "not-used", Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	oldTarget := meta.Node{OwnerID: owner.ID, Name: "original-destination", Type: meta.NodeTypeDir, Revision: 1}
	newTarget := meta.Node{OwnerID: owner.ID, Name: "replacement-destination", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&oldTarget).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&newTarget).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "Source whose target changes while run is active",
		Kind: "race_pull", Direction: meta.SourceDirectionPull,
		SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeScan,
		Status: meta.SourceStatusActive, Revision: 1,
		ScheduleType: "interval", ScheduleExpression: "6h",
		TargetNodeID: &oldTarget.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	manager := auth.New("source-observation-revision-secret", time.Hour)
	token, err := manager.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := (&Server{DB: db, Auth: manager, AllowedOrigin: "http://localhost"}).Router()
	basePath := fmt.Sprintf("/api/v1/sources/%d", source.ID)
	runID := uuid.NewString()
	request(t, router, http.MethodPost, basePath+"/runs", token,
		strings.NewReader(fmt.Sprintf("{\"run_id\":%q,\"trigger\":\"scheduled\"}", runID)),
		http.StatusCreated)
	var oldRun meta.SyncRun
	if err := db.Where("id = ? AND source_id = ?", runID, source.ID).First(&oldRun).Error; err != nil {
		t.Fatal(err)
	}
	if oldRun.Status != meta.SyncRunStatusRunning ||
		oldRun.SourceRevision != 1 || oldRun.TargetNodeID == nil || *oldRun.TargetNodeID != oldTarget.ID {
		t.Fatalf("old SyncRun does not retain the original active source snapshot: %+v", oldRun)
	}

	// Real owner HTTP revision-guarded target edit, without pausing the Source.
	// The old run remains running and is still eligible for its old worker's
	// late observe request, unless Server fences the changed Source revision.
	requestWithHeaders(t, router, http.MethodPatch, basePath, token,
		strings.NewReader(fmt.Sprintf("{\"target_node_id\":%d}", newTarget.ID)),
		http.StatusOK, map[string]string{"If-Match": "\"1\""})
	var edited meta.Source
	if err := db.First(&edited, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if edited.Revision != 2 || edited.Status != meta.SourceStatusActive ||
		edited.TargetNodeID == nil || *edited.TargetNodeID != newTarget.ID {
		t.Fatalf("new active target revision was not committed before stale observation: %+v", edited)
	}
	var beforeCount int64
	if err := db.Model(&meta.SourceItem{}).Where("source_id = ?", source.ID).Count(&beforeCount).Error; err != nil {
		t.Fatal(err)
	}
	if beforeCount != 0 {
		t.Fatalf("unexpected SourceItem fixture before stale observation: %d", beforeCount)
	}

	// Actual authenticated HTTP observer. Do not force its response to 200 or
	// 409 in the harness: only the AFTER-HTTP durable SourceItem invariant may
	// establish an authentic first-red. The repaired Server should reject 409.
	observePath := fmt.Sprintf("%s/runs/%s/observe", basePath, runID)
	observeBody := fmt.Sprintf(
		"{\"items\":[{\"external_id\":%q,\"kind\":\"file\",\"path\":%q,\"size\":%d,\"modified_at\":%q}]}",
		"old-run-asset", "old-destination/legacy.jpg", 123,
		time.Date(2026, time.October, 12, 10, 0, 0, 0, time.UTC).Format(time.RFC3339Nano),
	)
	req := httptest.NewRequest(http.MethodPost, observePath, strings.NewReader(observeBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	observed := httptest.NewRecorder()
	router.ServeHTTP(observed, req)
	if observed.Code != http.StatusOK && observed.Code != http.StatusConflict {
		t.Fatalf("invalid authenticated observe HTTP setup: status=%d body=%s", observed.Code, observed.Body.String())
	}

	var afterCount int64
	if err := db.Model(&meta.SourceItem{}).
		Where("source_id = ? AND external_id = ?", source.ID, "old-run-asset").
		Count(&afterCount).Error; err != nil {
		t.Fatal(err)
	}
	if afterCount != 0 {
		t.Fatalf("old revision-1 observe polluted active revision-2 SourceItem index: status=%d stale_items=%d old_run=%s new_target=%d",
			observed.Code, afterCount, oldRun.ID, newTarget.ID)
	}
	if observed.Code != http.StatusConflict {
		t.Fatalf("stale Source run observation must be rejected as conflict: HTTP %d body=%s", observed.Code, observed.Body.String())
	}
	var stillActive meta.Source
	if err := db.First(&stillActive, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stillActive.Revision != edited.Revision || stillActive.Status != edited.Status ||
		stillActive.TargetNodeID == nil || *stillActive.TargetNodeID != newTarget.ID {
		t.Fatalf("stale observer changed new Source configuration: %+v", stillActive)
	}
}
