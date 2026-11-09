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
	"sync/atomic"
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
		InstallMode: "manual",
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

func TestCurrentServerBundleRejectsUnapprovedInstallModes(t *testing.T) {
	_, fixture := bundleClientFixture(t, []byte("package"))
	if !validCurrentBundleArtifact(fixture.BuildCommit, fixture) {
		t.Fatal("known signed Windows package was rejected")
	}
	invalid := fixture
	invalid.InstallMode = "manual_test_only"
	// Testing-only is allowed as read-only Bundle metadata, but never an
	// automatic update source; see Agent independent channel admission.
	if !validCurrentBundleArtifact(invalid.BuildCommit, invalid) {
		t.Fatal("testing-only metadata should remain readable")
	}
	invalid.InstallMode = "automatic"
	if validCurrentBundleArtifact(invalid.BuildCommit, invalid) {
		t.Fatal("unknown installation mode accepted")
	}
	invalid = fixture
	invalid.Platform = "unknown"
	if validCurrentBundleArtifact(invalid.BuildCommit, invalid) {
		t.Fatal("unknown platform accepted")
	}
	invalid = fixture
	invalid.Platform = "ios"
	invalid.Filename = "xDrive-unsigned.ipa"
	invalid.Sources.GitLab = strings.Replace(fixture.Sources.GitLab, fixture.Filename, invalid.Filename, 1)
	invalid.Sources.GitHub = strings.Replace(fixture.Sources.GitHub, fixture.Filename, invalid.Filename, 1)
	invalid.DownloadURLs = []string{
		"/api/v1/release-bundles/current/artifacts/" + invalid.Filename,
		invalid.Sources.GitLab, invalid.Sources.GitHub,
	}
	if validCurrentBundleArtifact(invalid.BuildCommit, invalid) {
		t.Fatal("unsigned IPA accepted as regular installer")
	}
	invalid.InstallMode = "manual_test_only"
	if !validCurrentBundleArtifact(invalid.BuildCommit, invalid) {
		t.Fatal("unsigned IPA should be allowed for testing-only download")
	}
	invalid = fixture
	invalid.Platform = "android"
	if validCurrentBundleArtifact(invalid.BuildCommit, invalid) {
		t.Fatal("wrongly named Android APK or executable accepted")
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

func TestCurrentServerBundleGitHubAssetRedirectOnly(t *testing.T) {
	payload := bytes.Repeat([]byte("signed-release-cdn"), 41)
	for _, scenario := range []struct {
		name        string
		redirect    string
		wantSuccess bool
	}{
		{"github asset CDN", "https://release-assets.githubusercontent.com/1234/signed-asset?token=short", true},
		{"foreign CDN forbidden", "https://attacker.example/download/installer", false},
		{"http downgrade forbidden", "http://release-assets.githubusercontent.com/1234/installer", false},
		{"private link forbidden", "http://127.0.0.1/internal", false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			listing, artifact := bundleClientFixture(t, payload)
			artifact.Cached = false
			artifact.DownloadURLs = []string{artifact.Sources.GitLab, artifact.Sources.GitHub}
			listing.Artifacts = []ReleaseBundleArtifact{artifact}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer owner-test" {
					t.Error("authenticated listing missing bearer")
				}
				_ = json.NewEncoder(w).Encode(listing)
			}))
			defer server.Close()
			target := filepath.Join(t.TempDir(), artifact.Filename)
			var visited []string
			oldDefault := http.DefaultClient
			http.DefaultClient = &http.Client{Transport: releaseBundleTestTransport(
				func(req *http.Request) (*http.Response, error) {
					visited = append(visited, req.URL.String())
					if req.Header.Get("Authorization") != "" ||
						req.Header.Get("Cookie") != "" ||
						req.Header.Get("X-XDrive-Device-Token") != "" {
						t.Error("mirror request leaked private headers")
					}
					status := http.StatusOK
					body := payload
					headers := make(http.Header)
					switch req.URL.String() {
					case artifact.Sources.GitLab:
						status, body = http.StatusNotFound, nil
					case artifact.Sources.GitHub:
						status, body = http.StatusFound, nil
						headers.Set("Location", scenario.redirect)
					case scenario.redirect:
						if !scenario.wantSuccess {
							t.Error("unapproved redirect was followed")
						}
					default:
						t.Errorf("unexpected URL followed: %s", req.URL)
						return nil, context.Canceled
					}
					return &http.Response{
						StatusCode: status,
						Header:     headers,
						Body:       io.NopCloser(bytes.NewReader(body)),
						Request:    req,
					}, nil
				})}
			func() {
				defer func() { http.DefaultClient = oldDefault }()
				c := New(server.URL, "owner-test")
				err := c.DownloadCurrentReleaseArtifact(
					context.Background(), listing.Commit, artifact, target,
				)
				if scenario.wantSuccess {
					if err != nil {
						t.Fatalf("approved GitHub CDN redirect did not download: %v", err)
					}
					if bytesRead, readErr := os.ReadFile(target); readErr != nil ||
						!bytes.Equal(bytesRead, payload) {
						t.Fatalf("verified GitHub CDN did not provide exact bytes: %v", readErr)
					}
				} else if err == nil {
					t.Fatal("unapproved external redirect returned successful installer")
				}
				wantCalls := 2
				if scenario.wantSuccess {
					wantCalls = 3
				}
				if len(visited) != wantCalls {
					t.Fatalf("wrong mirror redirect path: %v", visited)
				}
			}()
		})
	}
}

