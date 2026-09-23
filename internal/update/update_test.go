package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestCompare(t *testing.T) {
	tests := []struct {
		a, b string
		want int
	}{
		{"v0.1.1", "v0.1.0", 1},
		{"v1.0.0", "v1.0.0", 0},
		{"v1.2.0", "v1.10.0", -1},
		{"v2.0.0", "v1.99.99", 1},
	}
	for _, tc := range tests {
		if got := Compare(tc.a, tc.b); got != tc.want {
			t.Fatalf("Compare(%q,%q)=%d want %d", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestIsReleaseVersion(t *testing.T) {
	for _, v := range []string{"v0.1.0", "v12.3.4"} {
		if !IsReleaseVersion(v) {
			t.Fatalf("%q should be a release version", v)
		}
	}
	for _, v := range []string{"dev", "snapshot-abcdef0", "0.1.0", "v1.2"} {
		if IsReleaseVersion(v) {
			t.Fatalf("%q should not be a release version", v)
		}
	}
}

func TestCheckAndDownloadVerified(t *testing.T) {
	payload := []byte("verified-installer")
	sum := sha256.Sum256(payload)
	checksum := hex.EncodeToString(sum[:])
	const assetName = "xDriveSetup-amd64.exe"

	var server *httptest.Server
	mux := http.NewServeMux()
	mux.HandleFunc("/repos/lazyxu/xdrive/releases/latest", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tag_name": "v0.2.0",
			"assets": []map[string]string{
				{"name": assetName, "browser_download_url": server.URL + "/asset"},
				{"name": "SHA256SUMS.txt", "browser_download_url": server.URL + "/sums"},
			},
		})
	})
	mux.HandleFunc("/asset", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(payload) })
	mux.HandleFunc("/sums", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(checksum + "  " + assetName + "\n"))
	})
	server = httptest.NewServer(mux)
	defer server.Close()

	checker := Checker{Repository: "lazyxu/xdrive", APIBase: server.URL, HTTP: server.Client()}
	result, err := checker.Check(context.Background(), "v0.1.0", assetName)
	if err != nil {
		t.Fatal(err)
	}
	if !result.UpdateAvailable || result.Latest != "v0.2.0" {
		t.Fatalf("unexpected result: %+v", result)
	}
	path, err := DownloadVerified(context.Background(), checker, result, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) {
		t.Fatalf("download=%q want=%q", got, payload)
	}
}
