package update

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
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

func TestReleaseDigestUsesAPIAssetAndSkipsChecksumManifest(t *testing.T) {
	payload := []byte("release-api-asset")
	sum := sha256.Sum256(payload)
	digest := "sha256:" + hex.EncodeToString(sum[:])
	const assetName = "xDriveSetup-amd64.exe"

	var server *httptest.Server
	var checksumHits, browserHits, apiHits int
	mux := http.NewServeMux()
	mux.HandleFunc("/repos/lazyxu/xdrive/releases/latest", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tag_name": "v0.2.0",
			"assets": []map[string]any{
				{
					"id": 42, "name": assetName, "size": len(payload), "digest": digest,
					"url":                  server.URL + "/repos/lazyxu/xdrive/releases/assets/42",
					"browser_download_url": server.URL + "/browser-asset",
				},
				{
					"id": 43, "name": "SHA256SUMS.txt", "size": 128,
					"url":                  server.URL + "/repos/lazyxu/xdrive/releases/assets/43",
					"browser_download_url": server.URL + "/sums",
				},
			},
		})
	})
	mux.HandleFunc("/repos/lazyxu/xdrive/releases/assets/42", func(w http.ResponseWriter, r *http.Request) {
		apiHits++
		if r.Header.Get("Accept") != "application/octet-stream" {
			t.Fatalf("asset API accept=%q", r.Header.Get("Accept"))
		}
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(payload)))
		_, _ = w.Write(payload)
	})
	mux.HandleFunc("/browser-asset", func(w http.ResponseWriter, r *http.Request) {
		browserHits++
		http.Error(w, "browser path should not be needed", http.StatusBadGateway)
	})
	mux.HandleFunc("/sums", func(w http.ResponseWriter, r *http.Request) {
		checksumHits++
		http.Error(w, "checksum manifest should not be needed", http.StatusBadGateway)
	})
	server = httptest.NewServer(mux)
	defer server.Close()

	checker := Checker{
		Repository: "lazyxu/xdrive", APIBase: server.URL, HTTP: server.Client(),
		RetryAttempts: 2, RetryBase: time.Millisecond,
	}
	result, err := checker.CheckChannel(context.Background(), "v0.1.0", assetName, ChannelStable)
	if err != nil {
		t.Fatal(err)
	}
	if result.Asset.Size != int64(len(payload)) || result.Asset.Digest != digest || result.Asset.ID != 42 {
		t.Fatalf("asset metadata=%+v", result.Asset)
	}
	path, err := DownloadVerifiedWithProgress(context.Background(), checker, result, t.TempDir(), nil)
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
	if apiHits != 1 || browserHits != 0 || checksumHits != 0 {
		t.Fatalf("hits api=%d browser=%d sums=%d", apiHits, browserHits, checksumHits)
	}
}

func TestDownloadVerifiedResumesPartialAsset(t *testing.T) {
	payload := []byte("0123456789abcdefghijklmnopqrstuvwxyz")
	sum := sha256.Sum256(payload)
	digest := "sha256:" + hex.EncodeToString(sum[:])
	const assetName = "xDriveSetup-amd64.exe"

	var server *httptest.Server
	var ranges []string
	mux := http.NewServeMux()
	mux.HandleFunc("/asset", func(w http.ResponseWriter, r *http.Request) {
		ranges = append(ranges, r.Header.Get("Range"))
		if r.Header.Get("Range") != "bytes=10-" {
			t.Fatalf("range=%q want bytes=10-", r.Header.Get("Range"))
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes 10-%d/%d", len(payload)-1, len(payload)))
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(payload)-10))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(payload[10:])
	})
	server = httptest.NewServer(mux)
	defer server.Close()

	dir := t.TempDir()
	part := filepath.Join(dir, assetName+".part")
	if err := os.WriteFile(part, payload[:10], 0o600); err != nil {
		t.Fatal(err)
	}

	checker := Checker{HTTP: server.Client(), RetryAttempts: 2, RetryBase: time.Millisecond}
	result := Result{
		Current: "v0.1.0", Latest: "v0.2.0", UpdateAvailable: true,
		Asset: Asset{Name: assetName, APIURL: server.URL + "/asset", Size: int64(len(payload)), Digest: digest},
	}
	path, err := DownloadVerifiedWithProgress(context.Background(), checker, result, dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) {
		t.Fatalf("resumed download=%q want=%q", got, payload)
	}
	if len(ranges) != 1 || ranges[0] != "bytes=10-" {
		t.Fatalf("ranges=%v", ranges)
	}
}

