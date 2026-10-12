package client

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestOwningAgentQuarantineClientStrictProofCountsAndNoAuthority(t *testing.T) {
	before, after := strings.Repeat("1", 64), strings.Repeat("2", 64)
	proof := LocalBoundSourceProof{
		DeviceID: "own-A", DeviceToken: "private-device-token",
		RootID: "root-A", RootFingerprint: "root-fingerprint",
	}
	type response struct {
		code  int
		etag  string
		cache string
		body  string
	}
	var reply atomic.Value
	good := response{
		code: http.StatusCreated, etag: "\"7\"", cache: "private, no-store",
		body: `{"source_id":42,"revision":7,"quarantined":1,"replayed":1,"commit_supported":false,"authoritative":false,"missing_inference_safe":false}`,
	}
	reply.Store(good)
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost ||
			r.URL.Path != "/api/v1/sources/42/local-identity/commit-intents" ||
			r.URL.RawQuery != "" ||
			r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("Content-Type") != "application/json" ||
			r.Header.Get("If-Match") != "\"7\"" ||
			r.Header.Get("X-XDrive-Device-ID") != proof.DeviceID ||
			r.Header.Get("X-XDrive-Device-Token") != proof.DeviceToken ||
			r.Header.Get("X-XDrive-Local-Root-ID") != proof.RootID ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != proof.RootFingerprint {
			t.Error("local quarantine transport omitted owning Agent authorization")
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var body struct {
			Before string   `json:"previous_snapshot_sha256"`
			After  string   `json:"current_snapshot_sha256"`
			IDs    []uint64 `json:"evidence_ids"`
		}
		if err := decoder.Decode(&body); err != nil ||
			body.Before != before || body.After != after ||
			len(body.IDs) != 2 || body.IDs[0] != 5 || body.IDs[1] != 9 {
			t.Errorf("incorrect private quarantine payload: %+v", body)
		}
		got := reply.Load().(response)
		w.Header().Set("ETag", got.etag)
		w.Header().Set("Cache-Control", got.cache)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(got.code)
		_, _ = w.Write([]byte(got.body))
	}))
	defer server.Close()
	cli := New(server.URL, "owner")
	run := func(ids []uint64) (LocalCommitIntentResult, error) {
		return cli.QuarantineLocalSourceCommitIntents(
			context.Background(), 42, 7, proof, before, after, ids)
	}
	for _, bad := range [][]uint64{
		nil, {}, {0}, {9, 5}, {5, 5}, make([]uint64, 17),
	} {
		if _, err := run(bad); err == nil {
			t.Fatalf("unsafe evidence IDs passed client preflight: %v", bad)
		}
	}
	if _, err := cli.QuarantineLocalSourceCommitIntents(
		context.Background(), 42, 7, LocalBoundSourceProof{}, before, after, []uint64{5}); err == nil {
		t.Fatal("missing local device and Root proof accepted")
	}
	if _, err := cli.QuarantineLocalSourceCommitIntents(
		context.Background(), 42, 7, proof, before, before, []uint64{5}); err == nil {
		t.Fatal("same journal generation accepted")
	}
	if _, err := cli.QuarantineLocalSourceCommitIntents(
		context.Background(), 0, 7, proof, before, after, []uint64{5}); err == nil {
		t.Fatal("missing Source accepted")
	}
	if calls.Load() != 0 {
		t.Fatalf("unsafe client input reached Server %d times", calls.Load())
	}
	got, err := run([]uint64{5, 9})
	if err != nil || got.SourceID != 42 || got.Revision != 7 ||
		got.Quarantined != 1 || got.Replayed != 1 ||
		got.CommitSupported || got.Authoritative || got.MissingInferenceSafe {
		t.Fatalf("quarantine did not stay non-authoritative: %+v %v", got, err)
	}
	replayed := response{
		code: http.StatusOK, etag: "\"7\"", cache: "private, no-store",
		body: `{"source_id":42,"revision":7,"quarantined":0,"replayed":2,"commit_supported":false,"authoritative":false,"missing_inference_safe":false}`,
	}
	reply.Store(replayed)
	got, err = run([]uint64{5, 9})
	if err != nil || got.Quarantined != 0 || got.Replayed != 2 {
		t.Fatalf("idempotent replay invalid: %+v %v", got, err)
	}
	for _, bad := range []response{
		{http.StatusAccepted, "\"7\"", "private, no-store", good.body},
		{http.StatusCreated, "\"6\"", "private, no-store", good.body},
		{http.StatusCreated, "\"7\"", "public", good.body},
		{http.StatusCreated, "\"7\"", "private, no-store", strings.Replace(good.body, `"replayed":1`, `"replayed":2`, 1)},
		{http.StatusCreated, "\"7\"", "private, no-store", strings.Replace(good.body, `"quarantined":1`, `"quarantined":0`, 1)},
		{http.StatusCreated, "\"7\"", "private, no-store", strings.Replace(good.body, `"commit_supported":false`, `"commit_supported":true`, 1)},
		{http.StatusCreated, "\"7\"", "private, no-store", strings.Replace(good.body, `"authoritative":false`, `"authoritative":true`, 1)},
		{http.StatusCreated, "\"7\"", "private, no-store", strings.Replace(good.body, `"missing_inference_safe":false`, `"missing_inference_safe":true`, 1)},
		{http.StatusCreated, "\"7\"", "private, no-store", strings.Replace(good.body, `,"commit_supported":false`, "", 1)},
		{http.StatusCreated, "\"7\"", "private, no-store", strings.Replace(good.body, "}", `,"root_id":"private"}`, 1)},
		{http.StatusCreated, "\"7\"", "private, no-store", good.body + "{}"},
		{http.StatusCreated, "\"7\"", "private, no-store", strings.Repeat("x", localCommitIntentReplyLimit+10)},
		{http.StatusCreated, "\"7\"", "private, no-store", "null"},
		{http.StatusOK, "\"7\"", "private, no-store", good.body},
	} {
		reply.Store(bad)
		if _, err := run([]uint64{5, 9}); err == nil {
			t.Fatalf("unsafe quarantine response was accepted: status=%d body=%s",
				bad.code, bad.body[:min(len(bad.body), 90)])
		}
	}
}

func TestOwningAgentQuarantineClientRequestContextCancellation(t *testing.T) {
	started := make(chan struct{})
	// On Windows, a cancelled client HTTP/1.1 request does not always
	// deliver server Request.Context cancellation before the handler returns.
	// Keep cancellation assertions on the CLIENT and release the test handler
	// independently so httptest.Server.Close cannot hang at teardown.
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		close(started)
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer func() {
		close(release)
		server.Close()
	}()
	proof := LocalBoundSourceProof{
		DeviceID: "own-A", DeviceToken: "private-token",
		RootID: "root-A", RootFingerprint: "fingerprint",
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, err := New(server.URL, "owner").QuarantineLocalSourceCommitIntents(
			ctx, 42, 7, proof, strings.Repeat("1", 64), strings.Repeat("2", 64),
			[]uint64{5})
		result <- err
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("private quarantine never started")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("context cancellation not propagated: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("private quarantine ignored request cancellation")
	}
}
