//go:build linux || windows

package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushwriter"
)

const localPushStageKeyCrashChildEnv = "XDRIVE_LOCALPUSH_STAGE_KEY_CRASH_CHILD"

func localPushCrashWriterScope(
	configDir string, grant localpush.RootGrant,
	sessionID string,
) (localpushwriter.Scope, error) {
	return localpushwriter.NewScope(
		configDir, grant.Path, grant.Server, grant.Account, sessionID,
		grant.DeviceID, grant.RootID, grant.Fingerprint, grant.SourceID,
		3, 9, strings.Repeat("d", 64), strings.Repeat("a", 64),
	)
}

func localPushCrashOperationScope(grant localpush.RootGrant, sessionID string) localPushRequestKeyScope {
	return localPushRequestKeyScope{
		server: grant.Server, account: grant.Account, sessionID: sessionID,
		deviceID: grant.DeviceID, rootID: grant.RootID,
		rootFingerprint: grant.Fingerprint, sourceID: grant.SourceID,
		revision: 3, targetNodeID: 9,
	}
}

// This is an actual child OS process with a live kernel-locked Writer, an
// O_EXCL Source-wide Stage-admission marker and a saved private request key.
// SIGKILL/TerminateProcess kills it WITHOUT calling Writer.Close.
// It deliberately performs no HTTP or SQL to avoid manufacturing a remote
// physical-COMMIT/CANCEL or a second-file admission in this test.
func TestLocalPushWriterStageKeyCrashChild(t *testing.T) {
	if os.Getenv(localPushStageKeyCrashChildEnv) != "1" {
		t.Skip("only run inside the explicitly marked short-lived OS child")
	}
	configDir := os.Getenv("XDRIVE_LOCALPUSH_CRASH_CONFIG")
	rootID := os.Getenv("XDRIVE_LOCALPUSH_CRASH_ROOT_ID")
	ready := os.Getenv("XDRIVE_LOCALPUSH_CRASH_READY")
	if configDir == "" || rootID == "" || ready == "" {
		t.Fatal("missing private child fixture coordinates")
	}
	grant, err := localpush.LoadRootGrant(configDir, "https://server.test", "alice", rootID)
	if err != nil || !grant.StrongIdentity || grant.SourceID != 42 {
		t.Fatalf("crash child has no saved owning Root: %v", err)
	}
	writerScope, err := localPushCrashWriterScope(configDir, grant, "login-a")
	if err != nil {
		t.Fatal(err)
	}
	claim, err := localpushwriter.Begin(context.Background(), writerScope)
	if err != nil {
		t.Fatalf("child could not lock the original writer: %v", err)
	}
	defer claim.Close() // only on normal exit; parent deliberately kills process
	opScope := localPushCrashOperationScope(grant, "login-a")
	if err := reserveFreshLocalPushStageAdmission(
		context.Background(), configDir, opScope, grant,
	); err != nil {
		t.Fatalf("child could not persist the original Stage admission: %v", err)
	}
	if _, err := mintLocalPushOperationRequestKey(configDir, opScope); err != nil {
		t.Fatalf("child could not persist the original request key: %v", err)
	}
	if err := os.WriteFile(ready, []byte("stage-and-key-durable"), 0o600); err != nil {
		t.Fatal(err)
	}
	for {
		time.Sleep(time.Hour)
	}
}

