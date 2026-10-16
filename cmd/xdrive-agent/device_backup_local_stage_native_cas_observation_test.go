package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushstage"
)

func testHistoricalNativeCASReceipt(hint localpushstage.LocalOriginalRecoveryHint) client.LocalPushFirstLeafPhysicalReceipt {
	return client.LocalPushFirstLeafPhysicalReceipt{
		StageID: hint.Stage.StageID, SourceID: hint.Stage.SourceID,
		Revision: hint.Stage.Revision, NodeID: 41, SourceItemID: 93,
		State: localPhysicalReceiptRecoveryState, CASObserved: true,
	}
}

func testHistoricalNativeValue(hint localpushstage.LocalOriginalRecoveryHint) localpush.LocalStagedOriginal {
	return localpush.LocalStagedOriginal{
		SHA256: hint.Stage.SHA256, Size: hint.Stage.Size,
		SnapshotSHA256: hint.Stage.SnapshotSHA256,
	}
}

func TestPrivateRestartNativeCASObservationNeedsTwoReadsAndOneScopedReceipt(t *testing.T) {
	hint := samplePrivateStageHint(1, "original.jpg")
	calls, remote := 0, 0
	original := func(_ context.Context, h localpushstage.LocalOriginalRecoveryHint) (localpush.LocalStagedOriginal, error) {
		calls++
		if h.Stage.StageID != hint.Stage.StageID || h.RelativePath != "original.jpg" {
			t.Fatal("private native recheck switched Stage identity")
		}
		return testHistoricalNativeValue(h), nil
	}
	historical := func(_ context.Context, sourceID, revision uint64, id, leaf string) (
		client.LocalPushFirstLeafPhysicalReceipt, error,
	) {
		remote++
		if sourceID != 42 || revision != 7 || id != hint.Stage.StageID || leaf != "original.jpg" {
			t.Fatal("private physical recheck switched owning Source identity")
		}
		return testHistoricalNativeCASReceipt(hint), nil
	}
	got, err := observeHistoricalNativeCAS(context.Background(), hint, 42, 7, original, historical)
	if err != nil || !got.NativeObserved || !got.CASObserved ||
		got.State != localStageNativeCASReadState || got.NodeID != 41 ||
		got.SourceItemID != 93 || got.BackupComplete || got.CommitSupported ||
		got.Authoritative || calls != 2 || remote != 1 {
		t.Fatalf("two-sided native/CAS observation lost its non-authoritative contract: %+v %v native=%d remote=%d",
			got, err, calls, remote)
	}
	raw, err := json.Marshal(got)
	if err != nil || string(raw) != "{}" {
		t.Fatalf("private native/CAS status leaked through IPC JSON: %q %v", raw, err)
	}
}

func TestPrivateRestartNativeCASObservationFailsClosedBeforeOrAfterNetwork(t *testing.T) {
	for _, tc := range []string{
		"wrong-source", "stale-revision", "wrong-UUID", "nested-leaf",
		"missing-digest", "oversized-file", "native-hash-before",
		"native-length-before", "native-snapshot-before", "bad-cas-stage",
		"bad-cas-source", "no-physical-cas", "fake-backup-complete",
		"fake-native-verified", "remote-denied", "native-changed-after",
		"native-vanished-after", "cancel-during-remote", "cancel-before",
	} {
		t.Run(tc, func(t *testing.T) {
			hint := samplePrivateStageHint(1, "original.jpg")
			stageID := hint.Stage.StageID
			sourceID, revision := uint64(42), uint64(7)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			switch tc {
			case "wrong-source":
				sourceID++
			case "stale-revision":
				revision++
			case "wrong-UUID":
				hint.Stage.StageID = "../private"
			case "nested-leaf":
				hint.RelativePath = "private/other.jpg"
			case "missing-digest":
				hint.Stage.CurrentPathKey = ""
			case "oversized-file":
				hint.Stage.Size = 65 << 20
			case "cancel-before":
				cancel()
			}
			nativeCalls, serverCalls := 0, 0
			readNative := func(_ context.Context, h localpushstage.LocalOriginalRecoveryHint) (localpush.LocalStagedOriginal, error) {
				nativeCalls++
				value := testHistoricalNativeValue(h)
				switch tc {
				case "native-hash-before":
					if nativeCalls == 1 {
						value.SHA256 = strings.Repeat("f", 64)
					}
				case "native-length-before":
					if nativeCalls == 1 {
						value.Size++
					}
				case "native-snapshot-before":
					if nativeCalls == 1 {
						value.SnapshotSHA256 = strings.Repeat("f", 64)
					}
				case "native-changed-after":
					if nativeCalls == 2 {
						value.SHA256 = strings.Repeat("f", 64)
					}
				case "native-vanished-after":
					if nativeCalls == 2 {
						return localpush.LocalStagedOriginal{}, errors.New("OS file disappeared")
					}
				}
				return value, nil
			}
			readCAS := func(_ context.Context, _, _ uint64, _, _ string) (
				client.LocalPushFirstLeafPhysicalReceipt, error,
			) {
				serverCalls++
				value := testHistoricalNativeCASReceipt(hint)
				switch tc {
				case "bad-cas-stage":
					value.StageID = uuid.NewString()
				case "bad-cas-source":
					value.SourceID++
				case "no-physical-cas":
					value.CASObserved = false
				case "fake-backup-complete":
					value.BackupComplete = true
				case "fake-native-verified":
					value.NativeVerified = true
				case "remote-denied":
					return client.LocalPushFirstLeafPhysicalReceipt{}, errors.New("remote Root/token must not be forwarded")
				case "cancel-during-remote":
					cancel()
				}
				return value, nil
			}
			got, err := observeHistoricalNativeCAS(
				ctx, hint, sourceID, revision, readNative, readCAS,
			)
			if err == nil || got.CASObserved || got.NativeObserved ||
				got.BackupComplete || got.NodeID != 0 || got.SourceItemID != 0 {
				t.Fatalf("%s acquired forbidden backup authority: %+v %v", tc, got, err)
			}
			if tc == "cancel-before" && !errors.Is(err, context.Canceled) {
				t.Fatalf("canceled request hid context cancellation: %v", err)
			}
			if tc == "cancel-during-remote" && !errors.Is(err, context.Canceled) {
				t.Fatalf("network cancellation did not propagate: %v", err)
			}
			if tc == "wrong-source" || tc == "stale-revision" ||
				tc == "wrong-UUID" || tc == "nested-leaf" ||
				tc == "missing-digest" || tc == "oversized-file" ||
				tc == "cancel-before" {
				if nativeCalls != 0 || serverCalls != 0 {
					t.Fatalf("%s should fail before OS or Server I/O: %d %d", tc, nativeCalls, serverCalls)
				}
			}
			if tc == "native-hash-before" || tc == "native-length-before" ||
				tc == "native-snapshot-before" {
				if nativeCalls != 1 || serverCalls != 0 {
					t.Fatalf("%s contacted remote before original verification: %d %d", tc, nativeCalls, serverCalls)
				}
			}
			if stageID == "" {
				t.Fatal("test Stage identity unexpectedly empty")
			}
		})
	}
}

