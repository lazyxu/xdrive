package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/localpushstage"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

func g2c2d2aPositive(e localPushPrivateOriginalRecoveryEvidence) localPushPriorFirstLeafOutcome {
	return localPushPriorFirstLeafOutcome{
		state:       localPushPriorPhysicalCommitObserved,
		operationID: e.prepared.operationID, generation: e.prepared.generation,
	}
}

func TestG2c2d2aOriginalPrivateJournalDurableIdempotentAndNonterminal(t *testing.T) {
	d, evidence := localPushPrivateReservationTerminalFixture(t)
	ctx := context.Background()
	if err := d.appendLocalPushPositiveAudit(ctx, evidence, g2c2d2aPositive(evidence)); err != nil {
		t.Fatalf("original physical observation not journaled: %v", err)
	}
	path, _, err := localPushPositiveAuditPath(d.configDir, d.requestScope)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() ||
		(runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
		t.Fatalf("private audit marker unavailable: %v", err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	row, err := readLocalPushPositiveAudit(ctx, d, evidence)
	if err != nil || row.OperationID != evidence.prepared.operationID ||
		row.Generation != evidence.prepared.generation ||
		row.StageID != evidence.hint.Stage.StageID ||
		row.State != localPushPriorPhysicalCommitObserved || row.MAC == "" {
		t.Fatalf("saved original correlation invalid: %+v %v", row, err)
	}
	for _, secret := range []string{
		d.account.Server, d.account.Username, d.proof.DeviceToken,
		d.grant.Path, d.grant.RootID, d.grant.Fingerprint,
	} {
		if secret != "" && strings.Contains(string(before), secret) {
			t.Fatal("private audit file exposed a raw account, Root or device identifier")
		}
	}
	if err := d.appendLocalPushPositiveAudit(ctx, evidence, g2c2d2aPositive(evidence)); err != nil {
		t.Fatalf("same original observation cannot be reopened: %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || string(after) != string(before) {
		t.Fatalf("idempotent private audit rewrote immutable marker: %v", err)
	}
	key, err := loadLocalPushOperationRequestKey(d.configDir, d.requestScope)
	if err != nil || key != evidence.key {
		t.Fatal("audit discarded original OS request secret")
	}
	if _, err := loadLocalPushPreparedReceipt(d.configDir, d.requestScope, key); err != nil {
		t.Fatal("audit discarded MAC-bound original UUID")
	}
	if _, err := os.Lstat(evidence.claim); err != nil {
		t.Fatal("audit removed original Stage O_EXCL claim")
	}
}

func TestG2c2d2aUnknownAndReservationOnlyNeverReachAuditDisk(t *testing.T) {
	for _, status := range []string{
		localPushPriorAbortedUnresolved, localPushPriorExpiredUnresolved,
		"file_cancelled", "backup_complete", "", "reserved",
	} {
		t.Run(status, func(t *testing.T) {
			d, evidence := localPushPrivateReservationTerminalFixture(t)
			out := g2c2d2aPositive(evidence)
			out.state = status
			if err := d.appendLocalPushPositiveAudit(context.Background(), evidence, out); err == nil {
				t.Fatal("uncertain/forged outcome was persisted")
			}
			path, _, err := localPushPositiveAuditPath(d.configDir, d.requestScope)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("uncertain result created positive journal")
			}
		})
	}
}

func TestG2c2d2aOriginalIdentityAndCurrentSessionCannotChange(t *testing.T) {
	d, evidence := localPushPrivateReservationTerminalFixture(t)
	ctx := context.Background()
	for _, change := range []func(*localPushPriorFirstLeafOutcome){
		func(o *localPushPriorFirstLeafOutcome) { o.operationID = uuid.NewString() },
		func(o *localPushPriorFirstLeafOutcome) { o.generation++ },
	} {
		out := g2c2d2aPositive(evidence)
		change(&out)
		if err := d.appendLocalPushPositiveAudit(ctx, evidence, out); err == nil {
			t.Fatal("foreign original operation was persisted")
		}
	}
	d.currentSession = func() (userconfig.Config, error) {
		changed := d.account
		changed.SessionID = "foreign-login"
		return changed, nil
	}
	if err := d.appendLocalPushPositiveAudit(ctx, evidence, g2c2d2aPositive(evidence)); err == nil {
		t.Fatal("changed login session was allowed to audit original")
	}
	d.currentSession = func() (userconfig.Config, error) { return d.account, nil }
	if err := d.appendLocalPushPositiveAudit(ctx, evidence, g2c2d2aPositive(evidence)); err != nil {
		t.Fatalf("unchanged original Source/Root refused: %v", err)
	}
	other := evidence.hint.Stage
	other.StageID = uuid.NewString()
	if err := localpushstage.SaveLocalOriginalRecoveryHint(
		ctx, d.configDir, d.grant, other, d.scope.RelativePath); err != nil {
		t.Fatal(err)
	}
	if _, err := readLocalPushPositiveAudit(ctx, d, evidence); err == nil {
		t.Fatal("stale positive journal bypassed duplicate Stage scope")
	}
}

func TestG2c2d2aCorruptOrInsecureJournalFailsClosed(t *testing.T) {
	for _, tc := range []string{"corrupt-mac", "unknown-field", "unsafe-mode", "symlink"} {
		t.Run(tc, func(t *testing.T) {
			d, evidence := localPushPrivateReservationTerminalFixture(t)
			ctx := context.Background()
			if err := d.appendLocalPushPositiveAudit(ctx, evidence, g2c2d2aPositive(evidence)); err != nil {
				t.Fatal(err)
			}
			path, _, err := localPushPositiveAuditPath(d.configDir, d.requestScope)
			if err != nil {
				t.Fatal(err)
			}
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			switch tc {
			case "corrupt-mac":
				var saved localPushPositiveAuditDisk
				if err := json.Unmarshal(raw, &saved); err != nil {
					t.Fatal(err)
				}
				saved.MAC = strings.Repeat("0", 64)
				corrupt, _ := json.Marshal(saved)
				if err := os.WriteFile(path, corrupt, 0o600); err != nil {
					t.Fatal(err)
				}
			case "unknown-field":
				raw = append(raw[:len(raw)-1], []byte(`,"retirement_supported":true}`)...)
				if err := os.WriteFile(path, raw, 0o600); err != nil {
					t.Fatal(err)
				}
			case "unsafe-mode":
				if runtime.GOOS == "windows" {
					t.Skip("POSIX mode bits")
				}
				if err := os.Chmod(path, 0o644); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				if runtime.GOOS == "windows" {
					t.Skip("Windows symlink privilege")
				}
				dest := filepath.Join(t.TempDir(), "redirected.json")
				if err := os.WriteFile(dest, raw, 0o600); err != nil {
					t.Fatal(err)
				}
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(dest, path); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := readLocalPushPositiveAudit(ctx, d, evidence); err == nil {
				t.Fatal("unsafe journal was trusted as a terminal file")
			}
			if err := d.appendLocalPushPositiveAudit(ctx, evidence, g2c2d2aPositive(evidence)); err == nil {
				t.Fatal("corrupt old journal was silently overwritten")
			}
			if _, err := os.Lstat(evidence.claim); err != nil {
				t.Fatal("unsafe journal rejection removed original Stage claim")
			}
		})
	}
}

func TestG2c2d2aPartialAuditAndCanceledRequestNeverOverwrite(t *testing.T) {
	d, evidence := localPushPrivateReservationTerminalFixture(t)
	name, _, err := localPushPositiveAuditPath(d.configDir, d.requestScope)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(name), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, []byte("partial-crash-marker"), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if d.appendLocalPushPositiveAudit(ctx, evidence, g2c2d2aPositive(evidence)) == nil {
		t.Fatal("canceled caller unexpectedly wrote journal")
	}
	if d.appendLocalPushPositiveAudit(context.Background(), evidence, g2c2d2aPositive(evidence)) == nil {
		t.Fatal("partial previous crash marker was overwritten")
	}
	contents, err := os.ReadFile(name)
	if err != nil || string(contents) != "partial-crash-marker" {
		t.Fatalf("original ambiguous file was changed: %v", err)
	}
	if _, err := loadLocalPushOperationRequestKey(d.configDir, d.requestScope); err != nil {
		t.Fatal("failed audit destroyed the original request secret")
	}
}

func TestG2c2d2aNeverExportsPositiveAuditAsProductControl(t *testing.T) {
	src, err := os.ReadFile("device_backup_local_positive_audit_g2c2d2a.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{
		"StageVerifiedNativeOriginalBytes(", "mintLocalPushOperationRequestKey(",
		"PrepareLocalPushOperation(", "BindLocalPushOperationStage(",
		"CommitLocalPushFirstLeafWithOperation(", "secretstore.Delete(",
		"DeleteLocalSource(", "BeginSourceRun(", "os.Remove(",
	} {
		if strings.Contains(string(src), forbidden) {
			t.Fatalf("private journal added upload, retirement or SourceRun %q", forbidden)
		}
	}
	for _, gate := range []string{
		"localFolderGrantMu.TryLock()", "recoverPreviousFirstLeafReadOnly(",
		"readPriorFirstLeafOriginalEvidence(", "localPushPriorEvidenceUnchanged(",
		"os.O_CREATE|os.O_EXCL|os.O_WRONLY", "localPushPositiveAuditMAC(",
	} {
		if !strings.Contains(string(src), gate) {
			t.Fatalf("audit path skipped safety gate %q", gate)
		}
	}
	for _, path := range []string{"desktop_ipc.go", "desktop_ipc_device_backup_config.go"} {
		raw, err := os.ReadFile(filepath.Clean(path))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(raw), "auditLocalPushPriorPhysicalCommitPrivate") {
			t.Fatal("private audit exposed to Desktop IPC")
		}
	}
	var observed localPushPriorFirstLeafOutcome
	wire, err := json.Marshal(observed)
	if err != nil || string(wire) != "{}" {
		t.Fatalf("private outcome escaped IPC JSON: %q %v", wire, err)
	}
}
