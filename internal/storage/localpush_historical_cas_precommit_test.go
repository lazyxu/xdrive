package storage

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestLocalPushHistoricalCASBeforeCommitPinsAndVerifies(t *testing.T) {
	reader, writer, stageKey, casKey, data := makeLocalPushStageCASFixture(t)
	if err := writer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatal(err)
	}
	calls := 0
	matched, err := reader.InspectPinnedLocalPushHistoricalCASBeforeCommit(
		context.Background(), casKey, int64(len(data)), func(context.Context) error {
			calls++
			ctx, cancel := context.WithTimeout(context.Background(), 160*time.Millisecond)
			defer cancel()
			if err := writer.Delete(ctx, casKey); !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("original CAS pin released before precommit callback: %v", err)
			}
			return nil
		},
	)
	if err != nil || !matched || calls != 1 {
		t.Fatalf("precommit CAS did not verify under held pin: matched=%t calls=%d err=%v", matched, calls, err)
	}
	if err := writer.Delete(context.Background(), casKey); err != nil {
		t.Fatalf("precommit CAS pin leaked: %v", err)
	}
}

func TestLocalPushHistoricalCASBeforeCommitFailClosed(t *testing.T) {
	for _, scenario := range []string{"bad-key", "bad-size", "corrupt-before", "cancel-before", "cancel-in-callback", "callback-error", "corrupt-in-callback"} {
		t.Run(scenario, func(t *testing.T) {
			reader, writer, stageKey, casKey, data := makeLocalPushStageCASFixture(t)
			if err := writer.DeleteStaging(context.Background(), stageKey); err != nil {
				t.Fatal(err)
			}
			key, size := casKey, int64(len(data))
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			full := filepath.Join(reader.FilesystemRoot(), filepath.FromSlash(casKey))
			changed := append([]byte(nil), data...)
			changed[len(changed)/2] ^= 0x20
			switch scenario {
			case "bad-key":
				key = "outside/cas"
			case "bad-size":
				size++
			case "corrupt-before":
				if err := os.WriteFile(full, changed, 0o600); err != nil {
					t.Fatal(err)
				}
			case "cancel-before":
				cancel()
			}
			calls := 0
			sentinel := errors.New("private callback failed")
			matched, err := reader.InspectPinnedLocalPushHistoricalCASBeforeCommit(ctx, key, size, func(context.Context) error {
				calls++
				switch scenario {
				case "cancel-in-callback":
					cancel()
				case "callback-error":
					return sentinel
				case "corrupt-in-callback":
					return os.WriteFile(full, changed, 0o600)
				}
				return nil
			})
			if matched || err == nil {
				t.Fatalf("unsafe %s became a physical terminal: matched=%t err=%v", scenario, matched, err)
			}
			before := scenario == "bad-key" || scenario == "bad-size" || scenario == "corrupt-before" || scenario == "cancel-before"
			if errors.Is(err, ErrLocalPushCASPrecommitOutcomeUncertain) != !before {
				t.Fatalf("%s lost pre/post callback uncertainty distinction: %v", scenario, err)
			}
			if scenario == "callback-error" && !errors.Is(err, sentinel) {
				t.Fatalf("post-callback uncertainty obscured original failure: %v", err)
			}
			if scenario == "cancel-in-callback" && !errors.Is(err, context.Canceled) {
				t.Fatalf("post-callback uncertainty obscured context cancellation: %v", err)
			}
			if (calls == 0) != before {
				t.Fatalf("%s callback order wrong: calls=%d", scenario, calls)
			}
			if err := writer.Delete(context.Background(), casKey); err != nil {
				t.Fatalf("rejected scope leaked held CAS: %v", err)
			}
		})
	}
}

func TestLocalPushHistoricalCASBeforeCommitRejectsNilCallback(t *testing.T) {
	reader, _, _, casKey, data := makeLocalPushStageCASFixture(t)
	matched, err := reader.InspectPinnedLocalPushHistoricalCASBeforeCommit(context.Background(), casKey, int64(len(data)), nil)
	if matched || err == nil {
		t.Fatalf("nil precommit callback was admitted: matched=%t err=%v", matched, err)
	}
}

