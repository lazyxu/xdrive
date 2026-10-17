package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
)

func TestLocalPushOperationAbortObserveStrictAgentTransport(t *testing.T) {
	proof := LocalBoundSourceProof{
		DeviceID: uuid.NewString(), DeviceToken: "private-agent-credential",
		RootID: uuid.NewString(), RootFingerprint: strings.Repeat("a", 64),
	}
	operationID := uuid.NewString()
	type reply struct {
		code              int
		etag, cache, body string
	}
	makeBody := func(state string) string {
		return `{"source_id":42,"revision":7,"operation_id":"` + operationID +
			`","generation":2,"state":"` + state +
			`","commit_supported":false,"backup_complete":false,"authoritative":false,"missing_inference_safe":false}`
	}
	var current atomic.Value
	current.Store(reply{http.StatusOK, `"7"`, "private, no-store", makeBody("reserved")})
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost ||
			(r.URL.Path != "/api/v1/sources/42/local-operation/observe" &&
				r.URL.Path != "/api/v1/sources/42/local-operation/abort") ||
			r.URL.RawQuery != "" ||
			r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("Content-Type") != "application/json" ||
			r.Header.Get("If-Match") != `"7"` ||
			r.Header.Get("X-XDrive-Device-ID") != proof.DeviceID ||
			r.Header.Get("X-XDrive-Device-Token") != proof.DeviceToken ||
			r.Header.Get("X-XDrive-Local-Root-ID") != proof.RootID ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != proof.RootFingerprint {
			t.Error("private operation transport lost owning credential or revision")
		}
		var selector struct {
			OperationID string `json:"operation_id"`
			Generation  uint64 `json:"generation"`
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&selector); err != nil ||
			selector.OperationID != operationID || selector.Generation != 2 {
			t.Errorf("private operation body changed identity: %+v %v", selector, err)
		}
		rep := current.Load().(reply)
		w.Header().Set("ETag", rep.etag)
		w.Header().Set("Cache-Control", rep.cache)
		w.WriteHeader(rep.code)
		_, _ = w.Write([]byte(rep.body))
	}))
	defer server.Close()
	cli := New(server.URL, "owner")
	observe := func(ctx context.Context, id string, gen uint64, p LocalBoundSourceProof) (LocalPushOperationStatus, error) {
		return cli.ObserveLocalPushOperation(ctx, 42, 7, p, id, gen)
	}
	abort := func(ctx context.Context, id string, gen uint64, p LocalBoundSourceProof) (LocalPushOperationStatus, error) {
		return cli.AbortLocalPushOperation(ctx, 42, 7, p, id, gen)
	}
	bad := proof
	bad.DeviceToken = ""
	if _, err := observe(context.Background(), operationID, 2, bad); err == nil {
		t.Fatal("missing device token permitted observe")
	}
	if _, err := abort(context.Background(), "not-uuid", 2, proof); err == nil {
		t.Fatal("malformed UUID permitted abort")
	}
	if _, err := observe(context.Background(), operationID, 0, proof); err == nil {
		t.Fatal("zero generation permitted observe")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := abort(ctx, operationID, 2, proof); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled request ignored: %v", err)
	}
	if calls.Load() != 0 {
		t.Fatalf("invalid requests crossed transport: %d", calls.Load())
	}
	got, err := observe(context.Background(), operationID, 2, proof)
	if err != nil || got.State != "reserved" || got.Generation != 2 || got.OperationID != operationID {
		t.Fatalf("reserved status not validated: %+v err=%v", got, err)
	}
	raw, err := json.Marshal(got)
	if err != nil || !bytes.Equal(raw, []byte("{}")) {
		t.Fatalf("private status escaped to JSON: %s err=%v", raw, err)
	}
	current.Store(reply{http.StatusOK, `"7"`, "private, no-store", makeBody("expired")})
	got, err = observe(context.Background(), operationID, 2, proof)
	if err != nil || got.State != "expired" {
		t.Fatalf("expired status not validated: %+v err=%v", got, err)
	}
	current.Store(reply{http.StatusOK, `"7"`, "private, no-store", makeBody("aborted")})
	got, err = abort(context.Background(), operationID, 2, proof)
	if err != nil || got.State != "aborted" {
		t.Fatalf("abort status not validated: %+v err=%v", got, err)
	}
	for _, invalid := range []reply{
		{http.StatusConflict, `"7"`, "private, no-store", makeBody("aborted")},
		{http.StatusCreated, `"7"`, "private, no-store", makeBody("aborted")},
		{http.StatusOK, `"6"`, "private, no-store", makeBody("aborted")},
		{http.StatusOK, `"7"`, "public, max-age=600", makeBody("aborted")},
		{http.StatusOK, `"7"`, "private, no-store", strings.Replace(makeBody("aborted"), `"backup_complete":false`, `"backup_complete":true`, 1)},
		{http.StatusOK, `"7"`, "private, no-store", strings.Replace(makeBody("aborted"), `"commit_supported":false`, "", 1)},
		{http.StatusOK, `"7"`, "private, no-store", strings.Replace(makeBody("aborted"), `"authoritative":false`, `"authoritative":true`, 1)},
		{http.StatusOK, `"7"`, "private, no-store", strings.Replace(makeBody("aborted"), `"missing_inference_safe":false`, `"missing_inference_safe":true`, 1)},
		{http.StatusOK, `"7"`, "private, no-store", strings.Replace(makeBody("aborted"), operationID, uuid.NewString(), 1)},
		{http.StatusOK, `"7"`, "private, no-store", strings.Replace(makeBody("aborted"), `"generation":2`, `"generation":3`, 1)},
		{http.StatusOK, `"7"`, "private, no-store", strings.Replace(makeBody("aborted"), `"state":"aborted"`, `"state":"reserved"`, 1)},
		{http.StatusOK, `"7"`, "private, no-store", strings.Replace(makeBody("aborted"), "}", `,"root_id":"leak"}`, 1)},
		{http.StatusOK, `"7"`, "private, no-store", makeBody("aborted") + "{}"},
		{http.StatusOK, `"7"`, "private, no-store", strings.Repeat("z", localPushOperationStatusMaxReply+10)},
	} {
		current.Store(invalid)
		if out, err := abort(context.Background(), operationID, 2, proof); err == nil || out != (LocalPushOperationStatus{}) {
			t.Fatalf("unsafe abort reply accepted: %d %+v", invalid.code, out)
		}
	}
}
