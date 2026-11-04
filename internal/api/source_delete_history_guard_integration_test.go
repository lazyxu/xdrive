package api

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

// Hard deletion is still permitted for a pristine Source draft, but must not
// cascade away provider identity, collection metadata or completed run history.
func TestSourceHardDeleteRequiresArchiveForRetainedHistory(t *testing.T) {
	db, server, owner, _, _ := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.SyncRun{}, &meta.SourceItem{}, &meta.SourceCollection{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("source-history-delete-test", time.Hour)
	router := server.Router()
	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}

	for _, scenario := range []string{"source-item", "collection-only", "completed-run", "pristine"} {
		t.Run(scenario, func(t *testing.T) {
			src := meta.Source{
				OwnerID: owner.ID, Name: "history-" + scenario,
				Kind: "synology_files", Direction: meta.SourceDirectionPull,
				SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeScan,
				Status: meta.SourceStatusPaused, Revision: 1,
			}
			if err := db.Create(&src).Error; err != nil {
				t.Fatal(err)
			}
			switch scenario {
			case "source-item":
				item := meta.SourceItem{
					SourceID: src.ID, ExternalID: "remote-file", Kind: meta.SourceItemKindFile,
					Path: "file.jpg", State: meta.SourceItemStatePending,
					LastSeenAt: time.Now().UTC(),
				}
				if err := db.Create(&item).Error; err != nil {
					t.Fatal(err)
				}
			case "collection-only":
				collection := meta.SourceCollection{
					SourceID: src.ID, ExternalID: "album-1", Kind: "album",
					Name: "Remote album", State: meta.SourceCollectionStateActive,
					LastSeenAt: time.Now().UTC(),
				}
				if err := db.Create(&collection).Error; err != nil {
					t.Fatal(err)
				}
			case "completed-run":
				finished := time.Now().UTC()
				run := meta.SyncRun{
					ID: uuid.NewString(), SourceID: src.ID, SourceRevision: src.Revision,
					Mode: meta.SourceRunModeScan, Trigger: meta.SyncRunTriggerManual,
					Status: meta.SyncRunStatusCompleted,
					StartedAt: finished.Add(-time.Minute), FinishedAt: &finished,
				}
				if err := db.Create(&run).Error; err != nil {
					t.Fatal(err)
				}
			}

			code := http.StatusConflict
			if scenario == "pristine" {
				code = http.StatusNoContent
			}
			response := requestWithHeaders(t, router, http.MethodDelete,
				fmt.Sprintf("/api/v1/sources/%d", src.ID), token, nil,
				code, map[string]string{"If-Match": `"1"`})
			if scenario != "pristine" && !strings.Contains(response.Body.String(), "archive") {
				t.Fatalf("missing archive guidance: %s", response.Body.String())
			}
			var retained int64
			if err := db.Model(&meta.Source{}).Where("id = ?", src.ID).Count(&retained).Error; err != nil {
				t.Fatal(err)
			}
			expected := int64(1)
			if scenario == "pristine" {
				expected = 0
			}
			if retained != expected {
				t.Fatalf("unexpected Source retention: scenario=%s count=%d", scenario, retained)
			}
			if scenario == "pristine" {
				return
			}
			var historyCount int64
			var model any = &meta.SourceItem{}
			switch scenario {
			case "collection-only":
				model = &meta.SourceCollection{}
			case "completed-run":
				model = &meta.SyncRun{}
			}
			if err := db.Model(model).Where("source_id = ?", src.ID).
				Count(&historyCount).Error; err != nil {
				t.Fatal(err)
			}
			if historyCount != 1 {
				t.Fatalf("history lost after rejected delete: scenario=%s count=%d", scenario, historyCount)
			}
		})
	}
}
