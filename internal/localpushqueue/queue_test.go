package localpushqueue

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

func testScope() Scope {
	return Scope{
		Server: "https://example.invalid", Account: "owner",
		DeviceID: "device-A", RootID: "root-A",
		RootFingerprint: strings.Repeat("a", 64),
		SourceID:        7, SourceRevision: 3, TargetNodeID: 19,
		SnapshotSHA256: strings.Repeat("b", 64),
	}
}

func testTask(path string) Task {
	return Task{Path: path, Size: 5, NativeIdentityKey: strings.Repeat("c", 64)}
}

func testCommit(op string) Commit {
	return Commit{
		OperationID: op, ResumeKey: "lp2_" + strings.Repeat("d", 64),
		NodeID: 17, NodeRevision: 1, ContentSHA: strings.Repeat("e", 64), Size: 5,
	}
}

const opA = "11111111-1111-4111-8111-111111111111"
const opB = "22222222-2222-4222-8222-222222222222"

func TestScannedQueuePersistsAndRechecksHistoricalOriginal(t *testing.T) {
	ctx := context.Background()
	base := t.TempDir()
	scope := testScope()
	generated := 0
	q, err := Build(ctx, base, scope, func(yield func(Task) error) error {
		generated++
		for _, item := range []Task{testTask("a.txt"), testTask("b.txt")} {
			if err := yield(item); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	uploads := 0
	rechecked := 0
	ops := map[string]string{"a.txt": opA, "b.txt": opB}
	upload := func(_ context.Context, item Task) (Commit, error) {
		uploads++
		return testCommit(ops[item.Path]), nil
	}
	recheck := func(_ context.Context, item Task, proof Commit) error {
		if proof.OperationID != ops[item.Path] {
			return errors.New("wrong original Operation")
		}
		rechecked++
		return nil
	}
	stats, err := q.Run(ctx, upload, recheck)
	if err != nil || stats.Tasks != 2 || stats.CommittedNow != 2 ||
		stats.HistoricalRechecked != 0 || uploads != 2 {
		t.Fatalf("fresh upload: %+v %v; uploads=%d", stats, err, uploads)
	}
	// A process restart only opens the immutable queue. It may not create a
	// new Operation, and rechecks the original SQL receipt for every marker.
	restarted, err := Open(base, scope)
	if err != nil {
		t.Fatal(err)
	}
	stats, err = restarted.Run(ctx, upload, recheck)
	if err != nil || stats.Tasks != 2 || stats.CommittedNow != 0 ||
		stats.HistoricalRechecked != 2 || uploads != 2 || rechecked != 2 {
		t.Fatalf("restart replay: %+v %v; uploads=%d rechecks=%d",
			stats, err, uploads, rechecked)
	}
	// Same snapshot must reuse its complete original task list, not replace it.
	same, err := Build(ctx, base, scope, func(func(Task) error) error {
		t.Fatal("existing durable queue was rebuilt")
		return nil
	})
	if err != nil || same.manifest.Count != 2 || generated != 1 {
		t.Fatalf("same-snapshot task list changed: %+v %v", same, err)
	}
	j, err := json.Marshal(*q)
	if err != nil || string(j) != "{}" {
		t.Fatalf("private queue escaped into IPC JSON: %q %v", j, err)
	}
}

func TestInterruptedQueueKeepsPreviousCommitsAndNeverSkipsUnknown(t *testing.T) {
	ctx := context.Background()
	base := t.TempDir()
	scope := testScope()
	q, err := Build(ctx, base, scope, func(yield func(Task) error) error {
		if err := yield(testTask("a.txt")); err != nil {
			return err
		}
		return yield(testTask("b.txt"))
	})
	if err != nil {
		t.Fatal(err)
	}
	attempts := make(map[string]int)
	fault := func(_ context.Context, item Task) (Commit, error) {
		attempts[item.Path]++
		if item.Path == "b.txt" && attempts[item.Path] == 1 {
			// Could already have reached SQL/CAS: absence of a local marker
			// is never a physical cancel or a new-Operation permission.
			return Commit{}, errors.New("lost SQL receipt")
		}
		if item.Path == "a.txt" {
			return testCommit(opA), nil
		}
		return testCommit(opB), nil
	}
	recheck := func(_ context.Context, t Task, proof Commit) error {
		if t.Path != "a.txt" || proof.OperationID != opA {
			return errors.New("untrusted historical receipt")
		}
		return nil
	}
	first, err := q.Run(ctx, fault, recheck)
	if !errors.Is(err, ErrQuarantined) || first.CommittedNow != 1 ||
		attempts["a.txt"] != 1 || attempts["b.txt"] != 1 {
		t.Fatalf("uncertain file was incorrectly completed: %+v %v", first, err)
	}
	restarted, err := Open(base, scope)
	if err != nil {
		t.Fatal(err)
	}
	next, err := restarted.Run(ctx, fault, recheck)
	if err != nil || next.CommittedNow != 1 || next.HistoricalRechecked != 1 ||
		attempts["a.txt"] != 1 || attempts["b.txt"] != 2 {
		t.Fatalf("replay created a duplicate prior file: %+v %v; %v", next, err, attempts)
	}
}

func TestFailedScanNeverPublishesExecutableQueue(t *testing.T) {
	base := t.TempDir()
	scope := testScope()
	_, err := Build(context.Background(), base, scope, func(yield func(Task) error) error {
		if err := yield(testTask("one.txt")); err != nil {
			return err
		}
		return errors.New("inventory changed before final verification")
	})
	if !errors.Is(err, ErrQuarantined) {
		t.Fatalf("partially verified inventory was runnable: %v", err)
	}
	if _, err := Open(base, scope); !errors.Is(err, ErrQuarantined) {
		t.Fatalf("incomplete scan was accepted: %v", err)
	}
	// No HTTP could have been sent during Build; a failed unpublished
	// scan can be rebuilt without deleting any original upload Operation.
	_, err = Build(context.Background(), base, scope, func(yield func(Task) error) error {
		return yield(testTask("one.txt"))
	})
	if err != nil {
		t.Fatalf("fresh complete scan was not admitted: %v", err)
	}
}

func TestForgedScopeTruncatedQueueAndBadTasksFailClosed(t *testing.T) {
	base := t.TempDir()
	scope := testScope()
	for _, tc := range []Task{
		testTask("../escape"), testTask("/absolute"), testTask("a\\b"),
		{Path: "x", Size: -1, NativeIdentityKey: strings.Repeat("a", 64)},
	} {
		other := scope
		other.SnapshotSHA256 = strings.Repeat("f", 64)
		_, err := Build(context.Background(), t.TempDir(), other,
			func(yield func(Task) error) error { return yield(tc) })
		if !errors.Is(err, ErrQuarantined) {
			t.Fatalf("untrusted task admitted %+v: %v", tc, err)
		}
	}
	q, err := Build(context.Background(), base, scope, func(yield func(Task) error) error {
		return yield(testTask("allowed.bin"))
	})
	if err != nil {
		t.Fatal(err)
	}
	forged := scope
	forged.DeviceID = "different-device"
	if _, err := Open(base, forged); !errors.Is(err, ErrQuarantined) {
		t.Fatalf("changed owning Device reused task journal: %v", err)
	}
	file := filepath.Join(q.dir, "tasks.ndjson")
	f, err := os.OpenFile(file, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.Write([]byte("malicious additional task\n"))
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(base, scope); !errors.Is(err, ErrQuarantined) {
		t.Fatalf("corrupted private task queue admitted: %v", err)
	}
}

func TestUntrustedCommitNeverBecomesHistoricalSuccess(t *testing.T) {
	base := t.TempDir()
	scope := testScope()
	q, err := Build(context.Background(), base, scope,
		func(yield func(Task) error) error { return yield(testTask("file.bin")) })
	if err != nil {
		t.Fatal(err)
	}
	_, err = q.Run(context.Background(),
		func(context.Context, Task) (Commit, error) {
			forged := testCommit(opA)
			forged.Size++
			return forged, nil
		}, func(context.Context, Task, Commit) error { return nil })
	if !errors.Is(err, ErrQuarantined) {
		t.Fatalf("wrong physical bytes accepted: %v", err)
	}
	// A recorded original SQL receipt is historical only. Refusing to
	// reauthorize it must stop replay, even if the local JSON is intact.
	good, err := q.Run(context.Background(),
		func(context.Context, Task) (Commit, error) { return testCommit(opA), nil },
		func(context.Context, Task, Commit) error { return nil })
	if err != nil || good.CommittedNow != 1 {
		t.Fatalf("genuine original proof unavailable: %+v %v", good, err)
	}
	_, err = q.Run(context.Background(),
		func(context.Context, Task) (Commit, error) {
			t.Fatal("unknown original was reuploaded")
			return Commit{}, nil
		}, func(context.Context, Task, Commit) error {
			return errors.New("revoked device or inaccessible original")
		})
	if !errors.Is(err, ErrQuarantined) {
		t.Fatalf("historical marker fabricated current success: %v", err)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Lstat(q.dir)
		if err != nil || info.Mode().Perm()&0077 != 0 {
			t.Fatalf("private queue dir readable by another user: %v %v", info, err)
		}
	}
}

func TestNextIncrementalBaselineRequiresAllPriorOriginalCommits(t *testing.T) {
	ctx := context.Background()
	base := t.TempDir()
	scope := testScope()
	old, exists, err := OpenIfPresent(base, scope)
	if err != nil || exists || old != nil {
		t.Fatalf("absent queue treated as a corrupt or completed baseline: %t %v", exists, err)
	}
	q, err := Build(ctx, base, scope, func(yield func(Task) error) error {
		if err := yield(testTask("a.txt")); err != nil {
			return err
		}
		return yield(testTask("b.txt"))
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = q.Run(ctx, func(_ context.Context, item Task) (Commit, error) {
		if item.Path == "b.txt" {
			return Commit{}, errors.New("pre-existing uncertain file")
		}
		return testCommit(opA), nil
	}, func(context.Context, Task, Commit) error { return nil })
	if !errors.Is(err, ErrQuarantined) {
		t.Fatalf("missing B did not halt original run: %v", err)
	}
	if _, err := q.RecheckAll(ctx, func(context.Context, Task, Commit) error { return nil }); !errors.Is(err, ErrQuarantined) {
		t.Fatalf("unfinished B promoted previous snapshot as a delta baseline: %v", err)
	}
	_, err = q.Run(ctx, func(_ context.Context, item Task) (Commit, error) {
		if item.Path != "b.txt" {
			t.Fatal("already committed A was uploaded again")
		}
		return testCommit(opB), nil
	}, func(context.Context, Task, Commit) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	history, err := q.RecheckAll(ctx, func(_ context.Context, task Task, proof Commit) error {
		if task.Path == "a.txt" && proof.OperationID != opA {
			return errors.New("wrong original A")
		}
		if task.Path == "b.txt" && proof.OperationID != opB {
			return errors.New("wrong original B")
		}
		return nil
	})
	if err != nil || len(history) != 2 {
		t.Fatalf("complete original receipts not usable as incremental baseline: %v %v", history, err)
	}
	if _, err := q.RecheckAll(ctx, func(context.Context, Task, Commit) error {
		return errors.New("Owner or Device revoked")
	}); !errors.Is(err, ErrQuarantined) {
		t.Fatalf("revoked previous snapshot was trusted: %v", err)
	}
}
