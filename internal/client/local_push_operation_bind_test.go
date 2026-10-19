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

func TestLocalPushOperationBindingStrictPrivateClientTransport(t *testing.T) {
	stageID := uuid.NewString()
	operationID := uuid.NewString()
	proof := LocalBoundSourceProof{
		DeviceID: uuid.NewString(), DeviceToken: "owning-device-private-token",
		RootID: uuid.NewString(), RootFingerprint: strings.Repeat("a", 64),
	}
	var key [32]byte
	for i := range key {
		key[i] = 0x41
	}
	type response struct {
		status            int
		etag, cache, body string
	}
	body := fmt.Sprintf(`{"source_id":42,"revision":7,"stage_id":%q,"operation_id":%q,"generation":3,"state":"bound","commit_supported":false,"backup_complete":false,"authoritative":false,"missing_inference_safe":false,"retirement_supported":false}`, stageID, operationID)
	good := response{http.StatusOK, `"7"`, "private, no-store", body}
	var current atomic.Value
	current.Store(good)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/sources/42/local-staging/"+stageID+"/operation-bind" ||
			r.URL.RawQuery != "" || r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("Content-Type") != "application/json" || r.Header.Get("If-Match") != `"7"` ||
			r.Header.Get("X-XDrive-Device-ID") != proof.DeviceID ||
			r.Header.Get("X-XDrive-Device-Token") != proof.DeviceToken ||
			r.Header.Get("X-XDrive-Local-Root-ID") != proof.RootID ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != proof.RootFingerprint {
			t.Error("private Stage bind transport bypassed device/Root/Source proof")
		}
		var input struct {
			RequestKey  string `json:"request_key"`
			OperationID string `json:"operation_id"`
			Generation  uint64 `json:"generation"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&input); err != nil ||
			input.RequestKey != base64.RawURLEncoding.EncodeToString(key[:]) ||
			input.OperationID != operationID || input.Generation != 3 {
			t.Errorf("wrong private bound key/operation: %+v %v", input, err)
		}
		reply := current.Load().(response)
		w.Header().Set("ETag", reply.etag)
		w.Header().Set("Cache-Control", reply.cache)
		w.WriteHeader(reply.status)
		_, _ = w.Write([]byte(reply.body))
	}))
	defer server.Close()
	cli := New(server.URL, "owner")
	invoke := func(ctx context.Context, sourceID uint64, p LocalBoundSourceProof, k [32]byte, stage, operation string, generation uint64) (LocalPushOperationStageBinding, error) {
		return cli.BindLocalPushOperationStage(ctx, sourceID, 7, p, stage, k, operation, generation)
	}
	if got, err := invoke(context.Background(), 42, proof, key, stageID, operationID, 3); err != nil ||
		got.SourceID != 42 || got.Revision != 7 || got.StageID != stageID ||
		got.OperationID != operationID || got.Generation != 3 {
		t.Fatalf("valid bind transport failed: %+v %v", got, err)
	}
	for _, invalid := range []func() (LocalPushOperationStageBinding, error){
		func() (LocalPushOperationStageBinding, error) {
			return invoke(context.Background(), 0, proof, key, stageID, operationID, 3)
		},
		func() (LocalPushOperationStageBinding, error) {
			return invoke(context.Background(), 42, proof, [32]byte{}, stageID, operationID, 3)
		},
		func() (LocalPushOperationStageBinding, error) {
			return invoke(context.Background(), 42, proof, key, "invalid", operationID, 3)
		},
		func() (LocalPushOperationStageBinding, error) {
			return invoke(context.Background(), 42, proof, key, stageID, "invalid", 3)
		},
		func() (LocalPushOperationStageBinding, error) {
			return invoke(context.Background(), 42, proof, key, stageID, operationID, 0)
		},
		func() (LocalPushOperationStageBinding, error) {
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			return invoke(ctx, 42, proof, key, stageID, operationID, 3)
		},
	} {
		if _, err := invalid(); err == nil {
			t.Fatal("invalid operation reached transport")
		}
	}
	if requests.Load() != 1 {
		t.Fatalf("invalid request emitted network calls: %d", requests.Load())
	}
	wire, _ := json.Marshal(LocalPushOperationStageBinding{StageID: stageID, OperationID: operationID})
	if !bytes.Equal(wire, []byte("{}")) {
		t.Fatalf("private bind receipt JSON exposure: %s", wire)
	}
	for _, bad := range []response{
		{http.StatusCreated, good.etag, good.cache, good.body},
		{http.StatusOK, `"999"`, good.cache, good.body},
		{http.StatusOK, good.etag, "public", good.body},
		{http.StatusOK, good.etag, good.cache, strings.Replace(good.body, `"commit_supported":false`, `"commit_supported":true`, 1)},
		{http.StatusOK, good.etag, good.cache, strings.Replace(good.body, `"backup_complete":false`, `"backup_complete":true`, 1)},
		{http.StatusOK, good.etag, good.cache, strings.Replace(good.body, `"retirement_supported":false`, `"retirement_supported":true`, 1)},
		{http.StatusOK, good.etag, good.cache, strings.Replace(good.body, `"stage_id":"`+stageID+`"`, `"stage_id":"`+uuid.NewString()+`"`, 1)},
		{http.StatusOK, good.etag, good.cache, strings.Replace(good.body, `"generation":3`, `"generation":4`, 1)},
		{http.StatusOK, good.etag, good.cache, strings.Replace(good.body, "}", `,"device_token":"leak"}`, 1)},
		{http.StatusOK, good.etag, good.cache, good.body + "{}"},
		{http.StatusOK, good.etag, good.cache, strings.Repeat("x", localPushOperationBindMaxReply+1)},
	} {
		current.Store(bad)
		got, err := invoke(context.Background(), 42, proof, key, stageID, operationID, 3)
		if err == nil || got != (LocalPushOperationStageBinding{}) {
			t.Fatalf("unsafe operation bind response admitted: %+v %v", got, err)
		}
	}
	// A canceled network request must not retry implicitly.
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := invoke(canceled, 42, proof, key, stageID, operationID, 3); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation not retained: %v", err)
	}
}