// This child test runs in a DIFFERENT Go process, not merely a second
// Local Store instance. It checks the real OS shared/exclusive shard
// collision without using in-process mutex state.
func TestLocalPushHistoricalCASBeforeCommitChildProcessLease(t *testing.T) {
	if os.Getenv("XD_TEST_LOCALPUSH_CAS_CHILD") != "1" {
		return
	}
	root := os.Getenv("XD_TEST_LOCALPUSH_CAS_ROOT")
	key := os.Getenv("XD_TEST_LOCALPUSH_CAS_KEY")
	want := os.Getenv("XD_TEST_LOCALPUSH_CAS_EXPECT")
	if root == "" || key == "" || (want != "busy" && want != "free") {
		t.Fatal("invalid isolated CAS child test scope")
	}
	store, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	hash, ok := canonicalCASDigest(key)
	if !ok {
		t.Fatal("invalid canonical CAS hash for child")
	}
	release, acquired, err := store.casLifecycleLeaseMode(
		context.Background(), hash, true, true,
	)
	if err != nil {
		t.Fatalf("child OS exclusive try-lock failed: %v", err)
	}
	if acquired {
		release()
	}
	if (want == "busy" && acquired) || (want == "free" && !acquired) {
		t.Fatalf("cross-process CAS lease: expected %s, acquired=%t", want, acquired)
	}
}

func TestLocalPushHistoricalCASBeforeCommitKeepsPinAcrossProcesses(t *testing.T) {
	reader, writer, stageKey, casKey, data := makeLocalPushStageCASFixture(t)
	if err := writer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatal(err)
	}
	checkChild := func(want string) {
		ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
		defer cancel()
		cmd := exec.CommandContext(
			ctx, os.Args[0], "-test.run=^TestLocalPushHistoricalCASBeforeCommitChildProcessLease$",
		)
		cmd.Env = append(os.Environ(),
			"XD_TEST_LOCALPUSH_CAS_CHILD=1",
			"XD_TEST_LOCALPUSH_CAS_ROOT="+reader.FilesystemRoot(),
			"XD_TEST_LOCALPUSH_CAS_KEY="+casKey,
			"XD_TEST_LOCALPUSH_CAS_EXPECT="+want,
		)
		output, err := cmd.CombinedOutput()
		if err != nil || ctx.Err() != nil {
			t.Fatalf("cross-process CAS %s check failed: %v, ctx=%v, output=%s",
				want, err, ctx.Err(), output)
		}
	}
	calls := 0
	matched, err := reader.InspectPinnedLocalPushHistoricalCASBeforeCommit(
		context.Background(), casKey, int64(len(data)), func(context.Context) error {
			calls++
			checkChild("busy")
			return nil
		},
	)
	if err != nil || !matched || calls != 1 {
		t.Fatalf("shared physical CAS pin was not held across process: matched=%t calls=%d err=%v",
			matched, calls, err)
	}
	checkChild("free")
	if err := writer.Delete(context.Background(), casKey); err != nil {
		t.Fatalf("released cross-process pin blocked canonical CAS deletion: %v", err)
	}
}

func TestLocalPushHistoricalCASBeforeCommitBusyIsExplicit(t *testing.T) {
	reader, writer, stageKey, casKey, data := makeLocalPushStageCASFixture(t)
	if err := writer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatal(err)
	}
	hash, canonical := canonicalCASDigest(casKey)
	if !canonical {
		t.Fatal("expected canonical CAS content key")
	}
	release, err := writer.casLifecycleLease(context.Background(), hash, true)
	if err != nil {
		t.Fatal(err)
	}
	called := false
	matched, err := reader.InspectPinnedLocalPushHistoricalCASBeforeCommit(
		context.Background(), casKey, int64(len(data)),
		func(context.Context) error { called = true; return nil },
	)
	release()
	if matched || called || !errors.Is(err, ErrLocalPushCASPrecommitBusy) ||
		errors.Is(err, ErrLocalPushCASPrecommitOutcomeUncertain) {
		t.Fatalf("busy physical CAS passed precommit without proof: matched=%t called=%t err=%v",
			matched, called, err)
	}
	calls := 0
	matched, err = reader.InspectPinnedLocalPushHistoricalCASBeforeCommit(
		context.Background(), casKey, int64(len(data)),
		func(context.Context) error { calls++; return nil },
	)
	if err != nil || !matched || calls != 1 {
		t.Fatalf("released shard rejected valid precommit: matched=%t calls=%d err=%v",
			matched, calls, err)
	}
	if err := writer.Delete(context.Background(), casKey); err != nil {
		t.Fatalf("valid precommit leaked physical CAS shard: %v", err)
	}
}
