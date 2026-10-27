package main

import (
	"archive/tar"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func writeTestFile(t *testing.T, path string, content []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, content, 0600); err != nil {
		t.Fatal(err)
	}
}
func testCAS(t *testing.T, root, content string) string {
	t.Helper()
	h := sha256.Sum256([]byte(content))
	digest := hex.EncodeToString(h[:])
	writeTestFile(t, filepath.Join(root, filepath.FromSlash(casRoot), digest[:2], digest), []byte(content))
	return digest
}
func snapshotPath(t *testing.T, repo, name string) string {
	t.Helper()
	s := filepath.Join(repo, "snapshots", name)
	if err := os.MkdirAll(s, 0700); err != nil {
		t.Fatal(err)
	}
	return s
}
func TestTwoGenerationReuseRestoreAfterSourceDeleted(t *testing.T) {
	base := t.TempDir()
	source := filepath.Join(base, "data")
	repo := filepath.Join(base, "repo")
	os.MkdirAll(source, 0700)
	h1 := testCAS(t, source, "hello immutable CAS")
	writeTestFile(t, filepath.Join(source, "42", "file-legacy"), []byte("legacy"))
	s1 := snapshotPath(t, repo, "generation1")
	if err := capture(source, repo, s1); err != nil {
		t.Fatal(err)
	}
	if _, err := verify(repo, s1, true); err != nil {
		t.Fatal(err)
	}
	st1, err := os.Stat(objectPath(repo, h1))
	if err != nil {
		t.Fatal(err)
	}
	h2 := testCAS(t, source, "new upload immutable CAS")
	s2 := snapshotPath(t, repo, "generation2")
	if err := capture(source, repo, s2); err != nil {
		t.Fatal(err)
	}
	st2, err := os.Stat(objectPath(repo, h1))
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(st1, st2) {
		t.Fatal("second generation rewrote existing immutable CAS")
	}
	// A generation must still restore after the live source is permanently gone.
	if err := os.RemoveAll(source); err != nil {
		t.Fatal(err)
	}
	recovery1 := filepath.Join(base, "recovery1")
	os.Mkdir(recovery1, 0700)
	if err := restore(repo, s1, recovery1); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(recovery1, filepath.FromSlash(casRoot), h2[:2], h2)); !os.IsNotExist(err) {
		t.Fatal("generation1 includes a later blob")
	}
	recovery2 := filepath.Join(base, "recovery2")
	os.Mkdir(recovery2, 0700)
	if err := restore(repo, s2, recovery2); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(recovery2, "42", "file-legacy"))
	if err != nil || string(got) != "legacy" {
		t.Fatalf("legacy restore: %q %v", got, err)
	}
	for _, h := range []string{h1, h2} {
		if _, err := os.Stat(filepath.Join(recovery2, filepath.FromSlash(casRoot), h[:2], h)); err != nil {
			t.Fatal(err)
		}
	}
}
func TestIncrementalPrunesOnlyRootMediaCache(t *testing.T) {
	base := t.TempDir()
	source := filepath.Join(base, "data")
	repo := filepath.Join(base, "repo")
	if err := os.MkdirAll(source, 0700); err != nil {
		t.Fatal(err)
	}
	hash := testCAS(t, source, "canonical immutable CAS")
	writeTestFile(t, filepath.Join(source, "1", "original.bin"), []byte("original"))
	writeTestFile(t, filepath.Join(source, ".xdrive-media-copy", "user-data.bin"), []byte("must-retain"))
	cache := filepath.Join(source, ".xdrive-media")
	writeTestFile(t, filepath.Join(cache, "thumbnails", "2026", "cache.jpg"), []byte("regenerable"))
	before, err := estimateIncrementalBytes(source, repo)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(cache, 0000); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Chmod(cache, 0700) })
	}
	after, err := estimateIncrementalBytes(source, repo)
	if err != nil || before != after {
		t.Fatalf("cache must not affect incremental preflight: before=%d after=%d err=%v", before, after, err)
	}
	snap := snapshotPath(t, repo, "cache-pruned")
	if err := capture(source, repo, snap); err != nil {
		t.Fatal(err)
	}
	if _, err := verify(repo, snap, true); err != nil {
		t.Fatal(err)
	}
	names := make(map[string]bool)
	if err := walkLegacyArchive(snap, func(header *tar.Header, _ *tar.Reader) error {
		names[strings.TrimSuffix(header.Name, "/")] = true
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for name := range names {
		if name == ".xdrive-media" || strings.HasPrefix(name, ".xdrive-media/") {
			t.Fatalf("derived cache unexpectedly archived: %s", name)
		}
	}
	if !names["1/original.bin"] || !names[".xdrive-media-copy/user-data.bin"] {
		t.Fatalf("canonical or similarly named user content missing: %+v", names)
	}
	restored := filepath.Join(base, "restored")
	if err := os.MkdirAll(restored, 0700); err != nil {
		t.Fatal(err)
	}
	if err := restore(repo, snap, restored); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(restored, ".xdrive-media")); !os.IsNotExist(err) {
		t.Fatalf("cache must be regenerated rather than restored: %v", err)
	}
	for name, want := range map[string]string{
		"1/original.bin":                                         "original",
		".xdrive-media-copy/user-data.bin":                       "must-retain",
		filepath.ToSlash(filepath.Join(casRoot, hash[:2], hash)): "canonical immutable CAS",
	} {
		contents, err := os.ReadFile(filepath.Join(restored, filepath.FromSlash(name)))
		if err != nil || string(contents) != want {
			t.Fatalf("restored %q: %q, %v", name, contents, err)
		}
	}
	if runtime.GOOS != "windows" && os.Geteuid() != 0 {
		nonCache := filepath.Join(source, "unreadable-user-data")
		writeTestFile(t, filepath.Join(nonCache, "blob"), []byte("critical"))
		if err := os.Chmod(nonCache, 0000); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Chmod(nonCache, 0700) })
		if _, err := estimateIncrementalBytes(source, repo); err == nil {
			t.Fatal("unreadable canonical storage was silently ignored by preflight")
		}
		if err := encodeTarLegacy(source, filepath.Join(base, "invalid-legacy.tar")); err == nil {
			t.Fatal("unreadable canonical storage was silently ignored by archive")
		}
	}
}

