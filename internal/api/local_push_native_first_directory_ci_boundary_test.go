//go:build linux || windows

package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/meta"
)

// This test connects real OS-backed, two-generation native observation to an
// independently authenticated CI-only HTTP fixture. The two operations are NOT
// one atomic, durable native-to-SQL proof; production must not call the writer.
func firstDirectoryNativeCIBoundaryFixture(t *testing.T) (localNativeCanonicalFixture, localpush.LocalFirstDirectoryNativeRecheckRequest) {
	t.Helper()
	f := makeLocalNativeCanonicalFixture(t)
	if !f.root.StrongIdentity {
		t.Skip("filesystem lacks strong Root identity")
	}
	const name = "Camera Roll"
	if err := os.Mkdir(filepath.Join(f.root.Path, name), 0o700); err != nil {
		t.Fatal(err)
	}
	journal, err := localpush.BeginInventoryJournal(f.configDir, f.root)
	if err != nil {
		t.Fatal(err)
	}
	defer journal.Abort()
	stats, err := (localpush.InventoryScanner{
		IncludeNativeIdentity: true,
		BatchSize:             localpush.DefaultInventoryBatchSize,
	}).ScanInventory(context.Background(), f.root, journal.Append)
	if err != nil || !stats.Complete {
		t.Fatalf("second physical inventory incomplete: %+v %v", stats, err)
	}
	if _, err := journal.Commit(stats); err != nil {
		t.Fatal(err)
	}
	generation, err := localpush.PublishLocalReconcileEvidence(
		context.Background(), f.configDir, f.root, f.source.Revision,
	)
	if err != nil || generation.CurrentSHA256 == generation.PreviousSHA256 {
		t.Fatalf("no distinct sealed native generations: %+v %v", generation, err)
	}
	matches := 0
	nativeKey := ""
	_, err = localpush.StreamVerifiedInventoryJournal(
		context.Background(), f.configDir, f.root, localpush.DefaultInventoryBatchSize,
		func(rows []localpush.InventoryItem) error {
			for _, row := range rows {
				if row.Path != name {
					continue
				}
				matches++
				if row.Kind != "directory" || row.NativeIdentity == nil ||
					!row.NativeIdentity.Strong || !row.NativeIdentity.RenameCandidate ||
					row.NativeIdentity.LinkCount == 0 {
					return fmt.Errorf("native directory lacks strong identity")
				}
				nativeKey = row.NativeIdentity.Key
			}
			return nil
		},
	)
	if err != nil || matches != 1 || nativeKey == "" {
		t.Fatalf("no unambiguous CURRENT native directory: matches=%d err=%v", matches, err)
	}
	return f, localpush.LocalFirstDirectoryNativeRecheckRequest{
		SourceID: f.source.ID, SourceRevision: f.source.Revision,
		RelativeDirectory: name, ExpectedNativeIdentityKey: nativeKey,
		PreviousSnapshotSHA256: generation.PreviousSHA256,
		CurrentSnapshotSHA256:  generation.CurrentSHA256,
	}
}

func firstDirectoryCINativeHTTP(t *testing.T, f localNativeCanonicalFixture, router *gin.Engine) *httptest.ResponseRecorder {
	t.Helper()
	var owner meta.User
	if err := f.server.DB.Where("id = ?", f.device.OwnerID).Take(&owner).Error; err != nil {
		t.Fatal(err)
	}
	jwt, err := f.server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/ci-first-directory-commit", f.source.ID),
		strings.NewReader(`{"relative_directory":"Camera Roll"}`))
	req.Header.Set("Authorization", "Bearer "+jwt)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", strconv.Quote(strconv.FormatUint(f.source.Revision, 10)))
	req.Header.Set("X-XDrive-Device-ID", f.nativeProof.DeviceID)
	req.Header.Set("X-XDrive-Device-Token", f.nativeProof.DeviceToken)
	req.Header.Set("X-XDrive-Local-Root-ID", f.nativeProof.RootID)
	req.Header.Set("X-XDrive-Local-Root-Fingerprint", f.nativeProof.RootFingerprint)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	for _, private := range []string{f.nativeProof.DeviceToken, f.root.RootID, f.root.Fingerprint} {
		if private != "" && strings.Contains(w.Body.String(), private) {
			t.Fatal("native CI boundary leaked secret or Root fingerprint")
		}
	}
	return w
}

