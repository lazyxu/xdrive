//go:build linux || windows

package localpush

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func firstDirectoryNativeFixture(t *testing.T) (RootGrant, string, string, LocalFirstDirectoryNativeRecheckRequest) {
	t.Helper()
	root, grant, config := deltaFixture(t)
	if !grant.StrongIdentity {
		t.Skip("native filesystem lacks strong Root identity")
	}
	if err := os.Mkdir(filepath.Join(root, "Camera Roll"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "one.txt"), []byte("before"), 0o600); err != nil {
		t.Fatal(err)
	}
	deltaScan(t, config, grant)
	if err := os.WriteFile(filepath.Join(root, "two.txt"), []byte("after"), 0o600); err != nil {
		t.Fatal(err)
	}
	deltaScan(t, config, grant)
	generation, err := PublishLocalReconcileEvidence(context.Background(), config, grant, 9)
	if err != nil {
		t.Fatal(err)
	}
	native := scanNativeIdentity(t, grant)["Camera Roll"]
	if native == nil || !native.Strong {
		t.Skip("native filesystem lacks strong directory identity")
	}
	return grant, config, root, LocalFirstDirectoryNativeRecheckRequest{
		SourceID: grant.SourceID, SourceRevision: 9,
		PreviousSnapshotSHA256: generation.PreviousSHA256,
		CurrentSnapshotSHA256:  generation.CurrentSHA256,
		RelativeDirectory:      "Camera Roll", ExpectedNativeIdentityKey: native.Key,
	}
}

func TestLocalFirstDirectoryNativeRecheckIsPrivateAndRequiresStoredRoot(t *testing.T) {
	grant, config, _, req := firstDirectoryNativeFixture(t)
	if got, err := RecheckLocalFirstDirectoryNative(context.Background(), config, grant, req); err == nil || got.NativeObserved {
		t.Fatalf("unstored Root granted observation: %+v %v", got, err)
	}
	if err := SaveRootGrant(config, grant); err != nil {
		t.Fatal(err)
	}
	got, err := RecheckLocalFirstDirectoryNative(context.Background(), config, grant, req)
	key, keyErr := LocalInventoryPathKey(grant, "directory", "Camera Roll")
	if err != nil || keyErr != nil || !got.NativeObserved || got.CurrentPathKey != key ||
		got.NativeIdentityKey != req.ExpectedNativeIdentityKey ||
		got.SourceRevision != req.SourceRevision || got.RootID != grant.RootID ||
		got.CommitSupported || got.BackupComplete || got.Authoritative || got.MissingInferenceSafe {
		t.Fatalf("native first directory rejected or elevated: %+v %v / %v", got, err, keyErr)
	}
	body, err := json.Marshal(got)
	if err != nil || string(body) != "{}" || strings.Contains(string(body), grant.RootID) ||
		strings.Contains(string(body), "Camera Roll") {
		t.Fatalf("private native observation escaped JSON: %s %v", body, err)
	}
	for name, corrupt := range map[string]func(*LocalFirstDirectoryNativeRecheckRequest){
		"foreign source":   func(x *LocalFirstDirectoryNativeRecheckRequest) { x.SourceID++ },
		"revision":         func(x *LocalFirstDirectoryNativeRecheckRequest) { x.SourceRevision++ },
		"old snapshot":     func(x *LocalFirstDirectoryNativeRecheckRequest) { x.PreviousSnapshotSHA256 = strings.Repeat("f", 64) },
		"current snapshot": func(x *LocalFirstDirectoryNativeRecheckRequest) { x.CurrentSnapshotSHA256 = strings.Repeat("e", 64) },
		"native key": func(x *LocalFirstDirectoryNativeRecheckRequest) {
			x.ExpectedNativeIdentityKey = strings.Repeat("d", 64)
		},
		"missing":    func(x *LocalFirstDirectoryNativeRecheckRequest) { x.RelativeDirectory = "Missing" },
		"nested":     func(x *LocalFirstDirectoryNativeRecheckRequest) { x.RelativeDirectory = "Camera Roll/sub" },
		"traversal":  func(x *LocalFirstDirectoryNativeRecheckRequest) { x.RelativeDirectory = ".." },
		"drive name": func(x *LocalFirstDirectoryNativeRecheckRequest) { x.RelativeDirectory = "C:root" },
	} {
		t.Run(name, func(t *testing.T) {
			bad := req
			corrupt(&bad)
			if obs, err := RecheckLocalFirstDirectoryNative(context.Background(), config, grant, bad); err == nil || obs.NativeObserved {
				t.Fatalf("forged first directory accepted: %+v %v", obs, err)
			}
		})
	}
	if err := RemoveRootGrant(config, grant.Server, grant.Account, grant.RootID); err != nil {
		t.Fatal(err)
	}
	if got, err := RecheckLocalFirstDirectoryNative(context.Background(), config, grant, req); err == nil || got.NativeObserved {
		t.Fatalf("removed Root accepted: %+v %v", got, err)
	}
}