func TestCorruptOrMissingCASRejectedBeforeDestructiveRestore(t *testing.T) {
	for _, mode := range []string{"corrupt", "missing", "wrong-size"} {
		t.Run(mode, func(t *testing.T) {
			base := t.TempDir()
			data := filepath.Join(base, "data")
			repo := filepath.Join(base, "repo")
			os.Mkdir(data, 0700)
			hash := testCAS(t, data, "important")
			snap := snapshotPath(t, repo, "backup1")
			if err := capture(data, repo, snap); err != nil {
				t.Fatal(err)
			}
			dst := filepath.Join(base, "restore")
			os.Mkdir(dst, 0700)
			writeTestFile(t, filepath.Join(dst, "do-not-remove"), []byte("safe"))
			p := objectPath(repo, hash)
			switch mode {
			case "corrupt":
				os.WriteFile(p, []byte("XmporYant"), 0600)
			case "missing":
				os.Remove(p)
			case "wrong-size":
				os.WriteFile(p, []byte("bad"), 0600)
			}
			if err := restore(repo, snap, dst); err == nil {
				t.Fatal("corrupt repo restored successfully")
			}
			if got, err := os.ReadFile(filepath.Join(dst, "do-not-remove")); err != nil || string(got) != "safe" {
				t.Fatal("preflight destroyed destination on corrupt repo")
			}
		})
	}
}
func TestSnapshotIndexTamperingAndLegacySymlinksRejected(t *testing.T) {
	base := t.TempDir()
	data := filepath.Join(base, "data")
	repo := filepath.Join(base, "repo")
	os.Mkdir(data, 0700)
	_ = testCAS(t, data, "live")
	snap := snapshotPath(t, repo, "backup1")
	if err := capture(data, repo, snap); err != nil {
		t.Fatal(err)
	}
	for _, index := range []string{"../../oops\t3\n", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\t1\naaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\t1\n"} {
		os.WriteFile(filepath.Join(snap, "objects.index"), []byte(index), 0600)
		if _, err := verify(repo, snap, true); err == nil {
			t.Fatal("accepted tampered index")
		}
	}
	data2 := filepath.Join(base, "data2")
	os.Mkdir(data2, 0700)
	os.Symlink("/etc/passwd", filepath.Join(data2, "unsafe-link"))
	snap2 := snapshotPath(t, repo, "backup2")
	if err := capture(data2, repo, snap2); err == nil {
		t.Fatal("accepted symlink in legacy data")
	}
}
func TestTarEscapeIsRejected(t *testing.T) {
	base := t.TempDir()
	repo := filepath.Join(base, "repo")
	snap := snapshotPath(t, repo, "backup1")
	writeTestFile(t, filepath.Join(snap, "objects.index"), nil)
	var b bytes.Buffer
	tw := tar.NewWriter(&b)
	tw.WriteHeader(&tar.Header{Name: "../../escape", Mode: 0600, Size: 1, Typeflag: tar.TypeReg})
	tw.Write([]byte{'x'})
	tw.Close()
	writeTestFile(t, filepath.Join(snap, "legacy.tar"), b.Bytes())
	if _, err := verify(repo, snap, true); err == nil || !strings.Contains(err.Error(), "unsafe") {
		t.Fatalf("did not reject archive escape: %v", err)
	}
}
func TestSourceCASMismatchNeverPublished(t *testing.T) {
	base := t.TempDir()
	data := filepath.Join(base, "data")
	repo := filepath.Join(base, "repo")
	os.Mkdir(data, 0700)
	wrong := strings.Repeat("a", 64)
	writeTestFile(t, filepath.Join(data, filepath.FromSlash(casRoot), "aa", wrong), []byte("not matching hash"))
	snap := snapshotPath(t, repo, "backup1")
	if err := capture(data, repo, snap); err == nil {
		t.Fatal("accepted bogus CAS")
	}
	if _, err := os.Stat(objectPath(repo, wrong)); !os.IsNotExist(err) {
		t.Fatal("published corrupt CAS")
	}
}
func TestInvalidOrNestedPaths(t *testing.T) {
	// Only capture may target a hidden-in-progress generation name; published
	// verify and restore must use the immutable committed name.
	base2 := t.TempDir()
	data2 := filepath.Join(base2, "source")
	repo2 := filepath.Join(base2, "repo")
	os.Mkdir(data2, 0700)
	partial := snapshotPath(t, repo2, "xdrive-backup-20261025T000000Z.partial")
	if err := run([]string{"capture", "--source", data2, "--repo", repo2, "--snapshot", filepath.Base(partial)}); err != nil {
		t.Fatalf("incremental script staging snapshot was rejected: %v", err)
	}
	for _, s := range []string{"../x", "/root", "a/b", ".partial", "bad@name"} {
		if safeName(s) {
			t.Fatalf("accepted snapshot %q", s)
		}
	}
	base := t.TempDir()
	data := filepath.Join(base, "source")
	os.Mkdir(data, 0700)
	repo := filepath.Join(data, "repo")
	snap := snapshotPath(t, repo, "backup1")
	if err := capture(data, repo, snap); err == nil {
		t.Fatal("accepted nested repo")
	}
}