func TestLocalFirstDirectoryNativePhysicalObservationNeverAuthorizesProductionHTTP(t *testing.T) {
	f, selector := firstDirectoryNativeCIBoundaryFixture(t)
	observed, err := localpush.RecheckLocalFirstDirectoryNative(
		context.Background(), f.configDir, f.root, selector,
	)
	if err != nil || !observed.NativeObserved || observed.CommitSupported ||
		observed.BackupComplete || observed.Authoritative || observed.MissingInferenceSafe {
		t.Fatalf("physical native evidence elevated permissions: %+v %v", observed, err)
	}
	encoded, err := json.Marshal(observed)
	if err != nil || string(encoded) != "{}" {
		t.Fatalf("native evidence exposed over JSON: %s %v", encoded, err)
	}
	// Even with a real owning Device and a positive CURRENT filesystem read,
	// the default production Router may NOT register the CI SQL writer.
	production := firstDirectoryCINativeHTTP(t, f, f.server.Router())
	if production.Code != http.StatusNotFound {
		t.Fatalf("native observation opened production SQL route: %d", production.Code)
	}
	f.server.localPushCIOnlyFirstDirectory = true
	created := firstDirectoryCINativeHTTP(t, f, f.server.Router())
	if created.Code != http.StatusCreated {
		t.Fatalf("CI-only authenticated pending directory rejected: %d %s", created.Code, created.Body.String())
	}
	var reply ciOnlyFirstDirectoryCommitResponse
	if err := json.Unmarshal(created.Body.Bytes(), &reply); err != nil ||
		reply.SourceID != f.source.ID || reply.Revision != f.source.Revision ||
		reply.NodeID == 0 || reply.SourceItemID == 0 ||
		reply.State != meta.SourceItemStatePending || reply.Replayed ||
		reply.NativeVerified || reply.BackupComplete || reply.CommitSupported ||
		reply.Authoritative || reply.MissingInferenceSafe {
		t.Fatalf("physical read was incorrectly turned into a backup receipt: %+v %v", reply, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", reply.SourceItemID).Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending || item.LastSyncedAt != nil ||
		item.LastSyncedRunID != "" {
		t.Fatalf("CI directory was marked synchronized: %+v %v", item, err)
	}
	var runs int64
	if err := f.server.DB.Model(&meta.SyncRun{}).Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("CI boundary created a fake SourceRun: %d %v", runs, err)
	}
	replayed := firstDirectoryCINativeHTTP(t, f, f.server.Router())
	if replayed.Code != http.StatusOK {
		t.Fatalf("CI-only native directory replay not idempotent: %d %s", replayed.Code, replayed.Body.String())
	}
	var replay ciOnlyFirstDirectoryCommitResponse
	if err := json.Unmarshal(replayed.Body.Bytes(), &replay); err != nil ||
		!replay.Replayed || replay.NodeID != reply.NodeID ||
		replay.SourceItemID != reply.SourceItemID || replay.NativeVerified ||
		replay.BackupComplete || replay.CommitSupported {
		t.Fatalf("CI-only replay changed the private evidence state: %+v %v", replay, err)
	}
}

func TestLocalFirstDirectoryNativeReplacementCannotOpenProductionHTTP(t *testing.T) {
	f, selector := firstDirectoryNativeCIBoundaryFixture(t)
	path := filepath.Join(f.root.Path, selector.RelativeDirectory)
	if err := os.Rename(path, path+"-old"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(path, 0o700); err != nil {
		t.Fatal(err)
	}
	observed, err := localpush.RecheckLocalFirstDirectoryNative(
		context.Background(), f.configDir, f.root, selector,
	)
	if err == nil || observed.NativeObserved {
		t.Fatalf("replaced CURRENT directory accepted: %+v %v", observed, err)
	}
	response := firstDirectoryCINativeHTTP(t, f, f.server.Router())
	if response.Code != http.StatusNotFound {
		t.Fatalf("native replacement opened production SQL route: %d", response.Code)
	}
	var items int64
	if err := f.server.DB.Model(&meta.SourceItem{}).Where("source_id = ?", f.source.ID).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("native replacement caused production mutation: %d %v", items, err)
	}
}
