package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

func sampleHeldPreparedStatus(f *heldOperationTestScope, id string) client.LocalPushPreparedOperation {
	return client.LocalPushPreparedOperation{
		SourceID: f.source.ID, Revision: f.source.Revision,
		OperationID: id, Generation: 1, State: "reserved",
	}
}

func sampleHeldPreparedObservation(f *heldOperationTestScope, id string) client.LocalPushOperationStatus {
	return client.LocalPushOperationStatus{
		SourceID: f.source.ID, Revision: f.source.Revision,
		OperationID: id, Generation: 1, State: "reserved",
	}
}

func TestHeldPrivateOperationPrepareObserveExactRecovery(t *testing.T) {
	f := newHeldOperationTestScope(t)
	id := uuid.NewString()
	var originalKey [32]byte
	prepareCalls, observeCalls := 0, 0
	prepare := func(_ context.Context, sourceID, revision uint64, proof client.LocalBoundSourceProof,
		key [32]byte,
	) (client.LocalPushPreparedOperation, error) {
		if !f.held || f.reads != 2 || sourceID != f.source.ID ||
			revision != f.source.Revision || proof != f.proof || key == [32]byte{} {
			t.Fatal("prepare was not inside the authenticated native held window")
		}
		if prepareCalls == 0 {
			originalKey = key
		} else if key != originalKey {
			t.Fatal("retry replaced the private idempotency key")
		}
		prepareCalls++
		return sampleHeldPreparedStatus(f, id), nil
	}
	observe := func(_ context.Context, sourceID, revision uint64, proof client.LocalBoundSourceProof,
		operationID string, generation uint64,
	) (client.LocalPushOperationStatus, error) {
		if !f.held || f.reads != 2 || proof != f.proof ||
			sourceID != f.source.ID || revision != f.source.Revision ||
			operationID != id || generation != 1 {
			t.Fatal("observe escaped native window or changed operation identity")
		}
		observeCalls++
		return sampleHeldPreparedObservation(f, id), nil
	}
	first, err := withBoundLocalPushPreparedOperation(context.Background(), f.configDir,
		f.account, f.source.ID, f.request, true, f.session, f.bound, f.native, prepare, observe)
	if err != nil || first.OperationID != id || f.reads != 3 ||
		prepareCalls != 1 || observeCalls != 1 {
		t.Fatalf("held first prepare failed: %+v err=%v reads=%d calls=%d/%d",
			first, err, f.reads, prepareCalls, observeCalls)
	}
	data, err := json.Marshal(first)
	if err != nil || !bytes.Equal(data, []byte("{}")) {
		t.Fatalf("private operation escaped Agent JSON: %s %v", data, err)
	}
	f.reads = 0
	replay, err := withBoundLocalPushPreparedOperation(context.Background(), f.configDir,
		f.account, f.source.ID, f.request, false, f.session, f.bound, f.native, prepare, observe)
	if err != nil || replay != first || f.reads != 3 ||
		prepareCalls != 2 || observeCalls != 2 {
		t.Fatalf("lost-ack exact-key recovery was rejected: %+v %v", replay, err)
	}
	f.reads = 0
	if _, err := withBoundLocalPushPreparedOperation(context.Background(), f.configDir,
		f.account, f.source.ID, f.request, true, f.session, f.bound, f.native, prepare, observe); err == nil ||
		prepareCalls != 2 {
		t.Fatal("a second fresh request replaced an unresolved durable key")
	}
}