func TestLocalPushRealProcessCrashCannotReenterWriterStageOrKey(t *testing.T) {
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	d, _ := localPushFirstLeafDriverFixture(t)
	secureLocalPushStageAdmissionTestConfig(t, d.configDir)
	scope := d.requestScope
	writerScope, err := localPushCrashWriterScope(d.configDir, d.grant, scope.sessionID)
	if err != nil {
		t.Fatal(err)
	}
	ready := filepath.Join(t.TempDir(), "child-ready")
	child := exec.Command(os.Args[0], "-test.run=^TestLocalPushWriterStageKeyCrashChild$")
	var output bytes.Buffer
	child.Stdout, child.Stderr = &output, &output
	child.Env = append(os.Environ(),
		localPushStageKeyCrashChildEnv+"=1",
		"XDRIVE_LOCALPUSH_CRASH_CONFIG="+d.configDir,
		"XDRIVE_LOCALPUSH_CRASH_ROOT_ID="+d.grant.RootID,
		"XDRIVE_LOCALPUSH_CRASH_READY="+ready,
	)
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	waited := false
	t.Cleanup(func() {
		if !waited {
			_ = child.Process.Kill()
			_ = child.Wait()
		}
	})
	deadline := time.Now().Add(20 * time.Second)
	for {
		if _, err := os.Stat(ready); err == nil {
			break
		} else if !errors.Is(err, os.ErrNotExist) {
			t.Fatal(err)
		}
		if time.Now().After(deadline) {
			t.Fatalf("child did not establish original Writer/Stage/key: %s", output.String())
		}
		time.Sleep(25 * time.Millisecond)
	}
	stagePath, err := localPushStageAdmissionClaimPath(d.configDir, scope)
	if err != nil {
		t.Fatal(err)
	}
	stageBefore, err := os.ReadFile(stagePath)
	if err != nil || len(stageBefore) == 0 {
		t.Fatalf("crash child's original O_EXCL Stage is missing: %v", err)
	}
	keyBefore, err := loadLocalPushOperationRequestKey(d.configDir, scope)
	if err != nil || keyBefore.bytes == ([32]byte{}) {
		t.Fatalf("crash child failed to persist original SecretStore key: %v", err)
	}
	if _, err := localpushwriter.Begin(context.Background(), writerScope); err == nil {
		t.Fatal("second Writer admitted while original OS child still owns the lock")
	}
	if err := reserveFreshLocalPushStageAdmission(context.Background(),
		d.configDir, scope, d.grant); err == nil {
		t.Fatal("second Stage admitted while original owner child remains alive")
	}
	if _, err := mintLocalPushOperationRequestKey(d.configDir, scope); err == nil {
		t.Fatal("second original request key admitted during live child's operation")
	}
	// Physically kill the owning Agent process without invoking Close.
	if err := child.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = child.Wait()
	waited = true
	if err := localpushwriter.ReadOriginalWriterQuarantine(
		context.Background(), writerScope,
	); err != nil {
		t.Fatalf("immutable original Writer marker lost after process kill: %v", err)
	}
	if _, err := localpushwriter.Begin(context.Background(), writerScope); err == nil {
		t.Fatal("released kernel lock following crash admitted another first writer")
	}
	if err := reserveFreshLocalPushStageAdmission(context.Background(),
		d.configDir, scope, d.grant); err == nil {
		t.Fatal("process kill allowed a new original Stage claim")
	}
	if _, err := mintLocalPushOperationRequestKey(d.configDir, scope); err == nil {
		t.Fatal("process kill allowed an alternative original request key")
	}
	// Mutable login/revision/target drift must not create another Source
	// admission or revive the retired *process*, even with the same Root.
	for _, mutate := range []func(*localPushRequestKeyScope){
		func(x *localPushRequestKeyScope) { x.sessionID = "new-login" },
		func(x *localPushRequestKeyScope) { x.revision++ },
		func(x *localPushRequestKeyScope) { x.targetNodeID++ },
	} {
		other := scope
		mutate(&other)
		if err := reserveFreshLocalPushStageAdmission(context.Background(),
			d.configDir, other, d.grant); err == nil {
			t.Fatal("mutable scope drift minted a Stage after crash")
		}
		if _, err := mintLocalPushOperationRequestKey(d.configDir, other); err == nil {
			t.Fatal("mutable scope drift minted a fresh request key after crash")
		}
	}
	stageAfter, err := os.ReadFile(stagePath)
	if err != nil || !bytes.Equal(stageBefore, stageAfter) {
		t.Fatalf("post-kill attempts changed original O_EXCL Stage marker: %v", err)
	}
	keyAfter, err := loadLocalPushOperationRequestKey(d.configDir, scope)
	if err != nil || keyAfter != keyBefore {
		t.Fatalf("post-kill attempts changed original OS-secret request key: %v", err)
	}
}
