package client

import (
	"context"
	"net/http"
	"testing"
)

func TestRequestIncludesConfiguredDeviceIdentity(t *testing.T) {
	api := New("https://drive.example.com", "owner-access-token")
	api.SetDeviceIdentity("synology-device-id", "synology-device-secret")

	req, err := api.request(context.Background(), http.MethodPost, "/api/v1/sources", nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := req.Header.Get("Authorization"); got != "Bearer owner-access-token" {
		t.Fatalf("Authorization=%q", got)
	}
	if got := req.Header.Get("X-XDrive-Device-ID"); got != "synology-device-id" {
		t.Fatalf("device id=%q", got)
	}
	if got := req.Header.Get("X-XDrive-Device-Token"); got != "synology-device-secret" {
		t.Fatalf("device token=%q", got)
	}
}

func TestRequestOmitsDeviceIdentityUntilConfigured(t *testing.T) {
	api := New("https://drive.example.com", "owner-access-token")
	req, err := api.request(context.Background(), http.MethodGet, "/api/v1/sources", nil)
	if err != nil {
		t.Fatal(err)
	}
	if req.Header.Get("X-XDrive-Device-ID") != "" || req.Header.Get("X-XDrive-Device-Token") != "" {
		t.Fatal("unconfigured device identity was sent")
	}
}
