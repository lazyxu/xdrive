package client

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func bundleClientFixture(t *testing.T, payload []byte) (ReleaseBundleListing, ReleaseBundleArtifact) {
	t.Helper()
	commit := strings.Repeat("a", 40)
	hash := sha256.Sum256(payload)
	name := "xDriveSetup-amd64.exe"
	artifact := ReleaseBundleArtifact{
		Platform: "windows", Filename: name, BuildCommit: commit,
		Size: int64(len(payload)), SHA256: hex.EncodeToString(hash[:]), Cached: true,
	}
	artifact.Sources.GitLab = "http://gitlab.t-fluid.com:1080/api/v4/projects/xuliang%2Fxdrive/packages/generic/xdrive-build-packages/sha-" + commit + "/" + name
	artifact.Sources.GitHub = "https://github.com/lazyxu/xdrive/releases/download/bundle-" + commit + "/" + name
	artifact.DownloadURLs = []string{
		"/api/v1/release-bundles/current/artifacts/" + name,
		artifact.Sources.GitLab, artifact.Sources.GitHub,
	}
	return ReleaseBundleListing{State: "ready", Commit: commit, Channel: "master",
		Artifacts: []ReleaseBundleArtifact{artifact}}, artifact
}

func TestCurrentServerBundleVerifiedLocalPreferred(t *testing.T) {
	payload := bytes.Repeat([]byte("verified-release-installer"), 12)
	listing, artifact := bundleClientFixture(t, payload)
	reqs := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqs++
		if r.Header.Get("Authorization") != "Bearer owner-test" {
			http.Error(w, "missing bearer", http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/api/v1/release-bundles/current":
			_ = json.NewEncoder(w).Encode(listing)
		case "/api/v1/release-bundles/current/artifacts/xDriveSetup-amd64.exe":
			_, _ = w.Write(payload)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := New(server.URL, "owner-test")
	target := filepath.Join(t.TempDir(), artifact.Filename)
	if err := client.DownloadCurrentReleaseArtifact(context.Background(), listing.Commit, artifact, target); err != nil {
		t.Fatal(err)
	}
	received, err := os.ReadFile(target)
	if err != nil || !bytes.Equal(received, payload) || reqs != 2 {
		t.Fatalf("verified local download failed: requests=%d err=%v", reqs, err)
	}
	// Reuse exact bytes after another authenticated, current-Commit check.
	if err := client.DownloadCurrentReleaseArtifact(context.Background(), listing.Commit, artifact, target); err != nil {
		t.Fatal(err)
	}
	if reqs != 3 {
		t.Fatalf("verified local cache was unnecessarily redownloaded: %d", reqs)
	}
}

func TestCurrentServerBundleRejectsCrossCommitAndHostInjection(t *testing.T) {
	payload := []byte("exact")
	listing, artifact := bundleClientFixture(t, payload)
	if !validCurrentBundleArtifact(listing.Commit, artifact) {
		t.Fatal("canonical exact-commit Bundle was rejected")
	}
	artifact.BuildCommit = strings.Repeat("b", 40)
	if validCurrentBundleArtifact(listing.Commit, artifact) {
		t.Fatal("cross-commit package accepted")
	}
	artifact = listing.Artifacts[0]
	artifact.DownloadURLs = append([]string(nil), artifact.DownloadURLs...)
	artifact.DownloadURLs[2] = "https://attacker.example/evil.exe"
	if validCurrentBundleArtifact(listing.Commit, artifact) {
		t.Fatal("untrusted package origin accepted")
	}
	artifact = listing.Artifacts[0]
	artifact.Filename = "../escape"
	if validCurrentBundleArtifact(listing.Commit, artifact) {
		t.Fatal("path traversal accepted")
	}
}

func TestCurrentServerBundleRefusesEqualSizeInvalidHashBeforeInstallation(t *testing.T) {
	payload := []byte("good-release-installer")
	listing, artifact := bundleClientFixture(t, payload)
	target := filepath.Join(t.TempDir(), artifact.Filename)
	if err := os.WriteFile(target, bytes.Repeat([]byte{'X'}, len(payload)), 0600); err != nil {
		t.Fatal(err)
	}
	if releaseBundleFileMatches(target, artifact.Size, artifact.SHA256) {
		t.Fatal("equal-size corrupt installer accepted")
	}
	response := &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(
		bytes.NewReader(bytes.Repeat([]byte{'X'}, len(payload))))}
	if err := releaseBundleDownloadResponse(context.Background(), response, artifact.Filename,
		target, artifact.Size, artifact.SHA256); err == nil {
		t.Fatal("download of same-sized corrupted package unexpectedly succeeded")
	}
	if releaseBundleFileMatches(target, artifact.Size, artifact.SHA256) {
		t.Fatal("a failed download was published as verified")
	}
	if _, err := os.Stat(target + ".part"); !os.IsNotExist(err) {
		t.Fatalf("failed temporary package was left behind: %v", err)
	}
	_ = listing
}

type releaseBundleTestTransport func(*http.Request) (*http.Response, error)

func (rt releaseBundleTestTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return rt(req)
}

func TestCurrentServerBundleFallbackOnUnavailableLocalAndCorruptGitLab(t *testing.T) {
	payload := bytes.Repeat([]byte("signed-exact-commit-archive"), 50)
	listing, artifact := bundleClientFixture(t, payload)
	var localCalls, externalCalls int
	// A login-scoped Server may be temporarily missing the package bytes:
	// this must not change the selected full-commit package or leak its bearer.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer owner-test" {
			t.Errorf("authenticated Server request lost its Owner bearer")
		}
		switch r.URL.Path {
		case "/api/v1/release-bundles/current":
			_ = json.NewEncoder(w).Encode(listing)
		case "/api/v1/release-bundles/current/artifacts/xDriveSetup-amd64.exe":
			localCalls++
			// An authenticated 307 must never forward an Owner bearer to an
			// unlisted endpoint, even within the same Server origin.
			w.Header().Set("Location", "/untrusted-installer-redirect")
			w.WriteHeader(http.StatusTemporaryRedirect)
		case "/untrusted-installer-redirect":
			t.Error("authenticated cache request followed an unapproved redirect")
			http.Error(w, "unexpected redirect", http.StatusForbidden)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	originalDefault := http.DefaultClient
	http.DefaultClient = &http.Client{Transport: releaseBundleTestTransport(
		func(r *http.Request) (*http.Response, error) {
			externalCalls++
			if r.Header.Get("Authorization") != "" || r.Header.Get("X-XDrive-Device-Token") != "" {
				t.Error("Owner credentials leaked to public package mirror")
			}
			var body []byte
			switch {
			case r.URL.String() == artifact.Sources.GitLab:
				body = bytes.Repeat([]byte{'X'}, len(payload)) // equal size, wrong digest
			case r.URL.String() == artifact.Sources.GitHub:
				body = payload
			default:
				t.Errorf("unexpected update host: %s", r.URL)
				return nil, context.Canceled
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(bytes.NewReader(body)),
				Header:     make(http.Header),
				Request:    r,
			}, nil
		})}
	t.Cleanup(func() { http.DefaultClient = originalDefault })
	target := filepath.Join(t.TempDir(), artifact.Filename)
	c := New(server.URL, "owner-test")
	if err := c.DownloadCurrentReleaseArtifact(context.Background(), listing.Commit, artifact, target); err != nil {
		t.Fatal(err)
	}
	if localCalls != 1 || externalCalls != 2 {
		t.Fatalf("expected local then GitLab then GitHub: local=%d external=%d",
			localCalls, externalCalls)
	}
	content, err := os.ReadFile(target)
	if err != nil || !bytes.Equal(content, payload) {
		t.Fatalf("fallback output did not retain exact signed bytes: %v", err)
	}
	if _, err := os.Stat(target + ".part"); !os.IsNotExist(err) {
		t.Fatalf("corrupt GitLab partial was not discarded: %v", err)
	}
}
