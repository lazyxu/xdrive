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

func TestOwningAgentPhysicalCASClientRequiresExactPrivateProofAndRejectsAuthority(t *testing.T) {
	before, after := strings.Repeat("1", 64), strings.Repeat("2", 64)
	item := LocalEvidenceCloudDigest{EvidenceID: 17, SHA256: strings.Repeat("a", 64), Size: 3}
	proof := LocalBoundSourceProof{
		DeviceID: "device-A", DeviceToken: "os-private-token",
		RootID: "root-A", RootFingerprint: "fingerprint-A",
	}
	var calls atomic.Int64
	var response atomic.Value
	response.Store(`{"source_id":42,"revision":7,"checked":1,"cloud_metadata_matched":true,"physical_cas_matched":true,"cloud_bytes_verified":false,"content_verified":false,"commit_supported":false,"authoritative":false,"missing_inference_safe":false}`)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost ||
			r.URL.Path != "/api/v1/sources/42/local-identity/evidence-cloud-bytes" ||
			r.URL.RawQuery != "" || r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("If-Match") != "\"7\"" ||
			r.Header.Get("X-XDrive-Device-ID") != proof.DeviceID ||
			r.Header.Get("X-XDrive-Device-Token") != proof.DeviceToken ||
			r.Header.Get("X-XDrive-Local-Root-ID") != proof.RootID ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != proof.RootFingerprint {
			t.Error("physical CAS request omitted exact authenticated owning Agent proof")
		}
		var body struct {
			Previous string                     `json:"previous_snapshot_sha256"`
			Current  string                     `json:"current_snapshot_sha256"`
			Items    []LocalEvidenceCloudDigest `json:"items"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
			body.Previous != before || body.Current != after ||
			len(body.Items) != 1 || body.Items[0] != item {
			t.Errorf("physical CAS request changed native content claim: %+v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(response.Load().(string)))
	}))
	defer server.Close()
	cli := New(server.URL, "owner")
	run := func(p LocalBoundSourceProof, target LocalEvidenceCloudDigest) (LocalEvidencePhysicalCAS, error) {
		return cli.CheckLocalSourceItemCloudBytes(context.Background(), 42, 7, p, before, after, target)
	}
	for _, invalid := range []LocalEvidenceCloudDigest{
		{EvidenceID: 0, SHA256: item.SHA256, Size: item.Size},
		{EvidenceID: 17, SHA256: item.SHA256, Size: -1},
		{EvidenceID: 17, SHA256: item.SHA256, Size: 64<<20 + 1},
		{EvidenceID: 17, SHA256: strings.Repeat("A", 64), Size: 3},
		{EvidenceID: 17, SHA256: "not-a-sha", Size: 3},
	} {
		if _, err := run(proof, invalid); err == nil {
			t.Fatalf("invalid physical CAS claim accepted: %+v", invalid)
		}
	}
	if _, err := run(LocalBoundSourceProof{}, item); err == nil {
		t.Fatal("foreign or unauthenticated device accepted")
	}
	if _, err := cli.CheckLocalSourceItemCloudBytes(context.Background(), 42, 7,
		proof, before, before, item); err == nil {
		t.Fatal("unsealed equal inventory generations accepted")
	}
	if calls.Load() != 0 {
		t.Fatal("client sent a request despite locally rejected input")
	}
	got, err := run(proof, item)
	if err != nil || got.SourceID != 42 || got.Revision != 7 ||
		!got.PhysicalCASMatched || !got.CloudMetadataMatched ||
		got.CloudBytesVerified || got.ContentVerified || got.CommitSupported ||
		got.Authoritative || got.MissingInferenceSafe {
		t.Fatalf("legitimate ephemeral physical sample failed: %+v, %v", got, err)
	}
	for _, invalid := range []string{
		`{"source_id":42,"revision":7,"checked":1,"cloud_metadata_matched":true,"physical_cas_matched":false}`,
		`{"source_id":42,"revision":7,"checked":1,"cloud_metadata_matched":false,"physical_cas_matched":true}`,
		`{"source_id":42,"revision":8,"checked":1,"cloud_metadata_matched":true,"physical_cas_matched":true}`,
		`{"source_id":42,"revision":7,"checked":2,"cloud_metadata_matched":true,"physical_cas_matched":true}`,
		`{"source_id":42,"revision":7,"checked":1,"cloud_metadata_matched":true,"physical_cas_matched":true,"cloud_bytes_verified":true}`,
		`{"source_id":42,"revision":7,"checked":1,"cloud_metadata_matched":true,"physical_cas_matched":true,"content_verified":true}`,
		`{"source_id":42,"revision":7,"checked":1,"cloud_metadata_matched":true,"physical_cas_matched":true,"commit_supported":true}`,
		`{"source_id":42,"revision":7,"checked":1,"cloud_metadata_matched":true,"physical_cas_matched":true,"authoritative":true}`,
		`{"source_id":42,"revision":7,"checked":1,"cloud_metadata_matched":true,"physical_cas_matched":true,"missing_inference_safe":true}`,
		`{"source_id":42,"revision":7,"checked":1,"cloud_metadata_matched":true,"physical_cas_matched":true,"storage_key":"internal"}`,
		`{"source_id":42,"revision":7,"checked":1,"cloud_metadata_matched":true,"physical_cas_matched":true}{}`,
		strings.Repeat("x", localEvidenceCloudMetadataReplyLimit+1),
	} {
		response.Store(invalid)
		if _, err := run(proof, item); err == nil {
			t.Fatalf("unsafe physical CAS reply accepted: %.100s", invalid)
		}
	}
}
