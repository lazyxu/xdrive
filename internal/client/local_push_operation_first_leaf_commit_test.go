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

	"github.com/google/uuid"
)

func TestOwningAgentFirstLeafCanonicalCommitStrictTransport(t *testing.T) {
	stageID := uuid.NewString()
	operationID := uuid.NewString()
	proof := LocalBoundSourceProof{
		DeviceID: uuid.NewString(), DeviceToken: "owning-private-secret",
		RootID: uuid.NewString(), RootFingerprint: strings.Repeat("a", 64),
	}
	var originalKey [32]byte
	for i := range originalKey {
		originalKey[i] = 0x41
	}
	const leaf = "first-original.jpg"
	type reply struct {
		status int
		etag   string
		cache  string
		body   string
	}
	jsonBody := fmt.Sprintf("{\"source_id\":42,\"revision\":7,\"stage_id\":%q,\"operation_id\":%q,\"generation\":3,\"node_id\":25,\"source_item_id\":26,\"state\":\"first_leaf_committed_pending_native_confirmation\",\"replayed\":false,\"sql_committed\":true,\"cas_observed\":true,\"native_verified\":false,\"backup_complete\":false,\"authoritative\":false,\"missing_inference_safe\":false,\"retirement_supported\":false}",
		stageID, operationID)
	good := reply{http.StatusCreated, "\"7\"", "private, no-store", jsonBody}
	var active atomic.Value
	active.Store(good)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Method != http.MethodPost ||
			r.URL.Path != "/api/v1/sources/42/local-staging/"+stageID+"/operation-first-leaf-commit" ||
			r.URL.RawQuery != "" ||
			r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("If-Match") != "\"7\"" ||
			r.Header.Get("Content-Type") != "application/json" ||
			r.Header.Get("X-XDrive-Device-ID") != proof.DeviceID ||
			r.Header.Get("X-XDrive-Device-Token") != proof.DeviceToken ||
			r.Header.Get("X-XDrive-Local-Root-ID") != proof.RootID ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != proof.RootFingerprint {
			t.Error("first leaf request bypassed exact authenticated scope")
		}
		var input struct {
			RelativeLeaf string `json:"relative_leaf"`
			RequestKey   string `json:"request_key"`
			OperationID  string `json:"operation_id"`
			Generation   uint64 `json:"generation"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&input); err != nil ||
			input.RelativeLeaf != leaf ||
			input.RequestKey != base64.RawURLEncoding.EncodeToString(originalKey[:]) ||
			input.OperationID != operationID || input.Generation != 3 {
			t.Errorf("invalid private first leaf COMMIT transport: %+v %v", input, err)
		}
		result := active.Load().(reply)
		w.Header().Set("ETag", result.etag)
		w.Header().Set("Cache-Control", result.cache)
		w.WriteHeader(result.status)
		_, _ = w.Write([]byte(result.body))
	}))
	defer server.Close()
	cli := New(server.URL, "owner")
	call := func(ctx context.Context, sourceID uint64, p LocalBoundSourceProof,
		leafName string, key [32]byte, stage, op string, generation uint64,
	) (LocalPushFirstLeafCanonicalReceipt, error) {
		return cli.CommitLocalPushFirstLeafWithOperation(
			ctx, sourceID, 7, p, stage, leafName, key, op, generation)
	}
	for _, tc := range []struct {
		name string
		run  func() (LocalPushFirstLeafCanonicalReceipt, error)
	}{
		{"nil-context", func() (LocalPushFirstLeafCanonicalReceipt, error) {
			return call(nil, 42, proof, leaf, originalKey, stageID, operationID, 3)
		}},
		{"zero-key", func() (LocalPushFirstLeafCanonicalReceipt, error) {
			return call(context.Background(), 42, proof, leaf, [32]byte{}, stageID, operationID, 3)
		}},
		{"wrong-owner", func() (LocalPushFirstLeafCanonicalReceipt, error) {
			return call(context.Background(), 0, proof, leaf, originalKey, stageID, operationID, 3)
		}},
		{"invalid-stage", func() (LocalPushFirstLeafCanonicalReceipt, error) {
			return call(context.Background(), 42, proof, leaf, originalKey, "invalid", operationID, 3)
		}},
		{"path-escape", func() (LocalPushFirstLeafCanonicalReceipt, error) {
			return call(context.Background(), 42, proof, "../escape", originalKey, stageID, operationID, 3)
		}},
		{"invalid-generation", func() (LocalPushFirstLeafCanonicalReceipt, error) {
			return call(context.Background(), 42, proof, leaf, originalKey, stageID, operationID, 0)
		}},
		{"cancelled", func() (LocalPushFirstLeafCanonicalReceipt, error) {
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			return call(ctx, 42, proof, leaf, originalKey, stageID, operationID, 3)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := tc.run()
			if err == nil {
				t.Fatal("unsafe private first leaf input reached transport")
			}
			if tc.name == "cancelled" && !errors.Is(err, context.Canceled) {
				t.Fatalf("cancelled context was hidden behind a generic error: %v", err)
			}
		})
	}
	if requests.Load() != 0 {
		t.Fatal("unauthorized local first leaf input caused network request")
	}
	first, err := call(context.Background(), 42, proof, leaf, originalKey, stageID, operationID, 3)
	if err != nil || first.NodeID != 25 || first.SourceItemID != 26 || first.Replayed ||
		first.StageID != stageID || first.OperationID != operationID {
		t.Fatalf("valid first-file canonical reply rejected: %+v %v", first, err)
	}
	private, marshalErr := json.Marshal(first)
	if marshalErr != nil || !bytes.Equal(private, []byte("{}")) {
		t.Fatalf("Agent-only canonical fields leaked through JSON: %s %v", private, marshalErr)
	}
	active.Store(reply{http.StatusOK, good.etag, good.cache,
		strings.Replace(good.body, "\"replayed\":false", "\"replayed\":true", 1)})
	replay, err := call(context.Background(), 42, proof, leaf, originalKey, stageID, operationID, 3)
	if err != nil || replay.NodeID != first.NodeID ||
		replay.SourceItemID != first.SourceItemID || !replay.Replayed {
		t.Fatalf("idempotent canonical reply lost: %+v %v", replay, err)
	}
	var bad = []reply{
		{http.StatusAccepted, good.etag, good.cache, good.body},
		{http.StatusCreated, "\"8\"", good.cache, good.body},
		{http.StatusCreated, good.etag, "public", good.body},
		{http.StatusCreated, good.etag, good.cache, strings.Replace(good.body, "\"sql_committed\":true", "\"sql_committed\":false", 1)},
		{http.StatusCreated, good.etag, good.cache, strings.Replace(good.body, "\"cas_observed\":true", "\"cas_observed\":false", 1)},
		{http.StatusCreated, good.etag, good.cache, strings.Replace(good.body, "\"native_verified\":false", "\"native_verified\":true", 1)},
		{http.StatusCreated, good.etag, good.cache, strings.Replace(good.body, "\"backup_complete\":false", "\"backup_complete\":true", 1)},
		{http.StatusCreated, good.etag, good.cache, strings.Replace(good.body, "\"retirement_supported\":false", "\"retirement_supported\":true", 1)},
		{http.StatusCreated, good.etag, good.cache, strings.Replace(good.body, "\"stage_id\":\""+stageID+"\"", "\"stage_id\":\""+uuid.NewString()+"\"", 1)},
		{http.StatusCreated, good.etag, good.cache, strings.Replace(good.body, "\"state\":\"first_leaf_committed_pending_native_confirmation\"", "\"state\":\"backup_complete\"", 1)},
		{http.StatusCreated, good.etag, good.cache, strings.Replace(good.body, "\"replayed\":false", "\"replayed\":true", 1)},
		{http.StatusCreated, good.etag, good.cache, strings.Replace(good.body, "\"node_id\":25", "\"node_id\":0", 1)},
		{http.StatusCreated, good.etag, good.cache, strings.Replace(good.body, "}", ",\"device_token\":\"leak\"}", 1)},
		{http.StatusCreated, good.etag, good.cache, good.body + "{}"},
		{http.StatusCreated, good.etag, good.cache, strings.Repeat("x", localPushFirstLeafOperationCommitMaxReply+1)},
	}
	for _, tc := range bad {
		active.Store(tc)
		if got, err := call(context.Background(), 42, proof, leaf, originalKey, stageID, operationID, 3); err == nil || got != (LocalPushFirstLeafCanonicalReceipt{}) {
			t.Fatalf("unsafe canonical response admitted: %+v %v", got, err)
		}
	}
}
