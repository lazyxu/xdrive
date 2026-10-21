package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalFirstFileDurableClaimSlotsMatchRealStableOriginal(t *testing.T) {
	configDir := t.TempDir()
	scope := localPushRequestFixture()
	key := localPushFirstFileJobKey{
		server: scope.server, account: scope.account, sessionID: scope.sessionID,
		deviceID: scope.deviceID, sourceID: scope.sourceID,
	}
	paths, err := localFirstFileDurableClaimPaths(configDir, key)
	if err != nil {
		t.Fatal(err)
	}
	stage, err := localPushStageAdmissionClaimPath(configDir, scope)
	if err != nil || paths[1] != stage {
		t.Fatalf("persisted Stage path drifted: %s %s %v", paths[1], stage, err)
	}
	_, operation, _, err := localPushRequestKeyNames(configDir, scope)
	if err != nil || paths[2] != operation {
		t.Fatalf("original operation path drifted: %s %s %v", paths[2], operation, err)
	}
	if filepath.Base(paths[0]) == filepath.Base(paths[1]) ||
		!strings.HasPrefix(paths[0], filepath.Join(configDir, "localpush", "native-writers")) {
		t.Fatal("original native writer slot was not isolated")
	}
	mutable := key
	mutable.sessionID = "changed-session"
	other, err := localFirstFileDurableClaimPaths(configDir, mutable)
	if err != nil || other != paths {
		t.Fatal("login rotation lost permanent original claim")
	}
	for _, wrong := range []func(*localPushFirstFileJobKey){
		func(k *localPushFirstFileJobKey) { k.server = "https://another.test" },
		func(k *localPushFirstFileJobKey) { k.account = "other-user" },
		func(k *localPushFirstFileJobKey) { k.deviceID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
		func(k *localPushFirstFileJobKey) { k.sourceID++ },
	} {
		foreign := key
		wrong(&foreign)
		got, err := localFirstFileDurableClaimPaths(configDir, foreign)
		if err != nil || got == paths {
			t.Fatal("foreign identity gained original recovery slot")
		}
	}
}

func TestLocalFirstFileDurableClaimAlwaysQuarantinesAfterAgentRestart(t *testing.T) {
	dir := t.TempDir()
	scope := localPushRequestFixture()
	key := localPushFirstFileJobKey{
		server: scope.server, account: scope.account, sessionID: scope.sessionID,
		deviceID: scope.deviceID, sourceID: scope.sourceID,
	}
	paths, err := localFirstFileDurableClaimPaths(dir, key)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if found, err := localFirstFileDurableClaimPresent(ctx, dir, key); err != nil || found {
		t.Fatalf("fresh source inherited claim: %t %v", found, err)
	}
	for _, path := range paths {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		body := []byte("possibly-corrupted-original-claim")
		if err := os.WriteFile(path, body, 0o600); err != nil {
			t.Fatal(err)
		}
		found, err := localFirstFileDurableClaimPresent(ctx, dir, key)
		if err != nil || !found {
			t.Fatalf("durable original claim invisible after restart: %s %t %v", path, found, err)
		}
		view := quarantineLocalFirstFileStatusByDurableClaim(
			localBackupFirstFileJobStatus{SourceID: key.sourceID, Phase: "not-recorded"}, found, nil)
		if view.Phase != "uncertain" || view.PhysicalObserved || view.BackupComplete ||
			view.RetirementSafe || view.ObservedBytes != 0 || view.Revision != 0 {
			t.Fatalf("persisted claim invented file completion: %+v", view)
		}
		after, err := os.ReadFile(path)
		if err != nil || string(after) != string(body) {
			t.Fatalf("read-only probe changed source marker: %v", err)
		}
		if err := os.Remove(path); err != nil {
			t.Fatal(err)
		}
	}
	for _, old := range []string{"running", "observed", "uncertain"} {
		view := localBackupFirstFileJobStatus{SourceID: key.sourceID, Phase: old}
		if got := quarantineLocalFirstFileStatusByDurableClaim(view, true, nil); got != view {
			t.Fatalf("durable claim changed authoritative process-local phase %s", old)
		}
	}
	v := quarantineLocalFirstFileStatusByDurableClaim(
		localBackupFirstFileJobStatus{SourceID: key.sourceID, Phase: "not-recorded"},
		false, errLocalBackupFirstFileUnavailable)
	if v.Phase != "uncertain" {
		t.Fatal("unreadable persistent claim was treated as safe absence")
	}
}

func TestLocalFirstFileClaimProbeRejectsCancellationAndUntrustedParents(t *testing.T) {
	dir := t.TempDir()
	scope := localPushRequestFixture()
	key := localPushFirstFileJobKey{
		server: scope.server, account: scope.account, sessionID: scope.sessionID,
		deviceID: scope.deviceID, sourceID: scope.sourceID,
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if found, err := localFirstFileDurableClaimPresent(ctx, dir, key); found || err == nil {
		t.Fatalf("canceled read accepted: %t %v", found, err)
	}
	if found, err := localFirstFileDurableClaimPresent(nil, dir, key); found || err == nil {
		t.Fatalf("nil request context accepted: %t %v", found, err)
	}
	if _, err := localFirstFileDurableClaimPaths("relative/path", key); err == nil {
		t.Fatal("noncanonical config path was accepted")
	}
	if err := os.MkdirAll(filepath.Join(dir, "localpush"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "localpush", "stage-admissions"), []byte("not-a-directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	if found, err := localFirstFileDurableClaimPresent(context.Background(), dir, key); found || !errors.Is(err, errLocalBackupFirstFileUnavailable) {
		t.Fatalf("unsafe claim parent pretended clean: %t %v", found, err)
	}
}
