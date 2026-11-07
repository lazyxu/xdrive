package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

type contentIPCFixture struct {
	*fakeDesktopIPCController
	calls int
	input client.MediaContentRequest
}

func (c *contentIPCFixture) CloudMediaContent(ctx context.Context, input client.MediaContentRequest) (json.RawMessage, error) {
	c.calls++
	c.input = input
	return json.RawMessage(`{"content_key":"` + input.ContentKey + `","items":[],"next_cursor":50}`), ctx.Err()
}
func TestDesktopIPCMediaContentAuthenticationAndClosedOperation(t *testing.T) {
	ctrl := &contentIPCFixture{fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1}}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})
	key := "sha256:" + strings.Repeat("a", 64)
	body := `{"operation":"sources","content_key":"` + key + `","cursor":50}`
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/v1/media/content", strings.NewReader(body))
	request.RemoteAddr = "127.0.0.1:1234"
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || ctrl.calls != 0 {
		t.Fatalf("unauthenticated content access %d", response.Code)
	}
	response = desktopIPCRequest(t, handler, http.MethodPost, "/v1/media/content", body)
	if response.Code != http.StatusOK || ctrl.calls != 1 || ctrl.input.ContentKey != key || ctrl.input.Cursor != 50 || !strings.Contains(response.Body.String(), `"next_cursor":50`) {
		t.Fatalf("wrong content forwarding %d %s", response.Code, response.Body.String())
	}
	for _, bad := range []string{
		`{"operation":"DELETE","content_key":"` + key + `"}`,
		`{"operation":"get","content_key":"../../admin/users"}`,
		`{"operation":"sources","content_key":"` + key + `","cursor":"50"}`,
	} {
		response = desktopIPCRequest(t, handler, http.MethodPost, "/v1/media/content", bad)
		if response.Code != http.StatusBadRequest || ctrl.calls != 1 {
			t.Fatalf("invalid proxy operation reached controller %d", response.Code)
		}
	}
}
