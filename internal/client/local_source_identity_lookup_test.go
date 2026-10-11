package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestLocalIdentityLookupUsesOnlyOwningProofAndValidatesReply(t *testing.T) {
	calls := 0
	var reply atomic.Value
	reply.Store(`{"source_id":42,"revision":7,"input_count":3,"matches":[{"index":0,"source_item_id":91},{"index":1,"source_item_id":91}],"authoritative":false,"missing_inference_safe":false}`)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/sources/42/local-identity/lookup" ||
			r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("X-XDrive-Device-ID") != "device-A" ||
			r.Header.Get("X-XDrive-Device-Token") != "OS-stored-private-device-token" ||
			r.Header.Get("X-XDrive-Local-Root-ID") != "root-A" ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != "fingerprint-A" ||
			r.Header.Get("If-Match") != "\"7\"" {
			t.Error("private identity lookup omitted owner, device/Root proof or revision")
		}
		var body struct {
			Identities []string `json:"identities"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
			len(body.Identities) != 3 || body.Identities[0] != "native-A" ||
			body.Identities[1] != "old-A" || body.Identities[2] != "unknown" {
			t.Errorf("unexpected identity lookup request: %+v err=%v", body, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(reply.Load().(string)))
	}))
	defer server.Close()
	c := New(server.URL, "owner")
	proof := LocalBoundSourceProof{
		DeviceID: "device-A", DeviceToken: "OS-stored-private-device-token",
		RootID: "root-A", RootFingerprint: "fingerprint-A",
	}
	ids := []string{"native-A", "old-A", "unknown"}
	for _, invalid := range [][]string{
		nil, {}, {"dup", "dup"}, {" space"}, {"has\ncontrol"}, {strings.Repeat("z", 513)},
	} {
		if _, err := c.LocalSourceIdentityLookup(context.Background(), 42, 7, proof, invalid); err == nil {
			t.Errorf("client dispatched invalid lookup: %v", invalid)
		}
	}
	if _, err := c.LocalSourceIdentityLookup(context.Background(), 0, 7, proof, ids); err == nil {
		t.Fatal("zero Source accepted")
	}
	if _, err := c.LocalSourceIdentityLookup(context.Background(), 42, 0, proof, ids); err == nil {
		t.Fatal("zero revision accepted")
	}
	if calls != 0 {
		t.Fatalf("invalid request contacted server %d times", calls)
	}
	got, err := c.LocalSourceIdentityLookup(context.Background(), 42, 7, proof, ids)
	if err != nil || got.SourceID != 42 || got.Revision != 7 ||
		len(got.Matches) != 2 || got.Matches[0].Index != 0 ||
		got.Matches[1].Index != 1 || got.Matches[0].SourceItemID != 91 || calls != 1 {
		t.Fatalf("private lookup failed: %+v err=%v calls=%d", got, err, calls)
	}
	for _, invalidReply := range []string{
		`{"source_id":42,"revision":8,"input_count":3}`,
		`{"source_id":42,"revision":7,"input_count":2}`,
		`{"source_id":42,"revision":7,"input_count":3,"authoritative":true}`,
		`{"source_id":42,"revision":7,"input_count":3,"missing_inference_safe":true}`,
		`{"source_id":42,"revision":7,"input_count":3,"matches":[{"index":3,"source_item_id":91}]}`,
		`{"source_id":42,"revision":7,"input_count":3,"matches":[{"index":0,"source_item_id":0}]}`,
		`{"source_id":42,"revision":7,"input_count":3,"matches":[{"index":0,"source_item_id":91},{"index":0,"source_item_id":91}]}`,
	} {
		reply.Store(invalidReply)
		if _, err := c.LocalSourceIdentityLookup(context.Background(), 42, 7, proof, ids); err == nil {
			t.Fatalf("accepted invalid identity reply: %s", invalidReply)
		}
	}
}
