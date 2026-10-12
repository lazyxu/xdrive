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

func TestLocalEvidencePreflightUsesPrivateProofAndNeverGrantsCommit(t *testing.T) {
	before, after := strings.Repeat("1", 64), strings.Repeat("2", 64)
	var calls atomic.Int64
	var reply atomic.Value
	reply.Store(`{"source_id":42,"revision":7,"checked":2,"server_consistent":true,"content_verified":false,"commit_supported":false,"authoritative":false,"missing_inference_safe":false}`)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost ||
			r.URL.Path != "/api/v1/sources/42/local-identity/evidence-preflight" ||
			r.URL.RawQuery != "" ||
			r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("X-XDrive-Device-ID") != "own-A" ||
			r.Header.Get("X-XDrive-Device-Token") != "private-token" ||
			r.Header.Get("X-XDrive-Local-Root-ID") != "root-A" ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != "fingerprint-A" ||
			r.Header.Get("If-Match") != "\"7\"" {
			t.Errorf("unsafe or foreign evidence preflight request: %s %s", r.Method, r.URL)
		}
		var body struct {
			Before string   `json:"previous_snapshot_sha256"`
			After  string   `json:"current_snapshot_sha256"`
			IDs    []uint64 `json:"evidence_ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
			body.Before != before || body.After != after ||
			len(body.IDs) != 2 || body.IDs[0] != 5 || body.IDs[1] != 9 {
			t.Errorf("incorrect private evidence preflight body: %+v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(reply.Load().(string)))
	}))
	defer server.Close()
	cli := New(server.URL, "owner")
	proof := LocalBoundSourceProof{
		DeviceID: "own-A", DeviceToken: "private-token",
		RootID: "root-A", RootFingerprint: "fingerprint-A",
	}
	call := func(id []uint64) (LocalEvidencePreflight, error) {
		return cli.PreflightLocalSourceItemEvidence(
			context.Background(), 42, 7, proof, before, after, id)
	}
	for _, invalid := range [][]uint64{
		nil, {}, {0}, {5, 5}, {9, 5}, make([]uint64, 65),
	} {
		if _, err := call(invalid); err == nil {
			t.Fatalf("invalid evidence IDs were sent: %v", invalid)
		}
	}
	if _, err := cli.PreflightLocalSourceItemEvidence(
		context.Background(), 42, 7, proof, before, before, []uint64{5}); err == nil {
		t.Fatal("same snapshot generation accepted")
	}
	if _, err := cli.PreflightLocalSourceItemEvidence(
		context.Background(), 42, 7, LocalBoundSourceProof{}, before, after, []uint64{5}); err == nil {
		t.Fatal("missing owning Root credentials accepted")
	}
	if calls.Load() != 0 {
		t.Fatalf("unsafe preflight contacted Server %d times", calls.Load())
	}
	got, err := call([]uint64{5, 9})
	if err != nil || got.Checked != 2 || !got.ServerConsistent ||
		got.ContentVerified || got.CommitSupported || got.Authoritative ||
		got.MissingInferenceSafe || calls.Load() != 1 {
		t.Fatalf("safe preflight denied or elevated: %+v err=%v", got, err)
	}
	unsafe := []string{
		`{"source_id":41,"revision":7,"checked":2,"server_consistent":true}`,
		`{"source_id":42,"revision":8,"checked":2,"server_consistent":true}`,
		`{"source_id":42,"revision":7,"checked":1,"server_consistent":true}`,
		`{"source_id":42,"revision":7,"checked":2,"server_consistent":false}`,
		`{"source_id":42,"revision":7,"checked":2,"server_consistent":true,"content_verified":true}`,
		`{"source_id":42,"revision":7,"checked":2,"server_consistent":true,"commit_supported":true}`,
		`{"source_id":42,"revision":7,"checked":2,"server_consistent":true,"authoritative":true}`,
		`{"source_id":42,"revision":7,"checked":2,"server_consistent":true,"missing_inference_safe":true}`,
		`{"source_id":42,"revision":7,"checked":2,"server_consistent":true,"root_id":"leaked"}`,
		`{"source_id":42,"revision":7,"checked":2,"server_consistent":true}{}`,
		strings.Repeat("X", 1200),
	}
	for _, response := range unsafe {
		reply.Store(response)
		if _, err := call([]uint64{5, 9}); err == nil {
			t.Fatalf("unsafe preflight accepted: %s", response[:min(len(response), 70)])
		}
	}
}
