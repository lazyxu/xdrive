package api

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestManagedUploadAuthorityKeepsPullRunAndLocalPushSeparate(t *testing.T) {
	db, _, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.SyncRun{}, &meta.UploadSession{}); err != nil {
		t.Fatal(err)
	}
	umbrella := createFilePropertiesDir(t, db, owner.ID, root.ID, "同步文件夹")
	pull := createFilePropertiesDir(t, db, owner.ID, umbrella.ID, "远程拉取")
	connector := createFilePropertiesDir(t, db, owner.ID, pull.ID, "Synology Photos")
	target := createFilePropertiesDir(t, db, owner.ID, connector.ID, "Photos")
	child := createFilePropertiesDir(t, db, owner.ID, target.ID, "Albums")
	ordinary := createFilePropertiesDir(t, db, owner.ID, root.ID, "Ordinary")
	source := meta.Source{
		OwnerID: owner.ID, Name: "Photos", Kind: synologySourceKind,
		Direction: meta.SourceDirectionPull,
		SyncMode:  meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync,
		Status: meta.SourceStatusActive, Revision: 1,
		TargetNodeID: &target.ID, TargetManaged: true,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	const runID = "a54b1e36-cff3-47cf-8f14-6c21e1ec8d74"
	run := meta.SyncRun{
		ID: runID, SourceID: source.ID, SourceRevision: source.Revision,
		Mode: meta.SourceRunModeSync, Status: meta.SyncRunStatusRunning,
		Trigger: meta.SyncRunTriggerManual, TargetNodeID: &target.ID,
		StartedAt: time.Now().UTC(),
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	regular, _ := gin.CreateTestContext(httptest.NewRecorder())
	scoped, _ := gin.CreateTestContext(httptest.NewRecorder())
	scoped.Set("sourceRunScope", sourceRunScope{sourceID: source.ID, runID: runID})
	wrongRun, _ := gin.CreateTestContext(httptest.NewRecorder())
	wrongRun.Set("sourceRunScope", sourceRunScope{
		sourceID: source.ID, runID: "b6b2bd48-2a4c-45a9-a9d2-ce80b855f58d",
	})
	ctx := context.Background()
	req := uploadInitRequest{ParentID: &child.ID, Name: "photo.jpg",
		ConflictPolicy: meta.UploadConflictPolicyFail, Size: 12}

	// Ordinary Files users retain ordinary writes, but neither they nor an
	// arbitrary lp2_ prefix may create files inside another Source's tree.
	if err := requireSourceRunOrLocalPushTargetTx(ctx, db, regular, owner.ID, ordinary.ID, req); err != nil {
		t.Fatalf("ordinary Files folder was rejected: %v", err)
	}
	if err := requireSourceRunOrLocalPushTargetTx(ctx, db, regular, owner.ID, child.ID, req); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("ordinary Owner gained Pull SourceRun writes: %v", err)
	}
	forged := req
	forged.ResumeKey = "lp2_" + strings.Repeat("a", 64)
	forged.SHA256 = strings.Repeat("b", 64)
	if err := requireSourceRunOrLocalPushTargetTx(ctx, db, regular, owner.ID, child.ID, forged); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("fabricated lp2_ prefix bypassed Source authorization: %v", err)
	}

	// The server-signed active Pull SourceRun has precisely one subtree.
	if err := requireSourceRunOrLocalPushTargetTx(ctx, db, scoped, owner.ID, child.ID, req); err != nil {
		t.Fatalf("valid Pull worker lost managed upload capability: %v", err)
	}
	if err := requireSourceRunOrLocalPushTargetTx(ctx, db, scoped, owner.ID, ordinary.ID, req); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("Pull SourceRun escaped its managed subtree: %v", err)
	}
	if err := requireSourceRunOrLocalPushTargetTx(ctx, db, wrongRun, owner.ID, child.ID, req); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("unrelated SourceRun gained target writes: %v", err)
	}

	// The checked Finalize path must preserve the same scoped separation.
	session := meta.UploadSession{ID: "120af9d6-9c02-4080-a6ff-2f219b17fda1",
		OwnerID: owner.ID, ParentID: &child.ID, Name: req.Name,
		SourceRunID: runID, Status: meta.UploadStatusActive,
		ConflictPolicy: meta.UploadConflictPolicyFail, TotalSize: req.Size}
	if err := requireSourceRunOrLocalPushFinalizeTx(ctx, db, scoped, session, child.ID); err != nil {
		t.Fatalf("valid Pull worker Finalize authorization rejected: %v", err)
	}
	if err := requireSourceRunOrLocalPushFinalizeTx(ctx, db, regular, session, child.ID); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("ordinary Owner gained SourceRun Finalize rights: %v", err)
	}
	// Cancellation revokes a still-signed SourceRun writer before the JWT
	// expires, including Finalize on an already prepared UploadSession.
	cancelled := time.Now().UTC()
	if err := db.Model(&meta.SyncRun{}).Where("id = ?", runID).
		Update("cancel_requested_at", &cancelled).Error; err != nil {
		t.Fatal(err)
	}
	if err := requireSourceRunOrLocalPushFinalizeTx(ctx, db, scoped, session, child.ID); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("cancelled SourceRun still finalized a managed upload: %v", err)
	}
	if err := db.Model(&meta.SyncRun{}).Where("id = ?", runID).
		Update("status", meta.SyncRunStatusCompleted).Error; err != nil {
		t.Fatal(err)
	}
	if err := requireSourceRunOrLocalPushTargetTx(ctx, db, scoped, owner.ID, child.ID, req); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("completed SourceRun continued writing: %v", err)
	}
}
