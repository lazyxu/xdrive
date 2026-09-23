//go:build windows

package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAvailabilityLabel(t *testing.T) {
	tests := map[string]string{
		"syncing":      "同步中",
		"always-local": "始终保留在此设备",
		"online-only": "仅在线",
		"cloud": "云端文件（使用时下载）",
		"local": "本地可用",
	}
	for in, want := range tests {
		if got := availabilityLabel(in); got != want {
			t.Fatalf("availabilityLabel(%q)=%q want %q", in, got, want)
		}
	}
}

func TestControlAuthorizationRejectsMissingToken(t *testing.T) {
	h := &controlHandler{token: "secret"}
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/", nil)
	if h.authorized(req) {
		t.Fatal("request without session token was authorized")
	}
	req = httptest.NewRequest(http.MethodGet, "http://127.0.0.1/?token=secret", nil)
	if !h.authorized(req) {
		t.Fatal("matching session token was rejected")
	}
}
