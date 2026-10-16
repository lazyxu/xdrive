package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// R-SYNC-010: a delayed terminal callback holds an older summary. Once newer
// progress is committed for that same run, finalization cannot rewind it.
func TestDelayedSourceRunFinishCannotRewindCommittedCumulativeProgress(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("XD_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	rootDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "source_finish_summary_race_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := rootDB.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootDB.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error })
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
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.Source{}, &meta.SyncRun{}, &meta.SourceItem{}, &meta.SourceRunFailure{}, &meta.SourceRunSkip{}); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{
		Username: "late-finish-source-owner", PasswordHash: "not-used", Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	target := meta.Node{OwnerID: owner.ID, Name: "late-finish-target", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&target).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "Out of order durable final summary", Kind: "race_pull_finish",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeScan,
		Status: meta.SourceStatusActive, Revision: 1, ScheduleType: "interval", ScheduleExpression: "6h",
		TargetNodeID: &target.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	manager := auth.New("out-of-order-finish-secret", time.Hour)
	token, err := manager.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := (&Server{DB: db, Auth: manager, AllowedOrigin: "http://localhost"}).Router()
	runID := uuid.NewString()
	path := fmt.Sprintf("/api/v1/sources/%d/runs", source.ID)
	request(t, router, http.MethodPost, path, token,
		strings.NewReader(fmt.Sprintf(`{"run_id":%q,"trigger":"scheduled"}`, runID)), http.StatusCreated)
	progressPath := fmt.Sprintf("%s/%s/progress", path, runID)
	finishPath := fmt.Sprintf("%s/%s/finish", path, runID)

	// The old terminal summary is prepared first, but its authenticated finish
	// HTTP request is held until AFTER newer cumulative progress commits.
	oldBody := `{"status":"completed","complete_inventory":true,"summary":{"scanned_items":7,"scanned_bytes":700,"new_items":2,"new_bytes":200,"planned_transfer_items":2,"planned_transfer_bytes":200}}`
	oldPrepared := make(chan struct{})
	releaseOld := make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(releaseOld) }) }
	t.Cleanup(unblock)
	type httpResult struct {
		status int
		body   string
	}
	oldDone := make(chan httpResult, 1)
	go func() {
		close(oldPrepared)
		<-releaseOld
		req := httptest.NewRequest(http.MethodPost, finishPath, strings.NewReader(oldBody))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		oldDone <- httpResult{status: rec.Code, body: rec.Body.String()}
	}()
	<-oldPrepared
	newerBody := `{"summary":{"scanned_items":70,"scanned_bytes":7000,"new_items":12,"new_bytes":1200,"planned_transfer_items":12,"planned_transfer_bytes":1200}}`
	request(t, router, http.MethodPost, progressPath, token, strings.NewReader(newerBody), http.StatusNoContent)
	var before meta.SyncRun
	if err := db.Where("id = ? AND source_id = ?", runID, source.ID).First(&before).Error; err != nil {
		t.Fatal(err)
	}
	if before.Status != meta.SyncRunStatusRunning || before.ScannedItems != 70 || before.ScannedBytes != 7000 || before.NewItems != 12 {
		t.Fatalf("newer real HTTP progress did not persist before releasing old request: %+v", before)
	}

	unblock()
	select {
	case result := <-oldDone:
		if result.status != http.StatusOK {
			t.Fatalf("old valid authenticated finish request failed setup: status=%d body=%s", result.status, result.body)
		}
	case <-time.After(12 * time.Second):
		t.Fatal("delayed HTTP finish request did not complete")
	}
	var after meta.SyncRun
	if err := db.Where("id = ? AND source_id = ?", runID, source.ID).First(&after).Error; err != nil {
		t.Fatal(err)
	}
	if after.Status != meta.SyncRunStatusCompleted {
		t.Fatalf("valid delayed finish did not finalize historical run: status=%s", after.Status)
	}
	if after.ScannedItems < before.ScannedItems || after.ScannedBytes < before.ScannedBytes ||
		after.NewItems < before.NewItems || after.NewBytes < before.NewBytes ||
		after.PlannedTransferItems < before.PlannedTransferItems || after.PlannedTransferBytes < before.PlannedTransferBytes {
		t.Fatalf("delayed finish summary rewound cumulative counters after newer committed HTTP progress: before=scanned(%d,%d) new(%d,%d) planned(%d,%d), after=scanned(%d,%d) new(%d,%d) planned(%d,%d)",
			before.ScannedItems, before.ScannedBytes, before.NewItems, before.NewBytes, before.PlannedTransferItems, before.PlannedTransferBytes,
			after.ScannedItems, after.ScannedBytes, after.NewItems, after.NewBytes, after.PlannedTransferItems, after.PlannedTransferBytes)
	}
}
