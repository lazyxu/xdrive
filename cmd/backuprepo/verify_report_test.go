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
