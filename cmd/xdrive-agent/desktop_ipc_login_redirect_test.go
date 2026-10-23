package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestDesktopIPCLoginAuthRedirectIsActionableAndRedacted(t *testing.T) {
	err := fmt.Errorf("upstream secret destination: %w", client.ErrAuthRedirect)
	code, message, status, ok := classifyDesktopLoginTransportError(err)
	if !ok || code != "server_auth_redirect" || status != http.StatusBadGateway {
		t.Fatalf("code=%q status=%d classified=%v", code, status, ok)
	}
	if !strings.Contains(message, "重定向") || strings.Contains(message, "secret destination") {
		t.Fatal("unsafe or missing authentication redirect guidance")
	}
	recorder := httptest.NewRecorder()
	writeDesktopIPCLoginError(recorder, err)
	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("http status=%d", recorder.Code)
	}
	var payload map[string]string
	if decodeErr := json.Unmarshal(recorder.Body.Bytes(), &payload); decodeErr != nil {
		t.Fatal(decodeErr)
	}
	if payload["error"] != code || payload["message"] != message {
		t.Fatalf("unexpected IPC error response %#v", payload)
	}
	if strings.Contains(recorder.Body.String(), "secret destination") {
		t.Fatal("IPC leaked redirect target details")
	}
}
