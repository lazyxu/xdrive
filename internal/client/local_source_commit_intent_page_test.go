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

func TestReadLocalSourceCommitIntentPageStrictOwningProofAndNoAuthority(t *testing.T) {
	proof := LocalBoundSourceProof{
		DeviceID: "own-A", DeviceToken: "secret-own-agent",
		RootID: "root-A", RootFingerprint: strings.Repeat("a", 64),
	}
	previous, current := strings.Repeat("1", 64), strings.Repeat("2", 64)
	type response struct {
		status int
		etag   string
		cache  string
		body   string
	}
	base := response{
		status: http.StatusOK, etag: `"7"`, cache: "private, no-store",
		body: `{"source_id":42,"revision":7,"quarantined_evidence_ids":[5,9],"has_more":true,"next_after_id":9,"commit_supported":false,"authoritative":false,"missing_inference_safe":false}`,
	}
	var reply atomic.Value
	reply.Store(base)
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/sources/42/local-identity/commit-intents/page" ||
			r.URL.RawQuery != "" || r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("Content-Type") != "application/json" ||
			r.Header.Get("If-Match") != `"7"` ||
			r.Header.Get("X-XDrive-Device-ID") != proof.DeviceID ||
			r.Header.Get("X-XDrive-Device-Token") != proof.DeviceToken ||
			r.Header.Get("X-XDrive-Local-Root-ID") != proof.RootID ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != proof.RootFingerprint {
			t.Error("quarantine read did not use owning-Agent proof")
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var input struct {
			Previous string `json:"previous_snapshot_sha256"`
			Current  string `json:"current_snapshot_sha256"`
			AfterID  uint64 `json:"after_evidence_id"`
			Limit    int    `json:"limit"`
		}
		if err := decoder.Decode(&input); err != nil ||
			input.Previous != previous || input.Current != current || input.Limit != 2 ||
			(input.AfterID != 0 && input.AfterID != 9) {
			t.Errorf("unexpected private quarantine read request: %+v %v", input, err)
		}
		v := reply.Load().(response)
		w.Header().Set("ETag", v.etag)
		w.Header().Set("Cache-Control", v.cache)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(v.status)
		_, _ = w.Write([]byte(v.body))
	}))
	defer server.Close()
	client := New(server.URL, "owner")
	run := func(ctx context.Context, afterID uint64, limit int, bound LocalBoundSourceProof, old, now string) (LocalCommitIntentPage, error) {
		return client.ReadLocalSourceCommitIntentPage(ctx, 42, 7, bound, old, now, limit, afterID)
	}
	for _, input := range []struct {
		proof LocalBoundSourceProof
		old   string
		now   string
		limit int
	}{
		{LocalBoundSourceProof{}, previous, current, 2},
		{proof, previous, previous, 2},
		{proof, "not-a-digest", current, 2},
		{proof, previous, current, 0},
		{proof, previous, current, localCommitIntentBatchLimit + 1},
	} {
		if _, err := run(context.Background(), 0, input.limit, input.proof, input.old, input.now); err == nil {
			t.Fatal("invalid private quarantine read dispatched")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := run(ctx, 0, 2, proof, previous, current); err == nil {
		t.Fatal("canceled context reached Server")
	}
	if calls.Load() != 0 {
		t.Fatalf("invalid request reached Server %d times", calls.Load())
	}
	got, err := run(context.Background(), 0, 2, proof, previous, current)
	if err != nil || len(got.EvidenceIDs) != 2 || got.EvidenceIDs[0] != 5 || got.EvidenceIDs[1] != 9 ||
		!got.HasMore || got.NextAfterID != 9 || got.CommitSupported || got.Authoritative || got.MissingInferenceSafe {
		t.Fatalf("valid bounded quarantine read rejected or gained authority: %+v %v", got, err)
	}
	reply.Store(response{
		status: http.StatusOK, etag: `"7"`, cache: "private, no-store",
		body: `{"source_id":42,"revision":7,"quarantined_evidence_ids":[],"has_more":false,"next_after_id":0,"commit_supported":false,"authoritative":false,"missing_inference_safe":false}`,
	})
	got, err = run(context.Background(), 9, 2, proof, previous, current)
	if err != nil || len(got.EvidenceIDs) != 0 || got.HasMore || got.NextAfterID != 0 {
		t.Fatalf("empty terminal page rejected: %+v %v", got, err)
	}
	for _, invalid := range []response{
		{http.StatusCreated, `"7"`, "private, no-store", base.body},
		{http.StatusOK, `"6"`, "private, no-store", base.body},
		{http.StatusOK, `"7"`, "public", base.body},
		{http.StatusOK, `"7"`, "private, no-store", strings.Replace(base.body, `"authoritative":false`, `"authoritative":true`, 1)},
		{http.StatusOK, `"7"`, "private, no-store", strings.Replace(base.body, `"commit_supported":false`, `"commit_supported":true`, 1)},
		{http.StatusOK, `"7"`, "private, no-store", strings.Replace(base.body, `"missing_inference_safe":false`, `"missing_inference_safe":true`, 1)},
		{http.StatusOK, `"7"`, "private, no-store", strings.Replace(base.body, `,"commit_supported":false`, "", 1)},
		{http.StatusOK, `"7"`, "private, no-store", strings.Replace(base.body, `"quarantined_evidence_ids":[5,9]`, `"quarantined_evidence_ids":null`, 1)},
		{http.StatusOK, `"7"`, "private, no-store", strings.Replace(base.body, `"quarantined_evidence_ids":[5,9]`, `"quarantined_evidence_ids":[9,5]`, 1)},
		{http.StatusOK, `"7"`, "private, no-store", strings.Replace(base.body, `"next_after_id":9`, `"next_after_id":10`, 1)},
		{http.StatusOK, `"7"`, "private, no-store", base.body + "{}"},
		{http.StatusOK, `"7"`, "private, no-store", strings.Replace(base.body, "}", `,"root_id":"secret"}`, 1)},
		{http.StatusOK, `"7"`, "private, no-store", strings.Repeat("x", localCommitIntentPageResponseMaxBytes+10)},
	} {
		reply.Store(invalid)
		if _, err := run(context.Background(), 0, 2, proof, previous, current); err == nil {
			t.Fatalf("unsafe quarantine read accepted: status=%d body=%s", invalid.status, invalid.body[:min(len(invalid.body), 80)])
		}
	}
}
