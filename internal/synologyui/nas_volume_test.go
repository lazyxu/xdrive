package synologyui

import (
	"context"
	"encoding/json"
	"net/http"
	"runtime"
	"testing"
)

func TestDSMNASVolumeRequiresAuthorizedExactRead(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("DSM package volume only exists on Linux")
	}
	g, _ := newFixture(t)
	valid := request(g, http.MethodGet, "/v1/nas-volume", "", "")
	if valid.Code != http.StatusOK {
		t.Fatalf("authenticated volume read HTTP %d", valid.Code)
	}
	var out map[string]any
	if err := json.Unmarshal(valid.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out) != 2 {
		t.Fatalf("unexpected private DSM disk fields: %v", out)
	}
	total, okTotal := out["capacity_bytes"].(float64)
	available, okAvailable := out["available_bytes"].(float64)
	if !okTotal || !okAvailable || total <= 0 || available < 0 || available > total {
		t.Fatalf("invalid bounded package filesystem evidence: %v", out)
	}
	if valid.Header().Get("Cache-Control") != "no-store, private" {
		t.Fatal("DSM volume measurement must not be cached")
	}
	for _, url := range []string{
		"/v1/nas-volume?path=/volume1/photo",
		"/v1/nas-volume?target=server",
		"/v1/nas-volume?path=",
		"/v1/nas-volume?path=x&path=y",
	} {
		if resp := request(g, "GET", url, "", ""); resp.Code != http.StatusBadRequest {
			t.Fatalf("unexpected path selector accepted %q: HTTP %d", url, resp.Code)
		}
	}
	if resp := request(g, "POST", "/v1/nas-volume",
		"https://nas.example:5001", getCSRF(t, g)); resp.Code == http.StatusOK {
		t.Fatal("DSM disk write accepted")
	}
	g.Authenticate = func(_ context.Context) (string, error) { return "foreign", nil }
	if resp := request(g, "GET", "/v1/nas-volume", "", ""); resp.Code != http.StatusForbidden {
		t.Fatal("foreign DSM principal read package space")
	}
}
