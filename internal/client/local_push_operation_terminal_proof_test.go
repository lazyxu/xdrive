package client

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestLocalPushTerminalProofClientStrictPrivateTransport(t *testing.T) {
	proof := LocalBoundSourceProof{
		DeviceID: uuid.NewString(), DeviceToken: "owning-secret",
		RootID: uuid.NewString(), RootFingerprint: strings.Repeat("a", 64),
	}
	operationID := uuid.NewString()
	var key [32]byte
	for i := range key {
		key[i] = 0x41
	}
	type reply struct {
		status int
		cache  string
		etag   string
		body   string
	}
	makeBody := func(state string) string {
		return fmt.Sprintf("{\"source_id\":42,\"revision\":7,\"operation_id\":%q,\"generation\":3,\"state\":%q,\"recorded_at\":\"2026-10-18T01:00:00Z\",\"commit_supported\":false,\"backup_complete\":false,\"authoritative\":false,\"missing_inference_safe\":false,\"retirement_supported\":false}", operationID, state)
	}
	var current atomic.Value
	current.Store(reply{http.StatusOK, "private, no-store", "\"7\"", makeBody("aborted")})
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost ||
			r.URL.Path != "/api/v1/sources/42/local-operation/terminal-proof" ||
			r.URL.RawQuery != "" || r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("Content-Type") != "application/json" ||
			r.Header.Get("If-Match") != "\"7\"" ||
			r.Header.Get("X-XDrive-Device-ID") != proof.DeviceID ||
			r.Header.Get("X-XDrive-Device-Token") != proof.DeviceToken ||
			r.Header.Get("X-XDrive-Local-Root-ID") != proof.RootID ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != proof.RootFingerprint {
			t.Error("terminal proof lost owning Agent, Root or Source headers")
		}
		var selector struct {
			RequestKey  string `json:"request_key"`
			OperationID string `json:"operation_id"`
			Generation  uint64 `json:"generation"`
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&selector); err != nil ||
			selector.RequestKey != base64.RawURLEncoding.EncodeToString(key[:]) ||
			selector.OperationID != operationID || selector.Generation != 3 {
			t.Errorf("terminal request changed original private key/identity: %+v %v", selector, err)
		}
		rep := current.Load().(reply)
		w.Header().Set("Cache-Control", rep.cache)
		w.Header().Set("ETag", rep.etag)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(rep.status)
		_, _ = w.Write([]byte(rep.body))
	}))
	defer server.Close()
	cli := New(server.URL, "owner")
	read := func(ctx context.Context, id string, generation uint64,
		k [32]byte, p LocalBoundSourceProof,
	) (LocalPushTerminalProof, error) {
		return cli.ReadLocalPushTerminalProof(ctx, 42, 7, p, k, id, generation)
	}
	bad := proof
	bad.DeviceToken = ""
	if _, err := read(context.Background(), operationID, 3, key, bad); err == nil {
		t.Fatal("missing token crossed Agent transport")
	}
	if _, err := read(context.Background(), "invalid", 3, key, proof); err == nil {
		t.Fatal("bad UUID crossed Agent transport")
	}
	if _, err := read(context.Background(), operationID, 0, key, proof); err == nil {
		t.Fatal("zero generation crossed Agent transport")
	}
	if _, err := read(context.Background(), operationID, 3, [32]byte{}, proof); err == nil {
		t.Fatal("zero request key crossed Agent transport")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := read(ctx, operationID, 3, key, proof); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled private transport continued: %v", err)
	}
	if calls.Load() != 0 {
		t.Fatalf("invalid calls reached HTTP: %d", calls.Load())
	}
	got, err := read(context.Background(), operationID, 3, key, proof)
	if err != nil || got.State != "aborted" || got.Generation != 3 ||
		got.OperationID != operationID || got.RecordedAt.Location() != time.UTC {
		t.Fatalf("valid private terminal rejected: %+v %v", got, err)
	}
	raw, err := json.Marshal(got)
	if err != nil || !bytes.Equal(raw, []byte("{}")) {
		t.Fatalf("Agent terminal leaked via IPC JSON: %s %v", raw, err)
	}
	current.Store(reply{http.StatusOK, "private, no-store", "\"7\"", makeBody("expired")})
	got, err = read(context.Background(), operationID, 3, key, proof)
	if err != nil || got.State != "expired" {
		t.Fatalf("valid expiry terminal rejected: %+v %v", got, err)
	}
	for _, invalid := range []reply{
		{http.StatusConflict, "private, no-store", "\"7\"", makeBody("expired")},
		{http.StatusOK, "public,max-age=60", "\"7\"", makeBody("expired")},
		{http.StatusOK, "private,no-store", "\"8\"", makeBody("expired")},
		{http.StatusOK, "private,no-store", "\"7\"", strings.Replace(makeBody("expired"), "\"backup_complete\":false", "\"backup_complete\":true", 1)},
		{http.StatusOK, "private,no-store", "\"7\"", strings.Replace(makeBody("expired"), "\"retirement_supported\":false", "\"retirement_supported\":true", 1)},
		{http.StatusOK, "private,no-store", "\"7\"", strings.Replace(makeBody("expired"), "\"retirement_supported\":false", "\"retirement_supported\":null", 1)},
		{http.StatusOK, "private,no-store", "\"7\"", strings.Replace(makeBody("expired"), "\"state\":\"expired\"", "\"state\":\"reserved\"", 1)},
		{http.StatusOK, "private,no-store", "\"7\"", strings.Replace(makeBody("expired"), operationID, uuid.NewString(), 1)},
		{http.StatusOK, "private,no-store", "\"7\"", strings.Replace(makeBody("expired"), "\"generation\":3", "\"generation\":4", 1)},
		{http.StatusOK, "private,no-store", "\"7\"", strings.Replace(makeBody("expired"), "2026-10-18T01:00:00Z", "2026-10-18T10:00:00+09:00", 1)},
		{http.StatusOK, "private,no-store", "\"7\"", strings.Replace(makeBody("expired"), "2026-10-18T01:00:00Z", "bad-time", 1)},
		{http.StatusOK, "private,no-store", "\"7\"", strings.Replace(makeBody("expired"), "}", ",\"root_id\":\"leak\"}", 1)},
		{http.StatusOK, "private,no-store", "\"7\"", makeBody("expired") + "{}"},
		{http.StatusOK, "private,no-store", "\"7\"", strings.Repeat("z", localPushTerminalProofMaxReply+10)},
	} {
		current.Store(invalid)
		if response, err := read(context.Background(), operationID, 3, key, proof); err == nil ||
			response != (LocalPushTerminalProof{}) {
			t.Fatalf("unsafe private reply accepted: %+v %v", response, err)
		}
	}
}
