//go:build linux || windows

package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushstage"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

func saveHeldOriginalCASStage(t *testing.T, f heldOriginalOperationFixture) string {
	t.Helper()
	grant, err := localpush.LoadRootGrant(f.dir, f.account.Server, f.account.Username, f.proof.RootID)
	if err != nil {
		t.Fatal(err)
	}
	key, err := localpush.LocalInventoryPathKey(grant, "file", "original.bin")
	if err != nil {
		t.Fatal(err)
	}
	id := uuid.NewString()
	stage := localpushstage.LocalOriginalServerStage{
		SourceID: f.source.ID, Revision: f.source.Revision, StageID: id,
		SnapshotSHA256: f.snapshot, SHA256: f.digest,
		CurrentPathKey: key, Size: int64(len(f.body)),
	}
	if err := localpushstage.SaveLocalOriginalRecoveryHint(
		context.Background(), f.dir, grant, stage, "original.bin"); err != nil {
		t.Fatal(err)
	}
	return id
}

func heldOriginalCASReceipt(f heldOriginalOperationFixture, stageID string) client.LocalPushFirstLeafPhysicalReceipt {
	return client.LocalPushFirstLeafPhysicalReceipt{
		SourceID: f.source.ID, Revision: f.source.Revision, StageID: stageID,
		NodeID: 88, SourceItemID: 99,
		State: localPhysicalReceiptRecoveryState, CASObserved: true,
	}
}

func TestHeldOriginalCASCorrelatesInsideOneNativeDescriptor(t *testing.T) {
	f := makeHeldOriginalOperationFixture(t)
	stageID := saveHeldOriginalCASStage(t, f)
	reads, statuses, physicals := 0, 0, 0
	readBound := func(ctx context.Context, id uint64) (client.Source, client.LocalBoundSourceProof, error) {
		reads++
		if ctx.Err() != nil || id != f.source.ID {
			t.Fatal("unexpected private source read")
		}
		return f.source, f.proof, nil
	}
	observe := func(_ context.Context, id, rev uint64, proof client.LocalBoundSourceProof,
		operationID string, generation uint64,
	) (client.LocalPushOperationStatus, error) {
		statuses++
		if proof != f.proof || id != f.source.ID || rev != f.source.Revision ||
			operationID != f.operationID || generation != 1 ||
			(statuses == 1 && reads != 2) || (statuses == 2 && reads != 3) {
			t.Fatal("operation observation not fenced inside native checkpoint")
		}
		return client.LocalPushOperationStatus{
			SourceID: id, Revision: rev, OperationID: operationID,
			Generation: generation, State: "reserved",
		}, nil
	}
	check := localPushHeldOriginalCASCheck{
		stageID: stageID,
		read: func(_ context.Context, id, rev uint64, proof client.LocalBoundSourceProof, stage, leaf string) (
			client.LocalPushFirstLeafPhysicalReceipt, error,
		) {
			physicals++
			if reads != 3 || statuses != 1 || proof != f.proof ||
				id != f.source.ID || rev != f.source.Revision ||
				stage != stageID || leaf != "original.bin" {
				t.Fatal("physical receipt read outside held native original")
			}
			return heldOriginalCASReceipt(f, stageID), nil
		},
	}
	got, err := observeBoundLocalPushHeldOriginalOperation(
		context.Background(), f.dir, f.account, f.source.ID, f.source.Revision,
		"original.bin", f.snapshot, f.digest, int64(len(f.body)),
		func() (userconfig.Config, error) { return f.account, nil },
		readBound, observe, check)
	if err != nil || reads != 4 || statuses != 2 || physicals != 1 ||
		got.native.ContentSHA256 != f.digest ||
		got.receipt.operationID != f.operationID ||
		got.cas.StageID != stageID || !got.cas.CASObserved ||
		got.cas.BackupComplete || got.cas.CommitSupported || got.cas.Authoritative {
		t.Fatalf("native/CAS read observation failed: %+v counts=%d/%d/%d err=%v",
			got, reads, statuses, physicals, err)
	}
	raw, err := json.Marshal(got)
	if err != nil || string(raw) != "{}" {
		t.Fatalf("private read evidence escaped IPC serialization: %s %v", raw, err)
	}
}

func TestHeldOriginalCASFailsClosedOnDrift(t *testing.T) {
	for _, variant := range []string{
		"missing-stage", "mismatched-stage", "wrong-receipt",
		"elevated-flags", "expired-after-cas", "session-switched",
		"file-modified", "root-revoked", "cancel",
	} {
		t.Run(variant, func(t *testing.T) {
			f := makeHeldOriginalOperationFixture(t)
			stageID := saveHeldOriginalCASStage(t, f)
			reads, statuses, physicals := 0, 0, 0
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if variant == "missing-stage" {
				stageID = uuid.NewString()
			}
			session := func() (userconfig.Config, error) {
				now := f.account
				if variant == "session-switched" && physicals > 0 {
					now.SessionID = "new-session"
				}
				return now, nil
			}
			readBound := func(_ context.Context, _ uint64) (client.Source, client.LocalBoundSourceProof, error) {
				reads++
				return f.source, f.proof, nil
			}
			observe := func(_ context.Context, id, rev uint64, proof client.LocalBoundSourceProof,
				operationID string, generation uint64,
			) (client.LocalPushOperationStatus, error) {
				statuses++
				state := "reserved"
				if variant == "expired-after-cas" && statuses == 2 {
					state = "expired"
				}
				return client.LocalPushOperationStatus{
					SourceID: id, Revision: rev, OperationID: operationID,
					Generation: generation, State: state,
				}, nil
			}
			check := localPushHeldOriginalCASCheck{
				stageID: stageID,
				read: func(_ context.Context, id, rev uint64, proof client.LocalBoundSourceProof,
					stage, leaf string,
				) (client.LocalPushFirstLeafPhysicalReceipt, error) {
					physicals++
					receipt := heldOriginalCASReceipt(f, stage)
					switch variant {
					case "wrong-receipt":
						receipt.SourceID++
					case "elevated-flags":
						receipt.BackupComplete = true
					case "file-modified":
						modified := append([]byte(nil), f.body...)
						modified[len(modified)/2] ^= 0xff
						if err := os.WriteFile(filepath.Join(f.root, "original.bin"), modified, 0o600); err != nil {
							t.Fatal(err)
						}
					case "root-revoked":
						if err := localpush.RemoveRootGrant(
							f.dir, f.account.Server, f.account.Username, f.proof.RootID); err != nil {
							t.Fatal(err)
						}
					case "cancel":
						cancel()
					}
					return receipt, nil
				},
			}
			digest := f.digest
			if variant == "mismatched-stage" {
				digest = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
			}
			got, err := observeBoundLocalPushHeldOriginalOperation(
				ctx, f.dir, f.account, f.source.ID, f.source.Revision,
				"original.bin", f.snapshot, digest, int64(len(f.body)),
				session, readBound, observe, check)
			if err == nil || got.receipt.operationID != "" || got.cas.CASObserved {
				t.Fatalf("%s returned unsafe native/CAS evidence: %+v %v", variant, got, err)
			}
			if (variant == "missing-stage" || variant == "mismatched-stage") && physicals != 0 {
				t.Fatalf("%s contacted Server before validating Stage: %d", variant, physicals)
			}
		})
	}
}
