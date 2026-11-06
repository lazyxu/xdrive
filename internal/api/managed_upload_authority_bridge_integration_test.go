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

func TestUploadSessionWriterClaimsAreExclusive(t *testing.T) {
	shareID := uint64(9)
	cases := []struct {
		name    string
		session meta.UploadSession
		deny    bool
	}{
		{name: "ordinary Owner", session: meta.UploadSession{}},
		{name: "native device Source", session: meta.UploadSession{
			SourceID: 11, SourceRevision: 2, SourceDeviceID: "device-id", SourceTargetID: 42,
		}},
		{name: "Pull SourceRun", session: meta.UploadSession{SourceRunID: "run-id"}},
		{name: "public Share", session: meta.UploadSession{ShareID: &shareID}},
		{name: "Local Push", session: meta.UploadSession{ResumeKey: "lp2_" + strings.Repeat("a", 64)}},
		{name: "Source plus Pull run", session: meta.UploadSession{SourceID: 11, SourceRunID: "run-id"}, deny: true},
		{name: "Source plus Share", session: meta.UploadSession{SourceID: 11, ShareID: &shareID}, deny: true},
		{name: "Pull run plus Share", session: meta.UploadSession{SourceRunID: "run-id", ShareID: &shareID}, deny: true},
		{name: "Local Push plus Pull run", session: meta.UploadSession{
			ResumeKey: "lp2_" + strings.Repeat("a", 64), SourceRunID: "run-id",
		}, deny: true},
		{name: "Local Push plus Share", session: meta.UploadSession{
			ResumeKey: "lp2_" + strings.Repeat("a", 64), ShareID: &shareID,
		}, deny: true},
		{name: "orphaned Source revision", session: meta.UploadSession{SourceRevision: 2}, deny: true},
		{name: "orphaned Source device", session: meta.UploadSession{SourceDeviceID: "device-id"}, deny: true},
		{name: "orphaned Source target", session: meta.UploadSession{SourceTargetID: 42}, deny: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := mixedUploadSessionWriterClaims(tc.session); got != tc.deny {
				t.Fatalf("session writer claim conflict: got=%v want=%v", got, tc.deny)
			}
		})
	}
}