func TestHeldPrivateOperationAmbiguousPrepareAndObservedRevocationFailClosed(t *testing.T) {
	f := newHeldOperationTestScope(t)
	id := uuid.NewString()
	var submitted [32]byte
	calls := 0
	prepare := func(_ context.Context, _, _ uint64, _ client.LocalBoundSourceProof,
		key [32]byte,
	) (client.LocalPushPreparedOperation, error) {
		if !f.held || f.reads != 2 {
			t.Fatal("request left the pinned directory window")
		}
		calls++
		if calls == 1 {
			submitted = key
			// The Server may have committed the reservation before TCP failed.
			return client.LocalPushPreparedOperation{}, errors.New("raw path and token must not leak")
		}
		if submitted != key {
			t.Fatal("ambiguous prepare minted a different key")
		}
		return sampleHeldPreparedStatus(f, id), nil
	}
	observe := func(_ context.Context, _, _ uint64, _ client.LocalBoundSourceProof,
		_ string, _ uint64,
	) (client.LocalPushOperationStatus, error) {
		if calls != 2 || !f.held {
			t.Fatal("observed a request before recovery")
		}
		f.proof.DeviceToken = "" // revoke after the Server replied
		return sampleHeldPreparedObservation(f, id), nil
	}
	first, err := withBoundLocalPushPreparedOperation(context.Background(), f.configDir,
		f.account, f.source.ID, f.request, true, f.session, f.bound, f.native, prepare, observe)
	if err == nil || first != (client.LocalPushPreparedOperation{}) ||
		strings.Contains(err.Error(), "raw path") || calls != 1 {
		t.Fatalf("ambiguous response became a receipt or leaked private errors: %+v %v", first, err)
	}
	f.reads = 0
	again, err := withBoundLocalPushPreparedOperation(context.Background(), f.configDir,
		f.account, f.source.ID, f.request, false, f.session, f.bound, f.native, prepare, observe)
	if err == nil || again != (client.LocalPushPreparedOperation{}) ||
		calls != 2 || f.reads != 3 {
		t.Fatalf("revoked post-observation proof still returned an operation: %+v %v", again, err)
	}
	if _, err := loadLocalPushOperationRequestKey(f.configDir, localPushRequestKeyScope{
		server: f.account.Server, account: f.account.Username, sessionID: f.account.SessionID,
		deviceID: f.proof.DeviceID, rootID: f.proof.RootID,
		rootFingerprint: f.proof.RootFingerprint,
		sourceID:        f.source.ID, revision: f.source.Revision, targetNodeID: *f.source.TargetNodeID,
	}); err != nil {
		t.Fatalf("ambiguous operation key was removed on unauthorized reply: %v", err)
	}
}

func TestHeldPrivateOperationRejectsForgedReceiptsAndUnsafeScopes(t *testing.T) {
	for _, scenario := range []string{
		"foreign-prepared-source", "wrong-revision", "invalid-operation-id",
		"prepared-aborted", "wrong-observed-generation", "observed-expired",
		"changed-account", "changed-root", "cancel-before",
		"missing-observe", "missing-key-on-recover",
	} {
		t.Run(scenario, func(t *testing.T) {
			f := newHeldOperationTestScope(t)
			id := uuid.NewString()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			currentSession := f.session
			newRequest := true
			prepareCalls, observeCalls := 0, 0
			prepare := func(_ context.Context, _, _ uint64, _ client.LocalBoundSourceProof,
				_ [32]byte,
			) (client.LocalPushPreparedOperation, error) {
				prepareCalls++
				p := sampleHeldPreparedStatus(f, id)
				switch scenario {
				case "foreign-prepared-source":
					p.SourceID++
				case "wrong-revision":
					p.Revision++
				case "invalid-operation-id":
					p.OperationID = "not-a-uuid"
				case "prepared-aborted":
					p.State = "aborted"
				}
				return p, nil
			}
			var observe localPushPrivateObserve = func(_ context.Context, _, _ uint64,
				_ client.LocalBoundSourceProof, _ string, _ uint64,
			) (client.LocalPushOperationStatus, error) {
				observeCalls++
				status := sampleHeldPreparedObservation(f, id)
				switch scenario {
				case "wrong-observed-generation":
					status.Generation++
				case "observed-expired":
					status.State = "expired"
				}
				return status, nil
			}
			switch scenario {
			case "changed-account":
				currentSession = func() (userconfig.Config, error) {
					s := f.account
					s.Username = "other-account"
					return s, nil
				}
			case "changed-root":
				f.proof.RootID = uuid.NewString()
			case "cancel-before":
				cancel()
			case "missing-observe":
				observe = nil
			case "missing-key-on-recover":
				newRequest = false
			}
			got, err := withBoundLocalPushPreparedOperation(ctx, f.configDir, f.account,
				f.source.ID, f.request, newRequest, currentSession, f.bound, f.native, prepare, observe)
			if err == nil || got != (client.LocalPushPreparedOperation{}) {
				t.Fatalf("%s became a valid operation: %+v err=%v", scenario, got, err)
			}
			if scenario == "missing-key-on-recover" && prepareCalls != 0 {
				t.Fatal("missing local key still sent an operation")
			}
			if scenario == "missing-observe" && (prepareCalls != 0 || observeCalls != 0) {
				t.Fatal("missing observation callback still sent an operation")
			}
		})
	}
}