func TestLocalFirstDirectoryNativeRecheckRejectsReplacementSymlinkAndRotatedGeneration(t *testing.T) {
	grant, config, root, req := firstDirectoryNativeFixture(t)
	if err := SaveRootGrant(config, grant); err != nil {
		t.Fatal(err)
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if got, err := RecheckLocalFirstDirectoryNative(cancelled, config, grant, req); !errors.Is(err, context.Canceled) || got.NativeObserved {
		t.Fatalf("canceled read accepted: %+v %v", got, err)
	}
	original := filepath.Join(root, req.RelativeDirectory)
	if err := os.Rename(original, original+"-old"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(original, 0o700); err != nil {
		t.Fatal(err)
	}
	if got, err := RecheckLocalFirstDirectoryNative(context.Background(), config, grant, req); err == nil || got.NativeObserved {
		t.Fatalf("swapped native directory accepted: %+v %v", got, err)
	}
	if err := os.Remove(original); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(original+"-old", original); err != nil {
		t.Skipf("cannot test native directory symlink: %v", err)
	}
	if got, err := RecheckLocalFirstDirectoryNative(context.Background(), config, grant, req); err == nil || got.NativeObserved {
		t.Fatalf("symlink directory accepted: %+v %v", got, err)
	}
	if err := os.Remove(original); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(original+"-old", original); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "extra.txt"), []byte("rotate"), 0o600); err != nil {
		t.Fatal(err)
	}
	deltaScan(t, config, grant)
	if got, err := RecheckLocalFirstDirectoryNative(context.Background(), config, grant, req); err == nil || got.NativeObserved {
		t.Fatalf("rotated CURRENT accepted: %+v %v", got, err)
	}
	if err := os.Rename(root, root+"-old"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if got, err := RecheckLocalFirstDirectoryNative(context.Background(), config, grant, req); err == nil || got.NativeObserved {
		t.Fatalf("replaced Root accepted: %+v %v", got, err)
	}
}

func TestLocalFirstDirectoryPinnedHandleRejectsCurrentPathReplacement(t *testing.T) {
	grant, _, root, request := firstDirectoryNativeFixture(t)
	pinned, err := openPinnedCurrentFirstDirectory(grant, request.RelativeDirectory)
	if err != nil {
		t.Fatalf("could not pin physical first directory: %v", err)
	}
	defer pinned.Close()
	if !currentPinnedFirstDirectoryMatches(grant, request.RelativeDirectory, pinned) {
		t.Fatal("newly pinned directory did not match its CURRENT path")
	}
	current := filepath.Join(root, request.RelativeDirectory)
	moved := filepath.Join(root, "old-first-directory")
	if err := os.Rename(current, moved); err != nil {
		// Windows commonly prevents renaming an open directory. Refusal is
		// a valid platform-specific lifetime fence, not a test failure.
		if runtime.GOOS == "windows" {
			if !currentPinnedFirstDirectoryMatches(grant, request.RelativeDirectory, pinned) {
				t.Fatal("failed replacement invalidated unchanged pinned directory")
			}
			return
		}
		t.Fatalf("rename pinned directory: %v", err)
	}
	if err := os.Mkdir(current, 0o700); err != nil {
		t.Fatal(err)
	}
	if currentPinnedFirstDirectoryMatches(grant, request.RelativeDirectory, pinned) {
		t.Fatal("same-name replacement incorrectly matched pinned native handle")
	}
	replacement, err := openPinnedCurrentFirstDirectory(grant, request.RelativeDirectory)
	if err != nil {
		t.Fatalf("replacement was not independently observable: %v", err)
	}
	defer replacement.Close()
	before, beforeErr := pinned.Stat()
	after, afterErr := replacement.Stat()
	if beforeErr != nil || afterErr != nil || os.SameFile(before, after) {
		t.Fatal("replaced native directory retained the previous native identity")
	}
}

func TestLocalFirstDirectoryHeldHandleNativeIdentityMatchesInventory(t *testing.T) {
	grant, _, _, request := firstDirectoryNativeFixture(t)
	handle, err := openPinnedCurrentFirstDirectory(grant, request.RelativeDirectory)
	if err != nil {
		t.Fatalf("pin current native directory: %v", err)
	}
	held, err := readPinnedDirectoryNativeIdentity(grant.RootID, handle)
	if err != nil || held == nil || held.Key != request.ExpectedNativeIdentityKey ||
		!held.Strong || !held.RenameCandidate || held.LinkCount == 0 {
		t.Fatalf("held fd disagrees with sealed inventory native key: %+v %v", held, err)
	}
	path, err := readCurrentNativeFirstDirectory(grant, request.RelativeDirectory)
	if err != nil || held.Key != path.Key || held.LinkCount != path.LinkCount {
		t.Fatalf("held and current-path identities disagree: fd=%+v path=%+v err=%v", held, path, err)
	}
	if got, err := readPinnedDirectoryNativeIdentity("foreign-root", handle); err == nil || got != nil {
		t.Fatal("unscoped pinned identity accepted")
	}
	if err := handle.Close(); err != nil {
		t.Fatal(err)
	}
	if got, err := readPinnedDirectoryNativeIdentity(grant.RootID, handle); err == nil || got != nil {
		t.Fatal("closed native handle was accepted")
	}
}

func TestLocalFirstDirectoryHeldNativeReadWindowPreservesPrivateObservation(t *testing.T) {
	grant, config, _, request := firstDirectoryNativeFixture(t)
	if err := SaveRootGrant(config, grant); err != nil {
		t.Fatal(err)
	}
	calls := 0
	got, err := recheckLocalFirstDirectoryNativeHeld(
		context.Background(), config, grant, request,
		func(ctx context.Context, observed LocalFirstDirectoryNativeObservation) error {
			calls++
			if ctx.Err() != nil || !observed.NativeObserved ||
				observed.NativeIdentityKey != request.ExpectedNativeIdentityKey ||
				observed.CommitSupported || observed.BackupComplete ||
				observed.Authoritative || observed.MissingInferenceSafe {
				return errors.New("held native callback received invalid/authoritative observation")
			}
			return nil
		},
	)
	if err != nil || calls != 1 || !got.NativeObserved || got.CommitSupported ||
		got.Authoritative || got.BackupComplete || got.MissingInferenceSafe {
		t.Fatalf("held read-only native window did not preserve its scope: %+v calls=%d err=%v", got, calls, err)
	}
	body, err := json.Marshal(got)
	if err != nil || string(body) != "{}" {
		t.Fatalf("held window leaked native details into JSON: %s err=%v", body, err)
	}
}

func TestLocalFirstDirectoryHeldNativeReadWindowRejectsRevocationAndCancel(t *testing.T) {
	for _, scenario := range []string{"remove-root-grant", "cancel", "private-error", "rotate-generation"} {
		t.Run(scenario, func(t *testing.T) {
			grant, config, root, request := firstDirectoryNativeFixture(t)
			if err := SaveRootGrant(config, grant); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			calls := 0
			got, err := recheckLocalFirstDirectoryNativeHeld(
				ctx, config, grant, request,
				func(_ context.Context, _ LocalFirstDirectoryNativeObservation) error {
					calls++
					switch scenario {
					case "remove-root-grant":
						return RemoveRootGrant(config, grant.Server, grant.Account, grant.RootID)
					case "cancel":
						cancel()
					case "private-error":
						return errors.New("private absolute root " + grant.Path)
					case "rotate-generation":
						if err := os.WriteFile(filepath.Join(root, "rotated.txt"), []byte("changed"), 0o600); err != nil {
							return err
						}
						deltaScan(t, config, grant)
						_, err := PublishLocalReconcileEvidence(context.Background(), config, grant, request.SourceRevision)
						return err
					}
					return nil
				},
			)
			if calls != 1 || err == nil || got.NativeObserved || got.SourceID != 0 {
				t.Fatalf("%s accepted stale/unsafe held observation: %+v calls=%d err=%v", scenario, got, calls, err)
			}
			if scenario == "cancel" && !errors.Is(err, context.Canceled) {
				t.Fatalf("held-window cancel not propagated: %v", err)
			}
			if strings.Contains(err.Error(), grant.Path) {
				t.Fatalf("held-window error disclosed private root: %v", err)
			}
		})
	}
}

func TestLocalFirstDirectoryHeldNativeReadWindowRejectsPathReplacement(t *testing.T) {
	grant, config, root, request := firstDirectoryNativeFixture(t)
	if err := SaveRootGrant(config, grant); err != nil {
		t.Fatal(err)
	}
	called, replaced := false, false
	got, err := recheckLocalFirstDirectoryNativeHeld(
		context.Background(), config, grant, request,
		func(_ context.Context, _ LocalFirstDirectoryNativeObservation) error {
			called = true
			current := filepath.Join(root, request.RelativeDirectory)
			if err := os.Rename(current, current+"-old"); err != nil {
				if runtime.GOOS == "windows" {
					// Windows is permitted to reject renaming an open directory.
					return nil
				}
				return err
			}
			replaced = true
			return os.Mkdir(current, 0o700)
		},
	)
	if !called {
		t.Fatal("held window callback never executed")
	}
	if replaced {
		if err == nil || got.NativeObserved {
			t.Fatalf("native path replacement bypassed held-handle fence: %+v err=%v", got, err)
		}
	} else if err != nil || !got.NativeObserved {
		t.Fatalf("unmodified Windows pinned directory incorrectly rejected: %+v err=%v", got, err)
	}
}

func TestLocalFirstDirectoryHeldCheckpointRequiresTrustedCallback(t *testing.T) {
	grant, config, _, request := firstDirectoryNativeFixture(t)
	if err := SaveRootGrant(config, grant); err != nil {
		t.Fatal(err)
	}
	if got, err := RecheckLocalFirstDirectoryNativeWithHeldCheckpoint(
		context.Background(), config, grant, request, nil,
	); err == nil || got.NativeObserved {
		t.Fatalf("nil Agent checkpoint accepted: %+v err=%v", got, err)
	}
	called := false
	got, err := RecheckLocalFirstDirectoryNativeWithHeldCheckpoint(
		context.Background(), config, grant, request,
		func(_ context.Context, observation LocalFirstDirectoryNativeObservation) error {
			called = true
			if !observation.NativeObserved || observation.CommitSupported ||
				observation.BackupComplete || observation.Authoritative ||
				observation.MissingInferenceSafe {
				return errors.New("unexpected read-only checkpoint observation")
			}
			return nil
		},
	)
	if err != nil || !called || !got.NativeObserved ||
		got.CommitSupported || got.BackupComplete {
		t.Fatalf("real verified native checkpoint unavailable: %+v called=%t err=%v", got, called, err)
	}
}
