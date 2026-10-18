package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

func makeLocalPushReconcileFixture(t *testing.T) (*heldOperationTestScope, string) {
	t.Helper()
	f := newHeldOperationTestScope(t)
	id := uuid.NewString()
	scope := localPushPreparedReceiptTestScope(f)
	key, err := mintLocalPushOperationRequestKey(f.configDir, scope)
	if err != nil {
		t.Fatal(err)
	}
	if err := persistLocalPushPreparedReceipt(f.configDir, scope, key,
		localPushPreparedReceiptCandidate(f, id)); err != nil {
		t.Fatal(err)
	}
	return f, id
}

func TestHeldLocalPushRestartReconcilesExactServerStateWithoutRetirement(t *testing.T) {
	for _, state := range []string{"reserved", "aborted", "expired"} {
		t.Run(state, func(t *testing.T) {
			f, operationID := makeLocalPushReconcileFixture(t)
			proof := f.proof
			calls := 0
			observe := func(_ context.Context, sourceID, revision uint64,
				gotProof client.LocalBoundSourceProof, id string, generation uint64,
			) (client.LocalPushOperationStatus, error) {
				if !f.held || f.reads != 2 || gotProof != proof ||
					sourceID != f.source.ID || revision != f.source.Revision ||
					id != operationID || generation != 1 {
					t.Fatal("recovery observation not bound to current native held Root")
				}
				calls++
				return client.LocalPushOperationStatus{
					SourceID: sourceID, Revision: revision,
					OperationID: id, Generation: generation, State: state,
				}, nil
			}
			recovered, err := withBoundLocalPushReconciledReceipt(
				context.Background(), f.configDir, f.account, f.source.ID,
				f.request, f.session, f.bound, f.native, observe)
			if err != nil || f.reads != 3 || calls != 1 ||
				recovered.operationID != operationID ||
				recovered.generation != 1 || recovered.state != state {
				t.Fatalf("restarted owning Agent could not reobserve %s: %+v err=%v reads=%d",
					state, recovered, err, f.reads)
			}
			wire, err := json.Marshal(recovered)
			if err != nil || !bytes.Equal(wire, []byte("{}")) {
				t.Fatalf("status-only private receipt escaped JSON: %s %v", wire, err)
			}
			scope := localPushPreparedReceiptTestScope(f)
			key, err := loadLocalPushOperationRequestKey(f.configDir, scope)
			if err != nil {
				t.Fatalf("reconciliation retired original operation key: %v", err)
			}
			record, err := loadLocalPushPreparedReceipt(f.configDir, scope, key)
			if err != nil || record.operationID != operationID || record.generation != 1 {
				t.Fatalf("reconciliation removed durable correlation: %+v %v", record, err)
			}
			if _, err := mintLocalPushOperationRequestKey(f.configDir, scope); err == nil {
				t.Fatal("reconciliation allowed a new operation key without terminal receipt")
			}
		})
	}
}

