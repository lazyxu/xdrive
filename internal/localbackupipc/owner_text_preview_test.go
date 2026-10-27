package localbackupipc

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOwnerTextPreviewProjectionIsBounded(t *testing.T) {
	if !ValidateOwnerTextPreview(OwnerTextPreview{Text: "中文 text", Size: 1024}) {
		t.Fatal("bounded UTF-8 text preview rejected")
	}
	for _, value := range []OwnerTextPreview{
		{Text: strings.Repeat("x", maxOwnerTextPreviewBytes+1), Size: maxOwnerTextPreviewBytes + 1},
		{Text: "ok", Size: -1},
		{Text: "ok", Size: int64(MaxSafeSourceID) + 1},
		{Text: string([]byte{0xff}), Size: 1},
	} {
		if ValidateOwnerTextPreview(value) {
			t.Fatal("invalid or oversized projection accepted")
		}
	}
}

func TestOwnerTextPreviewCapabilityAndFixedServerRead(t *testing.T) {
	requests := 0
	malformed := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != http.MethodGet || r.URL.Path != "/v1/cloud/text-preview" ||
			r.URL.RawQuery != "id=42" || r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 64) {
			t.Errorf("unexpected text preview route, method or native Agent credential: %s %s", r.Method, r.URL.String())
			http.Error(w, "invalid selector", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if malformed {
			_, _ = w.Write([]byte(`{"text":"unexpected","truncated":false,"size":-1}`))
			return
		}
		_, _ = w.Write([]byte(`{"text":"hello","truncated":false,"size":5}`))
	}))
	defer server.Close()
	agent := &Client{baseURL: server.URL, token: strings.Repeat("a", 64), http: server.Client()}
	if _, err := agent.OwnerFileTextPreview(context.Background(), 42); err == nil {
		t.Fatal("Agent without text capability accessed private preview")
	}
	if requests != 0 {
		t.Fatal("missing capability still contacted Agent")
	}
	agent.capabilities = []string{"cloud-files-read", "cloud-file-text-preview"}
	for _, badID := range []uint64{0, MaxSafeSourceID + 1} {
		if _, err := agent.OwnerFileTextPreview(context.Background(), badID); err == nil {
			t.Fatal("unsafe Owner preview node ID was accepted")
		}
	}
	if requests != 0 {
		t.Fatal("invalid Owner preview node ID contacted Agent")
	}
	preview, err := agent.OwnerFileTextPreview(context.Background(), 42)
	if err != nil || preview.Text != "hello" || preview.Size != 5 || preview.Truncated {
		t.Fatalf("valid Owner preview failed: %+v %v", preview, err)
	}
	malformed = true
	if _, err := agent.OwnerFileTextPreview(context.Background(), 42); err == nil {
		t.Fatal("unsafe Server preview crossed DSM projection")
	}
	if requests != 2 {
		t.Fatalf("unexpected Agent preview read count: %d", requests)
	}
}