func TestEstimateIncrementalSpaceNewObjectsOnly(t *testing.T) {
	base := t.TempDir()
	data := filepath.Join(base, "data")
	repo := filepath.Join(base, "repo")
	if err := os.MkdirAll(data, 0700); err != nil {
		t.Fatal(err)
	}
	payload := strings.Repeat("immutable-byte", 600)
	_ = testCAS(t, data, payload)
	writeTestFile(t, filepath.Join(data, "old-legacy.txt"), []byte("old"))
	first, err := estimateIncrementalBytes(data, repo)
	if err != nil || first < int64(len(payload)) {
		t.Fatalf("first estimate undercounts new CAS: %d, %v", first, err)
	}
	if err := capture(data, repo, snapshotPath(t, repo, "generation1")); err != nil {
		t.Fatal(err)
	}
	second, err := estimateIncrementalBytes(data, repo)
	if err != nil || first-second != int64(len(payload)) {
		t.Fatalf("reused CAS should cost zero new bytes: first=%d second=%d err=%v", first, second, err)
	}
	_ = testCAS(t, data, "another new object")
	third, err := estimateIncrementalBytes(data, repo)
	if err != nil || third-second != int64(len("another new object")) {
		t.Fatalf("incremental preflight should count new bytes: second=%d third=%d err=%v", second, third, err)
	}
	if err := run([]string{"estimate", "--source", data, "--repo", repo}); err != nil {
		t.Fatalf("estimate CLI failed: %v", err)
	}
}

func TestEstimateRejectsMalformedExistingObjectAndNestedRepo(t *testing.T) {
	base := t.TempDir()
	data := filepath.Join(base, "data")
	repo := filepath.Join(base, "repo")
	if err := os.MkdirAll(data, 0700); err != nil {
		t.Fatal(err)
	}
	hash := testCAS(t, data, "stored")
	writeTestFile(t, objectPath(repo, hash), []byte("bad"))
	if _, err := estimateIncrementalBytes(data, repo); err == nil {
		t.Fatal("incorrectly sized reused object passed preflight")
	}
	if _, err := estimateIncrementalBytes(data, filepath.Join(data, "nested")); err == nil {
		t.Fatal("nested repository accepted")
	}
	if err := run([]string{"estimate", "--repo", repo, "--source", data, "--snapshot", "backup1"}); err == nil {
		t.Fatal("estimate accepted a snapshot flag")
	}
}

