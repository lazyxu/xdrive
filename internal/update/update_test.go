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

func TestVersionChannels(t *testing.T) {
	for _, v := range []string{"v0.1.0", "v12.3.4"} {
		if !IsReleaseVersion(v) {
			t.Fatalf("%q should be a release version", v)
		}
		if got := DefaultChannel(v); got != ChannelStable {
			t.Fatalf("DefaultChannel(%q)=%q", v, got)
		}
	}
	for _, v := range []string{"snapshot-abcdef0", "snapshot-0123456789abcdef"} {
		if !IsSnapshotVersion(v) {
			t.Fatalf("%q should be a snapshot version", v)
		}
		if got := DefaultChannel(v); got != ChannelMaster {
			t.Fatalf("DefaultChannel(%q)=%q", v, got)
		}
	}
	for _, v := range []string{"dev", "0.1.0", "v1.2", "snapshot-nope"} {
		if got := DefaultChannel(v); got != "" {
			t.Fatalf("DefaultChannel(%q)=%q want empty", v, got)
		}
	}
	if got, err := NormalizeChannel("snapshot"); err != nil || got != ChannelMaster {
		t.Fatalf("snapshot alias got=%q err=%v", got, err)
	}
	if _, err := NormalizeChannel("nightly"); err == nil {
		t.Fatal("invalid channel accepted")
	}
}

func TestCheckStableAndDownloadVerified(t *testing.T) {
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
		_, _ = w.Write([]byte(checksum + "  " + assetName + "
"))
	})
	server = httptest.NewServer(mux)
	defer server.Close()

	checker := Checker{Repository: "lazyxu/xdrive", APIBase: server.URL, HTTP: server.Client()}
	result, err := checker.CheckChannel(context.Background(), "v0.1.0", assetName, ChannelStable)
	if err != nil {
		t.Fatal(err)
	}
	if !result.UpdateAvailable || result.Latest != "v0.2.0" || result.Channel != ChannelStable {
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

func TestCheckMasterSnapshot(t *testing.T) {
	const assetName = "xDriveSetup-amd64.exe"
	const sha = "0123456789abcdef0123456789abcdef01234567"

	var server *httptest.Server
	mux := http.NewServeMux()
	mux.HandleFunc("/repos/lazyxu/xdrive/releases/tags/snapshot", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tag_name": "snapshot",
			"assets": []map[string]string{
				{"name": assetName, "browser_download_url": server.URL + "/asset"},
				{"name": "SHA256SUMS.txt", "browser_download_url": server.URL + "/sums"},
			},
		})
	})
	mux.HandleFunc("/repos/lazyxu/xdrive/git/ref/tags/snapshot", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"object": map[string]string{"sha": sha, "type": "commit"},
		})
	})
	server = httptest.NewServer(mux)
	defer server.Close()

	checker := Checker{Repository: "lazyxu/xdrive", APIBase: server.URL, HTTP: server.Client()}
	result, err := checker.CheckChannel(context.Background(), "snapshot-deadbee", assetName, ChannelMaster)
	if err != nil {
		t.Fatal(err)
	}
	if !result.UpdateAvailable || result.Latest != "snapshot-0123456" || result.Commit != sha {
		t.Fatalf("unexpected result: %+v", result)
	}

	current, err := checker.CheckChannel(context.Background(), "snapshot-0123456", assetName, ChannelMaster)
	if err != nil {
		t.Fatal(err)
	}
	if current.UpdateAvailable {
		t.Fatalf("same snapshot reported update: %+v", current)
	}

	dev, err := checker.CheckChannel(context.Background(), "dev", assetName, ChannelMaster)
	if err != nil {
		t.Fatal(err)
	}
	if !dev.UpdateAvailable {
		t.Fatalf("explicit master channel should update dev builds: %+v", dev)
	}
}

func TestAutomaticChannelOverride(t *testing.T) {
	t.Setenv("XD_UPDATE_CHANNEL", "master")
	got, err := AutomaticChannel("v1.0.0")
	if err != nil || got != ChannelMaster {
		t.Fatalf("AutomaticChannel override=%q err=%v", got, err)
	}
}
