package api

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func TestSourceArchiveAndDeleteRejectLiveUploadWithoutRunningRun(t *testing.T) {
	for _, tc := range []struct {
		name       string
		method     string
		pathSuffix string
		okStatus   int
	}{
		{"archive", http.MethodPost, "/archive", http.StatusOK},
		{"delete", http.MethodDelete, "", http.StatusNoContent},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, server, owner, stranger, root := setupFilePropertiesTestDB(t)
			if err := db.AutoMigrate(&meta.SyncRun{}, &meta.UploadSession{}); err != nil {
				t.Fatal(err)
			}
			gin.SetMode(gin.TestMode)
			server.Auth = auth.New("source-lifecycle-inflight", time.Hour)
			router := server.Router()
			token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
			if err != nil {
				t.Fatal(err)
			}
			other, err := server.Auth.Issue(stranger.ID, stranger.SessionVersion)
			if err != nil {
				t.Fatal(err)
			}
			target := createFilePropertiesDir(t, db, owner.ID, root.ID, "managed source target")
			file := createFilePropertiesFile(t, db, owner.ID, target.ID, "preserve.jpg", 8)
			queuedAt := time.Now().UTC()
			source := meta.Source{
				OwnerID: owner.ID, Name: "Source", Kind: "synology_files",
				Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
				RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusActive,
				Revision: 1, TargetNodeID: &target.ID, RunRequestedAt: &queuedAt,
			}
			if err := db.Create(&source).Error; err != nil {
				t.Fatal(err)
			}
			session := meta.UploadSession{
				ID: uuid.NewString(), OwnerID: owner.ID, SourceID: source.ID,
				SourceRevision: source.Revision, SourceTargetID: target.ID,
				ParentID: &target.ID, Name: "unsettled.bin",
				ConflictPolicy: meta.UploadConflictPolicyFail,
				TotalSize: 4, ChunkSize: 4096, ChunkCount: 1,
				Status: meta.UploadStatusActive, ExpiresAt: time.Now().UTC().Add(time.Hour),
			}
			if err := db.Create(&session).Error; err != nil {
				t.Fatal(err)
			}
			path := fmt.Sprintf("/api/v1/sources/%d%s", source.ID, tc.pathSuffix)
			headers := map[string]string{"If-Match": strconv.Quote("1")}
			requestWithHeaders(t, router, tc.method, path, other, nil, http.StatusNotFound, headers)
			requestWithHeaders(t, router, tc.method, path, token, nil, http.StatusConflict, headers)
			var before meta.Source
			if err := db.First(&before, source.ID).Error; err != nil {
				t.Fatal(err)
			}
			if before.Status != meta.SourceStatusActive || before.Revision != 1 ||
				before.RunRequestedAt == nil || before.TargetNodeID == nil ||
				*before.TargetNodeID != target.ID {
				t.Fatalf("failed action changed Source: %+v", before)
			}
			if err := db.Model(&meta.UploadSession{}).Where("id = ?", session.ID).
				Update("status", meta.UploadStatusFinalized).Error; err != nil {
					t.Fatal(err)
				}
			requestWithHeaders(t, router, tc.method, path, token, nil, tc.okStatus, headers)
			var after meta.Source
			var kept meta.Node
			if err := db.First(&after, source.ID).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.First(&kept, file.ID).Error; err != nil {
				t.Fatal(err)
			}
			if after.Status != meta.SourceStatusArchived || after.Revision != 2 ||
				after.RunRequestedAt != nil || after.TargetNodeID == nil ||
				*after.TargetNodeID != target.ID || kept.ParentID == nil ||
				*kept.ParentID != target.ID {
				t.Fatalf("settled archive/delete changed original identity: source=%+v file=%+v", after, kept)
			}
		})
	}
}

