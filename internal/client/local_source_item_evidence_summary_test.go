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

func TestPrivateEvidenceCountUsesBoundDeviceProofAndRejectsUnsafeAnswers(t *testing.T) {
	var calls atomic.Int64
	var response atomic.Value
	response.Store(`{"source_id":42,"revision":7,"staged_records":3,"authoritative":false,"missing_inference_safe":false}`)
	before := strings.Repeat("1", 64)
	after := strings.Repeat("2", 64)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost ||
			r.URL.Path != "/api/v1/sources/42/local-identity/evidence-summary" ||
			r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("X-XDrive-Device-ID") != "device-A" ||
			r.Header.Get("X-XDrive-Device-Token") != "OS-secret" ||
			r.Header.Get("X-XDrive-Local-Root-ID") != "root-A" ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != "fingerprint-A" ||
			r.Header.Get("If-Match") != "\"7\"" {
			t.Error("owning Agent evidence readback lacked exact credentials or revision")
		}
		var body struct {
			Previous string `json:"previous_snapshot_sha256"`
			Current  string `json:"current_snapshot_sha256"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
			body.Previous != before || body.Current != after {
			t.Errorf("unexpected private generation query: %+v err=%v", body, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(response.Load().(string)))
	}))
	defer server.Close()
	cli := New(server.URL, "owner")
	proof := LocalBoundSourceProof{
		DeviceID: "device-A", DeviceToken: "OS-secret",
		RootID: "root-A", RootFingerprint: "fingerprint-A",
	}
	for _, input := range []struct {
		id       uint64
		revision uint64
		before   string
		after    string
	}{
		{0, 7, before, after},
		{42, 0, before, after},
		{42, 7, "", after},
		{42, 7, strings.Repeat("0", 64), after},
		{42, 7, strings.Repeat("A", 64), after},
		{42, 7, before, before},
		{42, 7, before, strings.Repeat("a", 63)},
	} {
		if _, err := cli.ReadLocalSourceItemEvidenceSummary(context.Background(),
			input.id, input.revision, proof, input.before, input.after); err == nil {
			t.Fatalf("unsafe evidence count query accepted: %+v", input)
		}
	}
	if calls.Load() != 0 {
		t.Fatalf("unsafe generation contacted Server: %d", calls.Load())
	}
	got, err := cli.ReadLocalSourceItemEvidenceSummary(
		context.Background(), 42, 7, proof, before, after)
	if err != nil || got.SourceID != 42 || got.Revision != 7 ||
		got.StagedRecords != 3 || got.Authoritative || got.MissingInferenceSafe ||
		calls.Load() != 1 {
		t.Fatalf("private stored COUNT incorrect: %+v err=%v", got, err)
	}
	for _, invalid := range []string{
		`{"source_id":41,"revision":7,"staged_records":3}`,
		`{"source_id":42,"revision":8,"staged_records":3}`,
		`{"source_id":42,"revision":7,"staged_records":-1}`,
		`{"source_id":42,"revision":7,"staged_records":3,"authoritative":true}`,
		`{"source_id":42,"revision":7,"staged_records":3,"missing_inference_safe":true}`,
	} {
		response.Store(invalid)
		if _, err := cli.ReadLocalSourceItemEvidenceSummary(
			context.Background(), 42, 7, proof, before, after); err == nil {
			t.Fatalf("unsafe Server summary accepted: %s", invalid)
		}
	}
}
