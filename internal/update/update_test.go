package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
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
		_, _ = w.Write([]byte(checksum + "  " + assetName + "\n"))
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
	if !result.UpdateAvailable || result.Latest != "snapshot-0123456789ab" || result.Commit != sha {
		t.Fatalf("unexpected result: %+v", result)
	}

	current, err := checker.CheckChannel(context.Background(), "snapshot-0123456789ab", assetName, ChannelMaster)
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

func TestValidCommitRef(t *testing.T) {
	for _, ref := range []string{"abcdef0", "0123456789ab", "0123456789abcdef0123456789abcdef01234567"} {
		if !validCommitRef(ref) {
			t.Fatalf("%q should be a valid commit ref", ref)
		}
	}
	for _, ref := range []string{"", "abc", "master", "../abcdef0", "01234g7", "0123456789abcdef0123456789abcdef012345678"} {
		if validCommitRef(ref) {
			t.Fatalf("%q should be rejected as a commit ref", ref)
		}
	}
}

func TestCheckCommitSnapshot(t *testing.T) {
	const assetName = "xDriveSetup-amd64.exe"
	const sha = "89abcdef0123456789abcdef0123456789abcdef"
	const tag = "snapshot-89abcdef0123"

	var server *httptest.Server
	mux := http.NewServeMux()
	mux.HandleFunc("/repos/lazyxu/xdrive/commits/89abcde", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"sha": sha})
	})
	mux.HandleFunc("/repos/lazyxu/xdrive/releases/tags/"+tag, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tag_name": tag,
			"assets": []map[string]string{
				{"name": assetName, "browser_download_url": server.URL + "/asset"},
				{"name": "SHA256SUMS.txt", "browser_download_url": server.URL + "/sums"},
			},
		})
	})
	mux.HandleFunc("/repos/lazyxu/xdrive/git/ref/tags/"+tag, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"object": map[string]string{"sha": sha, "type": "commit"},
		})
	})
	server = httptest.NewServer(mux)
	defer server.Close()

	checker := Checker{Repository: "lazyxu/xdrive", APIBase: server.URL, HTTP: server.Client()}
	result, err := checker.CheckTarget(context.Background(), "snapshot-deadbeef0000", assetName, ChannelCommit, "89abcde")
	if err != nil {
		t.Fatal(err)
	}
	if !result.UpdateAvailable || result.Latest != tag || result.Commit != sha || result.Channel != ChannelCommit {
		t.Fatalf("unexpected result: %+v", result)
	}

	current, err := checker.CheckTarget(context.Background(), tag, assetName, ChannelCommit, "89abcde")
	if err != nil {
		t.Fatal(err)
	}
	if current.UpdateAvailable {
		t.Fatalf("same commit reported update: %+v", current)
	}
}

func TestCommitChannelRequiresPublishedBuild(t *testing.T) {
	const sha = "fedcba9876543210fedcba9876543210fedcba98"
	mux := http.NewServeMux()
	mux.HandleFunc("/repos/lazyxu/xdrive/commits/fedcbaa", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"sha": sha})
	})
	server := httptest.NewServer(mux)
	defer server.Close()
	checker := Checker{Repository: "lazyxu/xdrive", APIBase: server.URL, HTTP: server.Client()}
	if _, err := checker.CheckTarget(context.Background(), "dev", "xDriveSetup-amd64.exe", ChannelCommit, "fedcbaa"); err == nil {
		t.Fatal("unpublished commit build was accepted")
	}
}

func TestAutomaticChannelOverride(t *testing.T) {
	t.Setenv("XD_UPDATE_CHANNEL", "commit")
	t.Setenv("XD_UPDATE_COMMIT", "89abcde")
	channel, commit, err := AutomaticTarget("v1.0.0")
	if err != nil || channel != ChannelCommit || commit != "89abcde" {
		t.Fatalf("AutomaticTarget override channel=%q commit=%q err=%v", channel, commit, err)
	}
}

func TestDownloadVerifiedUsesTransferProgressWithoutMetadataTimeout(t *testing.T) {
	payload := make([]byte, 256*1024)
	for i := range payload {
		payload[i] = byte(i)
	}
	sum := sha256.Sum256(payload)
	checksum := hex.EncodeToString(sum[:])
	const assetName = "xDriveSetup-amd64.exe"

	var server *httptest.Server
	mux := http.NewServeMux()
	mux.HandleFunc("/repos/lazyxu/xdrive/releases/latest", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tag_name": "v0.2.0",
			"assets": []map[string]string{
				{"name": assetName, "browser_download_url": server.URL + "/slow-asset"},
				{"name": "SHA256SUMS.txt", "browser_download_url": server.URL + "/sums"},
			},
		})
	})
	mux.HandleFunc("/sums", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(checksum + "  " + assetName + "\n"))
	})
	mux.HandleFunc("/slow-asset", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(payload)))
		flusher, _ := w.(http.Flusher)
		for i := 0; i < 4; i++ {
			start := i * len(payload) / 4
			end := (i + 1) * len(payload) / 4
			_, _ = w.Write(payload[start:end])
			if flusher != nil {
				flusher.Flush()
			}
			time.Sleep(25 * time.Millisecond)
		}
	})
	server = httptest.NewServer(mux)
	defer server.Close()

	httpClient := *server.Client()
	httpClient.Timeout = 40 * time.Millisecond
	checker := Checker{Repository: "lazyxu/xdrive", APIBase: server.URL, HTTP: &httpClient}
	result, err := checker.CheckChannel(context.Background(), "v0.1.0", assetName, ChannelStable)
	if err != nil {
		t.Fatal(err)
	}

	var events []ProgressEvent
	path, err := DownloadVerifiedWithProgress(context.Background(), checker, result, t.TempDir(), func(event ProgressEvent) {
		events = append(events, event)
	})
	if err != nil {
		t.Fatalf("slow installer download inherited metadata timeout: %v", err)
	}
	got, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(payload) {
		t.Fatalf("downloaded %d bytes want %d", len(got), len(payload))
	}
	foundDownload := false
	foundVerify := false
	for _, event := range events {
		if event.Step == 3 && event.Current == int64(len(payload)) {
			foundDownload = true
		}
		if event.Step == 4 && event.Message == "SHA-256 verified" {
			foundVerify = true
		}
	}
	if !foundDownload || !foundVerify {
		t.Fatalf("missing progress events: download=%v verify=%v events=%+v", foundDownload, foundVerify, events)
	}
}