func TestPrivateRestartNativeCASReadsActualSealedOSFileTwice(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "native")
	config := filepath.Join(t.TempDir(), "agent-config")
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	content := bytes.Repeat([]byte("native-original-evidence-"), 4096)
	if err := os.WriteFile(filepath.Join(root, "original.jpg"), content, 0o600); err != nil {
		t.Fatal(err)
	}
	grant, err := localpush.PrepareRootGrant(
		"http://localhost:19019", "original-owner", 42, uuid.NewString(), root,
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := localpush.SaveRootGrant(config, grant); err != nil {
		t.Fatal(err)
	}
	snapshot, summary, err := localpush.ScanInventoryToJournal(
		context.Background(), config, grant,
		localpush.InventoryScanner{
			IncludeNativeIdentity: true,
			BatchSize:             localpush.DefaultInventoryBatchSize,
		},
	)
	if err != nil || !summary.Complete || snapshot.SnapshotSHA256 == "" {
		t.Fatalf("sealed original CURRENT unavailable: %+v %+v %v", snapshot, summary, err)
	}
	key, err := localpush.LocalInventoryPathKey(grant, "file", "original.jpg")
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(content)
	hint := localpushstage.LocalOriginalRecoveryHint{
		Stage: localpushstage.LocalOriginalServerStage{
			StageID: uuid.NewString(), SourceID: grant.SourceID, Revision: 7,
			Size: int64(len(content)), SHA256: hex.EncodeToString(digest[:]),
			SnapshotSHA256: snapshot.SnapshotSHA256, CurrentPathKey: key,
		},
		RelativePath: "original.jpg", CreatedAt: time.Now().UTC(),
	}
	readNative := func(ctx context.Context, h localpushstage.LocalOriginalRecoveryHint) (
		localpush.LocalStagedOriginal, error,
	) {
		return localpush.StreamCurrentInventoryFileToStaging(
			ctx, config, grant, h.Stage.SnapshotSHA256,
			h.RelativePath, h.Stage.SHA256, io.Discard, nil,
		)
	}
	remote := func(_ context.Context, _, _ uint64, _, _ string) (
		client.LocalPushFirstLeafPhysicalReceipt, error,
	) {
		return testHistoricalNativeCASReceipt(hint), nil
	}
	valid, err := observeHistoricalNativeCAS(
		context.Background(), hint, 42, 7, readNative, remote,
	)
	if err != nil || !valid.NativeObserved || !valid.CASObserved ||
		valid.BackupComplete || valid.Authoritative {
		t.Fatalf("real original hash was not verified around CAS read: %+v %v", valid, err)
	}
	changed := false
	mutateDuringReceipt := func(_ context.Context, _, _ uint64, _, _ string) (
		client.LocalPushFirstLeafPhysicalReceipt, error,
	) {
		changed = true
		if err := os.WriteFile(filepath.Join(root, "original.jpg"),
			bytes.Repeat([]byte{0x99}, len(content)), 0o600); err != nil {
			return client.LocalPushFirstLeafPhysicalReceipt{}, err
		}
		return testHistoricalNativeCASReceipt(hint), nil
	}
	after, err := observeHistoricalNativeCAS(
		context.Background(), hint, 42, 7, readNative, mutateDuringReceipt,
	)
	if !changed || err == nil || after.NativeObserved || after.CASObserved {
		t.Fatalf("same-size native mutation during CAS read was accepted: %+v %v changed=%t",
			after, err, changed)
	}
}
