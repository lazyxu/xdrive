package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

// Remote Synology Pull is dormant in the folder-Push MVP, including legacy
// active Source rows. No silent migration or deletion of stored originals.
func TestDormantSynologyPullPreservesHistoryAndRejectsNewExecution(t *testing.T) {
	for _, kind := range []string{"synology_photos", "synology_files"} {
		t.Run(kind, func(t *testing.T) {
			db, server, owner, stranger, root := setupFilePropertiesTestDB(t)
			if err := db.AutoMigrate(&meta.SyncRun{}, &meta.UploadSession{},
				&meta.SourceItem{}, &meta.FileVersion{}); err != nil {
				t.Fatal(err)
			}
			gin.SetMode(gin.TestMode)
			server.Auth = auth.New("synology-pull-disabled-integration", time.Hour)
			router := server.Router()
			ownerToken, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
			if err != nil { t.Fatal(err) }
			strangerToken, err := server.Auth.Issue(stranger.ID, stranger.SessionVersion)
			if err != nil { t.Fatal(err) }

			newSource := fmt.Sprintf(`{"name":"new %s","kind":%q,"direction":"pull","sync_mode":"backup","run_mode":"sync"}`, kind, kind)
			request(t, router, http.MethodPost, "/api/v1/sources", ownerToken,
				strings.NewReader(newSource), http.StatusGone)

			target := createFilePropertiesDir(t, db, owner.ID, root.ID, "old "+kind)
			original := createFilePropertiesFile(t, db, owner.ID, target.ID, "original.jpg", 17)
			source := meta.Source{
				OwnerID: owner.ID, Name: "old "+kind, Kind: kind,
				Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
				RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive,
				Revision: 1, TargetNodeID: &target.ID, TargetManaged: true,
			}
			if err := db.Create(&source).Error; err != nil { t.Fatal(err) }
			item := meta.SourceItem{
				SourceID: source.ID, ExternalID: "old:one", NodeID: &original.ID,
				Kind: meta.SourceItemKindFile, Path: "original.jpg",
				State: meta.SourceItemStateSynced, LastSeenAt: time.Now().UTC(),
			}
			if err := db.Create(&item).Error; err != nil { t.Fatal(err) }
			version := meta.FileVersion{
				NodeID: original.ID, Revision: 1, Size: 17,
				SHA256: strings.Repeat("a", 64), StorageKey: "preserved/synology-original",
			}
			if err := db.Create(&version).Error; err != nil { t.Fatal(err) }
			run := meta.SyncRun{
				ID: uuid.NewString(), SourceID: source.ID, SourceRevision: source.Revision,
				TargetNodeID: &target.ID, Mode: meta.SourceRunModeSync,
				Trigger: meta.SyncRunTriggerManual, Status: meta.SyncRunStatusRunning,
				StartedAt: time.Now().UTC().Add(-time.Minute),
			}
			if err := db.Create(&run).Error; err != nil { t.Fatal(err) }
			session := meta.UploadSession{
				ID: uuid.NewString(), OwnerID: owner.ID, SourceRunID: run.ID,
				ParentID: &target.ID, Name: "incomplete.bin",
				ConflictPolicy: meta.UploadConflictPolicyFail, TotalSize: 4,
				ChunkSize: 4 << 20, ChunkCount: 1,
				Status: meta.UploadStatusActive, ExpiresAt: time.Now().UTC().Add(time.Hour),
			}
			if err := db.Create(&session).Error; err != nil { t.Fatal(err) }
			path := fmt.Sprintf("/api/v1/sources/%d", source.ID)
			request(t, router, http.MethodGet, path, ownerToken, nil, http.StatusOK)
			request(t, router, http.MethodGet, path, strangerToken, nil, http.StatusNotFound)
			request(t, router, http.MethodPost, path+"/trigger", strangerToken, nil, http.StatusNotFound)
			request(t, router, http.MethodPost, path+"/trigger", ownerToken, nil, http.StatusGone)
			requestWithHeaders(t, router, http.MethodPatch, path, ownerToken,
				strings.NewReader(`{"status":"active"}`), http.StatusGone,
				map[string]string{"If-Match": `"1"`})
			requestWithHeaders(t, router, http.MethodDelete, path, ownerToken,
				nil, http.StatusGone, map[string]string{"If-Match": `"1"`})
			begin := fmt.Sprintf(`{"run_id":%q,"trigger":"manual"}`, uuid.NewString())
			request(t, router, http.MethodPost, path+"/runs", ownerToken,
				strings.NewReader(begin), http.StatusGone)
			requestWithHeaders(t, router, http.MethodPost, path+"/restore",
				ownerToken, nil, http.StatusGone, map[string]string{"If-Match": `"1"`})

			if err := sourceRunContinueForCurrentSource(source, run); !errors.Is(err, errSynologyPullDisabled) {
				t.Fatalf("old running SourceRun was not denied: %v", err)
			}
			requestContext, _ := gin.CreateTestContext(httptest.NewRecorder())
			requestContext.Set("sourceRunScope", sourceRunScope{sourceID: source.ID, runID: run.ID})
			if err := trustedSourceRunTargetTx(context.Background(), db, requestContext,
				owner.ID, target.ID, true); !errors.Is(err, errManagedSourceWriteDenied) {
				t.Fatalf("old worker retained managed target write access: %v", err)
			}

			res := requestWithHeaders(t, router, http.MethodPost, path+"/archive", ownerToken,
				nil, http.StatusOK, map[string]string{"If-Match": `"1"`})
			var archived sourceDTO
			if err := json.Unmarshal(res.Body.Bytes(), &archived); err != nil { t.Fatal(err) }
			if archived.Status != meta.SourceStatusArchived || archived.Revision != 2 ||
				archived.TargetNodeID == nil || *archived.TargetNodeID != target.ID {
				t.Fatalf("archived Source lost target identity: %+v", archived)
			}
			requestWithHeaders(t, router, http.MethodPost, path+"/restore", ownerToken,
				nil, http.StatusGone, map[string]string{"If-Match": `"2"`})
			var keptRun meta.SyncRun
			if err := db.Where("id = ?", run.ID).Take(&keptRun).Error; err != nil { t.Fatal(err) }
			if keptRun.Status != meta.SyncRunStatusCancelled || keptRun.FinishedAt == nil {
				t.Fatalf("orphaned legacy run was not terminally canceled: %+v", keptRun)
			}
			var keptSource meta.Source
			var keptItem meta.SourceItem
			var keptVersion meta.FileVersion
			var keptSession meta.UploadSession
			if err := db.First(&keptSource, source.ID).Error; err != nil { t.Fatal(err) }
			if err := db.First(&keptItem, item.ID).Error; err != nil { t.Fatal(err) }
			if err := db.Where("node_id = ? AND revision = ?", version.NodeID, version.Revision).
				Take(&keptVersion).Error; err != nil { t.Fatal(err) }
			if err := db.Where("id = ?", session.ID).Take(&keptSession).Error; err != nil { t.Fatal(err) }
			if keptSource.TargetNodeID == nil || *keptSource.TargetNodeID != target.ID ||
				keptItem.NodeID == nil || *keptItem.NodeID != original.ID ||
				keptVersion.StorageKey != version.StorageKey || keptSession.SourceRunID != run.ID {
				t.Fatal("disabling Synology Pull changed existing Source/Item/CAS/upload identity")
			}
		})
	}
}
