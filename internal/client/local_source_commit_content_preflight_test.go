package client

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestOwningAgentQuarantinedContentPreflightTransportFailClosed(t *testing.T) {
	previous, current := strings.Repeat("1", 64), strings.Repeat("2", 64)
	proof := LocalBoundSourceProof{
		DeviceID: "device-A", DeviceToken: "private-device-token",
		RootID: "own-root", RootFingerprint: "private-root-fingerprint",
	}
	items := []LocalEvidenceCloudDigest{
		{EvidenceID: 11, SHA256: strings.Repeat("a", 64), Size: 3},
		{EvidenceID: 14, SHA256: strings.Repeat("b", 64), Size: 4},
	}
	type simulatedReply struct {
		status int
		etag   string
		cache  string
		body   string
	}
	success := `{"source_id":42,"revision":7,"checked":2,"quarantine_matched":true,"physical_cas_matched":true,"cloud_bytes_verified":false,"content_verified":false,"commit_supported":false,"authoritative":false,"missing_inference_safe":false}`
	var state atomic.Value
	state.Store(simulatedReply{status: http.StatusOK, etag: `"7"`, cache: "private, no-store", body: success})
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost ||
			r.URL.Path != "/api/v1/sources/42/local-identity/commit-intents/content-preflight" ||
			r.URL.RawQuery != "" || r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("If-Match") != `"7"` ||
			r.Header.Get("X-XDrive-Device-ID") != proof.DeviceID ||
			r.Header.Get("X-XDrive-Device-Token") != proof.DeviceToken ||
			r.Header.Get("X-XDrive-Local-Root-ID") != proof.RootID ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != proof.RootFingerprint {
			t.Error("native quarantine content request lost exact owning-device/Root proof")
		}
		var body struct {
			Previous string                     `json:"previous_snapshot_sha256"`
			Current  string                     `json:"current_snapshot_sha256"`
			Items    []LocalEvidenceCloudDigest `json:"items"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
			body.Previous != previous || body.Current != current ||
			len(body.Items) != 2 || body.Items[0] != items[0] ||
			body.Items[1] != items[1] {
			t.Errorf("private quarantine physical request not exact: %+v", body)
		}
		got := state.Load().(simulatedReply)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("ETag", got.etag)
		w.Header().Set("Cache-Control", got.cache)
		w.WriteHeader(got.status)
		_, _ = w.Write([]byte(got.body))
	}))
	defer server.Close()
	cli := New(server.URL, "owner")
	run := func(ctx context.Context, p LocalBoundSourceProof, selected []LocalEvidenceCloudDigest) (LocalQuarantinedContentPreflight, error) {
		return cli.PreflightLocalQuarantinedPhysicalContentBatch(ctx, 42, 7, p, previous, current, selected)
	}
	for name, bad := range map[string][]LocalEvidenceCloudDigest{
		"empty":       nil,
		"reordered":   {items[1], items[0]},
		"duplicate":   {items[0], items[0]},
		"missing ID":  {{EvidenceID: 0, SHA256: items[0].SHA256, Size: 3}},
		"bad digest":  {{EvidenceID: 11, SHA256: "bad", Size: 3}},
		"uppercase":   {{EvidenceID: 11, SHA256: strings.Repeat("A", 64), Size: 3}},
		"negative":    {{EvidenceID: 11, SHA256: items[0].SHA256, Size: -1}},
		"large":       {{EvidenceID: 11, SHA256: items[0].SHA256, Size: 64<<20 + 1}},
		"over 4":      {items[0], items[1], {EvidenceID: 20, SHA256: items[0].SHA256}, {EvidenceID: 21, SHA256: items[0].SHA256}, {EvidenceID: 22, SHA256: items[0].SHA256}},
		"over budget": {{EvidenceID: 11, SHA256: items[0].SHA256, Size: 32 << 20}, {EvidenceID: 14, SHA256: items[1].SHA256, Size: 32<<20 + 1}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := run(context.Background(), proof, bad); err == nil {
				t.Fatalf("unsafe content batch submitted: %+v", bad)
			}
		})
	}
	if _, err := run(context.Background(), LocalBoundSourceProof{}, items); err == nil {
		t.Fatal("missing owning-device secret accepted")
	}
	if _, err := cli.PreflightLocalQuarantinedPhysicalContentBatch(
		context.Background(), 42, 7, proof, previous, previous, items); err == nil {
		t.Fatal("duplicate generation digests accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := run(ctx, proof, items); err == nil {
		t.Fatal("canceled content preflight submitted")
	}
	if calls.Load() != 0 {
		t.Fatalf("invalid inputs caused %d Server calls", calls.Load())
	}
	got, err := run(context.Background(), proof, items)
	if err != nil || got.SourceID != 42 || got.Revision != 7 ||
		got.Checked != len(items) || !got.QuarantineMatched || !got.PhysicalCASMatched ||
		got.CloudBytesVerified || got.ContentVerified || got.CommitSupported ||
		got.Authoritative || got.MissingInferenceSafe {
		t.Fatalf("valid non-authoritative quarantine preflight rejected: %+v, %v", got, err)
	}

	for name, bad := range map[string]simulatedReply{
		"created status":  {status: http.StatusCreated, etag: `"7"`, cache: "private, no-store", body: success},
		"unauthorized":    {status: http.StatusForbidden, etag: `"7"`, cache: "private, no-store", body: `{"error":"forbidden"}`},
		"missing etag":    {status: http.StatusOK, etag: "", cache: "private, no-store", body: success},
		"stale etag":      {status: http.StatusOK, etag: `"8"`, cache: "private, no-store", body: success},
		"cacheable":       {status: http.StatusOK, etag: `"7"`, cache: "public, max-age=120", body: success},
		"public no-store": {status: http.StatusOK, etag: `"7"`, cache: "public, no-store", body: success},
		"missing field":   {status: http.StatusOK, etag: `"7"`, cache: "private, no-store", body: strings.Replace(success, `,"missing_inference_safe":false`, "", 1)},
		"privileged":      {status: http.StatusOK, etag: `"7"`, cache: "private, no-store", body: strings.Replace(success, `"authoritative":false`, `"authoritative":true`, 1)},
		"commit flag":     {status: http.StatusOK, etag: `"7"`, cache: "private, no-store", body: strings.Replace(success, `"commit_supported":false`, `"commit_supported":true`, 1)},
		"bytes flag":      {status: http.StatusOK, etag: `"7"`, cache: "private, no-store", body: strings.Replace(success, `"cloud_bytes_verified":false`, `"cloud_bytes_verified":true`, 1)},
		"no match":        {status: http.StatusOK, etag: `"7"`, cache: "private, no-store", body: strings.Replace(success, `"quarantine_matched":true`, `"quarantine_matched":false`, 1)},
		"wrong count":     {status: http.StatusOK, etag: `"7"`, cache: "private, no-store", body: strings.Replace(success, `"checked":2`, `"checked":1`, 1)},
		"wrong source":    {status: http.StatusOK, etag: `"7"`, cache: "private, no-store", body: strings.Replace(success, `"source_id":42`, `"source_id":24`, 1)},
		"extra field":     {status: http.StatusOK, etag: `"7"`, cache: "private, no-store", body: strings.TrimSuffix(success, "}") + `,"root_id":"leaked"}`},
		"trailing JSON":   {status: http.StatusOK, etag: `"7"`, cache: "private, no-store", body: success + "{}"},
		"oversized":       {status: http.StatusOK, etag: `"7"`, cache: "private, no-store", body: strings.Repeat("X", localEvidenceCloudMetadataReplyLimit+1)},
	} {
		t.Run(name, func(t *testing.T) {
			state.Store(bad)
			if _, err := run(context.Background(), proof, items); err == nil {
				t.Errorf("untrusted quarantine preflight response accepted: %s", name)
			}
		})
	}
	state.Store(simulatedReply{status: http.StatusOK, etag: `"7"`, cache: "private, no-store", body: success})
	if count := calls.Load(); count < 2 {
		t.Fatalf("test made no successful transport request: %d", count)
	}
}

func TestPrivateQuarantineContentClientProofCannotBeOmitted(t *testing.T) {
	proof := LocalBoundSourceProof{
		DeviceID: "owner", DeviceToken: "token", RootID: "root", RootFingerprint: "fingerprint",
	}
	cli := New("http://127.0.0.1:1", "owner")
	item := LocalEvidenceCloudDigest{EvidenceID: 1, SHA256: strings.Repeat("a", 64), Size: 1}
	before, after := strings.Repeat("1", 64), strings.Repeat("2", 64)
	for _, invalid := range []struct {
		id       uint64
		revision uint64
		proof    LocalBoundSourceProof
	}{
		{id: 0, revision: 7, proof: proof},
		{id: 42, revision: 0, proof: proof},
		{id: 42, revision: 7, proof: LocalBoundSourceProof{DeviceID: proof.DeviceID}},
	} {
		if _, err := cli.PreflightLocalQuarantinedPhysicalContentBatch(
			context.Background(), invalid.id, invalid.revision, invalid.proof,
			before, after, []LocalEvidenceCloudDigest{item}); err == nil {
			t.Fatal(fmt.Sprintf("incomplete Agent proof not rejected: %+v", invalid))
		}
	}
}
