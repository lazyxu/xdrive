//go:build linux || windows

package api

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/meta"
)

func nativeDurableFirstDirectoryChallengeFixture(
	t *testing.T,
) (localNativeCanonicalFixture, localpush.LocalFirstDirectoryNativeRecheckRequest, localpush.LocalFirstDirectoryAdvisoryChallenge) {
	t.Helper()
	f, request := firstDirectoryNativeCIBoundaryFixture(t)
	if err := f.server.DB.AutoMigrate(&meta.LocalPushFirstDirectoryChallenge{}); err != nil {
		t.Fatal(err)
	}
	challenge, err := f.server.issueBoundLocalPushFirstDirectoryChallenge(
		f.request, f.source.ID, f.source.Revision,
	)
	if err != nil || challenge.Nonce == ([32]byte{}) ||
		challenge.SourceID != request.SourceID || challenge.SourceRevision != request.SourceRevision {
		t.Fatalf("private owning Server could not issue challenge: %+v %v", challenge, err)
	}
	return f, request, challenge
}

func nativeDurableFirstDirectorySeal(
	t *testing.T,
	f localNativeCanonicalFixture,
	request localpush.LocalFirstDirectoryNativeRecheckRequest,
	challenge localpush.LocalFirstDirectoryAdvisoryChallenge,
) localpush.LocalFirstDirectoryAdvisorySeal {
	t.Helper()
	observation, err := localpush.RecheckLocalFirstDirectoryNative(
		context.Background(), f.configDir, f.root, request,
	)
	if err != nil || !observation.NativeObserved {
		t.Fatalf("real native CURRENT was not rechecked: %+v %v", observation, err)
	}
	// Simulated owning-Agent signing time is inside the Server's DB-clock
	// window. This is an integration fixture, NOT a production transport.
	seal, err := localpush.SealLocalFirstDirectoryAdvisoryObservation(
		context.Background(), observation, challenge, f.nativeProof.DeviceToken,
		challenge.IssuedAt.Add(time.Second),
	)
	if err != nil || seal.Observation.BackupComplete || seal.Observation.CommitSupported {
		t.Fatalf("native advisory signing gained false authority: %+v %v", seal, err)
	}
	return seal
}

func TestLocalPushPhysicalNativeToDurableChallengeOnlyConsumesEvidence(t *testing.T) {
	f, request, challenge := nativeDurableFirstDirectoryChallengeFixture(t)
	var beforeNodes int64
	if err := f.server.DB.Model(&meta.Node{}).Count(&beforeNodes).Error; err != nil {
		t.Fatal(err)
	}
	seal := nativeDurableFirstDirectorySeal(t, f, request, challenge)
	consumed, err := f.server.consumeBoundLocalPushFirstDirectoryChallenge(f.request, challenge, seal)
	if err != nil || !consumed {
		t.Fatalf("real native->HMAC->PostgreSQL advisory consumption failed: %t %v", consumed, err)
	}
	var row meta.LocalPushFirstDirectoryChallenge
	if err := f.server.DB.Where("source_id = ?", f.source.ID).Take(&row).Error; err != nil ||
		row.State != meta.LocalPushFirstDirectoryChallengeConsumed || row.ConsumedAt == nil {
		t.Fatalf("durable receipt is not one-use: %+v %v", row, err)
	}
	if ok, err := f.server.consumeBoundLocalPushFirstDirectoryChallenge(f.request, challenge, seal); ok || err == nil {
		t.Fatal("same authentic native observation could be consumed twice")
	}
	var nodes, items, runs int64
	if err := f.server.DB.Model(&meta.Node{}).Count(&nodes).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Model(&meta.SourceItem{}).Count(&items).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).Count(&runs).Error; err != nil {
		t.Fatal(err)
	}
	if nodes != beforeNodes || items != 0 || runs != 0 {
		t.Fatalf("advisory evidence mutated cloud: nodes %d->%d items=%d runs=%d", beforeNodes, nodes, items, runs)
	}
}

func TestLocalPushReplacedNativeDirectoryCannotSealDurableChallenge(t *testing.T) {
	f, request, _ := nativeDurableFirstDirectoryChallengeFixture(t)
	original := filepath.Join(f.root.Path, request.RelativeDirectory)
	if err := os.Rename(original, original+"-old"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(original, 0o700); err != nil {
		t.Fatal(err)
	}
	observation, err := localpush.RecheckLocalFirstDirectoryNative(
		context.Background(), f.configDir, f.root, request,
	)
	if err == nil || observation.NativeObserved {
		t.Fatalf("replaced native directory retained CURRENT identity: %+v %v", observation, err)
	}
	var row meta.LocalPushFirstDirectoryChallenge
	if err := f.server.DB.Where("source_id = ?", f.source.ID).Take(&row).Error; err != nil ||
		row.State != meta.LocalPushFirstDirectoryChallengeIssued || row.ConsumedAt != nil {
		t.Fatalf("native replacement consumed durable challenge: %+v %v", row, err)
	}
	var items int64
	if err := f.server.DB.Model(&meta.SourceItem{}).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("native replacement created cloud items: %d %v", items, err)
	}
}

func TestLocalPushRevokedDeviceRejectsPreviouslyFreshNativeSeal(t *testing.T) {
	f, request, challenge := nativeDurableFirstDirectoryChallengeFixture(t)
	seal := nativeDurableFirstDirectorySeal(t, f, request, challenge)
	now := time.Now().UTC()
	if err := f.server.DB.Model(&meta.ClientDevice{}).Where("id = ?", f.device.ID).
		Update("revoked_at", &now).Error; err != nil {
		t.Fatal(err)
	}
	consumed, err := f.server.consumeBoundLocalPushFirstDirectoryChallenge(f.request, challenge, seal)
	if consumed || err == nil {
		t.Fatalf("device revocation left stale native seal usable: %t %v", consumed, err)
	}
	var row meta.LocalPushFirstDirectoryChallenge
	if err := f.server.DB.Where("source_id = ?", f.source.ID).Take(&row).Error; err != nil ||
		row.State != meta.LocalPushFirstDirectoryChallengeIssued || row.ConsumedAt != nil {
		t.Fatalf("revoked device mutated challenge: %+v %v", row, err)
	}
}
