package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
)

type localDraftReadFake struct {
	*fakeDesktopIPCController
	page  client.LocalSourceDraftPage
	limit int
	after uint64
}

func (f *localDraftReadFake) CloudLocalSourceDrafts(_ context.Context, limit int, afterID uint64) (client.LocalSourceDraftPage, error) {
	f.limit, f.after = limit, afterID
	return f.page, f.err
}

func TestDesktopIPCLocalDraftsAreCredentialScopedAndBounded(t *testing.T) {
	fake := &localDraftReadFake{
		fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1},
		page: client.LocalSourceDraftPage{
			Items:   []client.LocalSourceDraft{{SourceID: 42, Name: "恢复草稿", Revision: 1, CreatedAt: time.Now().UTC()}},
			HasMore: true, NextAfterID: 42,
		},
	}
	handler := newDesktopIPCHandler(fake, "secret", func() {})
	res := desktopIPCRequest(t, handler, http.MethodGet, "/v1/device-backups/local-drafts?limit=7&after_id=31", "")
	if res.Code != http.StatusOK || fake.limit != 7 || fake.after != 31 {
		t.Fatalf("draft request bad status=%d limit=%d after=%d", res.Code, fake.limit, fake.after)
	}
	if res.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("private draft response must disable cache, got %q", res.Header().Get("Cache-Control"))
	}
	var page client.LocalSourceDraftPage
	if err := json.Unmarshal(res.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].SourceID != 42 || page.NextAfterID != 42 || !page.HasMore {
		t.Fatalf("unexpected narrow draft page: %+v", page)
	}
	for _, forbidden := range []string{"device_token", "root_id", "root_fingerprint", "checkpoint", "ignore_rules"} {
		if strings.Contains(res.Body.String(), forbidden) {
			t.Fatalf("local draft IPC leaked %s", forbidden)
		}
	}
	for _, path := range []string{
		"/v1/device-backups/local-drafts?limit=0",
		"/v1/device-backups/local-drafts?limit=101",
		"/v1/device-backups/local-drafts?after_id=-1",
		"/v1/device-backups/local-drafts?after_id=not-a-number",
	} {
		res = desktopIPCRequest(t, handler, http.MethodGet, path, "")
		if res.Code != http.StatusBadRequest {
			t.Fatalf("invalid local draft request %q accepted: %d", path, res.Code)
		}
	}
	anonymous := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/v1/device-backups/local-drafts", nil)
	anonymous.RemoteAddr = "127.0.0.1:43210"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, anonymous)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous draft request allowed: %d", rec.Code)
	}
	if res := desktopIPCRequest(t, handler, http.MethodPost, "/v1/device-backups/local-drafts", "{}"); res.Code != http.StatusMethodNotAllowed {
		t.Fatalf("local draft read must not support POST: %d", res.Code)
	}
}

func TestDesktopIPCLocalDraftsDoNotFallBackToGenericSourceController(t *testing.T) {
	handler := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1}, "secret", func() {})
	result := desktopIPCRequest(t, handler, http.MethodGet, "/v1/device-backups/local-drafts", "")
	if result.Code != http.StatusNotImplemented {
		t.Fatalf("safe local draft reader unavailable: %d", result.Code)
	}
}
