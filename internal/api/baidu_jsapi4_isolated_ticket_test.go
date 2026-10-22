package api

import (
	"net/http"
	"net/url"
	"testing"
)

func TestBaiduChildIndependentRegistrableSites(t *testing.T) {
	if !xdriveBaiduIndependentChildOrigins("https://gallery.example.net", "https://map-isolated.example.org") {
		t.Fatal("independent HTTPS registrable sites must pass")
	}
	for _, pair := range [][2]string{
		{"https://gallery.example.net", "https://map.example.net"},
		{"https://gallery.example.co.uk", "https://map.example.co.uk"},
		{"https://gallery.example.net", "https://map.example.net:8443"},
		{"https://gallery.example.net", "http://map.example.org"},
		{"https://gallery.example.net", "https://127.0.0.1"},
		{"https://gallery.example.net", "https://localhost"},
		{"https://gallery.example.net", "https://map.example.org/path"},
		{"https://gallery.example.net", "https://map.example.org?ak=abc"},
	} {
		if xdriveBaiduIndependentChildOrigins(pair[0], pair[1]) {
			t.Errorf("unsafe same-site or malformed origin admitted: %q, %q", pair[0], pair[1])
		}
	}
}

func TestBaiduChildSessionStrictHostAndOrigin(t *testing.T) {
	req := &http.Request{Method: http.MethodPost, URL: &url.URL{Path: "/_xdrive_baidu_isolated/session"},
		Header: http.Header{"Origin": []string{"https://map-isolated.example.org"}}}
	if !isolatedBaiduChildTransport(req, "https://map-isolated.example.org", http.MethodPost,
		"/_xdrive_baidu_isolated/session") {
		t.Fatal("expected exact child transport")
	}
	for _, modified := range []func(*http.Request){
		func(r *http.Request) { r.Header.Set("Origin", "https://evil.example.net") },
		func(r *http.Request) { r.Header.Add("Origin", "https://map-isolated.example.org") },
		func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "cross-site") },
		func(r *http.Request) { r.Header.Set("Proxy-Authorization", "secret") },
		func(r *http.Request) { r.URL.RawQuery = "token=x" },
		func(r *http.Request) { r.URL.Path = "/api/v1/media/private" },
		func(r *http.Request) { r.Method = "GET" },
	} {
		r := req.Clone(req.Context())
		r.URL = &url.URL{Path: "/_xdrive_baidu_isolated/session"}
		r.Header = req.Header.Clone()
		modified(r)
		if isolatedBaiduChildTransport(r, "https://map-isolated.example.org",
			http.MethodPost, "/_xdrive_baidu_isolated/session") {
			t.Errorf("unsafe child bootstrap accepted: %s", r.URL.String())
		}
	}
}
