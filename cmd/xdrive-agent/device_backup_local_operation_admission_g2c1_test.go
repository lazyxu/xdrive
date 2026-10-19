package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/secretstore"
)

func TestLocalPushFreshSlotFailsClosedAcrossRestartAndScopeDrift(t *testing.T) {
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	configDir := t.TempDir()
	scope := localPushRequestFixture()
	if err := requireFreshLocalPushOperationSlot(configDir, scope); err != nil {
		t.Fatalf("clean, previously unused request slot refused: %v", err)
	}
	originalKey, err := mintLocalPushOperationRequestKey(configDir, scope)
	if err != nil || originalKey.bytes == [32]byte{} {
		t.Fatalf("failed to persist the original native operation key: %v", err)
	}
	if err := requireFreshLocalPushOperationSlot(configDir, scope); !errors.Is(err, errLocalPushRequestKeyUnavailable) {
		t.Fatalf("restarted Agent accepted pending request slot: %v", err)
	}
	// Changing mutable scope MUST NOT bypass the stable per-Device/Source
	// claim, whether or not a new session or Source revision was observed.
	for _, change := range []func(*localPushRequestKeyScope){
		func(s *localPushRequestKeyScope) { s.sessionID = "new-login" },
		func(s *localPushRequestKeyScope) { s.revision++ },
		func(s *localPushRequestKeyScope) { s.targetNodeID++ },
		func(s *localPushRequestKeyScope) { s.rootID = "33333333-3333-4333-8333-333333333333" },
	} {
		next := scope
		change(&next)
		if err := requireFreshLocalPushOperationSlot(configDir, next); !errors.Is(err, errLocalPushRequestKeyUnavailable) {
			t.Fatalf("mutable scope bypassed pending request slot: %v", err)
		}
	}
	distinctSource := scope
	distinctSource.sourceID++
	if err := requireFreshLocalPushOperationSlot(configDir, distinctSource); err != nil {
		t.Fatalf("independent Source blocked by another Source claim: %v", err)
	}
	unchanged, err := loadLocalPushOperationRequestKey(configDir, scope)
	if err != nil || unchanged != originalKey {
		t.Fatal("read-only admission removed or modified original request key")
	}
	id, claim, _, err := localPushRequestKeyNames(configDir, scope)
	if err != nil {
		t.Fatal(err)
	}
	// A surviving OS secret with its nonsecret marker lost is unresolved.
	if err := os.Remove(claim); err != nil {
		t.Fatal(err)
	}
	if err := requireFreshLocalPushOperationSlot(configDir, scope); !errors.Is(err, errLocalPushRequestKeyUnavailable) {
		t.Fatalf("orphaned original credential permitted replacement: %v", err)
	}
	if _, err := secretstore.Load(configDir, id); err != nil {
		t.Fatal("read-only preflight altered orphaned secret")
	}
}

func TestLocalPushFreshSlotRejectsOrphanClaimAndUnreadableCredential(t *testing.T) {
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	configDir := t.TempDir()
	scope := localPushRequestFixture()
	id, claim, _, err := localPushRequestKeyNames(configDir, scope)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(claim), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(claim, []byte(localPushRequestClaimContents), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := requireFreshLocalPushOperationSlot(configDir, scope); !errors.Is(err, errLocalPushRequestKeyUnavailable) {
		t.Fatalf("orphan claim was mistaken for free slot: %v", err)
	}
	if _, err := mintLocalPushOperationRequestKey(configDir, scope); err == nil {
		t.Fatal("orphan claim permitted a second key")
	}
	if err := os.Remove(claim); err != nil {
		t.Fatal(err)
	}
	if err := secretstore.Save(configDir, id, "corrupt credential", secretstore.Credentials{
		OpaquePayload: "malformed-original-credential",
	}); err != nil {
		t.Fatal(err)
	}
	if err := requireFreshLocalPushOperationSlot(configDir, scope); !errors.Is(err, errLocalPushRequestKeyUnavailable) {
		t.Fatalf("orphan or corrupt credential permitted fresh operation: %v", err)
	}
}

func TestLocalPushRunnerAdmissionBlocksOldKeyBeforeRemoteStage(t *testing.T) {
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	d, s := localPushFirstLeafDriverFixture(t)
	reads := 0
	d.readBound = func(context.Context, uint64) (client.Source, client.LocalBoundSourceProof, error) {
		reads++
		return d.source, d.proof, nil
	}
	if err := d.Check(context.Background(), s); err != nil || reads != 1 {
		t.Fatalf("fresh owning Source refused: %v reads=%d", err, reads)
	}
	original, err := mintLocalPushOperationRequestKey(d.configDir, d.requestScope)
	if err != nil {
		t.Fatal(err)
	}
	reads = 0
	// An entirely NEW Runner/Agent lifetime must not issue even a Stage
	// reservation when a previous Operation has no durable terminal proof.
	restarted := *d
	restarted.key = localPushPrivateRequestKey{}
	if err := restarted.Check(context.Background(), s); err == nil || reads != 0 {
		t.Fatalf("stale durable request reached remote Source: %v reads=%d", err, reads)
	}
	if _, err := restarted.Stage(context.Background(), s); err == nil || reads != 0 {
		t.Fatalf("stale durable request reached native upload: %v reads=%d", err, reads)
	}
	recovered, err := loadLocalPushOperationRequestKey(d.configDir, d.requestScope)
	if err != nil || recovered != original {
		t.Fatal("rejected restart modified the original private request key")
	}
	// The SAME live Agent instance can continue its EXACT original key.
	// Commit/SourceRun still require separate signed Stage+Operation proofs.
	d.key = original
	if err := d.Check(context.Background(), s); err != nil {
		t.Fatalf("original in-process private key lost ownership: %v", err)
	}
	d.key.bytes[0] ^= 0xff
	if err := d.Check(context.Background(), s); err == nil {
		t.Fatal("mismatched in-memory request key accepted")
	}
	// Missing credential but retained claim fails closed even within the
	// original Agent lifetime. No cleanup or renewal is attempted.
	if err := secretstore.Delete(d.configDir, mustLocalPushRequestKeyID(t, d.configDir, d.requestScope)); err != nil {
		t.Fatal(err)
	}
	d.key = original
	if err := d.Check(context.Background(), s); err == nil {
		t.Fatal("orphan claim without SecretStore request key accepted")
	}
}

func mustLocalPushRequestKeyID(t *testing.T, configDir string, scope localPushRequestKeyScope) string {
	t.Helper()
	id, _, _, err := localPushRequestKeyNames(configDir, scope)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestLocalPushSlotAdmissionDoesNotModifyNativeRoot(t *testing.T) {
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	d, s := localPushFirstLeafDriverFixture(t)
	before, err := localpush.LoadRootGrant(d.configDir, d.account.Server, d.account.Username, d.grant.RootID)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.Check(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	after, err := localpush.LoadRootGrant(d.configDir, d.account.Server, d.account.Username, d.grant.RootID)
	if err != nil || before != after {
		t.Fatal("early request admission modified the locally approved native Root")
	}
}
