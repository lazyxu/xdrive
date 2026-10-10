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

type verifiedDeviceIdentityController struct {
	*fakeDesktopIPCController
	identity client.VerifiedLocalDevice
	reads    int
}

func (c *verifiedDeviceIdentityController) CloudVerifiedLocalDevice(context.Context) (client.VerifiedLocalDevice, error) {
	c.reads++
	return c.identity, c.err
}

func TestDesktopDeviceBackupLocalIdentityIsReadOnlyAndTokenFree(t *testing.T) {
	ctrl := &verifiedDeviceIdentityController{
		fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1},
		identity:                 client.VerifiedLocalDevice{DeviceID: "verified-device-A"},
	}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})
	hello := desktopIPCRequest(t, handler, http.MethodGet, "/v1/hello", "")
	if !strings.Contains(hello.Body.String(), "device-backup-local-device") {
		t.Fatal("Agent must advertise device backup local identity capability")
	}
	response := desktopIPCRequest(t, handler, http.MethodGet, "/v1/device-backups/local-device", "")
	if response.Code != http.StatusOK || ctrl.reads != 1 {
		t.Fatalf("safe local identity read status=%d count=%d body=%s", response.Code, ctrl.reads, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("identity must not be cached: %s", response.Header().Get("Cache-Control"))
	}
	var identity client.VerifiedLocalDevice
	if err := json.Unmarshal(response.Body.Bytes(), &identity); err != nil {
		t.Fatal(err)
	}
	if identity.DeviceID != "verified-device-A" {
		t.Fatalf("wrong verified ID: %+v", identity)
	}
	for _, forbidden := range []string{"device_token", "root_id", "root_fingerprint", "secret"} {
		if strings.Contains(response.Body.String(), forbidden) {
			t.Fatalf("identity response contains %q", forbidden)
		}
	}
	anonymous := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/v1/device-backups/local-device", nil)
	anonymous.RemoteAddr = "127.0.0.1:43210"
	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, anonymous)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous identity lookup was allowed: %d", unauthorized.Code)
	}
	response = desktopIPCRequest(t, handler, http.MethodPost, "/v1/device-backups/local-device", "{}")
	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("local identity must not support mutations: %d", response.Code)
	}
}

func TestDesktopDeviceBackupLocalIdentityCannotFallBackToUnverifiedController(t *testing.T) {
	handler := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1}, "secret", func() {})
	response := desktopIPCRequest(t, handler, http.MethodGet, "/v1/device-backups/local-device", "")
	if response.Code != http.StatusNotImplemented {
		t.Fatalf("unavailable verified local identity must fail closed: %d", response.Code)
	}
}