func TestCurrentServerBundleMetadataCannotRedirectOwnerBearer(t *testing.T) {
	var privatePathRequested atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/release-bundles/current":
			if r.Header.Get("Authorization") != "Bearer owner-test" {
				t.Error("authenticated metadata omitted bearer")
			}
			w.Header().Set("Location", "/private-redirected-metadata")
			w.WriteHeader(http.StatusTemporaryRedirect)
		case "/private-redirected-metadata":
			privatePathRequested.Store(true)
			t.Error("metadata API followed a bearer-authenticated redirect")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	c := New(server.URL, "owner-test")
	if _, err := c.CurrentReleaseBundle(context.Background()); err == nil {
		t.Fatal("metadata redirect was incorrectly accepted")
	}
	if privatePathRequested.Load() {
		t.Fatal("metadata redirect leaked Owner request")
	}
}

func TestReleaseBundleClientRecognizesEncodedPlus(t *testing.T) {
	payload := []byte("approved signed APK")
	listing, artifact := bundleClientFixture(t, payload)
	artifact.Platform = "android"
	artifact.InstallMode = "manual"
	artifact.Filename = "xdrive-android-12-0.1.3+build.apk"
	artifact.Cached = false
	artifact.Sources.GitLab = "http://gitlab.t-fluid.com:1080/api/v4/projects/xuliang%2Fxdrive/packages/generic/xdrive-build-packages/sha-" + listing.Commit + "/xdrive-android-12-0.1.3%2Bbuild.apk"
	artifact.Sources.GitHub = "https://github.com/lazyxu/xdrive/releases/download/bundle-" + listing.Commit + "/xdrive-android-12-0.1.3%2Bbuild.apk"
	artifact.DownloadURLs = []string{artifact.Sources.GitLab, artifact.Sources.GitHub}
	if !validCurrentBundleArtifact(listing.Commit, artifact) {
		t.Fatal("client rejected immutable manifest's percent-encoded APK source")
	}
	artifact.Cached = true
	artifact.DownloadURLs = append([]string{
		"/api/v1/release-bundles/current/artifacts/xdrive-android-12-0.1.3%2Bbuild.apk",
	}, artifact.DownloadURLs...)
	if !validCurrentBundleArtifact(listing.Commit, artifact) {
		t.Fatal("client rejected correctly escaped local cached APK URL")
	}
	artifact.DownloadURLs[0] = strings.Replace(artifact.DownloadURLs[0], "%2B", "+", 1)
	if validCurrentBundleArtifact(listing.Commit, artifact) {
		t.Fatal("client admitted an unescaped alternate cached APK source")
	}
	artifact.Cached = false
	artifact.DownloadURLs = []string{
		artifact.Sources.GitLab, strings.Replace(artifact.Sources.GitHub, "%2B", "+", 1),
	}
	if validCurrentBundleArtifact(listing.Commit, artifact) {
		t.Fatal("client accepted mismatched alternate source URL")
	}
}
