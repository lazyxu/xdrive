package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/meta"
)

func sampleLocalBoundFirstDirectory() (client.Source, client.LocalBoundSourceProof, localpush.LocalFirstDirectoryNativeRecheckRequest, localpush.LocalFirstDirectoryNativeObservation) {
	target := uint64(29)
	source := client.Source{ID: 42, Revision: 7, Name: "Photos", Kind: meta.SourceKindLocalFolder, Direction: meta.SourceDirectionPush, Status: meta.SourceStatusPaused, SyncMode: "backup", TargetNodeID: &target, TargetPath: "/Backup"}
	proof := client.LocalBoundSourceProof{DeviceID: uuid.NewString(), DeviceToken: "test-private-only", RootID: uuid.NewString(), RootFingerprint: strings.Repeat("a", 64)}
	request := localpush.LocalFirstDirectoryNativeRecheckRequest{SourceID: source.ID, SourceRevision: source.Revision, RelativeDirectory: "Camera Roll", ExpectedNativeIdentityKey: strings.Repeat("b", 64), PreviousSnapshotSHA256: strings.Repeat("c", 64), CurrentSnapshotSHA256: strings.Repeat("d", 64)}
	key, _ := localpush.LocalInventoryPathKey(localpush.RootGrant{SourceID: source.ID, RootID: proof.RootID}, "directory", request.RelativeDirectory)
	native := localpush.LocalFirstDirectoryNativeObservation{SourceID: source.ID, SourceRevision: source.Revision, DeviceID: proof.DeviceID, RootID: proof.RootID, RelativeDirectory: request.RelativeDirectory, CurrentPathKey: key, NativeIdentityKey: request.ExpectedNativeIdentityKey, PreviousSnapshotSHA256: request.PreviousSnapshotSHA256, CurrentSnapshotSHA256: request.CurrentSnapshotSHA256, NativeObserved: true}
	return source, proof, request, native
}

func TestLocalFirstDirectoryOwningPreflightReadsServerOnBothSidesOfNative(t *testing.T) {
	source, proof, request, native := sampleLocalBoundFirstDirectory()
	bounds, originals := 0, 0
	got, err := observeLocalBoundFirstDirectory(context.Background(), source.ID, request,
		func(_ context.Context, id uint64) (client.Source, client.LocalBoundSourceProof, error) {
			bounds++
			if id != source.ID {
				t.Fatal("bound read crossed Source identity")
			}
			return source, proof, nil
		},
		func(_ context.Context, p client.LocalBoundSourceProof, req localpush.LocalFirstDirectoryNativeRecheckRequest) (localpush.LocalFirstDirectoryNativeObservation, error) {
			originals++
			if p != proof || req != request {
				t.Fatal("native recheck crossed proof or inventory selector")
			}
			return native, nil
		},
	)
	if err != nil || !got.NativeObserved || bounds != 2 || originals != 1 ||
		got.CurrentPathKey != native.CurrentPathKey || got.BackupComplete ||
		got.CommitSupported || got.Authoritative || got.MissingInferenceSafe {
		t.Fatalf("owner-native-owner observation mismatch: %+v err=%v bounds=%d originals=%d", got, err, bounds, originals)
	}
	raw, err := json.Marshal(got)
	if err != nil || string(raw) != "{}" {
		t.Fatalf("private directory observation escaped JSON: %s %v", raw, err)
	}
}

