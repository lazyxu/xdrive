package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestHeldLocalPushTerminalRechecksNativeAndRetainsOriginalKey(t *testing.T) {
	for _, state := range []string{"aborted", "expired"} {
		t.Run(state, func(t *testing.T) {
			f, operationID := makeLocalPushReconcileFixture(t)
			expected, err := loadLocalPushOperationRequestKey(f.configDir,
				localPushPreparedReceiptTestScope(f))
			if err != nil {
				t.Fatal(err)
			}
			calls := 0
			terminal := func(_ context.Context, id, revision uint64,
				proof client.LocalBoundSourceProof, key [32]byte,
				gotID string, generation uint64,
			) (client.LocalPushTerminalProof, error) {
				if !f.held || f.reads != 2 || id != f.source.ID ||
					revision != f.source.Revision || proof != f.proof ||
					key != expected.bytes || gotID != operationID || generation != 1 {
					t.Fatal("terminal proof escaped owning Root held window")
				}
				calls++
				return client.LocalPushTerminalProof{
					SourceID: id, Revision: revision, OperationID: gotID,
					Generation: generation, State: state,
					RecordedAt: time.Date(2026, 10, 18, 1, 0, 0, 0, time.UTC),
				}, nil
			}
			got, err := withBoundLocalPushHeldTerminal(
				context.Background(), f.configDir, f.account, f.source.ID,
				f.request, f.session, f.bound, f.native, terminal)
			if err != nil || f.reads != 3 || calls != 1 ||
				got.operationID != operationID || got.generation != 1 ||
				got.state != state || got.recordedAt.IsZero() {
				t.Fatalf("native held terminal was not verified: %+v %v reads=%d", got, err, f.reads)
			}
			wire, err := json.Marshal(got)
			if err != nil || !bytes.Equal(wire, []byte("{}")) {
				t.Fatalf("private native result leaked to IPC: %s %v", wire, err)
			}
			again, err := loadLocalPushOperationRequestKey(f.configDir,
				localPushPreparedReceiptTestScope(f))
			if err != nil || again != expected {
				t.Fatalf("terminal read retired or replaced original key: %v", err)
			}
			if _, err := mintLocalPushOperationRequestKey(f.configDir,
				localPushPreparedReceiptTestScope(f)); err == nil {
				t.Fatal("terminal-only proof allowed new operation key")
			}
		})
	}
}

func TestHeldLocalPushTerminalDeniesChangedScopeAndForgedReceipts(t *testing.T) {
	for _, scenario := range []string{
		"wrong-source", "wrong-generation", "wrong-state", "wrong-time",
		"request-failed", "revoked-after-http", "changed-target",
		"missing-receipt", "cancel-after-http",
	} {
		t.Run(scenario, func(t *testing.T) {
			f, _ := makeLocalPushReconcileFixture(t)
			if scenario == "missing-receipt" {
				f = newHeldOperationTestScope(t)
			}
			readBound := f.bound
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			calls := 0
			if scenario == "changed-target" {
				readBound = func(checkCtx context.Context, id uint64) (
					client.Source, client.LocalBoundSourceProof, error,
				) {
					if f.reads == 1 {
						target := uint64(922)
						f.source.TargetNodeID = &target
					}
					return f.bound(checkCtx, id)
				}
			}
			read := func(_ context.Context, id, revision uint64,
				_ client.LocalBoundSourceProof, _ [32]byte,
				gotID string, generation uint64,
			) (client.LocalPushTerminalProof, error) {
				if !f.held || f.reads != 2 {
					t.Fatal("unauthorized terminal read outside native window")
				}
				calls++
				out := client.LocalPushTerminalProof{
					SourceID: id, Revision: revision, OperationID: gotID,
					Generation: generation, State: "aborted",
					RecordedAt: time.Date(2026, 10, 18, 1, 0, 0, 0, time.UTC),
				}
				switch scenario {
				case "wrong-source":
					out.SourceID++
				case "wrong-generation":
					out.Generation++
				case "wrong-state":
					out.State = "committed"
				case "wrong-time":
					out.RecordedAt = time.Time{}
				case "request-failed":
					return client.LocalPushTerminalProof{}, errors.New("secret native Root path exposed")
				case "revoked-after-http":
					f.proof.DeviceToken = ""
				case "cancel-after-http":
					cancel()
				}
				return out, nil
			}
			got, err := withBoundLocalPushHeldTerminal(
				ctx, f.configDir, f.account, f.source.ID,
				f.request, f.session, readBound, f.native, read)
			if err == nil || got != (localPushPrivateHeldTerminal{}) ||
				strings.Contains(err.Error(), "secret native Root path") {
				t.Fatalf("%s admitted unsafe native terminal: %+v %v", scenario, got, err)
			}
			if (scenario == "missing-receipt" || scenario == "changed-target") && calls != 0 {
				t.Fatalf("%s sent terminal HTTP before complete owning checks", scenario)
			}
		})
	}
}