func TestRepositorySymlinkDirectoriesFailClosed(t *testing.T) {
	base := t.TempDir()
	data := filepath.Join(base, "live")
	repo := filepath.Join(base, "backup")
	external := filepath.Join(base, "outside")
	if err := os.MkdirAll(data, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(external, 0700); err != nil {
		t.Fatal(err)
	}
	hash := testCAS(t, data, "restore-me-not-somewhere-else")
	snap := snapshotPath(t, repo, "generation1")
	objectsRoot := filepath.Join(repo, "objects")
	if err := os.MkdirAll(objectsRoot, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(external, filepath.Join(objectsRoot, "sha256")); err != nil {
		t.Skipf("symlink fixture is unsupported on this host: %v", err)
	}
	if _, err := estimateIncrementalBytes(data, repo); err == nil {
		t.Fatal("read-only preflight followed a symlinked object directory")
	}
	if err := capture(data, repo, snap); err == nil {
		t.Fatal("capture followed a symlinked object directory")
	}
	files, err := os.ReadDir(external)
	if err != nil || len(files) != 0 {
		t.Fatalf("backup wrote outside its repository: files=%v err=%v", files, err)
	}
	if err := os.Remove(filepath.Join(objectsRoot, "sha256")); err != nil {
		t.Fatal(err)
	}
	if err := capture(data, repo, snap); err != nil {
		t.Fatal(err)
	}
	bucket := filepath.Join(objectsRoot, "sha256", hash[:2])
	if err := os.Rename(bucket, bucket+"-original"); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(external, bucket); err != nil {
		t.Fatal(err)
	}
	if _, err := verify(repo, snap, true); err == nil {
		t.Fatal("verification followed a symlinked hash bucket")
	}
	dst := filepath.Join(base, "restore")
	if err := os.MkdirAll(dst, 0700); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(dst, "untouched"), []byte("important"))
	if err := restore(repo, snap, dst); err == nil {
		t.Fatal("restore accepted a symlinked object bucket")
	}
	if bytes, err := os.ReadFile(filepath.Join(dst, "untouched")); err != nil || string(bytes) != "important" {
		t.Fatal("failed restore modified destination despite invalid repository directory")
	}
}

func TestLegacyArchiveConflictsFailBeforeDestructiveRestore(t *testing.T) {
	for _, names := range [][]string{
		{"duplicate.txt", "duplicate.txt"},
		{"parent", "parent/child"},
		{"parent/child", "parent"},
		{"./alias"},
		{"folder//double"},
	} {
		t.Run(strings.Join(names, ","), func(t *testing.T) {
			base := t.TempDir()
			repo := filepath.Join(base, "backup")
			snapshot := snapshotPath(t, repo, "snapshot1")
			writeTestFile(t, filepath.Join(snapshot, "objects.index"), nil)
			var payload bytes.Buffer
			writer := tar.NewWriter(&payload)
			for _, name := range names {
				if err := writer.WriteHeader(&tar.Header{
					Name: name, Mode: 0600, Typeflag: tar.TypeReg, Size: 1,
				}); err != nil {
					t.Fatal(err)
				}
				if _, err := writer.Write([]byte("x")); err != nil {
					t.Fatal(err)
				}
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			writeTestFile(t, filepath.Join(snapshot, "legacy.tar"), payload.Bytes())
			target := filepath.Join(base, "restore")
			if err := os.MkdirAll(target, 0700); err != nil {
				t.Fatal(err)
			}
			writeTestFile(t, filepath.Join(target, "keep"), []byte("unchanged"))
			if _, err := verify(repo, snapshot, true); err == nil {
				t.Fatal("legacy tar conflict passed verification")
			}
			if err := restore(repo, snapshot, target); err == nil {
				t.Fatal("legacy tar conflict reached destructive restore")
			}
			got, err := os.ReadFile(filepath.Join(target, "keep"))
			if err != nil || string(got) != "unchanged" {
				t.Fatalf("unsafe legacy archive modified target: %q %v", got, err)
			}
		})
	}
}

// verify --json reports only the actual objects and bytes checked in the
// immutable CAS repository. Raw paths and object hashes remain private.
func TestStructuredVerificationCountsAndFailClosedCategories(t *testing.T) {
    base := t.TempDir()
    source := filepath.Join(base, "source")
    repo := filepath.Join(base, "repo")
    if err := os.Mkdir(source, 0700); err != nil { t.Fatal(err) }
    payload := "immutable sample byte payload"
    hash := testCAS(t, source, payload)
    snapshot := snapshotPath(t, repo, "generation1")
    if err := capture(source, repo, snapshot); err != nil { t.Fatal(err) }
    good, err := verifyWithReport(repo, snapshot, true)
    if err != nil || good.State != "success" || good.Mode != "deep" ||
       good.ObjectsChecked != 1 || good.BytesHashed != int64(len(payload)) ||
       good.FailureCategory != "" {
        t.Fatalf("unexpected successful report: %+v err=%v", good, err)
    }
    var output bytes.Buffer
    if err := writeVerificationReport(&output, good); err != nil { t.Fatal(err) }
    var decoded verificationReport
    if err := json.Unmarshal(output.Bytes(), &decoded); err != nil { t.Fatal(err) }
    if decoded != good { t.Fatalf("JSON changed actual counters: %+v != %+v", decoded, good) }
    if strings.Contains(output.String(), base) || strings.Contains(output.String(), hash) {
        t.Fatal("structured report leaked a storage path or object hash")
    }

    object := objectPath(repo, hash)
    for _, tc := range []struct { name, content, want string; missing bool }{
        {name: "missing", missing: true, want: "missing_object"},
        {name: "same-size-corrupt", content: strings.Repeat("X", len(payload)), want: "object_sha256_mismatch"},
        {name: "different-size", content: "bad", want: "object_size_mismatch"},
    } {
        t.Run(tc.name, func(t *testing.T) {
            if tc.missing {
                if err := os.Remove(object); err != nil { t.Fatal(err) }
            } else if err := os.WriteFile(object, []byte(tc.content), 0600); err != nil { t.Fatal(err) }
            report, verifyErr := verifyWithReport(repo, snapshot, true)
            if verifyErr == nil || report.State != "failed" || report.FailureCategory != tc.want ||
               report.ObjectsChecked != 0 {
                t.Fatalf("fail-closed verification category wrong: %+v err=%v", report, verifyErr)
            }
            if tc.want == "object_sha256_mismatch" && report.BytesHashed != int64(len(payload)) {
                t.Fatalf("actual hashed bytes lost for corrupted object: %+v", report)
            }
            if err := os.WriteFile(object, []byte(payload), 0600); err != nil { t.Fatal(err) }
        })
    }
    if err := os.WriteFile(filepath.Join(snapshot, "objects.index"), []byte("../bad\t1\n"), 0600); err != nil {
        t.Fatal(err)
    }
    report, err := verifyWithReport(repo, snapshot, true)
    if err == nil || report.FailureCategory != "invalid_object_index" {
        t.Fatalf("invalid index was not classified: %+v err=%v", report, err)
    }
}

func TestStructuredVerificationRejectsUnsafeFlagsAndRecordsPartialWork(t *testing.T) {
    base := t.TempDir()
    source := filepath.Join(base, "data")
    repo := filepath.Join(base, "repo")
    if err := os.Mkdir(source, 0700); err != nil { t.Fatal(err) }
    first := "first stable"
    second := "second stable blob"
    _ = testCAS(t, source, first)
    _ = testCAS(t, source, second)
    snap := snapshotPath(t, repo, "generation1")
    if err := capture(source, repo, snap); err != nil { t.Fatal(err) }
    report, err := verifyWithReport(repo, snap, false)
    if err != nil || report.Mode != "fast" || report.BytesHashed != 0 || report.ObjectsChecked != 2 {
        t.Fatalf("fast counts unexpectedly hashed CAS: %+v err=%v", report, err)
    }
    if err := os.WriteFile(filepath.Join(snap, "legacy.tar"), []byte("invalid tar bytes"), 0600); err != nil { t.Fatal(err) }
    report, err = verifyWithReport(repo, snap, true)
    if err == nil || report.FailureCategory != "invalid_legacy_archive" || report.ObjectsChecked != 2 ||
       report.BytesHashed != int64(len(first)+len(second)) {
        t.Fatalf("legacy failure lost partial verified counters: %+v err=%v", report, err)
    }
    if err := run([]string{"estimate", "--repo", repo, "--source", source, "--json"}); err == nil {
        t.Fatal("unsupported --json on estimate did not fail")
    }
    if err := run([]string{"verify", "--repo", repo, "--snapshot", "../unsafe", "--json"}); err == nil {
        t.Fatal("unsafe snapshot was accepted")
    }
}
