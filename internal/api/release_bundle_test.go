package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func bundleTestFixture(t *testing.T) (string, []byte, releaseBundleManifest) {
	t.Helper()
	root := t.TempDir()
	sha := strings.Repeat("a", 40)
	body := bytes.Repeat([]byte("xdrive-release-test"), 20)
	digest := sha256.Sum256(body)
	manifest := releaseBundleManifest{
		SchemaVersion: 1, Commit: sha, Channel: "master",
		Artifacts: []releaseBundleArtifact{{Platform: "ios", Filename: "xDrive-unsigned.ipa",
			BuildCommit: sha, Size: int64(len(body)), SHA256: hex.EncodeToString(digest[:]),
			InstallMode: "manual"}},
	}
	manifest.Artifacts[0].Sources.GitLab = "http://gitlab.t-fluid.com:1080/api/v4/projects/xuliang%2Fxdrive/packages/generic/xdrive-build-packages/sha-" + sha + "/xDrive-unsigned.ipa"
	manifest.Artifacts[0].Sources.GitHub = "https://github.com/lazyxu/xdrive/releases/download/bundle-" + sha + "/xDrive-unsigned.ipa"
	for _, path := range []string{"manifests", "packages/" + sha} {
		if err := os.MkdirAll(filepath.Join(root, path), 0755); err != nil {
			t.Fatal(err)
		}
	}
	writeJSON := func(path string, data any) {
		raw, err := json.Marshal(data)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(root, path), raw, 0644); err != nil {
			t.Fatal(err)
		}
	}
	writeJSON("manifests/"+sha+".json", manifest)
	writeJSON("current.json", map[string]string{"commit": sha})
	writeJSON("status.json", map[string]any{"commit": sha, "state": "ready"})
	if err := os.WriteFile(filepath.Join(root, "packages", sha, "xDrive-unsigned.ipa"), body, 0644); err != nil {
		t.Fatal(err)
	}
	return root, body, manifest
}

func TestReleaseBundleListingExactCommitAndFallback(t *testing.T) {
	root, _, manifest := bundleTestFixture(t)
	listing := readReleaseBundleListing(root)
	if listing.State != "ready" || listing.Commit != manifest.Commit || len(listing.Artifacts) != 1 ||
		!listing.Artifacts[0].Cached || len(listing.Artifacts[0].DownloadURLs) != 3 {
		t.Fatalf("unexpected listing: %+v", listing)
	}
	if listing.Artifacts[0].DownloadURLs[0] != "/api/v1/release-bundles/current/artifacts/xDrive-unsigned.ipa" ||
		listing.Artifacts[0].DownloadURLs[1] != manifest.Artifacts[0].Sources.GitLab ||
		listing.Artifacts[0].DownloadURLs[2] != manifest.Artifacts[0].Sources.GitHub {
		t.Fatalf("wrong fallback order: %+v", listing.Artifacts[0].DownloadURLs)
	}
}

func TestReleaseBundleRejectsCrossCommitAndPath(t *testing.T) {
	_, _, m := bundleTestFixture(t)
	m.Artifacts[0].BuildCommit = strings.Repeat("b", 40)
	if validReleaseBundleManifest(m) {
		t.Fatal("cross commit accepted")
	}
	m.Artifacts[0].BuildCommit = m.Commit
	m.Artifacts[0].Filename = "../unsafe"
	if validReleaseBundleManifest(m) {
		t.Fatal("path traversal accepted")
	}
	m.Artifacts[0].Filename = "xDrive-unsigned.ipa"
	m.Artifacts[0].Sources.GitHub = "https://evil.example/pkg"
	if validReleaseBundleManifest(m) {
		t.Fatal("untrusted origin accepted")
	}
}

func TestReleaseBundleDownloadRanges(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root, body, _ := bundleTestFixture(t)
	t.Setenv("XD_RELEASE_BUNDLE_DIR", root)
	server := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/release-bundles/current/artifacts/xDrive-unsigned.ipa", nil)
	req.Header.Set("Range", "bytes=0-9")
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req
	ctx.Params = gin.Params{{Key: "name", Value: "xDrive-unsigned.ipa"}}
	server.releaseBundleArtifactDownload(ctx)
	if recorder.Code != http.StatusPartialContent || !bytes.Equal(recorder.Body.Bytes(), body[:10]) {
		t.Fatalf("unexpected range status=%d body=%q", recorder.Code, recorder.Body.String())
	}
}

func TestReleaseBundleUncachedDoesNotExposeStalePackages(t *testing.T) {
	root, _, _ := bundleTestFixture(t)
	if err := os.Remove(filepath.Join(root, "packages", strings.Repeat("a", 40), "xDrive-unsigned.ipa")); err != nil {
		t.Fatal(err)
	}
	listing := readReleaseBundleListing(root)
	if len(listing.Artifacts) != 1 || listing.Artifacts[0].Cached ||
		len(listing.Artifacts[0].DownloadURLs) != 2 {
		t.Fatalf("bad uncached fallback: %+v", listing)
	}
}

func TestReleaseBundleManifestFetchFailureKeepsIndependentWarning(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	commit := strings.Repeat("c", 40)
	message := "Release Bundle download or verification failed; server remains usable"
	data, err := json.Marshal(releaseBundleState{
		Commit: commit, State: "retry_needed", Message: message,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "status.json"), data, 0644); err != nil {
		t.Fatal(err)
	}
	// The remote manifest could not be fetched, so no manifest or packages
	// exist yet. This is a retryable warning, not an unavailable feature.
	listing := readReleaseBundleListing(root)
	if listing.State != "retry_needed" || listing.Commit != commit ||
		listing.Message != message || len(listing.Artifacts) != 0 {
		t.Fatalf("manifest fetch failure warning was lost: %+v", listing)
	}

	t.Setenv("XD_RELEASE_BUNDLE_DIR", root)
	server := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/release-bundles/current", nil)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req
	server.releaseBundleStatus(ctx)
	if recorder.Code != http.StatusOK {
		t.Fatalf("release warning API returned HTTP %d", recorder.Code)
	}
	var actual releaseBundleListing
	if err := json.Unmarshal(recorder.Body.Bytes(), &actual); err != nil {
		t.Fatal(err)
	}
	if actual.State != "retry_needed" || actual.Commit != commit ||
		actual.Message != message || len(actual.Artifacts) != 0 {
		t.Fatalf("release warning API hid the retryable failure: %+v", actual)
	}
}

func TestReleaseBundleMissingManifestMustNotClaimReady(t *testing.T) {
	root := t.TempDir()
	commit := strings.Repeat("d", 40)
	data, err := json.Marshal(releaseBundleState{Commit: commit, State: "ready"})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "status.json"), data, 0644); err != nil {
		t.Fatal(err)
	}
	listing := readReleaseBundleListing(root)
	if listing.State != "unavailable" || len(listing.Artifacts) != 0 {
		t.Fatalf("missing verified manifest was incorrectly marked ready: %+v", listing)
	}
}
