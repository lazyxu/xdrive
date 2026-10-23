//go:build linux || windows

package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushcommon"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

// Real, non-production PostgreSQL and LocalCAS integration for independent
// file A/B and a later revision A'. Only the ordinary /uploads path writes
// bytes or creates Node/FileVersion; the private original SQL Operation is
// reconciled independently. The owning Desktop batch worker is not implied.
func TestLocalPushCommonNativeVersionedFilesAThenBThenUpdatedA(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(
		&meta.ClientDevice{}, &meta.LocalSourceBinding{},
		&meta.UploadSession{}, &meta.UploadPart{}, &meta.FileVersion{},
		&meta.ContentBlob{}, &meta.Share{}, &meta.AuditEvent{},
		&meta.LocalPushStaging{}, &meta.LocalPushOperationIntent{},
		&meta.LocalPushOperationTerminalReceipt{},
		&meta.LocalPushOperationStageBinding{},
		&meta.LocalPushFirstLeafOperationCommit{},
		&meta.LocalPushFileTerminal{},
		&meta.LocalPushNativeTerminalChallenge{},
		&meta.LocalPushCASPrepareIntent{},
		&meta.LocalPushFirstDirectoryChallenge{},
		&meta.LocalPushCommonUploadOperation{},
	); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server.Store = store
	server.Auth = auth.New("native-v2-multifile-integration", time.Hour)
	server.RefreshTTL = 24 * time.Hour
	server.MaxUploadBytes = 64 << 20
	gin.SetMode(gin.TestMode)

	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	secret := "owning-native-multi-file-device-fixture-32-plus"
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID,
		Name: "private native multifile", Platform: runtime.GOOS,
		CredentialHash: deviceCredentialDigest(secret),
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	parent := createFilePropertiesDir(t, db, owner.ID, root.ID, "Local backup root")
	source := meta.Source{
		OwnerID: owner.ID, Name: "Local v2",
		Kind: meta.SourceKindLocalFolder, Direction: meta.SourceDirectionPush,
		SyncMode: meta.SourceSyncModeBackup, Status: meta.SourceStatusPaused,
		Revision: 7, TargetNodeID: &parent.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(server.Router())
	defer httpServer.Close()
	dir := filepath.Join(t.TempDir(), "native")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	originalA := bytes.Repeat([]byte("original-A"), 1331)
	originalB := bytes.Repeat([]byte("original-B"), 1441)
	for name, payload := range map[string][]byte{
		"alpha.bin": originalA, "bravo.bin": originalB,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), payload, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	config := filepath.Join(t.TempDir(), "agent")
	grant, err := localpush.PrepareRootGrant(
		httpServer.URL, owner.Username, source.ID, device.ID, dir)
	if err != nil || !grant.StrongIdentity {
		t.Fatalf("strong native Root unavailable: %+v %v", grant, err)
	}
	if err := localpush.SaveRootGrant(config, grant); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.LocalSourceBinding{
		SourceID: source.ID, OwnerID: owner.ID, DeviceID: device.ID,
		RootID: grant.RootID, RootFingerprint: grant.Fingerprint,
	}).Error; err != nil {
		t.Fatal(err)
	}
	proof := client.LocalBoundSourceProof{
		DeviceID: device.ID, DeviceToken: secret,
		RootID: grant.RootID, RootFingerprint: grant.Fingerprint,
	}
	api := client.New(httpServer.URL, token)
	ctx, cancel := context.WithTimeout(context.Background(), 75*time.Second)
	defer cancel()
	scan := func() localpush.InventoryJournalSnapshot {
		t.Helper()
		snapshot, summary, err := localpush.ScanInventoryToJournal(
			ctx, config, grant, localpush.InventoryScanner{
				IncludeNativeIdentity: true, BatchSize: 100,
			})
		if err != nil || !summary.Complete || summary.MissingInferenceSafe ||
			snapshot.SnapshotSHA256 == "" {
			t.Fatalf("native inventory not complete: %+v %v", summary, err)
		}
		return snapshot
	}
	planFor := func(snapshot localpush.InventoryJournalSnapshot, relative string,
		target localpushcommon.Target,
	) localpushcommon.Plan {
		t.Helper()
		plan, err := localpush.PrepareVerifiedCommonUploadVersionedPlan(
			ctx, config, grant, token, source.Revision, snapshot.SnapshotSHA256,
			relative, target)
		if err != nil {
			t.Fatalf("persist original %s: %v", relative, err)
		}
		return plan
	}
	upload := func(snapshot localpush.InventoryJournalSnapshot,
		plan localpushcommon.Plan,
	) client.LocalPushCommonUploadReceipt {
		t.Helper()
		receipt, err := localpush.UploadVerifiedCommonNativeVersionedOne(
			ctx, config, grant, snapshot.SnapshotSHA256,
			plan, api, proof, nil)
		if err != nil || !receipt.Committed || receipt.State != "committed" ||
			receipt.OperationID != plan.OperationID || receipt.SourceID != source.ID ||
			receipt.ContentSHA256 != plan.ContentSHA256 || receipt.Size != plan.Size {
			t.Fatalf("original SQL receipt invalid: %+v %v", receipt, err)
		}
		return receipt
	}
	assertCAS := func(receipt client.LocalPushCommonUploadReceipt, expected []byte) {
		t.Helper()
		var f meta.File
		if err := db.Where("node_id = ?", receipt.NodeID).Take(&f).Error; err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(expected)
		if f.Size != int64(len(expected)) ||
			f.SHA256 != hex.EncodeToString(sum[:]) || f.StorageKey == "" {
			t.Fatalf("current physical file metadata incorrect: %+v", f)
		}
		reader, err := store.Open(ctx, f.StorageKey)
		if err != nil {
			t.Fatal(err)
		}
		got, err := io.ReadAll(reader)
		_ = reader.Close()
		if err != nil || !bytes.Equal(got, expected) {
			t.Fatalf("current CAS differs from original native bytes: %v", err)
		}
	}

	firstSnapshot := scan()
	planA := planFor(firstSnapshot, "alpha.bin",
		localpushcommon.Target{ParentID: parent.ID, Name: "alpha.bin"})
	planB := planFor(firstSnapshot, "bravo.bin",
		localpushcommon.Target{ParentID: parent.ID, Name: "bravo.bin"})
	if planA.OperationID == planB.OperationID {
		t.Fatal("two different files share a durable original Operation")
	}
	firstA := upload(firstSnapshot, planA)
	firstB := upload(firstSnapshot, planB)
	if firstA.NodeID == firstB.NodeID || firstA.NodeRevision != 1 ||
		firstB.NodeRevision != 1 {
		t.Fatalf("A/B Node identity incorrectly shared: A=%+v B=%+v", firstA, firstB)
	}
	assertCAS(firstA, originalA)
	assertCAS(firstB, originalB)
	var versionsBefore int64
	if err := db.Model(&meta.FileVersion{}).Where("node_id = ?", firstA.NodeID).
		Count(&versionsBefore).Error; err != nil {
		t.Fatal(err)
	}

	updatedA := bytes.Repeat([]byte("updated-A-new-version"), 1555)
	if err := os.WriteFile(filepath.Join(dir, "alpha.bin"), updatedA, 0o600); err != nil {
		t.Fatal(err)
	}
	secondSnapshot := scan()
	planA2 := planFor(secondSnapshot, "alpha.bin",
		localpushcommon.Target{NodeID: firstA.NodeID,
			ExpectedRevision: firstA.NodeRevision})
	if planA2.OperationID == planA.OperationID ||
		planA2.ContentSHA256 == planA.ContentSHA256 {
		t.Fatal("A' replaced the original immutable A instead of new revision")
	}
	secondA := upload(secondSnapshot, planA2)
	if secondA.NodeID != firstA.NodeID || secondA.NodeRevision != 2 {
		t.Fatalf("A' failed to create FileVersion: %+v", secondA)
	}
	assertCAS(secondA, updatedA)
	assertCAS(firstB, originalB)
	var versionsAfter int64
	if err := db.Model(&meta.FileVersion{}).Where("node_id = ?", firstA.NodeID).
		Count(&versionsAfter).Error; err != nil {
		t.Fatal(err)
	}
	if versionsAfter <= versionsBefore {
		t.Fatalf("A' did not advance historical FileVersion: before=%d after=%d",
			versionsBefore, versionsAfter)
	}
	keyA, err := planA.ResumeKey()
	if err != nil {
		t.Fatal(err)
	}
	immutableA, err := api.ReadLocalPushCommonUploadReceipt(
		ctx, source.ID, source.Revision, proof, planA.OperationID, keyA)
	if err != nil || immutableA != firstA {
		t.Fatalf("original A receipt rewritten after A': %+v %v", immutableA, err)
	}
	// Another unrelated file changes CURRENT. A' must still reuse the exact
	// original Operation after restart, without rewriting CAS/SQL/Node.
	if err := os.WriteFile(filepath.Join(dir, "charlie.bin"), []byte("new inventory member"), 0o600); err != nil {
		t.Fatal(err)
	}
	thirdSnapshot := scan()
	sameA2 := planFor(thirdSnapshot, "alpha.bin", planA2.Target)
	if sameA2 != planA2 {
		t.Fatal("unrelated inventory refresh minted another A' Operation")
	}
	if again := upload(thirdSnapshot, sameA2); again != secondA {
		t.Fatalf("replay did not preserve immutable A' receipt: %+v", again)
	}
	var operationCount, nodeCount int64
	if err := db.Model(&meta.LocalPushCommonUploadOperation{}).
		Where("source_id = ?", source.ID).Count(&operationCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.Node{}).
		Where("parent_id = ?", parent.ID).Count(&nodeCount).Error; err != nil {
		t.Fatal(err)
	}
	if operationCount != 3 || nodeCount != 2 {
		t.Fatalf("duplicate replay: operation rows=%d file nodes=%d", operationCount, nodeCount)
	}

	// Real descendant folder metadata + Native nested file -> ordinary
	// Session/chunks/Finalize, same Server/Owner/Device/Root proof.
	// A directory under another subtree of the SAME Owner must be denied.
	nestedRoot := filepath.Join(dir, "trips", "autumn")
	if err := os.MkdirAll(nestedRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	nestedBytes := bytes.Repeat([]byte("nested-original-media"), 600)
	if err := os.WriteFile(filepath.Join(nestedRoot, "memory.jpg"), nestedBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	trips, err := api.EnsureLocalPushCommonDirectory(
		ctx, source.ID, source.Revision, proof, parent.ID, "trips")
	if err != nil || trips.ID == 0 || trips.ParentID == nil ||
		*trips.ParentID != parent.ID || trips.Type != "dir" {
		t.Fatalf("private Source Root mkdir failed: %+v %v", trips, err)
	}
	autumn, err := api.EnsureLocalPushCommonDirectory(
		ctx, source.ID, source.Revision, proof, trips.ID, "autumn")
	if err != nil || autumn.ID == 0 || autumn.ParentID == nil ||
		*autumn.ParentID != trips.ID || autumn.Type != "dir" {
		t.Fatalf("private second-level folder missing: %+v %v", autumn, err)
	}
	replayedDir, err := api.EnsureLocalPushCommonDirectory(
		ctx, source.ID, source.Revision, proof, trips.ID, "autumn")
	if err != nil || replayedDir.ID != autumn.ID {
		t.Fatalf("lost mkdir ACK created a different directory: %+v %v", replayedDir, err)
	}
	verifiedDir, err := api.VerifyLocalPushCommonDirectory(
		ctx, source.ID, source.Revision, proof, trips.ID, "autumn")
	if err != nil || verifiedDir.ID != autumn.ID {
		t.Fatalf("read-only current Source directory proof missing: %+v %v", verifiedDir, err)
	}
	var directoriesBefore, directoriesAfter int64
	if err := db.Model(&meta.Node{}).
		Where("owner_id = ? AND type = ?", owner.ID, meta.NodeTypeDir).
		Count(&directoriesBefore).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := api.VerifyLocalPushCommonDirectory(
		ctx, source.ID, source.Revision, proof, trips.ID, "not-created"); err == nil {
		t.Fatal("read-only check incorrectly created a missing directory")
	}
	if err := db.Model(&meta.Node{}).
		Where("owner_id = ? AND type = ?", owner.ID, meta.NodeTypeDir).
		Count(&directoriesAfter).Error; err != nil || directoriesBefore != directoriesAfter {
		t.Fatalf("read-only lookup wrote a cloud directory: %d to %d: %v",
			directoriesBefore, directoriesAfter, err)
	}
	outside := createFilePropertiesDir(t, db, owner.ID, root.ID, "Outside own Source")
	if _, err := api.EnsureLocalPushCommonDirectory(
		ctx, source.ID, source.Revision, proof, outside.ID, "forbidden"); err == nil {
		t.Fatal("same Owner directory outside bound Source was writable")
	}
	nestedSnapshot := scan()
	nestedPlan := planFor(nestedSnapshot, "trips/autumn/memory.jpg",
		localpushcommon.Target{ParentID: autumn.ID, Name: "memory.jpg"})
	nestedReceipt := upload(nestedSnapshot, nestedPlan)
	if nestedReceipt.NodeRevision != 1 {
		t.Fatalf("nested byte upload did not commit exact SQL revision: %+v", nestedReceipt)
	}
	assertCAS(nestedReceipt, nestedBytes)
	// The file stays in one Node as a second full native revision, and
	// the original historical SQL result remains unchanged.
	updatedNested := bytes.Repeat([]byte("updated-nested-media"), 811)
	if err := os.WriteFile(filepath.Join(nestedRoot, "memory.jpg"), updatedNested, 0o600); err != nil {
		t.Fatal(err)
	}
	nextNestedSnapshot := scan()
	nestedUpdatePlan := planFor(nextNestedSnapshot, "trips/autumn/memory.jpg",
		localpushcommon.Target{
			NodeID: nestedReceipt.NodeID, ExpectedRevision: nestedReceipt.NodeRevision,
		})
	nestedUpdate := upload(nextNestedSnapshot, nestedUpdatePlan)
	if nestedUpdate.NodeID != nestedReceipt.NodeID || nestedUpdate.NodeRevision != 2 {
		t.Fatalf("nested media overwrite did not preserve Node/FileVersion: %+v", nestedUpdate)
	}
	assertCAS(nestedUpdate, updatedNested)
	nestedKey, keyErr := nestedPlan.ResumeKey()
	if keyErr != nil {
		t.Fatal(keyErr)
	}
	nestedOriginal, err := api.ReadLocalPushCommonUploadReceipt(
		ctx, source.ID, source.Revision, proof, nestedPlan.OperationID, nestedKey)
	if err != nil || nestedOriginal != nestedReceipt {
		t.Fatalf("nested update rewrote first original SQL receipt: %+v %v", nestedOriginal, err)
	}
	// A user can later move a previously trusted cloud directory outside
	// the Source subtree. Even though the Owner is unchanged, the private
	// endpoint must refuse new children beneath that moved folder.
	if err := db.Model(&meta.Node{}).Where("id = ?", trips.ID).
		Update("parent_id", outside.ID).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := api.EnsureLocalPushCommonDirectory(
		ctx, source.ID, source.Revision, proof, autumn.ID, "escaped"); err == nil {
		t.Fatal("moved nested folder retained original Source upload authority")
	}
	if _, err := api.VerifyLocalPushCommonDirectory(
		ctx, source.ID, source.Revision, proof, trips.ID, "autumn"); err == nil {
		t.Fatal("moved folder still passed the skip-only current ancestry check")
	}
	if _, err := api.VerifyLocalPushCommonDirectory(
		ctx, source.ID, source.Revision, proof, parent.ID, "trips"); err == nil {
		t.Fatal("old Source-relative name was still accepted after moving folder away")
	}
}
