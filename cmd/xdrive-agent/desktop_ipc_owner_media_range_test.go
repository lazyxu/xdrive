package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

type fakeOwnerMediaRangeController struct {
	*fakeDesktopIPCController
	hits    int
	corrupt bool
}

func (f *fakeOwnerMediaRangeController) CloudOwnerMediaRange(
	_ context.Context, nodeID, revision uint64, offset int64, length int,
) (client.OwnerMediaRange, error) {
	f.hits++
	if nodeID != 42 || revision != 7 || offset != 4 || length != 4 {
		return client.OwnerMediaRange{}, context.Canceled
	}
	out := client.OwnerMediaRange{
		Offset: 4, Total: 10, Revision: 7,
		SHA256: strings.Repeat("a", 64), Data: []byte("4567"),
	}
	if f.corrupt {
		out.Offset = 0
	}
	return out, nil
}

func TestBackupOnlyOwnerMediaRangeRequiresCanonicalFixedGet(t *testing.T) {
	owner := &fakeOwnerMediaRangeController{
		fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1},
	}
	backup := newDesktopIPCHandler(owner, "secret", func() {}, true)
	valid := "/v1/cloud/media-range?node_id=42&revision=7&offset=4&length=4"
	seen := false
	for _, cap := range desktopIPCCapabilitiesForRuntime(true) {
		if cap == "cloud-media-range-read" {
			seen = true
		}
		if cap == "cloud-media-stream" {
			t.Fatal("Backup-only cannot claim arbitrary media stream")
		}
	}
	if !seen || fullAgentOnlyRequest(http.MethodGet, "/v1/cloud/media-range") {
		t.Fatal("bounded Owner media range unexpectedly unavailable")
	}
	w := desktopIPCRequest(t, backup, http.MethodGet, valid, "")
	if w.Code != http.StatusOK || owner.hits != 1 {
		t.Fatalf("valid immutable range rejected: HTTP %d %s", w.Code, w.Body.String())
	}
	var got client.OwnerMediaRange
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil ||
		got.Offset != 4 || got.Total != 10 || got.Revision != 7 ||
		string(got.Data) != "4567" || len(got.SHA256) != 64 {
		t.Fatalf("unexpected Owner projection: %+v %v", got, err)
	}
	for _, query := range []string{
		"/v1/cloud/media-range",
		"/v1/cloud/media-range?node_id=42&revision=7&offset=4",
		"/v1/cloud/media-range?node_id=042&revision=7&offset=4&length=4",
		"/v1/cloud/media-range?node_id=42&revision=07&offset=4&length=4",
		"/v1/cloud/media-range?node_id=42&revision=7&offset=04&length=4",
		"/v1/cloud/media-range?node_id=42&revision=7&offset=4&length=0",
		"/v1/cloud/media-range?node_id=42&revision=7&offset=4&length=262145",
		"/v1/cloud/media-range?node_id=42&revision=7&offset=4&length=4&url=https://evil.example",
		"/v1/cloud/media-range?node_id=42&revision=7&offset=4&length=4&node_id=99",
		"/v1/cloud/media-range?node_id=42&revision=7&offset=-1&length=4",
		"/v1/cloud/media-range?node_id=9007199254740992&revision=7&offset=4&length=4",
		"/v1/cloud/media-range?node_id=42%0A&revision=7&offset=4&length=4",
		"/v1/cloud/media-range?node_id=42&revision=7&offset=4&length=4;action=delete",
	} {
		bad := desktopIPCRequest(t, backup, http.MethodGet, query, "")
		if bad.Code == http.StatusOK {
			t.Fatalf("unsafe Owner media selector accepted: %s", query)
		}
	}
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		if !fullAgentOnlyRequest(method, "/v1/cloud/media-range") {
			t.Fatalf("unexpected Backup-only media route: %s", method)
		}
		if bad := desktopIPCRequest(t, backup, method, valid, ""); bad.Code != http.StatusConflict {
			t.Fatalf("Owner media range mutation allowed: %s %d", method, bad.Code)
		}
	}
	if owner.hits != 1 {
		t.Fatal("unsafe request reached private Server media content")
	}
	owner.corrupt = true
	if bad := desktopIPCRequest(t, backup, http.MethodGet, valid, ""); bad.Code == http.StatusOK {
		t.Fatal("corrupt Owner media range projection accepted")
	}
	// Old Agent/controller lacks the explicit reader and cannot emulate bytes.
	old := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1}, "secret", func() {}, true)
	if bad := desktopIPCRequest(t, old, http.MethodGet, valid, ""); bad.Code != http.StatusNotImplemented {
		t.Fatalf("old Agent incorrectly provided Owner ranges: %d", bad.Code)
	}
}
