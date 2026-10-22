package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushrunner"
	"github.com/lazyxu/xdrive/internal/localpushstage"
)

func originalStageCommitHintFixture(t *testing.T) (
	*localPushFirstLeafDriver, localpushrunner.Scope,
	localpushrunner.Staged, localpushrunner.Operation, string,
) {
	t.Helper()
	d, scope := localPushFirstLeafDriverFixture(t)
	pathKey, err := localpush.LocalInventoryPathKey(d.grant, "file", scope.RelativePath)
	if err != nil {
		t.Fatal(err)
	}
	d.stage = localpushstage.LocalOriginalServerStage{
		SourceID: scope.SourceID, Revision: scope.Revision,
		StageID: uuid.NewString(), SHA256: scope.ContentSHA256,
		SnapshotSHA256: strings.Repeat("b", 64),
		CurrentPathKey: pathKey, Size: scope.Size,
	}
	if err := localpushstage.SaveLocalOriginalRecoveryHint(
		context.Background(), d.configDir, d.grant, d.stage, scope.RelativePath,
	); err != nil {
		t.Fatal(err)
	}
	d.bound = true
	d.key.bytes[0] = 0x51 // test-only; does not mint any real request-key SecretStore claim
	d.prepared = localPushPrivatePreparedReceipt{
		operationID: uuid.NewString(), generation: 1,
	}
	st := localpushrunner.Staged{
		StageID: d.stage.StageID, SourceID: scope.SourceID,
		Revision: scope.Revision, ContentSHA256: scope.ContentSHA256, Size: scope.Size,
	}
	op := localpushrunner.Operation{
		ID: d.prepared.operationID, Generation: 1,
		SourceID: scope.SourceID, Revision: scope.Revision,
	}
	pattern := filepath.Join(d.configDir, "localpush", "stage-recovery", "*", st.StageID+".json")
	matches, err := filepath.Glob(pattern)
	if err != nil || len(matches) != 1 {
		t.Fatalf("expected one persisted original Stage hint: %v %v", matches, err)
	}
	return d, scope, st, op, matches[0]
}

func TestOriginalStageCommitHoldsSamePrivateHintAcrossCallback(t *testing.T) {
	d, scope, st, op, _ := originalStageCommitHintFixture(t)
	calls := 0
	err := d.withOriginalStageHeldDuringCommit(
		context.Background(), scope, st, op, func(ctx context.Context) error {
			calls++
			return ctx.Err()
		},
	)
	if err != nil || calls != 1 {
		t.Fatalf("valid pinned original Stage failed: calls=%d err=%v", calls, err)
	}
}

func TestOriginalStageCommitCannotUseUnheldOrAlteredHint(t *testing.T) {
	for _, mode := range []string{
		"absent", "corrupt-before", "wrong-stage", "foreign-scope",
		"revoked-root", "cancel-before", "changed-same-inode",
		"same-bytes-replaced", "cancel-during", "callback-failed",
	} {
		t.Run(mode, func(t *testing.T) {
			if mode == "same-bytes-replaced" && runtime.GOOS == "windows" {
				t.Skip("Windows denies rename while the original Stage descriptor is open")
			}
			if mode == "changed-same-inode" && runtime.GOOS == "windows" {
				t.Skip("Windows Stage descriptor sharing differs during in-place edits")
			}
			d, scope, st, op, file := originalStageCommitHintFixture(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			switch mode {
			case "absent":
				if err := os.Remove(file); err != nil {
					t.Fatal(err)
				}
			case "corrupt-before":
				if err := os.WriteFile(file, []byte("{}"), 0o600); err != nil {
					t.Fatal(err)
				}
			case "wrong-stage":
				st.StageID = uuid.NewString()
			case "foreign-scope":
				scope.DeviceID = uuid.NewString()
			case "revoked-root":
				if err := localpush.RemoveRootGrant(
					d.configDir, d.grant.Server, d.grant.Account, d.grant.RootID,
				); err != nil {
					t.Fatal(err)
				}
			case "cancel-before":
				cancel()
			}
			calls := 0
			err := d.withOriginalStageHeldDuringCommit(ctx, scope, st, op,
				func(context.Context) error {
					calls++
					switch mode {
					case "changed-same-inode":
						data, readErr := os.ReadFile(file)
						if readErr != nil {
							return readErr
						}
						return os.WriteFile(file, bytes.Repeat([]byte("x"), len(data)), 0o600)
					case "same-bytes-replaced":
						data, readErr := os.ReadFile(file)
						if readErr != nil {
							return readErr
						}
						if err := os.Rename(file, file+".prior"); err != nil {
							return err
						}
						return os.WriteFile(file, data, 0o600)
					case "cancel-during":
						cancel()
					case "callback-failed":
						return errors.New("remote operation result uncertain")
					}
					return nil
				},
			)
			if err == nil {
				t.Fatalf("%s promoted altered Stage to successful commit", mode)
			}
			expectCalls := 0
			switch mode {
			case "changed-same-inode", "same-bytes-replaced", "cancel-during", "callback-failed":
				expectCalls = 1
			}
			if calls != expectCalls {
				t.Fatalf("%s executed callback %d times, expected %d", mode, calls, expectCalls)
			}
		})
	}
}

func TestOriginalAgentCommitNestsStageFdNativeFdWriterAndHTTP(t *testing.T) {
	// This checks the actual production Commit call tree; a helper-only test
	// cannot certify that the owning upload invokes the pinned Stage window.
	raw, err := os.ReadFile("device_backup_local_production_driver.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (d *localPushFirstLeafDriver) Commit(")
	end := strings.Index(source, "func (d *localPushFirstLeafDriver) Reconcile(")
	if start < 0 || end <= start {
		t.Fatal("live production Commit or Reconcile boundary missing")
	}
	body := source[start:end]
	for _, call := range []string{
		"return d.withOriginalStageHeldDuringCommit(",
		"WithHeldCurrentOriginalFirstLeafCommitWindow(heldStageCtx",
		"return d.withBoundOriginalLiveWriterWitness(",
		"CommitLocalPushFirstLeafWithOperation(",
		"return commitBound(writeCtx)",
	} {
		if !strings.Contains(body, call) {
			t.Fatalf("real HTTP commit lost a mandatory held-boundary: %s", call)
		}
	}
	guard, err := os.ReadFile("device_backup_local_operation_stage_hint_commit_g2c2d2b3c4f.go")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(guard), "WithHeldLocalOriginalRecoveryHint(") {
		t.Fatal("the outer Stage hint gate no longer holds an original descriptor")
	}
}
