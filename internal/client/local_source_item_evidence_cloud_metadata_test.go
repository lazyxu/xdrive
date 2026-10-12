package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestLocalCloudMetadataClientKeepsNativeDigestsPrivateAndFailsClosed(t *testing.T) {
	before, after := strings.Repeat("1", 64), strings.Repeat("2", 64)
	claims := []LocalEvidenceCloudDigest{
		{EvidenceID: 5, SHA256: strings.Repeat("a", 64), Size: 6},
		{EvidenceID: 9, SHA256: strings.Repeat("b", 64), Size: 7},
	}
	var calls atomic.Int64
	var response atomic.Value
	response.Store(`{"source_id":42,"revision":7,"checked":2,"cloud_metadata_matched":true,"cloud_bytes_verified":false,"content_verified":false,"commit_supported":false,"authoritative":false,"missing_inference_safe":false}`)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost ||
			r.URL.Path != "/api/v1/sources/42/local-identity/evidence-cloud-metadata" ||
			r.URL.RawQuery != "" ||
			r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("If-Match") != "\"7\"" ||
			r.Header.Get("X-XDrive-Device-ID") != "device-A" ||
			r.Header.Get("X-XDrive-Device-Token") != "os-private-token" ||
			r.Header.Get("X-XDrive-Local-Root-ID") != "root-A" ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != "fingerprint-A" {
			t.Errorf("owning Agent evidence request missing device/Root/session proof")
		}
		var body struct {
			Previous string                     `json:"previous_snapshot_sha256"`
			Current  string                     `json:"current_snapshot_sha256"`
			Items    []LocalEvidenceCloudDigest `json:"items"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
			body.Previous != before || body.Current != after ||
			len(body.Items) != 2 || body.Items[0] != claims[0] ||
			body.Items[1] != claims[1] {
			t.Errorf("private digest claim changed during transport: %+v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(response.Load().(string)))
	}))
	defer server.Close()
	cli := New(server.URL, "owner")
	proof := LocalBoundSourceProof{
		DeviceID: "device-A", DeviceToken: "os-private-token",
		RootID: "root-A", RootFingerprint: "fingerprint-A",
	}
	run := func(items []LocalEvidenceCloudDigest) (LocalEvidenceCloudMetadata, error) {
		return cli.CheckLocalSourceItemCloudMetadata(
			context.Background(), 42, 7, proof, before, after, items)
	}
	for _, invalid := range [][]LocalEvidenceCloudDigest{
		nil, {}, {claims[1], claims[0]}, {claims[0], claims[0]},
		{{EvidenceID: 5, SHA256: strings.Repeat("0", 64), Size: 6}},
		{{EvidenceID: 5, SHA256: strings.Repeat("A", 64), Size: 6}},
		{{EvidenceID: 5, SHA256: strings.Repeat("a", 64), Size: -1}},
		make([]LocalEvidenceCloudDigest, 65),
	} {
		if _, err := run(invalid); err == nil {
			t.Fatalf("unsafe cloud metadata request accepted: %+v", invalid)
		}
	}
	if _, err := cli.CheckLocalSourceItemCloudMetadata(
		context.Background(), 42, 7, proof, before, before, claims); err == nil {
		t.Fatal("equal private generations accepted")
	}
	if _, err := cli.CheckLocalSourceItemCloudMetadata(
		context.Background(), 42, 7, LocalBoundSourceProof{}, before, after, claims); err == nil {
		t.Fatal("request without device/Root proof accepted")
	}
	if calls.Load() != 0 {
		t.Fatalf("invalid inputs reached Server: %d", calls.Load())
	}
	ok, err := run(claims)
	if err != nil || ok.SourceID != 42 || ok.Revision != 7 ||
		ok.Checked != 2 || !ok.CloudMetadataMatched ||
		ok.CloudBytesVerified || ok.ContentVerified || ok.CommitSupported ||
		ok.Authoritative || ok.MissingInferenceSafe || calls.Load() != 1 {
		t.Fatalf("valid but non-authoritative metadata result invalid: %+v err=%v", ok, err)
	}
	for _, invalid := range []string{
		`{"source_id":41,"revision":7,"checked":2,"cloud_metadata_matched":true}`,
		`{"source_id":42,"revision":8,"checked":2,"cloud_metadata_matched":true}`,
		`{"source_id":42,"revision":7,"checked":1,"cloud_metadata_matched":true}`,
		`{"source_id":42,"revision":7,"checked":2,"cloud_metadata_matched":false}`,
		`{"source_id":42,"revision":7,"checked":2,"cloud_metadata_matched":true,"cloud_bytes_verified":true}`,
		`{"source_id":42,"revision":7,"checked":2,"cloud_metadata_matched":true,"content_verified":true}`,
		`{"source_id":42,"revision":7,"checked":2,"cloud_metadata_matched":true,"commit_supported":true}`,
		`{"source_id":42,"revision":7,"checked":2,"cloud_metadata_matched":true,"authoritative":true}`,
		`{"source_id":42,"revision":7,"checked":2,"cloud_metadata_matched":true,"missing_inference_safe":true}`,
		`{"source_id":42,"revision":7,"checked":2,"cloud_metadata_matched":true,"storage_key":"secret"}`,
		`{"source_id":42,"revision":7,"checked":2,"cloud_metadata_matched":true}{}`,
		strings.Repeat("x", localEvidenceCloudMetadataReplyLimit+1),
	} {
		response.Store(invalid)
		if _, err := run(claims); err == nil {
			t.Fatalf("unsafe cloud metadata response accepted: %s", invalid[:min(90, len(invalid))])
		}
	}
}
