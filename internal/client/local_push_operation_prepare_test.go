package client

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
)

func TestOwningAgentLocalPushPrepareStrictTransportAndPrivacy(t *testing.T) {
	proof := LocalBoundSourceProof{DeviceID: uuid.NewString(), DeviceToken: "owning-private-token", RootID: uuid.NewString(), RootFingerprint: strings.Repeat("a", 64)}
	var key [32]byte
	for i := range key {
		key[i] = 0x41
	}
	operationID := uuid.NewString()
	var requests atomic.Int32
	type reply struct {
		code              int
		etag, cache, body string
	}
	good := reply{http.StatusOK, "\"7\"", "private, no-store",
		`{"source_id":42,"revision":7,"operation_id":"` + operationID + `","generation":1,"state":"reserved","commit_supported":false,"backup_complete":false,"authoritative":false,"missing_inference_safe":false}`}
	var current atomic.Value
	current.Store(good)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/sources/42/local-operation/prepare" || r.URL.RawQuery != "" ||
			r.Header.Get("Authorization") != "Bearer owner" || r.Header.Get("Content-Type") != "application/json" ||
			r.Header.Get("If-Match") != "\"7\"" || r.Header.Get("X-XDrive-Device-ID") != proof.DeviceID ||
			r.Header.Get("X-XDrive-Device-Token") != proof.DeviceToken || r.Header.Get("X-XDrive-Local-Root-ID") != proof.RootID ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != proof.RootFingerprint {
			t.Error("private owning-Agent request missing proof or revision fence")
		}
		var incoming struct {
			RequestKey string `json:"request_key"`
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&incoming); err != nil || incoming.RequestKey != base64.RawURLEncoding.EncodeToString(key[:]) {
			t.Errorf("incorrect private request key transport: %v", err)
		}
		res := current.Load().(reply)
		w.Header().Set("ETag", res.etag)
		w.Header().Set("Cache-Control", res.cache)
		w.WriteHeader(res.code)
		_, _ = w.Write([]byte(res.body))
	}))
	defer server.Close()
	cli := New(server.URL, "owner")
	run := func(ctx context.Context, p LocalBoundSourceProof, k [32]byte) (LocalPushPreparedOperation, error) {
		return cli.PrepareLocalPushOperation(ctx, 42, 7, p, k)
	}
	invalid := proof
	invalid.DeviceToken = ""
	if _, err := run(context.Background(), invalid, key); err == nil {
		t.Fatal("missing device token reached operation transport")
	}
	if _, err := run(context.Background(), proof, [32]byte{}); err == nil {
		t.Fatal("zero request key reached operation transport")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := run(ctx, proof, key); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled operation started: %v", err)
	}
	if requests.Load() != 0 {
		t.Fatalf("invalid requests reached Server: %d", requests.Load())
	}
	got, err := run(context.Background(), proof, key)
	if err != nil || got.SourceID != 42 || got.Revision != 7 || got.OperationID != operationID || got.Generation != 1 || got.State != "reserved" {
		t.Fatalf("private prepare response was not validated: %+v err=%v", got, err)
	}
	serialized, err := json.Marshal(got)
	if err != nil || !bytes.Equal(serialized, []byte("{}")) {
		t.Fatalf("Agent-only receipt entered JSON: %s %v", serialized, err)
	}
	for _, bad := range []reply{
		{http.StatusCreated, "\"7\"", "private, no-store", good.body},
		{http.StatusForbidden, "\"7\"", "private, no-store", `{"secret":"do-not-echo"}`},
		{http.StatusOK, "\"8\"", "private, no-store", good.body},
		{http.StatusOK, "\"7\"", "public", good.body},
		{http.StatusOK, "\"7\"", "private, no-store", strings.Replace(good.body, `"commit_supported":false`, `"commit_supported":true`, 1)},
		{http.StatusOK, "\"7\"", "private, no-store", strings.Replace(good.body, `"backup_complete":false`, `"backup_complete":true`, 1)},
		{http.StatusOK, "\"7\"", "private, no-store", strings.Replace(good.body, `"authoritative":false`, `"authoritative":true`, 1)},
		{http.StatusOK, "\"7\"", "private, no-store", strings.Replace(good.body, `"missing_inference_safe":false`, `"missing_inference_safe":true`, 1)},
		{http.StatusOK, "\"7\"", "private, no-store", strings.Replace(good.body, `,"backup_complete":false`, "", 1)},
		{http.StatusOK, "\"7\"", "private, no-store", strings.Replace(good.body, operationID, "bad-id", 1)},
		{http.StatusOK, "\"7\"", "private, no-store", strings.Replace(good.body, `"generation":1`, `"generation":0`, 1)},
		{http.StatusOK, "\"7\"", "private, no-store", strings.Replace(good.body, `"state":"reserved"`, `"state":"committed"`, 1)},
		{http.StatusOK, "\"7\"", "private, no-store", strings.Replace(good.body, "}", `,"device_token":"leak"}`, 1)},
		{http.StatusOK, "\"7\"", "private, no-store", good.body + "{}"},
		{http.StatusOK, "\"7\"", "private, no-store", strings.Repeat("x", localPushOperationPrepareMaxReply+10)},
	} {
		current.Store(bad)
		if out, err := run(context.Background(), proof, key); err == nil || out != (LocalPushPreparedOperation{}) {
			t.Fatalf("unsafe private prepare response accepted: status=%d %+v", bad.code, out)
		}
	}
}
