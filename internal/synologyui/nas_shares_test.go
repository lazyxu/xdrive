package synologyui

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDSMNASShareInventoryScope(t *testing.T) {
	root := t.TempDir()
	volume := filepath.Join(root, "volume1")
	if err := os.Mkdir(volume, 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"photo", "homes", "@appdata", "#recycle", ".private"} {
		if err := os.Mkdir(filepath.Join(volume, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(root, "volume2"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(volume, "photo"), filepath.Join(root, "volume2", "spoof")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(volume, filepath.Join(root, "volume3")); err != nil {
		t.Fatal(err)
	}
	key := []byte(strings.Repeat("s", 32))
	read := func(cookie string) []NASShareChoice {
		t.Helper()
		items, err := enumerateNASShareChoices(context.Background(), root, key, "owner", cookie, "nas.local")
		if err != nil {
			t.Fatal(err)
		}
		return items
	}
	a := read("cookie-a")
	if len(a) != 1 || a[0].Label != "/volume1/photo" || len(a[0].SelectionID) != 64 {
		t.Fatalf("unsafe inventory: %+v", a)
	}
	if a[0].SelectionID == read("cookie-b")[0].SelectionID {
		t.Fatal("selection not session-scoped")
	}
	if a[0].SelectionID != read("cookie-a")[0].SelectionID {
		t.Fatal("same session changed identity")
	}
	if _, err := enumerateNASShareChoices(context.Background(), root, key[:1], "owner", "cookie-a", "nas.local"); err == nil {
		t.Fatal("short key accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := enumerateNASShareChoices(ctx, root, key, "owner", "cookie-a", "nas.local"); err == nil {
		t.Fatal("cancelled scan accepted")
	}
	for _, name := range []string{"homes", "@appdata", "#recycle", ".hidden", "foo/bar", "foo\\bar", "bad\nname", strings.Repeat("a", 256)} {
		if validNASShareName(name) {
			t.Errorf("unsafe name accepted: %q", name)
		}
	}
}

func TestDSMNASSharesCGIRequiresAuthorizedPrincipal(t *testing.T) {
	g, _ := newFixture(t)
	root := t.TempDir()
	volume := filepath.Join(root, "volume1")
	if err := os.Mkdir(volume, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(volume, "photos"), 0700); err != nil {
		t.Fatal(err)
	}
	g.nasShareRoot = root
	w := request(g, http.MethodGet, "/v1/nas-shares", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("NAS shares HTTP %d", w.Code)
	}
	var data map[string][]map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &data); err != nil {
		t.Fatal(err)
	}
	items := data["items"]
	if len(items) != 1 || items[0]["label"] != "/volume1/photos" || len(items[0]["selection_id"]) != 64 {
		t.Fatalf("invalid shares: %v", data)
	}
	cgiRequest := httptest.NewRequest(http.MethodGet, "https://nas.example:5001"+DSMCGIPath+"?op=nas-shares", nil)
	cgiRequest.Header.Set("Cookie", "id=dsm-session")
	cgiResponse := httptest.NewRecorder()
	CGIHandler(g).ServeHTTP(cgiResponse, cgiRequest)
	if cgiResponse.Code != http.StatusOK {
		t.Fatalf("fixed CGI route HTTP %d", cgiResponse.Code)
	}
	for _, name := range []string{"/v1/nas-shares?path=%2Fetc", "/v1/nas-shares?source_id=42"} {
		if r := request(g, http.MethodGet, name, "", ""); r.Code != http.StatusBadRequest {
			t.Fatalf("client path selector admitted: %s -> %d", name, r.Code)
		}
	}
	if r := request(g, http.MethodPost, "/v1/nas-shares", "https://nas.example:5001", getCSRF(t, g)); r.Code == http.StatusOK {
		t.Fatal("read-only endpoint admitted POST")
	}
	g.Authenticate = func(context.Context) (string, error) {
		return "foreign", nil
	}
	if r := request(g, http.MethodGet, "/v1/nas-shares", "", ""); r.Code != http.StatusForbidden {
		t.Fatalf("foreign DSM principal admitted: %d", r.Code)
	}
}
