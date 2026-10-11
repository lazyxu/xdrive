//go:build linux || windows

package localpush

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

func localReconcileFixture(t *testing.T) (RootGrant, string, string) {
	t.Helper()
	root, grant, config := deltaFixture(t)
	if err := os.WriteFile(filepath.Join(root, "old.txt"), []byte("original"), 0o600); err != nil {
		t.Fatal(err)
	}
	deltaScan(t, config, grant)
	if err := os.Rename(filepath.Join(root, "old.txt"), filepath.Join(root, "new.txt")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "added.txt"), []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	deltaScan(t, config, grant)
	return grant, config, root
}

func TestLocalReconcileEvidencePublishesOnlySealedAdvisorySummary(t *testing.T) {
	grant, config, root := localReconcileFixture(t)
	record, err := PublishLocalReconcileEvidence(context.Background(), config, grant, 7)
	if err != nil {
		t.Fatal(err)
	}
	if record.Version != localEvidenceVersion || record.SourceRevision != 7 ||
		record.Added != 2 || record.AbsentCandidates != 1 ||
		record.CurrentItems != 2 || record.PreviousItems != 1 ||
		record.MissingInferenceSafe || record.Authoritative ||
		!validEvidenceDigest(record.IntegritySHA256) {
		t.Fatalf("invalid advisory evidence: %+v", record)
	}
	dir, err := localEvidenceDirectory(config, grant)
	if err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(dir, localEvidenceFile)
	data, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{root, grant.Server, grant.Account, "source_item_id", "node_id", "device_token", "local_path"} {
		if strings.Contains(string(data), forbidden) {
			t.Fatalf("private advisory manifest leaked forbidden data %q", forbidden)
		}
	}
	if runtime.GOOS == "linux" {
		info, err := os.Stat(manifest)
		if err != nil || info.Mode().Perm() != 0o600 {
			t.Fatalf("private file permissions: %+v %v", info, err)
		}
		info, err = os.Stat(dir)
		if err != nil || info.Mode().Perm() != 0o700 {
			t.Fatalf("private directory permissions: %+v %v", info, err)
		}
	}
	loaded, err := LoadLocalReconcileEvidence(context.Background(), config, grant, 7)
	if err != nil || !reflect.DeepEqual(loaded, record) {
		t.Fatalf("published summary was not recoverable: got=%+v expected=%+v err=%v", loaded, record, err)
	}
	again, err := PublishLocalReconcileEvidence(context.Background(), config, grant, 7)
	if err != nil || !reflect.DeepEqual(again, record) {
		t.Fatalf("replayed same Source revision/generations changed manifest: %+v, %v", again, err)
	}
	replayedBytes, err := os.ReadFile(manifest)
	if err != nil || !reflect.DeepEqual(replayedBytes, data) {
		t.Fatalf("idempotent replay rewrote bytes: %v", err)
	}
	if _, err := LoadLocalReconcileEvidence(context.Background(), config, grant, 8); err == nil {
		t.Fatal("incorrect Source revision accepted")
	}
	wrongAccount := grant
	wrongAccount.Account = "another-owner"
	if _, err := LoadLocalReconcileEvidence(context.Background(), config, wrongAccount, 7); err == nil {
		t.Fatal("another account scope accessed advisory evidence")
	}
}

