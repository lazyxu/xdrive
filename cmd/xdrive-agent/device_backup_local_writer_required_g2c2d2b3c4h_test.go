package main

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/localpushrunner"
	"github.com/lazyxu/xdrive/internal/localpushwriter"
)

// The unclaimed private selector used to permit a source-scoped Stage/Prepare
// without first invoking localpushwriter.Begin. There must be NO durable
// Stage/key/Operation side effect if the live Claim was never established.
func TestFirstLeafDriverWithoutLiveWriterCannotEnterPhysicalStage(t *testing.T) {
	d, scope := localPushFirstLeafDriverFixture(t)
	if err := d.Check(context.Background(), scope); err != nil {
		t.Fatalf("control fixture's owning scope invalid: %v", err)
	}
	claimPath, err := localPushStageAdmissionClaimPath(d.configDir, d.requestScope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.Stage(context.Background(), scope); !errors.Is(err, errLocalPushDriverDenied) {
		t.Fatalf("unclaimed Stage was not rejected before O_EXCL: %v", err)
	}
	if _, err := os.Lstat(claimPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unclaimed Stage created a persistent Source slot: %v", err)
	}
	staged := localpushrunner.Staged{
		StageID:  "33333333-3333-4333-8333-333333333333",
		SourceID: scope.SourceID, Revision: scope.Revision,
		Size: scope.Size, ContentSHA256: scope.ContentSHA256,
	}
	if _, err := d.Prepare(context.Background(), scope, staged); !errors.Is(err, errLocalPushDriverDenied) {
		t.Fatalf("unclaimed Prepare minted an Operation: %v", err)
	}
	if _, err := loadLocalPushOperationRequestKey(d.configDir, d.requestScope); err == nil {
		t.Fatal("unclaimed Prepare minted a persistent SecretStore request key")
	}
	if _, err := (&agentController{}).runLocalPushFirstLeafPrivate(
		context.Background(), scope.SourceID, scope.RelativePath, scope.ContentSHA256, scope.Size,
	); !errors.Is(err, errLocalPushDriverDenied) {
		t.Fatalf("obsolete unclaimed selector remained executable: %v", err)
	}
}

func TestFirstLeafLiveWriterPreflightRequiresExactOriginalKernelClaim(t *testing.T) {
	d, scope := localPushFirstLeafDriverFixture(t)
	// Real installed Agent configuration is private (0700). testing.T.TempDir
	// may create a 0755 leaf; never weaken production Writer admission for it.
	secureLocalPushStageAdmissionTestConfig(t, d.configDir)
	d.liveWriterRequired = true
	d.liveWriterOriginalKey = strings.Repeat("d", 64)
	writerScope, err := localpushwriter.NewScope(
		d.configDir, d.grant.Path, d.account.Server, d.account.Username,
		d.account.SessionID, scope.DeviceID, scope.RootID, d.grant.Fingerprint,
		scope.SourceID, scope.Revision, scope.TargetNodeID, d.liveWriterOriginalKey,
		scope.ContentSHA256,
	)
	if err != nil {
		t.Fatal(err)
	}
	writer, err := localpushwriter.Begin(context.Background(), writerScope)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = writer.Close() })
	d.liveWriter = writer
	if err := d.requireLiveOriginalWriter(context.Background(), scope); err != nil {
		t.Fatalf("actual live OS-locked original rejected: %v", err)
	}
	native := d.liveWriterOriginalKey
	d.liveWriterOriginalKey = strings.Repeat("e", 64)
	if err := d.requireLiveOriginalWriter(context.Background(), scope); err == nil {
		t.Fatal("foreign native inode identity was accepted with an old Writer marker")
	}
	d.liveWriterOriginalKey = native
	wrongScope := scope
	wrongScope.SourceID++
	if err := d.requireLiveOriginalWriter(context.Background(), wrongScope); err == nil {
		t.Fatal("foreign Source reused first-file kernel lock")
	}
	wrongScope = scope
	wrongScope.SessionID = "replacement-session"
	if err := d.requireLiveOriginalWriter(context.Background(), wrongScope); err == nil {
		t.Fatal("rebound session reused first-file Writer")
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if err := d.requireLiveOriginalWriter(canceled, scope); err == nil {
		t.Fatal("canceled writer preflight returned success")
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := d.requireLiveOriginalWriter(context.Background(), scope); err == nil {
		t.Fatal("released kernel lock still authorized original Stage")
	}
	if _, err := d.Stage(context.Background(), scope); !errors.Is(err, errLocalPushDriverDenied) {
		t.Fatalf("closed original Writer started Stage: %v", err)
	}
}

func TestFirstLeafProductionEntrypointsCannotBypassLiveWriter(t *testing.T) {
	driver, err := os.ReadFile("device_backup_local_production_driver.go")
	if err != nil {
		t.Fatal(err)
	}
	code := string(driver)
	for _, method := range []string{"Stage", "Prepare", "Commit", "Reconcile"} {
		start := strings.Index(code, "func (d *localPushFirstLeafDriver) "+method+"(")
		if start < 0 {
			t.Fatalf("real Agent %s entrypoint missing", method)
		}
		segment := code[start:]
		if next := strings.Index(segment[5:], "\nfunc ("); next >= 0 {
			segment = segment[:next+5]
		}
		if !strings.Contains(segment, "d.requireLiveOriginalWriter(ctx, s)") {
			t.Fatalf("real Agent %s can skip native Writer preflight", method)
		}
	}
	if strings.Contains(code, "return commitBound(heldCtx)") ||
		strings.Contains(code, "else if err := readBound(heldCtx); err != nil") {
		t.Fatal("canonical Commit/Reconcile retained a non-Writer HTTP fallback")
	}
	if !strings.Contains(code, "return d.withBoundOriginalLiveWriterWitness(") ||
		!strings.Contains(code, "d.withCurrentOriginalLiveWriterProof(") {
		t.Fatal("actual HTTP Commit or Reconcile lost the live Writer lock window")
	}
	if strings.Contains(code, "RunFirstLeaf(ctx, d.scope, d)") {
		t.Fatal("legacy raw-path private runner still creates remote Stage without Writer Begin")
	}
	activation, err := os.ReadFile("device_backup_local_first_file_activation.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(activation)
	claim := strings.Index(text, "localpushwriter.Begin(workCtx, writerScope)")
	originalKey := strings.Index(text, "driver.liveWriterOriginalKey = digest.NativeIdentityKey")
	execute := strings.Index(text, "RunFirstLeaf(workCtx, driver.scope, driver)")
	if claim < 0 || originalKey <= claim || execute <= originalKey ||
		!strings.Contains(text, "driver.liveWriterRequired = true") {
		t.Fatal("real owning-Desktop first-file runner does not bind original Writer before execution")
	}
}