func TestHeldLocalPushRestartRejectsUnsafeScopeAndForgedServerState(t *testing.T) {
	for _, scenario := range []string{
		"missing-request", "missing-receipt", "different-server-uuid",
		"different-generation", "foreign-source", "wrong-revision", "forged-state",
		"observe-failed", "changed-login", "changed-root", "changed-target",
		"changed-source-revision", "wrong-native-identity", "revoked-after-observe",
		"cancel-before", "cancel-after-observe", "nil-observe",
	} {
		t.Run(scenario, func(t *testing.T) {
			f := newHeldOperationTestScope(t)
			operationID := uuid.NewString()
			observeCalls := 0
			switch scenario {
			case "missing-request":
				// Do not mint a request key. An offline receipt alone is not authority.
			case "missing-receipt":
				if _, err := mintLocalPushOperationRequestKey(
					f.configDir, localPushPreparedReceiptTestScope(f)); err != nil {
					t.Fatal(err)
				}
			default:
				scope := localPushPreparedReceiptTestScope(f)
				key, err := mintLocalPushOperationRequestKey(f.configDir, scope)
				if err != nil {
					t.Fatal(err)
				}
				if err := persistLocalPushPreparedReceipt(f.configDir, scope, key,
					localPushPreparedReceiptCandidate(f, operationID)); err != nil {
					t.Fatal(err)
				}
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			currentSession := f.session
			readBound := f.bound
			var observe localPushPrivateObserve = func(_ context.Context, id, revision uint64,
				proof client.LocalBoundSourceProof, gotID string, generation uint64,
			) (client.LocalPushOperationStatus, error) {
				if !f.held || f.reads != 2 {
					t.Fatal("recovery HTTP was not inside held native callback")
				}
				observeCalls++
				status := client.LocalPushOperationStatus{
					SourceID: id, Revision: revision, OperationID: gotID,
					Generation: generation, State: "reserved",
				}
				switch scenario {
				case "different-server-uuid":
					status.OperationID = uuid.NewString()
				case "different-generation":
					status.Generation++
				case "foreign-source":
					status.SourceID++
				case "wrong-revision":
					status.Revision++
				case "forged-state":
					status.State = "committed"
				case "observe-failed":
					return client.LocalPushOperationStatus{}, errors.New("private absolute path leaked")
				case "revoked-after-observe":
					f.proof.DeviceToken = ""
				case "cancel-after-observe":
					cancel()
				}
				return status, nil
			}
			switch scenario {
			case "changed-login":
				currentSession = func() (userconfig.Config, error) {
					out := f.account
					out.SessionID = uuid.NewString()
					return out, nil
				}
			case "changed-root":
				f.proof.RootID = uuid.NewString()
			case "changed-source-revision":
				f.source.Revision++
			case "changed-target":
				readBound = func(checkCtx context.Context, id uint64) (
					client.Source, client.LocalBoundSourceProof, error,
				) {
					if f.reads == 1 {
						nextTarget := uint64(922)
						f.source.TargetNodeID = &nextTarget
					}
					return f.bound(checkCtx, id)
				}
			case "wrong-native-identity":
				f.observed.NativeIdentityKey = strings.Repeat("a", 64)
			case "cancel-before":
				cancel()
			case "nil-observe":
				observe = nil
			}
			received, err := withBoundLocalPushReconciledReceipt(
				ctx, f.configDir, f.account, f.source.ID, f.request,
				currentSession, readBound, f.native, observe)
			if err == nil || received != (localPushPrivateReconciledReceipt{}) ||
				strings.Contains(err.Error(), "private absolute path") {
				t.Fatalf("%s returned unsafe/positive recovery: %+v %v", scenario, received, err)
			}
			if (scenario == "missing-request" || scenario == "missing-receipt" ||
				scenario == "changed-login" || scenario == "nil-observe" ||
				scenario == "cancel-before") && observeCalls != 0 {
				t.Fatalf("%s sent unauthorized HTTP observation", scenario)
			}
		})
	}
}

func TestHeldLocalPushRestartUsesRealAgentGoClientStatusHTTP(t *testing.T) {
	f, operationID := makeLocalPushReconcileFixture(t)
	proof := f.proof
	sourceID, revision := f.source.ID, f.source.Revision
	var calls atomic.Int32
	var state atomic.Value
	state.Store("reserved")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost ||
			r.URL.Path != fmt.Sprintf("/api/v1/sources/%d/local-operation/observe", sourceID) ||
			r.URL.RawQuery != "" || r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("If-Match") != strconv.Quote(strconv.FormatUint(revision, 10)) ||
			r.Header.Get("Content-Type") != "application/json" ||
			r.Header.Get("X-XDrive-Device-ID") != proof.DeviceID ||
			r.Header.Get("X-XDrive-Device-Token") != proof.DeviceToken ||
			r.Header.Get("X-XDrive-Local-Root-ID") != proof.RootID ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != proof.RootFingerprint {
			t.Error("current owning device, Root or revision proof missing")
		}
		var body struct {
			OperationID string `json:"operation_id"`
			Generation  uint64 `json:"generation"`
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil ||
			body.OperationID != operationID || body.Generation != 1 {
			t.Errorf("recovery changed persisted operation UUID/generation: %+v %v", body, err)
		}
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"source_id": sourceID, "revision": revision,
			"operation_id": operationID, "generation": 1,
			"state":            state.Load().(string),
			"commit_supported": false, "backup_complete": false,
			"authoritative": false, "missing_inference_safe": false,
		})
	}))
	defer server.Close()
	cli := client.New(server.URL, "owner")
	observe := func(ctx context.Context, id, revision uint64,
		gotProof client.LocalBoundSourceProof, op string, generation uint64,
	) (client.LocalPushOperationStatus, error) {
		if !f.held || f.reads != 2 {
			t.Fatal("real HTTP Go Client invoked after native handle was closed")
		}
		return cli.ObserveLocalPushOperation(ctx, id, revision, gotProof, op, generation)
	}
	for i, expected := range []string{"reserved", "expired"} {
		state.Store(expected)
		f.reads = 0
		observed, err := withBoundLocalPushReconciledReceipt(
			context.Background(), f.configDir, f.account, f.source.ID,
			f.request, f.session, f.bound, f.native, observe)
		if err != nil || observed.operationID != operationID ||
			observed.state != expected || observed.generation != 1 ||
			f.reads != 3 || calls.Load() != int32(i+1) {
			t.Fatalf("real Agent status request failed for %s: %+v %v", expected, observed, err)
		}
	}
}