func TestLocalReconcileEvidenceRotationAndRevisionFencing(t *testing.T) {
	grant, config, root := localReconcileFixture(t)
	first, err := PublishLocalReconcileEvidence(context.Background(), config, grant, 7)
	if err != nil {
		t.Fatal(err)
	}
	// CURRENT/PREVIOUS changed: previous evidence is not a transferable
	// authorization for a subsequent scan or config revision.
	if err := os.WriteFile(filepath.Join(root, "later.txt"), []byte("later"), 0o600); err != nil {
		t.Fatal(err)
	}
	deltaScan(t, config, grant)
	if _, err := LoadLocalReconcileEvidence(context.Background(), config, grant, 7); err == nil {
		t.Fatal("stale generations accepted")
	}
	latest, err := PublishLocalReconcileEvidence(context.Background(), config, grant, 8)
	if err != nil || latest.CurrentSnapshot == first.CurrentSnapshot {
		t.Fatalf("new revision/generation not published: %+v %v", latest, err)
	}
	if _, err := PublishLocalReconcileEvidence(context.Background(), config, grant, 7); err == nil {
		t.Fatal("older Source revision overwrote latest advisory evidence")
	}
	loaded, err := LoadLocalReconcileEvidence(context.Background(), config, grant, 8)
	if err != nil || loaded.IntegritySHA256 != latest.IntegritySHA256 {
		t.Fatalf("latest advisory state lost: %+v %v", loaded, err)
	}
	// An interrupted scan cannot replace the manifest.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := PublishLocalReconcileEvidence(ctx, config, grant, 9); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled advisory publish was accepted: %v", err)
	}
	dir, err := localEvidenceDirectory(config, grant)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".advisory-incomplete-orphan.tmp"), []byte("partial"), 0o600); err != nil {
		t.Fatal(err)
	}
	afterRestart, err := LoadLocalReconcileEvidence(context.Background(), config, grant, 8)
	if err != nil || afterRestart.IntegritySHA256 != latest.IntegritySHA256 {
		t.Fatalf("incomplete tmp overwrote a completed manifest: %+v %v", afterRestart, err)
	}
	// An ambiguous/crashed publisher is intentionally fail-closed: reads
	// continue; no automated lock stealing or speculative recovery.
	if err := os.Mkdir(filepath.Join(dir, localEvidenceLock), 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := PublishLocalReconcileEvidence(context.Background(), config, grant, 9); err == nil {
		t.Fatal("simultaneous or crashed writer was accepted")
	}
	if _, err := LoadLocalReconcileEvidence(context.Background(), config, grant, 8); err != nil {
		t.Fatalf("publish lock blocked stable read: %v", err)
	}
}

func TestLocalReconcileEvidenceCorruptionAndRootSwapFailClosed(t *testing.T) {
	grant, config, root := localReconcileFixture(t)
	record, err := PublishLocalReconcileEvidence(context.Background(), config, grant, 7)
	if err != nil {
		t.Fatal(err)
	}
	dir, err := localEvidenceDirectory(config, grant)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, localEvidenceFile)
	before, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	corrupt := strings.Replace(string(before), "\"source_revision\":7", "\"source_revision\":8", 1)
	if corrupt == string(before) {
		t.Fatal("test cannot corrupt manifest Source revision")
	}
	if err := os.WriteFile(file, []byte(corrupt), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadLocalReconcileEvidence(context.Background(), config, grant, 8); err == nil {
		t.Fatal("tampered integrity checksum accepted")
	}
	if _, err := PublishLocalReconcileEvidence(context.Background(), config, grant, 9); err == nil {
		t.Fatal("corrupt prior manifest was overwritten")
	}
	if err := os.WriteFile(file, before, 0o600); err != nil {
		t.Fatal(err)
	}
	// Existing journal bytes changed after completion; the summary may
	// never be replayed as current evidence, irrespective of its checksum.
	jdir, err := inventoryJournalDir(config, grant)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := os.OpenFile(filepath.Join(jdir, record.CurrentSnapshot), os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := snapshot.WriteString("tampered"); err != nil {
		t.Fatal(err)
	}
	if err := snapshot.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadLocalReconcileEvidence(context.Background(), config, grant, 7); err == nil {
		t.Fatal("tampered source snapshot accepted")
	}
	if err := os.Rename(root, root+"-replaced"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadLocalReconcileEvidence(context.Background(), config, grant, 7); err == nil {
		t.Fatal("replaced Root was interpreted as empty or valid")
	}
}

func TestLocalReconcileEvidenceRequiresTwoVerifiedCompleteScans(t *testing.T) {
	root, grant, config := deltaFixture(t)
	if err := os.WriteFile(filepath.Join(root, "single.txt"), []byte("single"), 0o600); err != nil {
		t.Fatal(err)
	}
	deltaScan(t, config, grant)
	if _, err := PublishLocalReconcileEvidence(context.Background(), config, grant, 4); err == nil {
		t.Fatal("single scan was published as complete delta evidence")
	}
	dir, err := localEvidenceDirectory(config, grant)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, localEvidenceFile)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unverified evidence became visible: %v", err)
	}
	if _, err := PublishLocalReconcileEvidence(nil, config, grant, 4); err == nil {
		t.Fatal("nil context accepted")
	}
	if _, err := PublishLocalReconcileEvidence(context.Background(), config, grant, 0); err == nil {
		t.Fatal("zero revision accepted")
	}
}
