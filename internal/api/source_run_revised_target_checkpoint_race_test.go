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

// R-SYNC-006: a SyncRun retains its old target and Source revision after an
// administrator changes the target. Its late success must not publish the old
// target's checkpoint as the current Source's new target cursor.
func TestOldCompletedSourceRunCannotPublishCheckpointAfterTargetRevisionChange(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("XD_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	rootDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "source_run_revision_race_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := rootDB.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootDB.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error })
	dsnURL, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := dsnURL.Query()
	query.Set("search_path", schema)
	dsnURL.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(dsnURL.String()), &gorm.Config{})
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
		&meta.SyncRun{}, &meta.SourceItem{}, &meta.SourceRunFailure{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{
		Username: "old-run-revision-owner", PasswordHash: "not-used",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	oldTarget := meta.Node{
		OwnerID: owner.ID, Name: "old-target", Type: meta.NodeTypeDir, Revision: 1,
	}
	newTarget := meta.Node{
		OwnerID: owner.ID, Name: "new-target", Type: meta.NodeTypeDir, Revision: 1,
	}
	if err := db.Create(&oldTarget).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&newTarget).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "Changing target during active run",
		Kind: "race_pull", Direction: meta.SourceDirectionPull,
		SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeScan,
		Status: meta.SourceStatusActive, Revision: 1,
		ScheduleType: "interval", ScheduleExpression: "6h",
		TargetNodeID: &oldTarget.ID, Checkpoint: "old-target-checkpoint-before",
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	manager := auth.New("run-revision-checkpoint-race-secret", time.Hour)
	token, err := manager.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := (&Server{DB: db, Auth: manager, AllowedOrigin: "http://localhost"}).Router()

	runID := uuid.NewString()
	basePath := fmt.Sprintf("/api/v1/sources/%d", source.ID)
	request(t, router, http.MethodPost, basePath+"/runs", token,
		strings.NewReader(fmt.Sprintf("{\"run_id\":%q,\"trigger\":\"scheduled\"}", runID)),
		http.StatusCreated)
	var running meta.SyncRun
	if err := db.Where("id = ? AND source_id = ?", runID, source.ID).First(&running).Error; err != nil {
		t.Fatal(err)
	}
	if running.SourceRevision != 1 || running.TargetNodeID == nil ||
		*running.TargetNodeID != oldTarget.ID || running.CheckpointBefore != source.Checkpoint {
		t.Fatalf("the running sync did not retain its original Source identity: %+v", running)
	}

	// The real owner HTTP PATCH commits a new Source revision and new target
	// while the earlier SyncRun is still running (not a mocked DB update).
	requestWithHeaders(t, router, http.MethodPatch, basePath, token,
		strings.NewReader(fmt.Sprintf("{\"target_node_id\":%d,\"status\":\"paused\"}", newTarget.ID)),
		http.StatusOK, map[string]string{"If-Match": "\"1\""})
	var edited meta.Source
	if err := db.First(&edited, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if edited.Revision != 2 || edited.Status != meta.SourceStatusPaused ||
		edited.TargetNodeID == nil || *edited.TargetNodeID != newTarget.ID ||
		edited.Checkpoint != source.Checkpoint || edited.LastSuccessAt != nil ||
		edited.LastRunAt == nil {
		t.Fatalf("new Source revision was not committed before old run finished: %+v", edited)
	}

	// The original long-running worker returns a successful terminal result
	// for its OLD target after the newer configuration has been committed.
	finishPath := fmt.Sprintf("%s/runs/%s/finish", basePath, runID)
	request(t, router, http.MethodPost, finishPath, token,
		strings.NewReader("{\"status\":\"completed\",\"complete_inventory\":true,\"checkpoint\":\"old-target-checkpoint-after\",\"summary\":{}}"),
		http.StatusOK)
	var finished meta.SyncRun
	if err := db.Where("id = ? AND source_id = ?", runID, source.ID).First(&finished).Error; err != nil {
		t.Fatal(err)
	}
	if finished.Status != meta.SyncRunStatusCompleted ||
		finished.CheckpointAfter != "old-target-checkpoint-after" {
		t.Fatalf("old run history did not reach a real terminal result: %+v", finished)
	}
	var after meta.Source
	if err := db.First(&after, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.Revision != edited.Revision || after.Status != edited.Status ||
		after.TargetNodeID == nil || *after.TargetNodeID != newTarget.ID {
		t.Fatalf("old run changed the newer Source target or configuration: before=%+v after=%+v", edited, after)
	}
	if after.Checkpoint != edited.Checkpoint || after.LastSuccessAt != nil ||
		after.LastRunAt == nil || !after.LastRunAt.Equal(*edited.LastRunAt) {
		t.Fatalf("old run published stale target cursor/success into newer Source revision: checkpoint_before=%q checkpoint_after=%q last_run_before=%v last_run_after=%v last_success_after=%v",
			edited.Checkpoint, after.Checkpoint, edited.LastRunAt, after.LastRunAt, after.LastSuccessAt)
	}
}