func TestHeldLocalPushTerminalRealGoClientHTTPAndBoundNativeRoot(t *testing.T) {
	f, operationID := makeLocalPushReconcileFixture(t)
	proof, sourceID, revision := f.proof, f.source.ID, f.source.Revision
	original, err := loadLocalPushOperationRequestKey(f.configDir,
		localPushPreparedReceiptTestScope(f))
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodPost ||
			r.URL.Path != fmt.Sprintf("/api/v1/sources/%d/local-operation/terminal-proof", sourceID) ||
			r.URL.RawQuery != "" || r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("If-Match") != strconv.Quote(strconv.FormatUint(revision, 10)) ||
			r.Header.Get("Content-Type") != "application/json" ||
			r.Header.Get("X-XDrive-Device-ID") != proof.DeviceID ||
			r.Header.Get("X-XDrive-Device-Token") != proof.DeviceToken ||
			r.Header.Get("X-XDrive-Local-Root-ID") != proof.RootID ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != proof.RootFingerprint {
			t.Error("real Go Agent terminal call lost owning-native scope")
		}
		var req struct {
			RequestKey  string `json:"request_key"`
			OperationID string `json:"operation_id"`
			Generation  uint64 `json:"generation"`
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&req); err != nil ||
			req.RequestKey != base64.RawURLEncoding.EncodeToString(original.bytes[:]) ||
			req.OperationID != operationID || req.Generation != 1 {
			t.Errorf("native Agent lost durable correlation: %+v %v", req, err)
		}
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(fmt.Sprintf(
			"{\"source_id\":%d,\"revision\":%d,\"operation_id\":%q,\"generation\":1,\"state\":\"expired\",\"recorded_at\":\"2026-10-18T01:00:00Z\",\"commit_supported\":false,\"backup_complete\":false,\"authoritative\":false,\"missing_inference_safe\":false,\"retirement_supported\":false}",
			sourceID, revision, operationID)))
	}))
	defer server.Close()
	cli := client.New(server.URL, "owner")
	read := func(ctx context.Context, id, rev uint64, p client.LocalBoundSourceProof,
		k [32]byte, op string, generation uint64,
	) (client.LocalPushTerminalProof, error) {
		if !f.held || f.reads != 2 {
			t.Fatal("real HTTP terminal request executed without native Root")
		}
		return cli.ReadLocalPushTerminalProof(ctx, id, rev, p, k, op, generation)
	}
	got, err := withBoundLocalPushHeldTerminal(
		context.Background(), f.configDir, f.account, f.source.ID,
		f.request, f.session, f.bound, f.native, read)
	if err != nil || got.state != "expired" || f.reads != 3 || calls != 1 {
		t.Fatalf("real bounded Agent HTTP terminal not verified: %+v %v reads=%d", got, err, f.reads)
	}
}
