package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// --json reports only the actual objects and bytes checked in the immutable
// CAS repository. Raw paths and object hashes remain on private stderr.
func TestStructuredVerificationCountsAndFailClosedCategories(t *testing.T) {
	base := t.TempDir()
	source := filepath.Join(base, "source")
	repo := filepath.Join(base, "repo")
	if err := os.Mkdir(source, 0700); err != nil {
		t.Fatal(err)
	}
	payload := "immutable sample byte payload"
	hash := testCAS(t, source, payload)
	snapshot := snapshotPath(t, repo, "generation1")
	if err := capture(source, repo, snapshot); err != nil {
		t.Fatal(err)
	}
	good, err := verifyWithReport(repo, snapshot, true)
	if err != nil || good.State != "success" || good.Mode != "deep" ||
		good.ObjectsChecked != 1 || good.BytesHashed != int64(len(payload)) ||
		good.FailureCategory != "" {
		t.Fatalf("unexpected successful report: %+v err=%v", good, err)
	}
	var output bytes.Buffer
	if err := writeVerificationReport(&output, good); err != nil {
		t.Fatal(err)
	}
	var decoded verificationReport
	if err := json.Unmarshal(output.Bytes(), &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded != good {
		t.Fatalf("JSON changed actual counters: %+v != %+v", decoded, good)
	}
	if strings.Contains(output.String(), base) || strings.Contains(output.String(), hash) {
		t.Fatal("structured report leaked a storage path or object hash")
	}
	object := objectPath(repo, hash)
	cases := []struct {
		name, content, want string
		missing             bool
	}{
		{name: "missing", missing: true, want: "missing_object"},
		{name: "same-size-corrupt", content: strings.Repeat("X", len(payload)), want: "object_sha256_mismatch"},
		{name: "different-size", content: "bad", want: "object_size_mismatch"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.missing {
				if err := os.Remove(object); err != nil {
					t.Fatal(err)
				}
			} else if err := os.WriteFile(object, []byte(tc.content), 0600); err != nil {
				t.Fatal(err)
			}
			report, verifyErr := verifyWithReport(repo, snapshot, true)
			if verifyErr == nil || report.State != "failed" || report.FailureCategory != tc.want ||
				report.ObjectsChecked != 0 {
				t.Fatalf("fail-closed verification category wrong: %+v err=%v", report, verifyErr)
			}
			if tc.want == "object_sha256_mismatch" && report.BytesHashed != int64(len(payload)) {
				t.Fatalf("actual hashed bytes lost for corrupted object: %+v", report)
			}
			if err := os.WriteFile(object, []byte(payload), 0600); err != nil {
				t.Fatal(err)
			}
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
	if err := os.Mkdir(source, 0700); err != nil {
		t.Fatal(err)
	}
	first := "first stable"
	second := "second stable blob"
	_ = testCAS(t, source, first)
	_ = testCAS(t, source, second)
	snap := snapshotPath(t, repo, "generation1")
	if err := capture(source, repo, snap); err != nil {
		t.Fatal(err)
	}
	report, err := verifyWithReport(repo, snap, false)
	if err != nil || report.Mode != "fast" || report.BytesHashed != 0 || report.ObjectsChecked != 2 {
		t.Fatalf("fast counts unexpectedly hashed CAS: %+v err=%v", report, err)
	}
	if err := os.WriteFile(filepath.Join(snap, "legacy.tar"), []byte("invalid tar bytes"), 0600); err != nil {
		t.Fatal(err)
	}
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

func TestStructuredVerificationCLIJSONUsesNonzeroExitOnCorruption(t *testing.T) {
	base := t.TempDir()
	source := filepath.Join(base, "data")
	repo := filepath.Join(base, "repo")
	if err := os.Mkdir(source, 0700); err != nil {
		t.Fatal(err)
	}
	payload := "preserved and verified"
	hash := testCAS(t, source, payload)
	if err := capture(source, repo, snapshotPath(t, repo, "generation1")); err != nil {
		t.Fatal(err)
	}
	args := []string{"verify", "--repo", repo, "--snapshot", "generation1", "--json"}
	var output bytes.Buffer
	if err := runWithReportWriter(args, &output); err != nil {
		t.Fatal(err)
	}
	var passed verificationReport
	if err := json.Unmarshal(output.Bytes(), &passed); err != nil {
		t.Fatal(err)
	}
	if passed.State != "success" || passed.ObjectsChecked != 1 || passed.BytesHashed != int64(len(payload)) {
		t.Fatalf("CLI did not return actual successful hash counts: %+v", passed)
	}
	if err := os.WriteFile(objectPath(repo, hash), []byte(strings.Repeat("B", len(payload))), 0600); err != nil {
		t.Fatal(err)
	}
	output.Reset()
	if err := runWithReportWriter(args, &output); err == nil {
		t.Fatal("CLI silently accepted same-size CAS corruption")
	}
	var failed verificationReport
	if err := json.Unmarshal(output.Bytes(), &failed); err != nil {
		t.Fatal(err)
	}
	if failed.State != "failed" || failed.FailureCategory != "object_sha256_mismatch" ||
		failed.ObjectsChecked != 0 || failed.BytesHashed != int64(len(payload)) {
		t.Fatalf("CLI output falsely claimed full verification: %+v", failed)
	}
	if strings.Contains(output.String(), base) || strings.Contains(output.String(), hash) {
		t.Fatal("CLI JSON exposed private storage details")
	}
}
// The public v2 writer publishes these six exact files. A CAS-only verifier
// must not report success for a malformed or checksum-tampered published
// snapshot, nor may standalone restore erase an existing destination.
func TestPublishedV2MetadataGuardsVerifyAndRestore(t *testing.T) {
	cases := []struct {
		name   string
		tamper func(*testing.T, string)
	}{
		{name: "valid"},
		{name: "missing-manifest", tamper: func(t *testing.T, snapshot string) {
			t.Helper()
			if err := os.Remove(filepath.Join(snapshot, "manifest.json")); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "altered-verify-receipt", tamper: func(t *testing.T, snapshot string) {
			t.Helper()
			writeTestFile(t, filepath.Join(snapshot, "verify.json"), []byte(`{"tampered":true}`))
		}},
		{name: "inconsistent-with-fresh-checksums", tamper: func(t *testing.T, snapshot string) {
			t.Helper()
			writeTestFile(t, filepath.Join(snapshot, "manifest.json"),
				[]byte(`{"format_version":2,"file_data_included":true,"consistency_verified":false}`))
			retentionFixtureChecksum(t, snapshot)
		}},
		{name: "duplicate-manifest-with-fresh-checksums", tamper: func(t *testing.T, snapshot string) {
			t.Helper()
			writeTestFile(t, filepath.Join(snapshot, "manifest.json"),
				[]byte(`{"format_version":2,"file_data_included":true,"consistency_verified":false,"consistency_verified":true}`))
			retentionFixtureChecksum(t, snapshot)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			source, repo := filepath.Join(root, "source"), filepath.Join(root, "repo")
			if err := os.MkdirAll(source, 0700); err != nil {
				t.Fatal(err)
			}
			hash := testCAS(t, source, "actual CAS data that must remain intact")
			snapshot := retentionFixtureSnapshot(t, repo, source, "xdrive-backup-20261030T010000Z")
			if tc.tamper != nil {
				tc.tamper(t, snapshot)
			}
			report, err := verifyWithReport(repo, snapshot, true)
			if tc.tamper == nil {
				if err != nil || report.State != "success" || report.ObjectsChecked != 1 {
					t.Fatalf("valid published snapshot rejected: %+v %v", report, err)
				}
				return
			}
			if err == nil || report.State != "failed" || report.FailureCategory != "unsafe_snapshot" ||
				report.ObjectsChecked != 0 || report.BytesHashed != 0 {
				t.Fatalf("unsafe published snapshot verified: %+v err=%v", report, err)
			}
			var output bytes.Buffer
			args := []string{"verify", "--repo", repo, "--snapshot", filepath.Base(snapshot), "--json"}
			if err := runWithReportWriter(args, &output); err == nil {
				t.Fatal("CLI verification accepted untrusted published metadata")
			}
			var decoded verificationReport
			if err := json.Unmarshal(output.Bytes(), &decoded); err != nil ||
				decoded.State != "failed" || decoded.FailureCategory != "unsafe_snapshot" {
				t.Fatalf("CLI did not return bounded fail-closed receipt: %+v, %v", decoded, err)
			}
			if strings.Contains(output.String(), root) || strings.Contains(output.String(), hash) {
				t.Fatal("structured report leaked a private path or object hash")
			}
			target := filepath.Join(root, "recovery")
			if err := os.Mkdir(target, 0700); err != nil {
				t.Fatal(err)
			}
			sentinel := filepath.Join(target, "must-not-remove")
			writeTestFile(t, sentinel, []byte("original destination data"))
			if err := restore(repo, snapshot, target); err == nil {
				t.Fatal("standalone restore accepted an unsafe published snapshot")
			}
			unchanged, err := os.ReadFile(sentinel)
			if err != nil || string(unchanged) != "original destination data" {
				t.Fatalf("failed restore modified existing destination: %q %v", unchanged, err)
			}
		})
	}
}
