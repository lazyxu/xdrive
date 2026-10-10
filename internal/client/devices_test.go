package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLocalDeviceAndBindingHTTPTransport(t *testing.T) {
	token := "opaque-local-device-secret"
	var called []string
	tokenRead := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = append(called, r.Method+" "+r.URL.Path)
		if r.Header.Get("Authorization") != "Bearer account-token" {
			t.Errorf("account auth missing for %s", r.URL.Path)
		}
		switch r.URL.Path {
		case "/api/v1/devices":
			if r.Method == http.MethodPost {
				w.WriteHeader(http.StatusCreated)
				w.Write([]byte(`{"device":{"id":"device-1"},"device_token":"secret"}`))
			} else {
				w.Write([]byte(`{"items":[{"id":"device-1"}],"has_more":false}`))
			}
		case "/api/v1/devices/device-1/revoke":
			w.WriteHeader(http.StatusNoContent)
		case "/api/v1/sources/42/local-binding":
			switch r.Method {
			case http.MethodPost:
				if r.Header.Get("If-Match") != `"7"` || r.Header.Get("X-XDrive-Device-Token") != token {
					t.Error("missing revision or device credential")
				}
				var body BindLocalSourceInput
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.RootID != "root-id" {
					t.Errorf("incorrect Root body: %+v, %v", body, err)
				}
				w.WriteHeader(http.StatusCreated)
				w.Write([]byte(`{"source_id":42,"device_id":"device-1","root_id":"root-id","status":"awaiting_executor"}`))
			case http.MethodGet:
				if r.Header.Get("X-XDrive-Device-Token") == token {
					tokenRead = true
				}
				w.Write([]byte(`{"source_id":42,"device_id":"device-1","root_id":"root-id","status":"awaiting_executor"}`))
			case http.MethodDelete:
				if r.Header.Get("If-Match") != `"8"` {
					t.Error("unbind requires Source revision")
				}
				w.WriteHeader(http.StatusNoContent)
			}
		default:
			t.Errorf("unexpected endpoint: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	c := New(server.URL, "account-token")
	ctx := context.Background()
	device, err := c.RegisterClientDevice(ctx, "PC", "windows", "1.0")
	if err != nil || device.Device.ID != "device-1" || device.DeviceToken != "secret" {
		t.Fatalf("register: %+v %v", device, err)
	}
	page, err := c.ClientDevices(ctx)
	if err != nil || len(page.Items) != 1 || page.HasMore {
		t.Fatalf("list: %+v %v", page, err)
	}
	binding, err := c.BindLocalSource(ctx, 42, 7, token, BindLocalSourceInput{
		DeviceID: "device-1", RootID: "root-id", RootFingerprint: strings.Repeat("f", 64),
	})
	if err != nil || binding.Status != "awaiting_executor" {
		t.Fatalf("bind: %+v %v", binding, err)
	}
	if _, err := c.LocalSourceBinding(ctx, 42); err != nil {
		t.Fatal(err)
	}
	if _, err := c.LocalSourceBindingWithToken(ctx, 42, token); err != nil || !tokenRead {
		t.Fatalf("bound Root recovery must send owning device token: %v", err)
	}
	if err := c.UnbindLocalSource(ctx, 42, 8); err != nil {
		t.Fatal(err)
	}
	if err := c.RevokeClientDevice(ctx, "device-1"); err != nil {
		t.Fatal(err)
	}
	if len(called) != 7 {
		t.Fatalf("expected seven device/root requests, got %d", len(called))
	}
}
