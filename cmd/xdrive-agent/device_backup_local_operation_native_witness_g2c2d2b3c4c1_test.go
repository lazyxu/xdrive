package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushrunner"
)

func boundOriginalWitnessFixture(t *testing.T) (
	[32]byte, localpushrunner.Scope, localpushrunner.Staged,
	localpushrunner.Operation, localpush.NativeHeldCurrentOriginal,
) {
	t.Helper()
	_, scope := localPushFirstLeafDriverFixture(t)
	stage := localpushrunner.Staged{
		StageID:  "33333333-3333-4333-8333-333333333333",
		SourceID: scope.SourceID, Revision: scope.Revision,
		ContentSHA256: scope.ContentSHA256, Size: scope.Size,
	}
	op := localpushrunner.Operation{
		ID:         "44444444-4444-4444-8444-444444444444",
		Generation: 1, SourceID: scope.SourceID, Revision: scope.Revision,
	}
	native := localpush.NativeHeldCurrentOriginal{
		SourceID: scope.SourceID, DeviceID: scope.DeviceID,
		RootID: scope.RootID, RelativePath: scope.RelativePath,
		PathKey:        strings.Repeat("b", 64),
		SnapshotSHA256: strings.Repeat("c", 64),
		ContentSHA256:  scope.ContentSHA256,
		NativeKey:      strings.Repeat("d", 64), Size: scope.Size,
	}
	var secret [32]byte
	copy(secret[:], bytes.Repeat([]byte{0x52}, 32))
	return secret, scope, stage, op, native
}

func TestBoundOriginalNativeWitnessCorrelatesExactOperationAndNative(t *testing.T) {
	key, scope, stage, op, native := boundOriginalWitnessFixture(t)
	expected, err := boundOriginalNativeWitnessDigest(key, scope, stage, op, native)
	if err != nil || !validLocalPushNativeWitnessDigest(expected) {
		t.Fatalf("valid private evidence not derived: %v", err)
	}
	same, err := boundOriginalNativeWitnessDigest(key, scope, stage, op, native)
	if err != nil || same != expected {
		t.Fatalf("original identity was not repeatable: %v", err)
	}
	verifyChanged := func(name string, k [32]byte, s localpushrunner.Scope,
		st localpushrunner.Staged, operation localpushrunner.Operation,
		n localpush.NativeHeldCurrentOriginal) {
		t.Helper()
		t.Run(name, func(t *testing.T) {
			observed, err := boundOriginalNativeWitnessDigest(k, s, st, operation, n)
			if err == nil && observed == expected {
				t.Fatalf("mutated %s reused original witness", name)
			}
		})
	}
	otherKey := key
	otherKey[0] ^= 1
	verifyChanged("request-key", otherKey, scope, stage, op, native)
	otherStage := stage
	otherStage.StageID = "55555555-5555-4555-8555-555555555555"
	verifyChanged("stage", key, scope, otherStage, op, native)
	otherOp := op
	otherOp.Generation++
	verifyChanged("generation", key, scope, stage, otherOp, native)
	otherOp = op
	otherOp.ID = "66666666-6666-4666-8666-666666666666"
	verifyChanged("operation", key, scope, stage, otherOp, native)
	otherNative := native
	otherNative.NativeKey = strings.Repeat("e", 64)
	verifyChanged("native-key", key, scope, stage, op, otherNative)
	otherNative = native
	otherNative.SnapshotSHA256 = strings.Repeat("e", 64)
	verifyChanged("snapshot", key, scope, stage, op, otherNative)
	otherScope := scope
	otherScope.SessionID = "changed-session"
	verifyChanged("session", key, otherScope, stage, op, native)
	otherScope = scope
	otherScope.RootFingerprint = strings.Repeat("f", 64)
	verifyChanged("Root-fingerprint", key, otherScope, stage, op, native)
}

func TestBoundOriginalNativeWitnessDeniesMissingOrMismatchedProof(t *testing.T) {
	key, scope, stage, op, native := boundOriginalWitnessFixture(t)
	if result, err := boundOriginalNativeWitnessDigest([32]byte{}, scope, stage, op, native); err == nil || result != "" {
		t.Fatalf("missing secret minted witness: %q %v", result, err)
	}
	native.NativeKey = ""
	if result, err := boundOriginalNativeWitnessDigest(key, scope, stage, op, native); err == nil || result != "" {
		t.Fatalf("missing strong OS identity minted witness: %q %v", result, err)
	}
	native.NativeKey = strings.Repeat("d", 64)
	native.DeviceID = "77777777-7777-4777-8777-777777777777"
	if result, err := boundOriginalNativeWitnessDigest(key, scope, stage, op, native); err == nil || result != "" {
		t.Fatalf("foreign native Device accepted: %q %v", result, err)
	}
}

func TestBoundOriginalNativeWitnessRequiresRealAgentCallbackAndStaysPrivate(t *testing.T) {
	_, scope, stage, op, _ := boundOriginalWitnessFixture(t)
	evidence := localPushOriginalHeldWitness{
		operationID: op.ID, generation: op.Generation,
		stageID: stage.StageID, digest: strings.Repeat("a", 64),
	}
	raw, err := json.Marshal(evidence)
	if err != nil || string(raw) != "{}" {
		t.Fatalf("native witness reached public JSON: %s %v", raw, err)
	}
	driver, _ := localPushFirstLeafDriverFixture(t)
	if err := driver.withBoundOriginalLiveWriterWitness(
		context.Background(), scope, localpush.NativeHeldCurrentOriginal{},
		stage, op, func(context.Context, localPushOriginalHeldWitness) error {
			t.Fatal("unheld Writer accessed witness")
			return nil
		}); err == nil {
		t.Fatal("unheld Agent created operation-native evidence")
	}
	source, err := os.ReadFile("device_backup_local_production_driver.go")
	if err != nil {
		t.Fatal(err)
	}
	code := string(source)
	start := strings.Index(code, "func (d *localPushFirstLeafDriver) Commit(")
	end := strings.Index(code, "func (d *localPushFirstLeafDriver) Reconcile(")
	if start < 0 || end <= start {
		t.Fatal("original production callback boundary missing")
	}
	body := code[start:end]
	if !strings.Contains(body, "WithHeldCurrentOriginalFirstLeafCommitWindow(") ||
		!strings.Contains(body, "withBoundOriginalLiveWriterWitness(") ||
		!strings.Contains(body, "commitBound(writeCtx)") {
		t.Fatal("real native fd and Writer Claim proof not nested in Commit")
	}
}