func TestHeldPrivateOperationUsesRealGoClientHTTPTransport(t *testing.T) {
	f := newHeldOperationTestScope(t)
	operationID := uuid.NewString()
	var firstKey string
	var keyMu sync.Mutex
	var serverRequests, observeRequests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.RawQuery != "" ||
			r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("If-Match") != strconv.Quote(strconv.FormatUint(f.source.Revision, 10)) ||
			r.Header.Get("X-XDrive-Device-ID") != f.proof.DeviceID ||
			r.Header.Get("X-XDrive-Device-Token") != f.proof.DeviceToken ||
			r.Header.Get("X-XDrive-Local-Root-ID") != f.proof.RootID ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != f.proof.RootFingerprint {
			t.Error("transport escaped authenticated native checkpoint")
		}
		defer r.Body.Close()
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("ETag", strconv.Quote(strconv.FormatUint(f.source.Revision, 10)))
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/sources/42/local-operation/prepare":
			serverRequests.Add(1)
			var body struct {
				RequestKey string `json:"request_key"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("bad private request JSON: %v", err)
			}
			decoded, err := base64.RawURLEncoding.DecodeString(body.RequestKey)
			if err != nil || len(decoded) != 32 {
				t.Error("request did not contain one OS-CSPRNG key")
			}
			keyMu.Lock()
			if firstKey != "" && firstKey != body.RequestKey {
				t.Error("lost-response retry changed private request key")
			}
			firstKey = body.RequestKey
			keyMu.Unlock()
			_, _ = w.Write([]byte(`{"source_id":42,"revision":7,"operation_id":"` +
				operationID + `","generation":1,"state":"reserved","commit_supported":false,"backup_complete":false,"authoritative":false,"missing_inference_safe":false}`))
		case "/api/v1/sources/42/local-operation/observe":
			observeRequests.Add(1)
			var body struct {
				OperationID string `json:"operation_id"`
				Generation  uint64 `json:"generation"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
				body.OperationID != operationID || body.Generation != 1 {
				t.Error("observe changed reserved identity")
			}
			_, _ = w.Write([]byte(`{"source_id":42,"revision":7,"operation_id":"` +
				operationID + `","generation":1,"state":"reserved","commit_supported":false,"backup_complete":false,"authoritative":false,"missing_inference_safe":false}`))
		default:
			t.Errorf("unexpected URL: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()
	cli := client.New(srv.URL, "owner")
	prepare := func(ctx context.Context, id, revision uint64, proof client.LocalBoundSourceProof,
		key [32]byte,
	) (client.LocalPushPreparedOperation, error) {
		if !f.held || f.reads != 2 {
			t.Fatal("prepare HTTP escaped held native callback")
		}
		return cli.PrepareLocalPushOperation(ctx, id, revision, proof, key)
	}
	observe := func(ctx context.Context, id, revision uint64, proof client.LocalBoundSourceProof,
		operationID string, generation uint64,
	) (client.LocalPushOperationStatus, error) {
		if !f.held || f.reads != 2 {
			t.Fatal("observe HTTP escaped held native callback")
		}
		return cli.ObserveLocalPushOperation(ctx, id, revision, proof, operationID, generation)
	}
	first, err := withBoundLocalPushPreparedOperation(context.Background(), f.configDir,
		f.account, f.source.ID, f.request, true, f.session, f.bound, f.native, prepare, observe)
	if err != nil || first.OperationID != operationID || f.reads != 3 ||
		serverRequests.Load() != 1 || observeRequests.Load() != 1 {
		t.Fatalf("held authenticated HTTP prepare/observe failed: %+v err=%v reads=%d",
			first, err, f.reads)
	}
	f.reads = 0
	replay, err := withBoundLocalPushPreparedOperation(context.Background(), f.configDir,
		f.account, f.source.ID, f.request, false, f.session, f.bound, f.native, prepare, observe)
	if err != nil || replay != first || serverRequests.Load() != 2 || observeRequests.Load() != 2 {
		t.Fatalf("native HTTP retry did not preserve idempotency: %+v err=%v", replay, err)
	}
}