func TestUpdateMetadataRetriesTransientFailures(t *testing.T) {
	const assetName = "xDriveSetup-amd64.exe"
	payload := []byte("asset")
	sum := sha256.Sum256(payload)
	digest := "sha256:" + hex.EncodeToString(sum[:])

	var hits int
	mux := http.NewServeMux()
	mux.HandleFunc("/repos/lazyxu/xdrive/releases/latest", func(w http.ResponseWriter, r *http.Request) {
		hits++
		if hits < 3 {
			http.Error(w, "transient", http.StatusServiceUnavailable)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tag_name": "v0.2.0",
			"assets": []map[string]any{
				{"id": 1, "name": assetName, "size": len(payload), "digest": digest, "browser_download_url": "https://example.invalid/asset"},
			},
		})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	checker := Checker{
		Repository: "lazyxu/xdrive", APIBase: server.URL, HTTP: server.Client(),
		RetryAttempts: 3, RetryBase: time.Millisecond,
	}
	result, err := checker.CheckChannel(context.Background(), "v0.1.0", assetName, ChannelStable)
	if err != nil {
		t.Fatal(err)
	}
	if !result.UpdateAvailable || hits != 3 {
		t.Fatalf("result=%+v hits=%d", result, hits)
	}
}

func TestDownloadFallsBackFromAPIAssetToBrowserURL(t *testing.T) {
	payload := []byte("browser-fallback")
	sum := sha256.Sum256(payload)
	digest := "sha256:" + hex.EncodeToString(sum[:])
	const assetName = "xDriveSetup-amd64.exe"

	var apiHits, browserHits int
	mux := http.NewServeMux()
	mux.HandleFunc("/api-asset", func(w http.ResponseWriter, r *http.Request) {
		apiHits++
		http.Error(w, "temporary API asset failure", http.StatusBadGateway)
	})
	mux.HandleFunc("/browser-asset", func(w http.ResponseWriter, r *http.Request) {
		browserHits++
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(payload)))
		_, _ = w.Write(payload)
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	checker := Checker{HTTP: server.Client(), RetryAttempts: 2, RetryBase: time.Millisecond}
	result := Result{
		Current: "v0.1.0", Latest: "v0.2.0", UpdateAvailable: true,
		Asset: Asset{
			Name: assetName, ReleaseTag: "v0.2.0",
			APIURL: server.URL + "/api-asset", URL: server.URL + "/browser-asset",
			Size: int64(len(payload)), Digest: digest,
		},
	}
	path, err := DownloadVerifiedWithProgress(context.Background(), checker, result, t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) || apiHits != 1 || browserHits != 1 {
		t.Fatalf("download=%q apiHits=%d browserHits=%d", got, apiHits, browserHits)
	}
}

func TestUpdateAssetMirrorIsPreferred(t *testing.T) {
	t.Setenv("XD_UPDATE_ASSET_MIRROR", "https://mirror.example/xdrive/")
	asset := Asset{
		Name: "xDriveSetup-amd64.exe", ReleaseTag: "snapshot-abc123",
		APIURL: "https://api.github.example/asset/1",
		URL:    "https://github.example/download/asset",
	}
	sources := assetDownloadSources(asset)
	want := "https://mirror.example/xdrive/snapshot-abc123/xDriveSetup-amd64.exe"
	if len(sources) != 3 || sources[0] != want {
		t.Fatalf("sources=%v want mirror first=%q", sources, want)
	}
}

func TestCorruptCompletedPartialIsRedownloaded(t *testing.T) {
	payload := []byte("fresh-installer")
	sum := sha256.Sum256(payload)
	digest := "sha256:" + hex.EncodeToString(sum[:])
	const assetName = "xDriveSetup-amd64.exe"

	var ranges []string
	mux := http.NewServeMux()
	mux.HandleFunc("/asset", func(w http.ResponseWriter, r *http.Request) {
		ranges = append(ranges, r.Header.Get("Range"))
		if r.Header.Get("Range") != "" {
			t.Fatalf("unexpected resume for corrupt full partial: %q", r.Header.Get("Range"))
		}
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(payload)))
		_, _ = w.Write(payload)
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	dir := t.TempDir()
	part := filepath.Join(dir, assetName+".part")
	corrupt := bytes.Repeat([]byte("x"), len(payload))
	if err := os.WriteFile(part, corrupt, 0o600); err != nil {
		t.Fatal(err)
	}

	checker := Checker{HTTP: server.Client(), RetryAttempts: 2, RetryBase: time.Millisecond}
	result := Result{
		Current: "v0.1.0", Latest: "v0.2.0", UpdateAvailable: true,
		Asset: Asset{Name: assetName, APIURL: server.URL + "/asset", Size: int64(len(payload)), Digest: digest},
	}
	path, err := DownloadVerifiedWithProgress(context.Background(), checker, result, dir, nil)
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
	if len(ranges) != 1 || ranges[0] != "" {
		t.Fatalf("ranges=%v", ranges)
	}
}

func TestFormatProgressShowsCurrentAndTotal(t *testing.T) {
	got := FormatProgress(ProgressEvent{
		Step: 3, Stage: "download xDriveSetup-amd64.exe",
		Current: 2 << 20, Total: 8 << 20,
		BytesPerSecond: 512 << 10, Elapsed: 5 * time.Second,
	})
	for _, want := range []string{"2.0 MiB / 8.0 MiB", "25.0%", "512.0 KiB/s", "elapsed 5s"} {
		if !strings.Contains(got, want) {
			t.Fatalf("progress %q missing %q", got, want)
		}
	}
}

func TestProbeAssetDownloadUsesRange(t *testing.T) {
	var gotRange string
	mux := http.NewServeMux()
	mux.HandleFunc("/asset", func(w http.ResponseWriter, r *http.Request) {
		gotRange = r.Header.Get("Range")
		w.Header().Set("Content-Range", "bytes 0-0/6432558")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte{0})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	asset := Asset{
		Name:       "xDriveSetup-amd64.exe",
		ReleaseTag: "snapshot-test",
		APIURL:     server.URL + "/asset",
		Size:       6432558,
	}
	source, err := ProbeAssetDownload(context.Background(), "snapshot-deadbeef", asset)
	if err != nil {
		t.Fatal(err)
	}
	if source == "" || gotRange != "bytes=0-0" {
		t.Fatalf("source=%q range=%q", source, gotRange)
	}
}
