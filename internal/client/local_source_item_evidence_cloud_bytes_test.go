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

func TestOwningAgentPhysicalCASBatchIsStrictlyBoundedAndAtomic(t *testing.T) {
	before, after := strings.Repeat("1", 64), strings.Repeat("2", 64)
	proof := LocalBoundSourceProof{
		DeviceID: "device-A", DeviceToken: "private-device-secret",
		RootID: "root-A", RootFingerprint: "private-root-fingerprint",
	}
	items := []LocalEvidenceCloudDigest{
		{EvidenceID: 5, SHA256: strings.Repeat("a", 64), Size: 12},
		{EvidenceID: 8, SHA256: strings.Repeat("b", 64), Size: 23},
	}
	var count atomic.Int64
	var reply atomic.Value
	reply.Store(`{"source_id":42,"revision":7,"checked":2,"cloud_metadata_matched":true,"physical_cas_matched":true,"cloud_bytes_verified":false,"content_verified":false,"commit_supported":false,"authoritative":false,"missing_inference_safe":false}`)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count.Add(1)
		if r.Method != http.MethodPost ||
			r.URL.Path != "/api/v1/sources/42/local-identity/evidence-cloud-bytes" ||
			r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("If-Match") != "\"7\"" ||
			r.Header.Get("X-XDrive-Device-ID") != proof.DeviceID ||
			r.Header.Get("X-XDrive-Device-Token") != proof.DeviceToken ||
			r.Header.Get("X-XDrive-Local-Root-ID") != proof.RootID ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != proof.RootFingerprint {
			t.Error("batch lost owning native Agent proof")
		}
		var body struct {
			Previous string                     `json:"previous_snapshot_sha256"`
			Current  string                     `json:"current_snapshot_sha256"`
			Items    []LocalEvidenceCloudDigest `json:"items"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
			body.Previous != before || body.Current != after ||
			len(body.Items) != 2 || body.Items[0] != items[0] || body.Items[1] != items[1] {
			t.Errorf("physical CAS batch payload mismatch: %+v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(reply.Load().(string)))
	}))
	defer server.Close()
	cli := New(server.URL, "owner")
	run := func(batch []LocalEvidenceCloudDigest) (LocalEvidencePhysicalCAS, error) {
		return cli.CheckLocalSourceItemCloudBytesBatch(context.Background(), 42, 7, proof,
			before, after, batch)
	}
	bad := [][]LocalEvidenceCloudDigest{
		nil, {},
		{items[1], items[0]},
		{items[0], items[0]},
		{{EvidenceID: 5, SHA256: items[0].SHA256, Size: -1}},
		{{EvidenceID: 5, SHA256: items[0].SHA256, Size: 64<<20 + 1}},
		{{EvidenceID: 5, SHA256: items[0].SHA256, Size: 32 << 20},
			{EvidenceID: 8, SHA256: items[1].SHA256, Size: 32<<20 + 1}},
		{items[0], items[1], {EvidenceID: 10, SHA256: items[0].SHA256, Size: 0},
			{EvidenceID: 11, SHA256: items[0].SHA256, Size: 0},
			{EvidenceID: 12, SHA256: items[0].SHA256, Size: 0}},
	}
	for _, input := range bad {
		if _, err := run(input); err == nil {
			t.Fatalf("invalid physical batch reached server: %+v", input)
		}
	}
	if count.Load() != 0 {
		t.Fatalf("client sent %d invalid batch requests", count.Load())
	}
	verified, err := run(items)
	if err != nil || verified.Checked != 2 || !verified.PhysicalCASMatched ||
		!verified.CloudMetadataMatched || verified.CloudBytesVerified ||
		verified.ContentVerified || verified.Authoritative ||
		verified.CommitSupported || verified.MissingInferenceSafe {
		t.Fatalf("two-object observation invalid: %+v %v", verified, err)
	}
	for _, unsafe := range []string{
		`{"source_id":42,"revision":7,"checked":1,"cloud_metadata_matched":true,"physical_cas_matched":true}`,
		`{"source_id":42,"revision":7,"checked":2,"cloud_metadata_matched":true,"physical_cas_matched":true,"authoritative":true}`,
		`{"source_id":42,"revision":7,"checked":2,"cloud_metadata_matched":true,"physical_cas_matched":true,"commit_supported":true}`,
		`{"source_id":42,"revision":7,"checked":2,"cloud_metadata_matched":true,"physical_cas_matched":true,"cloud_bytes_verified":true}`,
		`{"source_id":42,"revision":7,"checked":2,"cloud_metadata_matched":true,"physical_cas_matched":true,"path":"/private"}`,
	} {
		reply.Store(unsafe)
		if _, err := run(items); err == nil {
			t.Fatalf("partial or privileged response accepted: %s", unsafe)
		}
	}
}
