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
	"gorm.io/gorm/clause"
)

// R-SYNC-001-A: a new authenticated durable begin and an owner delete compete
// for the same Source. Either begin commits and delete is refused, or delete
// commits and begin is rejected. Never leave an orphan running SyncRun.
func TestConcurrentSourceDeleteAndDurableBeginCannotOrphanRun(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("XD_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	rootDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "source_delete_begin_race_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := rootDB.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootDB.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error })
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
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(6)
	sqlDB.SetMaxIdleConns(0)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.Source{}, &meta.SyncRun{}, &meta.SourceItem{}, &meta.SourceRunFailure{}, &meta.SourceRunSkip{}); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{Username: "source-delete-begin-race-owner", PasswordHash: "not-used", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	target := meta.Node{OwnerID: owner.ID, Name: "delete-begin-target", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&target).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "Concurrent delete or begin", Kind: "race_pull_delete",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeScan,
		Status: meta.SourceStatusActive, Revision: 1, ScheduleType: "interval", ScheduleExpression: "6h",
		TargetNodeID: &target.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	manager := auth.New("delete-begin-race-secret", time.Hour)
	token, err := manager.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := (&Server{DB: db, Auth: manager, AllowedOrigin: "http://localhost"}).Router()
	sourcePath := fmt.Sprintf("/api/v1/sources/%d", source.ID)
	runPath := sourcePath + "/runs"
	runID := uuid.NewString()

	// Force the two real HTTP requests to compete at the Source row lock.
	lockEntered := make(chan struct{})
	unlock := make(chan struct{})
	lockDone := make(chan error, 1)
	var once sync.Once
	release := func() { once.Do(func() { close(unlock) }) }
	t.Cleanup(release)
	go func() {
		lockDone <- db.Transaction(func(tx *gorm.DB) error {
			var locked meta.Source
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ? AND owner_id = ?", source.ID, owner.ID).First(&locked).Error; err != nil {
				return err
			}
			close(lockEntered)
			select {
			case <-unlock:
				return nil
			case <-time.After(12 * time.Second):
				return fmt.Errorf("Source test lock was not released")
			}
		})
	}()
	select {
	case <-lockEntered:
	case err := <-lockDone:
		t.Fatalf("could not hold Source lock: %v", err)
	case <-time.After(8 * time.Second):
		t.Fatal("Source row lock fixture did not start")
	}
	type httpOutcome struct {
		kind string
		code int
		body string
	}
	started := make(chan struct{}, 2)
	results := make(chan httpOutcome, 2)
	send := func(kind, method, path, body string, headers map[string]string) {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		for key, value := range headers {
			req.Header.Set(key, value)
		}
		rec := httptest.NewRecorder()
		started <- struct{}{}
		router.ServeHTTP(rec, req)
		results <- httpOutcome{kind: kind, code: rec.Code, body: rec.Body.String()}
	}
	go send("begin", http.MethodPost, runPath,
		fmt.Sprintf("{\"run_id\":%q,\"trigger\":\"scheduled\"}", runID), nil)
	go send("delete", http.MethodDelete, sourcePath, "",
		map[string]string{"If-Match": "\"1\""})
	<-started
	<-started
	release()
	select {
	case err := <-lockDone:
		if err != nil {
			t.Fatalf("held Source transaction failed: %v", err)
		}
	case <-time.After(12 * time.Second):
		t.Fatal("held Source transaction failed to unlock")
	}
	outcomes := make(map[string]httpOutcome)
	for i := 0; i < 2; i++ {
		select {
		case r := <-results:
			outcomes[r.kind] = r
		case <-time.After(12 * time.Second):
			t.Fatal("concurrent Source begin/delete HTTP request did not finish")
		}
	}
	begin, deleted := outcomes["begin"], outcomes["delete"]
	var sourceCount, runCount int64
	if err := db.Model(&meta.Source{}).Where("id = ?", source.ID).Count(&sourceCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.SyncRun{}).Where("source_id = ?", source.ID).Count(&runCount).Error; err != nil {
		t.Fatal(err)
	}
	switch {
	case begin.code == http.StatusCreated && deleted.code == http.StatusConflict:
		if sourceCount != 1 || runCount != 1 {
			t.Fatalf("begin won but delete lost Source or SyncRun: source=%d runs=%d", sourceCount, runCount)
		}
		var run meta.SyncRun
		if err := db.Where("id = ? AND source_id = ?", runID, source.ID).First(&run).Error; err != nil {
			t.Fatal(err)
		}
		if run.Status != meta.SyncRunStatusRunning || run.SourceRevision != source.Revision {
			t.Fatalf("delete was not fenced while durable run is active: %+v", run)
		}
		requestWithHeaders(t, router, http.MethodDelete, sourcePath, token, nil,
			http.StatusConflict, map[string]string{"If-Match": "\"1\""})
	case begin.code == http.StatusNotFound && deleted.code == http.StatusNoContent:
		if sourceCount != 0 || runCount != 0 {
			t.Fatalf("delete won but left Source or orphan durable SyncRun: source=%d runs=%d", sourceCount, runCount)
		}
	default:
		t.Fatalf("concurrent Source begin/delete violated exclusive outcome: begin=%d %q, delete=%d %q, source=%d runs=%d",
			begin.code, begin.body, deleted.code, deleted.body, sourceCount, runCount)
	}
}
