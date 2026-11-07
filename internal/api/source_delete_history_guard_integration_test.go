package api

import (
	"errors"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// DELETE archives every configured or previously-used Source so its provider
// identity, target binding, and synchronization history remain recoverable.
// Only a pristine, unbound draft can be hard-deleted.
// Use enabled Yike Pull for the generic lifecycle; disabled Synology Pull
// DELETE is independently verified as HTTP 410 in its dedicated regression.
func TestSourceDeleteArchivesRetainedStateAndHardDeletesPristineDraft(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(
		&meta.SyncRun{}, &meta.SourceItem{}, &meta.SourceCollection{},
		&meta.SourceRunFailure{}, &meta.SourceRunSkip{}, &meta.SourceCredential{},
		&meta.SourceConnectorConfig{}, &meta.SourceItemAlias{}, &meta.SourceItemMetadata{},
	); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("source-delete-archive-test", time.Hour)
	router := server.Router()
	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}

	for _, scenario := range []string{
		"source-item", "collection-only", "completed-run",
		"credential-only", "connector-config-only", "bound-target", "pristine",
	} {
		t.Run(scenario, func(t *testing.T) {
			src := meta.Source{
				OwnerID: owner.ID, Name: "delete-" + scenario,
				Kind: yikeSourceKind, Direction: meta.SourceDirectionPull,
				SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeScan,
				Status: meta.SourceStatusPaused, Revision: 1,
			}
			var target *meta.Node
			if scenario == "bound-target" {
				dir := createFilePropertiesDir(t, db, owner.ID, root.ID, "bound-"+scenario)
				target = &dir
				src.TargetNodeID = &dir.ID
				src.TargetManaged = true
			}
			if err := db.Create(&src).Error; err != nil {
				t.Fatal(err)
			}
			switch scenario {
			case "source-item":
				item := meta.SourceItem{
					SourceID: src.ID, ExternalID: "remote-file", Kind: meta.SourceItemKindFile,
					Path: "file.jpg", State: meta.SourceItemStatePending, LastSeenAt: time.Now().UTC(),
				}
				if err := db.Create(&item).Error; err != nil {
					t.Fatal(err)
				}
			case "collection-only":
				collection := meta.SourceCollection{
					SourceID: src.ID, ExternalID: "album-1", Kind: "album",
					Name: "Remote album", State: meta.SourceCollectionStateActive, LastSeenAt: time.Now().UTC(),
				}
				if err := db.Create(&collection).Error; err != nil {
					t.Fatal(err)
				}
			case "completed-run":
				finished := time.Now().UTC()
				run := meta.SyncRun{
					ID: uuid.NewString(), SourceID: src.ID, SourceRevision: src.Revision,
					Mode: meta.SourceRunModeScan, Trigger: meta.SyncRunTriggerManual,
					Status: meta.SyncRunStatusCompleted, StartedAt: finished.Add(-time.Minute), FinishedAt: &finished,
				}
				if err := db.Create(&run).Error; err != nil {
					t.Fatal(err)
				}
			case "credential-only":
				credential := meta.SourceCredential{SourceID: src.ID, Ciphertext: []byte("encrypted"), KeyVersion: 1}
				if err := db.Create(&credential).Error; err != nil {
					t.Fatal(err)
				}
			case "connector-config-only":
				config := meta.SourceConnectorConfig{SourceID: src.ID, Payload: "{}"}
				if err := db.Create(&config).Error; err != nil {
					t.Fatal(err)
				}
			}

			requestWithHeaders(t, router, http.MethodDelete,
				fmt.Sprintf("/api/v1/sources/%d", src.ID), token, nil,
				http.StatusNoContent, map[string]string{"If-Match": `"1"`})

			var retained meta.Source
			err := db.First(&retained, src.ID).Error
			if scenario == "pristine" {
				if !errors.Is(err, gorm.ErrRecordNotFound) {
					t.Fatalf("pristine draft should be hard-deleted, got source=%+v err=%v", retained, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("configured Source was deleted instead of archived: %v", err)
			}
			if retained.Status != meta.SourceStatusArchived || retained.Revision != 2 ||
				(retained.TargetNodeID == nil) != (src.TargetNodeID == nil) ||
				(retained.TargetNodeID != nil && *retained.TargetNodeID != *src.TargetNodeID) ||
				retained.RunRequestedAt != nil || retained.RetryAt != nil || retained.RetryAttempt != 0 {
				t.Fatalf("DELETE did not archive without changing durable binding: %+v", retained)
			}
			if target != nil {
				var preserved meta.Node
				if err := db.First(&preserved, target.ID).Error; err != nil {
					t.Fatalf("managed target was removed: %v", err)
				}
			}
		})
	}
}