func TestLocalFirstDirectoryOwningPreflightRejectsRevocationAndScopeChanges(t *testing.T) {
	for _, scenario := range []string{
		"foreign-source", "stale-revision", "nested-name", "cancel-before",
		"missing-device-token", "pull-source", "active-source", "nil-target",
		"first-server-denied", "last-server-denied", "revoked-token",
		"changed-source", "changed-target", "changed-root", "changed-target-path",
		"wrong-native-device", "wrong-native-root", "wrong-native-key",
		"wrong-native-name", "wrong-native-generation", "native-no-proof",
		"native-fake-complete", "native-fake-commit", "native-denied",
		"cancel-native", "cancel-after-server",
	} {
		t.Run(scenario, func(t *testing.T) {
			source, proof, req, native := sampleLocalBoundFirstDirectory()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			switch scenario {
			case "foreign-source":
				req.SourceID++
			case "stale-revision":
				req.SourceRevision++
			case "nested-name":
				req.RelativeDirectory = "Camera Roll/nested"
			case "cancel-before":
				cancel()
			case "missing-device-token":
				proof.DeviceToken = ""
			case "pull-source":
				source.Direction = "pull"
			case "active-source":
				source.Status = "active"
			case "nil-target":
				source.TargetNodeID = nil
			}
			serverReads, nativeReads := 0, 0
			got, err := observeLocalBoundFirstDirectory(ctx, source.ID, req,
				func(_ context.Context, _ uint64) (client.Source, client.LocalBoundSourceProof, error) {
					serverReads++
					if scenario == "first-server-denied" ||
						(scenario == "last-server-denied" && serverReads == 2) {
						return client.Source{}, client.LocalBoundSourceProof{}, errors.New("raw private Server error")
					}
					if serverReads == 2 {
						switch scenario {
						case "revoked-token":
							proof.DeviceToken = ""
						case "changed-source":
							source.Revision++
						case "changed-target":
							changed := uint64(999)
							source.TargetNodeID = &changed
						case "changed-root":
							proof.RootID = uuid.NewString()
						case "changed-target-path":
							source.TargetPath = "/Moved"
						case "cancel-after-server":
							cancel()
						}
					}
					return source, proof, nil
				},
				func(_ context.Context, _ client.LocalBoundSourceProof, _ localpush.LocalFirstDirectoryNativeRecheckRequest) (localpush.LocalFirstDirectoryNativeObservation, error) {
					nativeReads++
					switch scenario {
					case "wrong-native-device":
						native.DeviceID = uuid.NewString()
					case "wrong-native-root":
						native.RootID = uuid.NewString()
					case "wrong-native-key":
						native.CurrentPathKey = strings.Repeat("e", 64)
					case "wrong-native-name":
						native.RelativeDirectory = "Other"
					case "wrong-native-generation":
						native.CurrentSnapshotSHA256 = strings.Repeat("f", 64)
					case "native-no-proof":
						native.NativeObserved = false
					case "native-fake-complete":
						native.BackupComplete = true
					case "native-fake-commit":
						native.CommitSupported = true
					case "native-denied":
						return localpush.LocalFirstDirectoryNativeObservation{}, errors.New("raw OS path leaked")
					case "cancel-native":
						cancel()
					}
					return native, nil
				},
			)
			if err == nil || got.NativeObserved || got.SourceID != 0 || got.BackupComplete || got.CommitSupported {
				t.Fatalf("%s gained forbidden backup authority: %+v %v", scenario, got, err)
			}
			if strings.Contains(err.Error(), "raw private Server") || strings.Contains(err.Error(), "raw OS path") {
				t.Fatalf("%s disclosed private error: %v", scenario, err)
			}
			if strings.HasPrefix(scenario, "cancel-") && !errors.Is(err, context.Canceled) {
				t.Fatalf("%s did not forward cancellation: %v", scenario, err)
			}
			if scenario == "foreign-source" || scenario == "nested-name" || scenario == "cancel-before" {
				if serverReads != 0 || nativeReads != 0 {
					t.Fatalf("%s made untrusted IO: Server %d native %d", scenario, serverReads, nativeReads)
				}
			}
			if scenario == "missing-device-token" || scenario == "pull-source" ||
				scenario == "active-source" || scenario == "nil-target" ||
				scenario == "stale-revision" || scenario == "first-server-denied" {
				if nativeReads != 0 {
					t.Fatalf("%s reached native filesystem without valid Server scope", scenario)
				}
			}
		})
	}
}
