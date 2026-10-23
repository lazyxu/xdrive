package client

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
)

func commonTestProof() LocalBoundSourceProof {
	return LocalBoundSourceProof{
		DeviceID: uuid.NewString(), DeviceToken: "fixture-device-token",
		RootID: uuid.NewString(), RootFingerprint: strings.Repeat("a", 64),
	}
}

func TestLocalPushCommonPrivateTransportOwnsScopeAndStrictReplies(t *testing.T) {
	const sourceID, revision uint64 = 12, 7
	proof := commonTestProof()
	operation := uuid.NewString()
	session := uuid.NewString()
	resume := "lp2_" + strings.Repeat("b", 64)
	hash := strings.Repeat("c", 64)
	parent := uint64(42)
	input := LocalPushCommonUploadInput{
		OperationID: operation, ResumeKey: resume, SHA256: hash,
		Size: 13, ParentID: &parent, Name: "a.txt",
	}
	var mu sync.Mutex
	events := make([]string, 0, 3)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		events = append(events, r.URL.Path)
		mu.Unlock()
		if r.Method != http.MethodPost ||
			r.Header.Get("If-Match") != strconv.Quote("7") ||
			r.Header.Get("X-XDrive-Device-ID") != proof.DeviceID ||
			r.Header.Get("X-XDrive-Device-Token") != proof.DeviceToken ||
			r.Header.Get("X-XDrive-Local-Root-ID") != proof.RootID ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != proof.RootFingerprint {
			t.Errorf("unfenced private request: %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("ETag", strconv.Quote("7"))
		w.Header().Set("Content-Type", "application/json")
		result := map[string]any{
			"source_id": sourceID, "revision": revision,
			"operation_id":    operation,
			"backup_complete": false, "retirement_safe": false,
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "/admit"):
			result["state"] = "reserved"
		case strings.HasSuffix(r.URL.Path, "/bind"):
			result["state"] = "bound"
		case strings.HasSuffix(r.URL.Path, "/receipt"):
			result["state"] = "committed"
			result["committed"] = true
			result["current_cas_verified"] = false
			result["node_id"] = uint64(55)
			result["node_revision"] = uint64(1)
			result["content_sha256"] = hash
			result["size"] = int64(13)
		default:
			t.Errorf("unexpected private common upload endpoint %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(result)
	}))
	defer srv.Close()
	api := New(srv.URL, "owner-jwt")
	admit, err := api.AdmitLocalPushCommonUpload(context.Background(), sourceID, revision, proof, input)
	if err != nil || admit.State != "reserved" || admit.OperationID != operation {
		t.Fatalf("admit: %+v %v", admit, err)
	}
	bind, err := api.BindLocalPushCommonUpload(context.Background(), sourceID, revision,
		proof, operation, resume, session)
	if err != nil || bind.State != "bound" || bind.OperationID != operation {
		t.Fatalf("bind: %+v %v", bind, err)
	}
	receipt, err := api.ReadLocalPushCommonUploadReceipt(context.Background(),
		sourceID, revision, proof, operation, resume)
	if err != nil || !receipt.Committed || receipt.NodeID != 55 ||
		receipt.ContentSHA256 != hash || receipt.Size != 13 {
		t.Fatalf("original receipt: %+v %v", receipt, err)
	}
	for _, v := range []any{admit, bind, receipt} {
		raw, err := json.Marshal(v)
		if err != nil || string(raw) != "{}" {
			t.Fatalf("private data may leak through generic IPC: %s %v", raw, err)
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if len(events) != 3 || !strings.HasSuffix(events[0], "/admit") ||
		!strings.HasSuffix(events[1], "/bind") ||
		!strings.HasSuffix(events[2], "/receipt") {
		t.Fatalf("wrong operation transport sequence: %v", events)
	}
}

func TestLocalPushCommonRejectsForgedReceiptFlagsAndMutableResults(t *testing.T) {
	proof := commonTestProof()
	operation := uuid.NewString()
	resume := "lp2_" + strings.Repeat("a", 64)
	base := map[string]any{
		"source_id": uint64(5), "revision": uint64(3), "operation_id": operation,
		"state": "committed", "committed": true, "node_id": uint64(19),
		"node_revision": uint64(1), "content_sha256": strings.Repeat("b", 64),
		"size": int64(0), "backup_complete": false,
		"retirement_safe": false, "current_cas_verified": false,
	}
	cases := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{"missing negative authority", func(m map[string]any) { delete(m, "backup_complete") }},
		{"invented backup", func(m map[string]any) { m["backup_complete"] = true }},
		{"invented retirement", func(m map[string]any) { m["retirement_safe"] = true }},
		{"invented CAS", func(m map[string]any) { m["current_cas_verified"] = true }},
		{"changed operation", func(m map[string]any) { m["operation_id"] = uuid.NewString() }},
		{"changed source", func(m map[string]any) { m["source_id"] = uint64(10) }},
		{"wrong content", func(m map[string]any) { m["content_sha256"] = "invalid" }},
		{"missing commit", func(m map[string]any) { m["committed"] = false }},
		{"bad revision", func(m map[string]any) { m["node_revision"] = uint64(0) }},
		{"unknown field", func(m map[string]any) { m["attestation"] = "forged" }},
		{"premature bound", func(m map[string]any) { m["state"] = "bound" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := make(map[string]any, len(base))
			for k, v := range base {
				m[k] = v
			}
			tc.mutate(m)
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Cache-Control", "private, no-store")
				w.Header().Set("ETag", strconv.Quote("3"))
				_ = json.NewEncoder(w).Encode(m)
			}))
			defer srv.Close()
			api := New(srv.URL, "jwt")
			if _, err := api.ReadLocalPushCommonUploadReceipt(context.Background(), 5, 3, proof, operation, resume); err == nil {
				t.Fatal("malicious/mutated original receipt was accepted")
			}
		})
	}
}

func TestLocalPushCommonRejectsUnauthenticatedInputsBeforeSending(t *testing.T) {
	proof := commonTestProof()
	count := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count++
		_, _ = io.WriteString(w, "{}")
	}))
	defer srv.Close()
	api := New(srv.URL, "jwt")
	parent := uint64(1)
	input := LocalPushCommonUploadInput{OperationID: uuid.NewString(),
		ResumeKey: "lp2_" + strings.Repeat("a", 64), SHA256: strings.Repeat("b", 64),
		Size: 5, ParentID: &parent, Name: "x"}
	bad := input
	bad.Name = "../x"
	if _, err := api.AdmitLocalPushCommonUpload(context.Background(), 9, 1, proof, bad); err == nil {
		t.Fatal("absolute/traversal target was accepted")
	}
	if _, err := api.BindLocalPushCommonUpload(context.Background(), 9, 1, proof,
		input.OperationID, input.ResumeKey, "not-uuid"); err == nil {
		t.Fatal("bad upload Session ID accepted")
	}
	if _, err := api.ReadLocalPushCommonUploadReceipt(context.Background(), 9, 1, proof,
		input.OperationID, "other"); err == nil {
		t.Fatal("wrong original resume identity accepted")
	}
	if count != 0 {
		t.Fatalf("unsafe input touched network %d times", count)
	}
}
