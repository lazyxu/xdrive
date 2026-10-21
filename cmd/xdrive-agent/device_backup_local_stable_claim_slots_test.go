package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

// Test the historical physical names, not just equality among refactored
// helpers: upgrades must still see every original Stage/Operation claim.
func TestLocalPushStableClaimSlotsRetainOriginalPhysicalNames(t *testing.T) {
	dir := t.TempDir()
	scope := localPushRequestFixture()
	id, stage, operation, err := localPushStableClaimSlots(
		dir, scope.server, scope.account, scope.deviceID, scope.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	legacy := sha256.Sum256([]byte("xdrive-localpush-request-slot-v1\x00" +
		scope.server + "\x00" + scope.account + "\x00" + scope.deviceID + "\x00" +
		strconv.FormatUint(scope.sourceID, 10)))
	oldID := "local-push-request-" + hex.EncodeToString(legacy[:16])
	if id != oldID || stage != filepath.Join(dir, "localpush", "stage-admissions", oldID+".claim") ||
		operation != filepath.Join(dir, "localpush", "operation-requests", oldID+".claim") {
		t.Fatalf("changed permanent Stage/Operation physical names: %q %q %q", id, stage, operation)
	}
	productionStage, err := localPushStageAdmissionClaimPath(dir, scope)
	if err != nil || productionStage != stage {
		t.Fatalf("real Stage O_EXCL path differs from Agent restart: %q %v", productionStage, err)
	}
	_, productionOperation, _, err := localPushRequestKeyNames(dir, scope)
	if err != nil || productionOperation != operation {
		t.Fatalf("real Operation O_EXCL path differs from Agent restart: %q %v", productionOperation, err)
	}
	for _, change := range []func(*localPushRequestKeyScope){
		func(s *localPushRequestKeyScope) { s.sessionID = "new-session" },
		func(s *localPushRequestKeyScope) { s.rootID = "33333333-3333-4333-8333-333333333333" },
		func(s *localPushRequestKeyScope) {
			s.rootFingerprint = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
		},
		func(s *localPushRequestKeyScope) { s.revision++ },
		func(s *localPushRequestKeyScope) { s.targetNodeID++ },
	} {
		mutable := scope
		change(&mutable)
		one, err := localPushStageAdmissionClaimPath(dir, mutable)
		if err != nil || one != stage {
			t.Fatalf("mutable identity reset Stage slot: %q %v", one, err)
		}
		_, two, _, err := localPushRequestKeyNames(dir, mutable)
		if err != nil || two != operation {
			t.Fatalf("mutable identity reset Operation slot: %q %v", two, err)
		}
	}
	for _, change := range []func(*localPushRequestKeyScope){
		func(s *localPushRequestKeyScope) { s.server = "https://foreign.invalid" },
		func(s *localPushRequestKeyScope) { s.account = "different-owner" },
		func(s *localPushRequestKeyScope) { s.deviceID = "44444444-4444-4444-8444-444444444444" },
		func(s *localPushRequestKeyScope) { s.sourceID++ },
	} {
		foreign := scope
		change(&foreign)
		other, foreignStage, foreignOperation, err := localPushStableClaimSlots(
			dir, foreign.server, foreign.account, foreign.deviceID, foreign.sourceID)
		if err != nil || other == id || foreignStage == stage || foreignOperation == operation {
			t.Fatalf("foreign identity inherited original claims: %q %v", other, err)
		}
	}
	deny := func(dir, server, account, device string, sourceID uint64) {
		t.Helper()
		if _, _, _, err := localPushStableClaimSlots(dir, server, account, device, sourceID); err == nil {
			t.Fatal("invalid original slot scope admitted")
		}
	}
	deny("relative-dir", scope.server, scope.account, scope.deviceID, scope.sourceID)
	deny(dir+string(filepath.Separator)+"..", scope.server, scope.account, scope.deviceID, scope.sourceID)
	deny(dir, scope.server, scope.account, scope.deviceID, 0)
	deny(dir, scope.server, scope.account, "invalid-device", scope.sourceID)
	deny(dir, scope.server, "bad\naccount", scope.deviceID, scope.sourceID)
	if _, err := os.Lstat(filepath.Join(dir, "localpush")); !os.IsNotExist(err) {
		t.Fatalf("pure slot derivation touched disk: %v", err)
	}
}
