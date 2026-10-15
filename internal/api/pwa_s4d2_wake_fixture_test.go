//go:build linux

package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// S4D2 is an explicit synthetic Server-state transition in a private test
// fixture, not a claim that a real sync worker ran after OS process eviction.
type pwaS4D2WakeFixture struct {
	ownerRunID   string
	foreignRunID string
	advanceCalls atomic.Int64
	mutations    atomic.Int64
}

func pwaS4D2Prepare(t *testing.T, db *gorm.DB, ownerID, foreignID uint64) *pwaS4D2WakeFixture {
	t.Helper()
	ownerSource := meta.Source{
		OwnerID:   ownerID,
		Name:      "PWA S4D2 synthetic owner sync",
		Kind:      "test",
		Direction: meta.SourceDirectionPull,
		SyncMode:  meta.SourceSyncModeBackup,
		RunMode:   meta.SourceRunModeSync,
		Status:    meta.SourceStatusActive,
		Revision:  1,
	}
	foreignSource := ownerSource
	foreignSource.ID = 0
	foreignSource.OwnerID = foreignID
	foreignSource.Name = "PWA S4D2 synthetic foreign sync"
	if err := db.Create(&ownerSource).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&foreignSource).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	ownerRun := meta.SyncRun{
		ID:                     "4d200000-0000-4000-8000-000000000001",
		SourceID:               ownerSource.ID,
		RunNumber:              1,
		Mode:                   meta.SourceRunModeSync,
		SyncMode:               meta.SourceSyncModeBackup,
		Trigger:                meta.SyncRunTriggerManual,
		Status:                 meta.SyncRunStatusRunning,
		PlannedTransferItems:   10,
		ProcessedTransferItems: 4,
		StartedAt:              now.Add(-time.Minute),
		UpdatedAt:              now,
	}
	foreignRun := ownerRun
	foreignRun.ID = "4d200000-0000-4000-8000-000000000002"
	foreignRun.SourceID = foreignSource.ID
	if err := db.Create(&ownerRun).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&foreignRun).Error; err != nil {
		t.Fatal(err)
	}
	return &pwaS4D2WakeFixture{
		ownerRunID:   ownerRun.ID,
		foreignRunID: foreignRun.ID,
	}
}

func (f *pwaS4D2WakeFixture) advance(w http.ResponseWriter, r *http.Request, db *gorm.DB) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if r.Header.Get("X-PWA-Synthetic-Advance") != "s4d2-fixture-only" {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if !f.advanceCalls.CompareAndSwap(0, 1) {
		w.WriteHeader(http.StatusConflict)
		return
	}
	now := time.Now().UTC()
	result := db.Model(&meta.SyncRun{}).
		Where("id = ? AND status = ?", f.ownerRunID, meta.SyncRunStatusRunning).
		Updates(map[string]any{
			"status":                   meta.SyncRunStatusCompleted,
			"processed_transfer_items": int64(10),
			"finished_at":              &now,
			"updated_at":               now,
		})
	if result.Error != nil || result.RowsAffected != 1 {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (f *pwaS4D2WakeFixture) verify(
	t *testing.T,
	db *gorm.DB,
	router http.Handler,
	ownerToken, foreignToken string,
) {
	t.Helper()
	if f.advanceCalls.Load() != 1 || f.mutations.Load() != 0 {
		t.Fatalf("S4D2 test transition or client-side mutation incorrect: advances=%d mutations=%d",
			f.advanceCalls.Load(), f.mutations.Load())
	}
	var ownerRun, foreignRun meta.SyncRun
	if err := db.Where("id = ?", f.ownerRunID).First(&ownerRun).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("id = ?", f.foreignRunID).First(&foreignRun).Error; err != nil {
		t.Fatal(err)
	}
	if ownerRun.Status != meta.SyncRunStatusCompleted ||
		ownerRun.FinishedAt == nil || ownerRun.ProcessedTransferItems != 10 ||
		foreignRun.Status != meta.SyncRunStatusRunning ||
		foreignRun.FinishedAt != nil || foreignRun.ProcessedTransferItems != 4 {
		t.Fatal("S4D2 synthetic server task completion or foreign running task was modified")
	}
	readSummary := func(token string, want int) {
		t.Helper()
		response := request(t, router, http.MethodGet,
			"/api/v1/background-tasks/active-summary", token, nil, http.StatusOK)
		var value backgroundTaskActiveSummaryDTO
		if err := json.Unmarshal(response.Body.Bytes(), &value); err != nil {
			t.Fatal(err)
		}
		if value.ActiveTotal != want || value.SyncRun != want {
			t.Fatalf("S4D2 authoritative owner summary active=%d sync=%d want=%d",
				value.ActiveTotal, value.SyncRun, want)
		}
	}
	readPage := func(token string, expectedID, expectedState, excludedID string) {
		t.Helper()
		response := request(t, router, http.MethodGet,
			"/api/v1/background-tasks/page?limit=50", token, nil, http.StatusOK)
		var page backgroundTaskPageDTO
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		found := false
		for _, task := range append(page.CurrentItems, page.HistoryItems...) {
			if task.ID == "sync-run:"+excludedID {
				t.Fatal("S4D2 leaked foreign user's task to current viewer")
			}
			if task.ID == "sync-run:"+expectedID {
				if task.State != expectedState {
					t.Fatalf("S4D2 task state=%s expected=%s", task.State, expectedState)
				}
				found = true
			}
		}
		if !found {
			t.Fatal("S4D2 correct Server task missing from owner-scoped page")
		}
	}
	readSummary(ownerToken, 0)
	readSummary(foreignToken, 1)
	readPage(ownerToken, f.ownerRunID, "completed", f.foreignRunID)
	readPage(foreignToken, f.foreignRunID, "running", f.ownerRunID)
	t.Log(fmt.Sprintf("PWA_S4D2_GIN_POSTGRES_VERIFIED advanced=%d mutations=%d ownerComplete=true foreignUnchanged=true",
		f.advanceCalls.Load(), f.mutations.Load()))
}