func TestManagedUploadAuthorityKeepsPullRunAndLocalPushSeparate(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.SyncRun{}, &meta.UploadSession{}); err != nil {
		t.Fatal(err)
	}
	umbrella := createFilePropertiesDir(t, db, owner.ID, root.ID, "同步文件夹")
	pull := createFilePropertiesDir(t, db, owner.ID, umbrella.ID, "Pull")
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
	// Even when the target itself is ordinary, an incomplete DSM Source claim
	// cannot silently fall back to a generic Owner upload admission.
	regular.Request = httptest.NewRequest("POST", "/api/v1/uploads", nil)
	for _, header := range []string{"X-XDrive-Synology-Source-ID", "X-XDrive-Synology-Source-Revision"} {
		regular.Request.Header.Set(header, "42")
		if err := requireSourceRunOrLocalPushTargetTx(ctx, db, regular, owner.ID, ordinary.ID, req); !errors.Is(err, errManagedSourceWriteDenied) {
			t.Fatalf("unbound %s fell back to Owner upload: %v", header, err)
		}
		regular.Request.Header.Del(header)
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
		RequestedName: req.Name, SourceRunID: runID, Status: meta.UploadStatusActive,
		ConflictPolicy: meta.UploadConflictPolicyFail, TotalSize: req.Size,
		ChunkSize: defaultUploadChunkSize, ChunkCount: 1, ExpiresAt: time.Now().Add(time.Hour),
	}
	// The authorization helper intentionally reloads and locks the durable
	// session, not the caller's mutable in-memory struct. Model that real SQL
	// boundary instead of passing a session UUID that does not exist.
	if err := db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	if err := requireSourceRunOrLocalPushFinalizeTx(ctx, db, scoped, session, child.ID); err != nil {
		t.Fatalf("valid Pull worker Finalize authorization rejected: %v", err)
	}
	if err := requireSourceRunOrLocalPushFinalizeTx(ctx, db, regular, session, child.ID); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("ordinary Owner gained SourceRun Finalize rights: %v", err)
	}
	// Chunk writes must use the exact same live SourceRun scope as Finalize,
	// not a stale preflight grant or a generic Owner UploadSession.
	if err := server.requireUploadChunkAuthorityTx(ctx, db, scoped, session); err != nil {
		t.Fatalf("valid Pull worker UploadPart rejected: %v", err)
	}
	if err := server.requireUploadSessionReadAuthorityTx(ctx, db, scoped, session); err != nil {
		t.Fatalf("valid Pull worker UploadSession read rejected: %v", err)
	}
	if err := server.requireUploadSessionReadAuthorityTx(ctx, db, regular, session); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("ordinary Owner read a Pull SourceRun session: %v", err)
	}
	for _, noProof := range []*gin.Context{regular, wrongRun} {
		if err := server.requireUploadChunkAuthorityTx(ctx, db, noProof, session); !errors.Is(err, errManagedSourceWriteDenied) {
			t.Fatalf("unauthorized SourceRun reached chunk SQL transaction: %v", err)
		}
	}
	ordinarySession := meta.UploadSession{
		ID: "899de10a-62bf-4470-ae8f-a4c62d2a611a",
		OwnerID: owner.ID, ParentID: &ordinary.ID, Name: req.Name, RequestedName: req.Name,
		Status: meta.UploadStatusActive, ConflictPolicy: meta.UploadConflictPolicyFail,
		ChunkSize: defaultUploadChunkSize, ChunkCount: 1, ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := db.Create(&ordinarySession).Error; err != nil {
		t.Fatal(err)
	}
	if err := server.requireUploadChunkAuthorityTx(ctx, db, regular, ordinarySession); err != nil {
		t.Fatalf("ordinary Owner folder cannot upload chunks: %v", err)
	}
	if err := server.requireUploadSessionReadAuthorityTx(ctx, db, regular, ordinarySession); err != nil {
		t.Fatalf("ordinary Owner folder cannot read its own session: %v", err)
	}
	if err := server.requireUploadSessionReadAuthorityTx(ctx, db, scoped, ordinarySession); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("SourceRun adopted an ordinary Owner UploadSession read: %v", err)
	}
	if err := server.requireUploadChunkAuthorityTx(ctx, db, scoped, ordinarySession); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("signed SourceRun adopted an ordinary Owner UploadSession: %v", err)
	}

	// Old and partially populated Source-session rows must never be treated
	// as generic Owner sessions. Exercise each identity column separately
	// against both the real chunk/receipt SQL check and Finalize dispatch.
	for _, marker := range []struct {
		column string
		value  any
		reset  any
	}{
		{"source_revision", uint64(7), uint64(0)},
		{"source_device_id", "13dfbb14-cf78-49d0-ab3f-1da99e57c870", ""},
		{"source_target_id", ordinary.ID, uint64(0)},
		{"source_root_id", "98e9b808-6de4-4b26-8fe4-85d81c20baae", ""},
		{"source_root_fingerprint", strings.Repeat("f", 64), ""},
	} {
		if err := db.Model(&meta.UploadSession{}).
			Where("id = ?", ordinarySession.ID).Update(marker.column, marker.value).Error; err != nil {
			t.Fatal(err)
		}
		var partial meta.UploadSession
		if err := db.Where("id = ?", ordinarySession.ID).Take(&partial).Error; err != nil {
			t.Fatal(err)
		}
		if err := server.requireUploadChunkAuthorityTx(ctx, db, regular, partial); !errors.Is(err, errManagedSourceWriteDenied) {
			t.Fatalf("%s escaped UploadPart SQL authority: %v", marker.column, err)
		}
		if err := server.requireUploadSessionReadAuthorityTx(ctx, db, regular, partial); !errors.Is(err, errManagedSourceWriteDenied) {
			t.Fatalf("%s escaped upload receipt SQL authority: %v", marker.column, err)
		}
		if err := requireSourceRunOrLocalPushFinalizeTx(ctx, db, regular, partial, ordinary.ID); !errors.Is(err, errManagedSourceWriteDenied) {
			t.Fatalf("%s escaped Finalize source authority: %v", marker.column, err)
		}
		if err := db.Model(&meta.UploadSession{}).
			Where("id = ?", ordinarySession.ID).Update(marker.column, marker.reset).Error; err != nil {
			t.Fatal(err)
		}
		if err := server.requireUploadChunkAuthorityTx(ctx, db, regular, ordinarySession); err != nil {
			t.Fatalf("clean ordinary upload rejected after %s isolation check: %v", marker.column, err)
		}
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
	if err := server.requireUploadChunkAuthorityTx(ctx, db, scoped, session); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("cancelled SourceRun committed an UploadPart: %v", err)
	}
	if err := server.requireUploadSessionReadAuthorityTx(ctx, db, scoped, session); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("cancelled SourceRun still read its upload session: %v", err)
	}
	if err := db.Model(&meta.SyncRun{}).Where("id = ?", runID).
		Update("status", meta.SyncRunStatusCompleted).Error; err != nil {
		t.Fatal(err)
	}
	if err := requireSourceRunOrLocalPushTargetTx(ctx, db, scoped, owner.ID, child.ID, req); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("completed SourceRun continued writing: %v", err)
	}
}