// An old native Stage/Operation can exist without an active SourceRun,
// and the Source's exact Device proof is not a substitute for settling it.
func TestSourceLifecycleUnsettledNativeOperationsAndExpiry(t *testing.T) {
	db, _, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.SyncRun{}, &meta.UploadSession{},
		&meta.LocalPushCommonUploadOperation{}, &meta.LocalPushOperationIntent{},
		&meta.LocalPushStaging{}, &meta.LocalPushQuotaHold{}); err != nil {
			t.Fatal(err)
		}
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "native source target")
	source := meta.Source{
		OwnerID: owner.ID, Name: "local push", Kind: meta.SourceKindLocalFolder,
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		Status: meta.SourceStatusPaused, Revision: 1, TargetNodeID: &target.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	check := func(block bool) {
		t.Helper()
		err := db.Transaction(func(tx *gorm.DB) error { return requireSourceNoUnsettledWritesTx(tx, source) })
		if block && !errors.Is(err, errSourceUnsettledWrites) {
			t.Fatalf("live operation not fenced: %v", err)
		}
		if !block && err != nil {
			t.Fatalf("settled operation still blocked: %v", err)
		}
	}
	check(false)
	common := meta.LocalPushCommonUploadOperation{
		OperationID: uuid.NewString(), OwnerID: owner.ID, SourceID: source.ID,
		SourceTargetID: target.ID, State: meta.LocalPushCommonUploadReserved,
	}
	if err := db.Create(&common).Error; err != nil {
		t.Fatal(err)
	}
	check(true)
	if err := db.Model(&meta.LocalPushCommonUploadOperation{}).Where("operation_id = ?", common.OperationID).
		Update("state", meta.LocalPushCommonUploadBound).Error; err != nil {
			t.Fatal(err)
		}
	check(true)
	if err := db.Model(&meta.LocalPushCommonUploadOperation{}).Where("operation_id = ?", common.OperationID).
		Update("state", meta.LocalPushCommonUploadCommitted).Error; err != nil {
			t.Fatal(err)
		}
	check(false)
	now := time.Now().UTC()
	intent := meta.LocalPushOperationIntent{
		ID: uuid.NewString(), SourceID: source.ID, Generation: 1, OwnerID: owner.ID,
		State: meta.LocalPushOperationIntentReserved, IssuedAt: now, ExpiresAt: now.Add(time.Hour),
	}
	if err := db.Create(&intent).Error; err != nil {
		t.Fatal(err)
	}
	check(true)
	if err := db.Model(&meta.LocalPushOperationIntent{}).Where("id = ?", intent.ID).
		Update("expires_at", now.Add(-time.Minute)).Error; err != nil {
			t.Fatal(err)
		}
	check(false)
	stage := meta.LocalPushStaging{
		SourceID: source.ID, StageID: uuid.NewString(), OwnerID: owner.ID,
		TargetNodeID: target.ID, Status: localPushStageReserved, ExpiresAt: now.Add(time.Hour),
	}
	if err := db.Create(&stage).Error; err != nil {
		t.Fatal(err)
	}
	for _, status := range []string{localPushStageReserved, localPushStageWriting, localPushStageReady} {
		if err := db.Model(&meta.LocalPushStaging{}).Where("source_id = ?", source.ID).
			Update("status", status).Error; err != nil {
				t.Fatal(err)
			}
		check(true)
	}
	if err := db.Model(&meta.LocalPushStaging{}).Where("source_id = ?", source.ID).
		Update("expires_at", now.Add(-time.Minute)).Error; err != nil {
			t.Fatal(err)
		}
	check(false)
	hold := meta.LocalPushQuotaHold{
		StageID: stage.StageID, OwnerID: owner.ID, SourceID: source.ID,
		TargetNodeID: target.ID, ExpiresAt: now.Add(time.Hour),
	}
	if err := db.Create(&hold).Error; err != nil {
		t.Fatal(err)
	}
	check(true)
	if err := db.Model(&meta.LocalPushQuotaHold{}).Where("stage_id = ?", hold.StageID).
		Update("released_at", &now).Error; err != nil {
			t.Fatal(err)
		}
	check(false)
}
