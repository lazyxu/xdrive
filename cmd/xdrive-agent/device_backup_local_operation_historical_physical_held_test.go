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
	"github.com/lazyxu/xdrive/internal/userconfig"
)

func historicalHeldOriginalKey(t *testing.T, f heldOriginalOperationFixture) [32]byte {
	t.Helper()
	scope := localPushRequestKeyScope{
		server: f.account.Server, account: f.account.Username,
		sessionID: f.account.SessionID,
		deviceID:  f.proof.DeviceID, rootID: f.proof.RootID,
		rootFingerprint: f.proof.RootFingerprint,
		sourceID:        f.source.ID, revision: f.source.Revision,
		targetNodeID: *f.source.TargetNodeID,
	}
	key, err := loadLocalPushOperationRequestKey(f.dir, scope)
	if err != nil || key.bytes == [32]byte{} {
		t.Fatalf("owning original request key missing: %v", err)
	}
	return key.bytes
}

func fakeHeldOriginalHistoricalReceipt(
	f heldOriginalOperationFixture, stage string,
) client.LocalPushHistoricalOperationPhysicalReceipt {
	return client.LocalPushHistoricalOperationPhysicalReceipt{
		StageID: stage, SourceID: f.source.ID, Revision: f.source.Revision,
		OperationID: f.operationID, Generation: 1, NodeID: 87,
		SourceItemID: 91, CASObserved: true,
	}
}

func TestHeldOriginalExactHistoricalPhysicalReadKeepsNativeDescriptor(t *testing.T) {
	f := makeHeldOriginalOperationFixture(t)
	stage := saveHeldOriginalCASStage(t, f)
	expectedKey := historicalHeldOriginalKey(t, f)
	reads, physicalReads := 0, 0
	lookup := func(_ context.Context, sourceID uint64) (
		client.Source, client.LocalBoundSourceProof, error,
	) {
		reads++
		if sourceID != f.source.ID {
			t.Fatal("wrong Source inside historical native descriptor")
		}
		return f.source, f.proof, nil
	}
	// The SQL reservation may ALREADY have expired or been aborted after
	// COMMIT. No live-operation status is consulted for historical proof.
	result, err := observeBoundLocalPushHeldHistoricalOperationPhysical(
		context.Background(), f.dir, f.account, f.source.ID,
		f.source.Revision, stage,
		func() (userconfig.Config, error) { return f.account, nil },
		lookup,
		func(ctx context.Context, id, revision uint64,
			proof client.LocalBoundSourceProof, exactStage, leaf string,
			key [32]byte, opID string, generation uint64,
		) (client.LocalPushHistoricalOperationPhysicalReceipt, error) {
			physicalReads++
			if ctx.Err() != nil || reads != 2 ||
				id != f.source.ID || revision != f.source.Revision ||
				proof != f.proof || exactStage != stage || leaf != "original.bin" ||
				key != expectedKey || opID != f.operationID || generation != 1 {
				t.Fatal("historical original key/operation escaped native descriptor")
			}
			return fakeHeldOriginalHistoricalReceipt(f, stage), nil
		})
	if err != nil || reads != 3 || physicalReads != 1 ||
		result.native.NativeKey == "" ||
		result.native.ContentSHA256 != f.digest ||
		result.native.SnapshotSHA256 != f.snapshot ||
		result.prepared.operationID != f.operationID ||
		result.prepared.generation != 1 ||
		result.physical.StageID != stage || !result.physical.CASObserved ||
		result.physical.NativeVerified || result.physical.BackupComplete ||
		result.physical.CommitSupported || result.physical.Authoritative ||
		result.physical.RetirementSupported {
		t.Fatalf("held original exact historical read incorrect: %+v reads=%d/%d err=%v",
			result, reads, physicalReads, err)
	}
	bytes, err := json.Marshal(result)
	if err != nil || string(bytes) != "{}" {
		t.Fatalf("private native/SQL/CAS proof escaped JSON: %s %v", bytes, err)
	}
}

func TestHeldOriginalExactHistoricalPhysicalRejectsDrift(t *testing.T) {
	for _, scenario := range []string{
		"missing-stage", "wrong-reply-operation", "wrong-reply-stage",
		"wrong-reply-generation", "elevated-backup", "elevated-retirement",
		"no-cas", "zero-node", "source-switch", "session-switch",
		"root-revoked", "same-size-file-change", "cancel",
	} {
		t.Run(scenario, func(t *testing.T) {
			f := makeHeldOriginalOperationFixture(t)
			stage := saveHeldOriginalCASStage(t, f)
			if scenario == "missing-stage" {
				stage = uuid.NewString()
			}
			key := historicalHeldOriginalKey(t, f)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			reads, calls := 0, 0
			lookup := func(_ context.Context, _ uint64) (
				client.Source, client.LocalBoundSourceProof, error,
			) {
				reads++
				src := f.source
				if scenario == "source-switch" && reads == 3 {
					src.Revision++
				}
				return src, f.proof, nil
			}
			session := func() (userconfig.Config, error) {
				now := f.account
				if scenario == "session-switch" && calls > 0 {
					now.SessionID = "other-session"
				}
				return now, nil
			}
			observed, err := observeBoundLocalPushHeldHistoricalOperationPhysical(
				ctx, f.dir, f.account, f.source.ID, f.source.Revision,
				stage, session, lookup,
				func(readCtx context.Context, id, revision uint64,
					proof client.LocalBoundSourceProof, givenStage, leaf string,
					requestKey [32]byte, operationID string, gen uint64,
				) (client.LocalPushHistoricalOperationPhysicalReceipt, error) {
					calls++
					if readCtx.Err() != nil || requestKey != key ||
						operationID != f.operationID || gen != 1 ||
						leaf != "original.bin" || proof != f.proof {
						t.Fatal("invalid historical own-device read input")
					}
					out := fakeHeldOriginalHistoricalReceipt(f, givenStage)
					switch scenario {
					case "wrong-reply-operation":
						out.OperationID = uuid.NewString()
					case "wrong-reply-stage":
						out.StageID = uuid.NewString()
					case "wrong-reply-generation":
						out.Generation++
					case "elevated-backup":
						out.BackupComplete = true
					case "elevated-retirement":
						out.RetirementSupported = true
					case "no-cas":
						out.CASObserved = false
					case "zero-node":
						out.NodeID = 0
					case "root-revoked":
						if err := localpush.RemoveRootGrant(
							f.dir, f.account.Server, f.account.Username, f.proof.RootID); err != nil {
							t.Fatal(err)
						}
					case "same-size-file-change":
						modified := append([]byte(nil), f.body...)
						modified[len(modified)/2] ^= 0xff
						if err := os.WriteFile(
							filepath.Join(f.root, "original.bin"), modified, 0o600); err != nil {
							t.Fatal(err)
						}
					case "cancel":
						cancel()
					}
					return out, nil
				})
			if err == nil || observed.native.NativeKey != "" ||
				observed.prepared.operationID != "" ||
				observed.physical.CASObserved {
				t.Fatalf("%s returned untrusted historical proof: %+v err=%v",
					scenario, observed, err)
			}
			if scenario == "missing-stage" && calls != 0 {
				t.Fatalf("missing Stage invoked remote read: %d", calls)
			}
		})
	}
}
