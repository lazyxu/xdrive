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
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpushrunner"
	"github.com/lazyxu/xdrive/internal/localpushstage"
)

func TestLocalPushRecoveryRejectsAbsentClaimWithoutOSSecret(t *testing.T) {
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	d, scope := localPushFirstLeafDriverFixture(t)
	secureLocalPushStageAdmissionTestConfig(t, d.configDir)
	result, err := d.recoverPreviousFirstLeafReadOnly(context.Background(), scope)
	if !errors.Is(err, errLocalPushDriverDenied) || result.Confirmed || result.Uncertain {
		t.Fatalf("unclaimed recovery bypassed private admission: %+v %v", result, err)
	}
	if _, err := loadLocalPushOperationRequestKey(d.configDir, d.requestScope); err == nil {
		t.Fatal("read-only recovery created an OS secret")
	}
	claim, err := localPushStageAdmissionClaimPath(d.configDir, d.requestScope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(claim); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("read-only recovery allocated a Stage claim")
	}
}

func TestLocalPushRecoveryRejectsOrphanAndTamperedClaims(t *testing.T) {
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	d, scope := localPushFirstLeafDriverFixture(t)
	secureLocalPushStageAdmissionTestConfig(t, d.configDir)
	if err := reserveFreshLocalPushStageAdmission(context.Background(),
		d.configDir, d.requestScope, d.grant); err != nil {
		t.Fatal(err)
	}
	claim, err := localPushStageAdmissionClaimPath(d.configDir, d.requestScope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.recoverPreviousFirstLeafReadOnly(context.Background(), scope); err == nil {
		t.Fatal("Stage claim without original SecretStore key authorized recovery")
	}
	raw, err := os.ReadFile(claim)
	if err != nil || string(raw) != localPushStageAdmissionClaimContents {
		t.Fatalf("read-only recovery modified claim: %v", err)
	}
	if err := os.WriteFile(claim, []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	if localPushStageAdmissionClaimValidForRecovery(claim) {
		t.Fatal("changed Stage claim was accepted")
	}
	if err := os.WriteFile(claim, []byte(localPushStageAdmissionClaimContents), 0o600); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(claim, 0o644); err != nil {
			t.Fatal(err)
		}
		if localPushStageAdmissionClaimValidForRecovery(claim) {
			t.Fatal("readable-by-others Stage claim was accepted")
		}
	}
}

func TestLocalPushRecoveryCannotInventMissingStageOrOriginalOperation(t *testing.T) {
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	d, scope := localPushFirstLeafDriverFixture(t)
	secureLocalPushStageAdmissionTestConfig(t, d.configDir)
	ctx := context.Background()
	if err := reserveFreshLocalPushStageAdmission(ctx, d.configDir, d.requestScope, d.grant); err != nil {
		t.Fatal(err)
	}
	key, err := mintLocalPushOperationRequestKey(d.configDir, d.requestScope)
	if err != nil {
		t.Fatal(err)
	}
	// Even a valid original key without the exact prepared Operation must fail.
	if _, err := d.recoverPreviousFirstLeafReadOnly(ctx, scope); err == nil {
		t.Fatal("original key without prepared SQL identity passed recovery")
	}
	prepared := client.LocalPushPreparedOperation{
		SourceID: scope.SourceID, Revision: scope.Revision,
		OperationID: uuid.NewString(), Generation: 1, State: "reserved",
	}
	if err := persistLocalPushPreparedReceipt(d.configDir, d.requestScope, key, prepared); err != nil {
		t.Fatal(err)
	}
	if _, err := d.recoverPreviousFirstLeafReadOnly(ctx, scope); err == nil {
		t.Fatal("prepared operation without exact historical Stage passed recovery")
	}
	if _, err := loadLocalPushOperationRequestKey(d.configDir, d.requestScope); err != nil {
		t.Fatal("failed recovery deleted the original OS secret")
	}
	if _, err := loadLocalPushPreparedReceipt(d.configDir, d.requestScope, key); err != nil {
		t.Fatal("failed recovery deleted the prepared SQL correlation")
	}
}

func TestLocalPushRecoveryExactOneUnambiguousHint(t *testing.T) {
	_, scope := localPushFirstLeafDriverFixture(t)
	h := localpushstage.LocalOriginalRecoveryHint{
		Stage: localpushstage.LocalOriginalServerStage{
			SourceID: scope.SourceID, Revision: scope.Revision,
			StageID: uuid.NewString(), Size: scope.Size, SHA256: scope.ContentSHA256,
			SnapshotSHA256: strings.Repeat("b", 64),
			CurrentPathKey: strings.Repeat("c", 64),
		},
		RelativePath: scope.RelativePath,
	}
	if _, ok := selectLocalPushRecoveredFirstLeaf([]localpushstage.LocalOriginalRecoveryHint{h}, scope); !ok {
		t.Fatal("exact validated single history candidate was rejected")
	}
	for _, candidate := range [][]localpushstage.LocalOriginalRecoveryHint{
		nil, {h, h},
		{func() localpushstage.LocalOriginalRecoveryHint { other := h; other.Stage.Revision++; return other }()},
		{func() localpushstage.LocalOriginalRecoveryHint {
			other := h
			other.Stage.StageID = "../fake"
			return other
		}()},
		{func() localpushstage.LocalOriginalRecoveryHint {
			other := h
			other.RelativePath = "nested/leaf"
			return other
		}()},
		{func() localpushstage.LocalOriginalRecoveryHint {
			other := h
			other.Stage.SHA256 = strings.Repeat("d", 64)
			return other
		}()},
	} {
		if _, ok := selectLocalPushRecoveredFirstLeaf(candidate, scope); ok {
			t.Fatal("missing, ambiguous or unrelated Stage was accepted")
		}
	}
}

func TestLocalPushRecoveryHasNoPublicRoutingOrWriteMethods(t *testing.T) {
	path := "device_backup_local_recovery_g2c2b.go"
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	src := string(b)
	begin := strings.Index(src, "func (d *localPushFirstLeafDriver) recoverPreviousFirstLeafReadOnly(")
	end := strings.Index(src, "func (c *agentController) recoverLocalPushFirstLeafPrivate(")
	if begin < 0 || end <= begin {
		t.Fatal("private recovery boundaries unavailable")
	}
	body := src[begin:end]
	for _, forbidden := range []string{
		"StageVerifiedNativeOriginalBytes(", "mintLocalPushOperationRequestKey(",
		"PrepareLocalPushOperation(", "BindLocalPushOperationStage(",
		"CommitLocalPushFirstLeafWithOperation(", "SaveLocalOriginalRecoveryHint(",
		"SourceRun", "Delete(", "os.Remove(",
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("private recovery unexpectedly mutates %q", forbidden)
		}
	}
	for _, filename := range []string{"desktop_ipc.go", "desktop_ipc_device_backup_config.go"} {
		b, err := os.ReadFile(filepath.Clean(filename))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(b), "recoverLocalPushFirstLeafPrivate") {
			t.Fatal("private recovery exposed to Desktop IPC")
		}
	}
	var result localpushrunner.FirstLeafResult
	data, err := json.Marshal(result)
	if err != nil || string(data) != "{}" {
		t.Fatalf("recovery observation was serialized to Renderer: %q %v", data, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	d, scope := localPushFirstLeafDriverFixture(t)
	if _, err := d.recoverPreviousFirstLeafReadOnly(ctx, scope); err == nil {
		t.Fatal("canceled recovery read bypassed admission")
	}
}
