package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"github.com/lazyxu/xdrive/internal/storageadvice"
)

func TestStorageOptimizationAdvisoryRealPinnedCASAndPersistedRead(t *testing.T) {
	db := newSystemMaintenanceTaskTestDB(t)
	if err := db.AutoMigrate(&meta.ContentBlob{}); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	store, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	keys := make([]string, 0, 16)
	for i := 0; i < 16; i++ {
		bytesForBlob := bytes.Repeat([]byte{byte(i)}, 1024)
		digest := sha256.Sum256(bytesForBlob)
		hash := hex.EncodeToString(digest[:])
		key, err := storage.ContentAddressedKey(hash)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.Put(ctx, key, bytes.NewReader(bytesForBlob)); err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.ContentBlob{
			SHA256: hash, Size: int64(len(bytesForBlob)), StorageKey: key,
			RefCount: 1, State: meta.ContentBlobStateReady,
		}).Error; err != nil {
			t.Fatal(err)
		}
		keys = append(keys, key)
	}
	srv := &Server{DB: db, Store: store}
	report, err := srv.captureStorageOptimizationAdvice(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if report.SampleObjects != 16 || report.Pack.Objects != 16 ||
		report.Pack.ProjectedSavingsPercent < 25 {
		t.Fatalf("unexpected physical-CAS Pack evaluation: %+v", report)
	}
	if report.Recommendations[3].Decision != "candidate" ||
		report.Recommendations[2].Decision != "observe" {
		t.Fatalf("unexpected online/backup isolation: %+v", report.Recommendations)
	}
	started := time.Now().UTC()
	run := meta.SystemMaintenanceRun{
		Kind:      meta.SystemMaintenanceKindStorageOptimization,
		Status:    meta.SystemMaintenanceStatusRunning,
		Phase:     meta.SystemMaintenancePhaseStorageOptimization,
		StartedAt: started,
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := srv.evaluateStorageOptimizationTask(ctx, run.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&run).Updates(map[string]any{
		"status":      meta.SystemMaintenanceStatusSuccess,
		"finished_at": time.Now().UTC(),
	}).Error; err != nil {
		t.Fatal(err)
	}
	var persisted meta.SystemMaintenanceRun
	if err := db.First(&persisted, run.ID).Error; err != nil {
		t.Fatal(err)
	}
	var saved storageadvice.Report
	if err := json.Unmarshal([]byte(persisted.ReportJSON), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.SampleObjects != 16 || saved.Pack.Objects != 16 {
		t.Fatalf("persisted report lost sample evidence: %+v", saved)
	}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/storage/optimization-advice", nil)
	srv.adminStorageOptimizationAdvice(c)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "\"report\"") {
		t.Fatalf("failed to reload advisory: %d %s", w.Code, w.Body.String())
	}
	for _, key := range keys {
		if strings.Contains(w.Body.String(), key) {
			t.Fatal("private CAS identifiers must not appear in aggregate advisory JSON")
		}
	}
	for _, key := range keys {
		read, err := store.Open(ctx, key)
		if err != nil {
			t.Fatal(err)
		}
		stat, err := read.Stat()
		_ = read.Close()
		if err != nil || stat.Size() != 1024 {
			t.Fatal("advisory changed the original immutable Blob")
		}
	}
}
