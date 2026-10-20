package main

import (
	"context"
	"errors"
	"os"
	"runtime"
	"strings"
	"sync"
	"testing"
)

// The installed Agent configuration directory is created/chmod 0700 by
// userconfig.writeConfig. testing.T.TempDir creates 0755 leaf directories
// on POSIX; explicitly match the deployed private-config contract here,
// without weakening the production Stage admission guard.
func secureLocalPushStageAdmissionTestConfig(t *testing.T, dir string) {
	t.Helper()
	if err := os.Chmod(dir, 0o700); err != nil {
		t.Fatal(err)
	}
}

func TestLocalPushStageAdmissionSurvivesRestartAndScopeDrift(t *testing.T) {
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	d, _ := localPushFirstLeafDriverFixture(t)
	secureLocalPushStageAdmissionTestConfig(t, d.configDir)
	ctx := context.Background()
	claim, err := localPushStageAdmissionClaimPath(d.configDir, d.requestScope)
	if err != nil {
		t.Fatal(err)
	}
	if err := reserveFreshLocalPushStageAdmission(ctx, d.configDir, d.requestScope, d.grant); err != nil {
		t.Fatalf("first owning Agent Stage reservation refused: %v", err)
	}
	info, err := os.Lstat(claim)
	if err != nil || !info.Mode().IsRegular() ||
		(runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
		t.Fatalf("durable private Stage claim missing or unsafe: %v", err)
	}
	data, err := os.ReadFile(claim)
	if err != nil || string(data) != localPushStageAdmissionClaimContents ||
		strings.Contains(string(data), d.account.Server) ||
		strings.Contains(string(data), d.account.Username) {
		t.Fatal("Stage claim missing, corrupt or leaked account identity")
	}
	if err := reserveFreshLocalPushStageAdmission(ctx, d.configDir, d.requestScope, d.grant); !errors.Is(err, errLocalPushStageAdmissionUnavailable) {
		t.Fatal("restarted Agent reissued a stale Stage")
	}
	for _, mutate := range []func(*localPushRequestKeyScope){
		func(s *localPushRequestKeyScope) { s.sessionID = "new-login" },
		func(s *localPushRequestKeyScope) { s.revision++ },
		func(s *localPushRequestKeyScope) { s.targetNodeID++ },
	} {
		other := d.requestScope
		mutate(&other)
		next, err := localPushStageAdmissionClaimPath(d.configDir, other)
		if err != nil || next != claim {
			t.Fatal("mutable session/revision/target bypassed stable Stage key")
		}
		if err := reserveFreshLocalPushStageAdmission(ctx, d.configDir, other, d.grant); err == nil {
			t.Fatal("changed mutable scope reissued a prior Stage")
		}
	}
	unchanged, err := os.ReadFile(claim)
	if err != nil || string(unchanged) != localPushStageAdmissionClaimContents {
		t.Fatal("rejection modified original private claim")
	}
}

func TestLocalPushStageAdmissionSerializesTwoAgentProcesses(t *testing.T) {
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	d, _ := localPushFirstLeafDriverFixture(t)
	secureLocalPushStageAdmissionTestConfig(t, d.configDir)
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			results <- reserveFreshLocalPushStageAdmission(context.Background(), d.configDir, d.requestScope, d.grant)
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	success, denied := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, errLocalPushStageAdmissionUnavailable) {
			denied++
		} else {
			t.Fatalf("unexpected Stage admission error: %v", err)
		}
	}
	if success != 1 || denied != 1 {
		t.Fatalf("two Agents created %d Stage claims (denied %d)", success, denied)
	}
}

func TestLocalPushStageAdmissionDeniesOldOperationAndForeignScope(t *testing.T) {
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	d, scope := localPushFirstLeafDriverFixture(t)
	secureLocalPushStageAdmissionTestConfig(t, d.configDir)
	ctx := context.Background()
	foreign := d.requestScope
	foreign.account = "other"
	if err := reserveFreshLocalPushStageAdmission(ctx, d.configDir, foreign, d.grant); err == nil {
		t.Fatal("foreign account passed native Stage gate")
	}
	if _, err := mintLocalPushOperationRequestKey(d.configDir, d.requestScope); err != nil {
		t.Fatal(err)
	}
	if err := reserveFreshLocalPushStageAdmission(ctx, d.configDir, d.requestScope, d.grant); err == nil {
		t.Fatal("old Operation key allowed new Stage")
	}
	claim, err := localPushStageAdmissionClaimPath(d.configDir, d.requestScope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(claim); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("denied Stage allocated a new claim")
	}
	if _, err := d.Stage(ctx, scope); err == nil {
		t.Fatal("stale request passed Driver.Stage")
	}
}

func TestLocalPushStageAdmissionRunsBeforeNativeUploadSourceContract(t *testing.T) {
	source, err := os.ReadFile("device_backup_local_production_driver.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	start := strings.Index(text, "func (d *localPushFirstLeafDriver) Stage(")
	end := strings.Index(text, "func (d *localPushFirstLeafDriver) Prepare(")
	if start < 0 || end < start {
		t.Fatal("Agent Stage/Prepare boundaries are missing")
	}
	body := text[start:end]
	fence := strings.Index(body, "reserveFreshLocalPushStageAdmission(")
	stream := strings.Index(body, "StageVerifiedNativeOriginalBytes(")
	if fence < 0 || stream < 0 || fence > stream {
		t.Fatal("native bytes Stage starts before durable OS claim")
	}
}

// A world-readable local configuration directory is NOT an installed
// xDrive private config. Do not quietly weaken the gate to pass a default
// t.TempDir fixture; ensure the untrusted directory stays rejected.
func TestLocalPushStageAdmissionRejectsNonPrivateConfigDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX mode-bits contract only")
	}
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	d, _ := localPushFirstLeafDriverFixture(t)
	if err := os.Chmod(d.configDir, 0o755); err != nil {
		t.Fatal(err)
	}
	claim, err := localPushStageAdmissionClaimPath(d.configDir, d.requestScope)
	if err != nil {
		t.Fatal(err)
	}
	if err := reserveFreshLocalPushStageAdmission(context.Background(), d.configDir, d.requestScope, d.grant); err == nil {
		t.Fatal("unsafe shared configuration directory admitted private Stage")
	}
	if _, err := os.Lstat(claim); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("denied Stage allocated private claim")
	}
}
