//go:build linux || windows

package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

type heldOriginalOperationFixture struct {
	dir         string
	root        string
	account     userconfig.Config
	source      client.Source
	proof       client.LocalBoundSourceProof
	snapshot    string
	digest      string
	operationID string
	body        []byte
}

func makeHeldOriginalOperationFixture(t *testing.T) heldOriginalOperationFixture {
	t.Helper()
	root := filepath.Join(t.TempDir(), "photos")
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	body := bytes.Repeat([]byte("owned-original-operation-"), 15000)
	if err := os.WriteFile(filepath.Join(root, "original.bin"), body, 0o600); err != nil {
		t.Fatal(err)
	}
	grant, err := localpush.PrepareRootGrant(
		"https://server.test", "owner", 42, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	if !grant.StrongIdentity {
		t.Skip("strong native Root unavailable")
	}
	dir := filepath.Join(t.TempDir(), "agent")
	if err := localpush.SaveRootGrant(dir, grant); err != nil {
		t.Fatal(err)
	}
	snap, summary, err := localpush.ScanInventoryToJournal(context.Background(), dir,
		grant, localpush.InventoryScanner{IncludeNativeIdentity: true, BatchSize: 4})
	if err != nil || !summary.Complete || snap.Items != 1 {
		t.Fatalf("native CURRENT unavailable: %+v %+v %v", snap, summary, err)
	}
	target := uint64(77)
	source := client.Source{
		ID: grant.SourceID, Revision: 7, Name: "Local photos",
		Kind: meta.SourceKindLocalFolder, Direction: meta.SourceDirectionPush,
		Status: meta.SourceStatusPaused, SyncMode: meta.SourceSyncModeBackup,
		TargetNodeID: &target, TargetPath: "/Backups",
	}
	proof := client.LocalBoundSourceProof{
		DeviceID: grant.DeviceID, DeviceToken: "owning-device-private-test",
		RootID: grant.RootID, RootFingerprint: grant.Fingerprint,
	}
	account := userconfig.Config{
		Server: grant.Server, Username: grant.Account, SessionID: "test-session",
	}
	scope := localPushRequestKeyScope{}
	scope.server = account.Server
	scope.account = account.Username
	scope.sessionID = account.SessionID
	scope.deviceID = proof.DeviceID
	scope.rootID = proof.RootID
	scope.rootFingerprint = proof.RootFingerprint
	scope.sourceID = source.ID
	scope.revision = source.Revision
	scope.targetNodeID = target
	key, err := mintLocalPushOperationRequestKey(dir, scope)
	if err != nil {
		t.Fatal(err)
	}
	opID := uuid.NewString()
	err = persistLocalPushPreparedReceipt(dir, scope, key, client.LocalPushPreparedOperation{
		SourceID: source.ID, Revision: source.Revision,
		OperationID: opID, Generation: 1, State: "reserved",
	})
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(body)
	return heldOriginalOperationFixture{
		dir: dir, root: root, account: account, source: source,
		proof: proof, snapshot: snap.SnapshotSHA256,
		digest: hex.EncodeToString(hash[:]), operationID: opID, body: body,
	}
}

func TestHeldOriginalOperationReadsExactServerStatusInsideNativeDescriptor(t *testing.T) {
	f := makeHeldOriginalOperationFixture(t)
	reads, calls := 0, 0
	readBound := func(ctx context.Context, id uint64) (client.Source, client.LocalBoundSourceProof, error) {
		reads++
		if id != f.source.ID || ctx.Err() != nil {
			t.Fatal("unexpected Source read")
		}
		return f.source, f.proof, nil
	}
	observe := func(ctx context.Context, id, rev uint64, proof client.LocalBoundSourceProof,
		operationID string, generation uint64,
	) (client.LocalPushOperationStatus, error) {
		calls++
		if ctx.Err() != nil || reads != 2 || id != f.source.ID ||
			rev != f.source.Revision || proof != f.proof ||
			operationID != f.operationID || generation != 1 {
			t.Fatal("private Server observation escaped owning native window")
		}
		return client.LocalPushOperationStatus{
			SourceID: id, Revision: rev, OperationID: operationID,
			Generation: generation, State: "reserved",
		}, nil
	}
	result, err := observeBoundLocalPushHeldOriginalOperation(
		context.Background(), f.dir, f.account, f.source.ID, f.source.Revision,
		"original.bin", f.snapshot, f.digest, int64(len(f.body)),
		func() (userconfig.Config, error) { return f.account, nil },
		readBound, observe)
	if err != nil || reads != 3 || calls != 1 ||
		result.receipt.operationID != f.operationID || result.receipt.generation != 1 ||
		result.native.ContentSHA256 != f.digest || result.native.Size != int64(len(f.body)) ||
		result.native.SnapshotSHA256 != f.snapshot || result.native.NativeKey == "" {
		t.Fatalf("verified status missing inside original native handle: %+v %d %d %v",
			result, reads, calls, err)
	}
	raw, err := json.Marshal(result)
	if err != nil || string(raw) != "{}" {
		t.Fatalf("private file/operation leaked via JSON: %q %v", raw, err)
	}
}

func TestHeldOriginalOperationRejectsScopeDriftAndContentMutation(t *testing.T) {
	for _, variant := range []string{
		"aborted", "expired", "wrong-id", "wrong-generation",
		"changed-source", "changed-session", "revoked-root",
		"changed-file", "missing-key", "wrong-content", "cancel",
	} {
		t.Run(variant, func(t *testing.T) {
			f := makeHeldOriginalOperationFixture(t)
			reads, observes := 0, 0
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			session := func() (userconfig.Config, error) { return f.account, nil }
			if variant == "changed-session" {
				session = func() (userconfig.Config, error) {
					next := f.account
					if observes > 0 {
						next.SessionID = "rotated-session"
					}
					return next, nil
				}
			}
			readBound := func(_ context.Context, _ uint64) (client.Source, client.LocalBoundSourceProof, error) {
				reads++
				s := f.source
				if variant == "changed-source" && reads == 3 {
					s.Revision++
				}
				return s, f.proof, nil
			}
			if variant == "missing-key" {
				scope := localPushRequestKeyScope{}
				scope.server = f.account.Server
				scope.account = f.account.Username
				scope.sessionID = f.account.SessionID
				scope.deviceID = f.proof.DeviceID
				scope.rootID = f.proof.RootID
				scope.rootFingerprint = f.proof.RootFingerprint
				scope.sourceID = f.source.ID
				scope.revision = f.source.Revision
				scope.targetNodeID = *f.source.TargetNodeID
				_, claim, _, err := localPushRequestKeyNames(f.dir, scope)
				if err != nil {
					t.Fatal(err)
				}
				if err := os.Remove(claim); err != nil {
					t.Fatal(err)
				}
			}
			digest := f.digest
			if variant == "wrong-content" {
				digest = strings.Repeat("f", 64)
			}
			observe := func(_ context.Context, id, rev uint64, proof client.LocalBoundSourceProof,
				operationID string, generation uint64,
			) (client.LocalPushOperationStatus, error) {
				observes++
				if reads != 2 {
					t.Fatal("observed operation outside native held window")
				}
				switch variant {
				case "revoked-root":
					if err := localpush.RemoveRootGrant(
						f.dir, f.account.Server, f.account.Username, f.proof.RootID); err != nil {
						t.Fatal(err)
					}
				case "changed-file":
					changed := append([]byte(nil), f.body...)
					changed[len(changed)/2] ^= 0xff
					if err := os.WriteFile(filepath.Join(f.root, "original.bin"), changed, 0o600); err != nil {
						t.Fatal(err)
					}
				case "cancel":
					cancel()
				case "wrong-id":
					operationID = uuid.NewString()
				case "wrong-generation":
					generation++
				}
				state := "reserved"
				if variant == "aborted" || variant == "expired" {
					state = variant
				}
				return client.LocalPushOperationStatus{
					SourceID: id, Revision: rev, OperationID: operationID,
					Generation: generation, State: state,
				}, nil
			}
			result, err := observeBoundLocalPushHeldOriginalOperation(
				ctx, f.dir, f.account, f.source.ID, f.source.Revision,
				"original.bin", f.snapshot, digest, int64(len(f.body)),
				session, readBound, observe)
			if err == nil || result.receipt.operationID != "" {
				t.Fatalf("%s accepted unsafe native operation: %+v %v", variant, result, err)
			}
			if (variant == "missing-key" || variant == "wrong-content") && observes != 0 {
				t.Fatalf("%s contacted Server before validating original: %d", variant, observes)
			}
		})
	}
}
