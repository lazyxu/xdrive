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

func TestReleaseBundlePartialCurrentCommitCacheStatusAndFallback(t *testing.T) {
	root, body, manifest := bundleTestFixture(t)
	sha := manifest.Commit
	second := manifest.Artifacts[0]
	second.Filename = "unpublished.ipa"
	second.Size = int64(len(body) + 20)
	second.Sources.GitLab = strings.Replace(second.Sources.GitLab,
		"xDrive-unsigned.ipa", second.Filename, 1)
	second.Sources.GitHub = strings.Replace(second.Sources.GitHub,
		"xDrive-unsigned.ipa", second.Filename, 1)
	manifest.Artifacts = append(manifest.Artifacts, second)
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "manifests", sha+".json"), raw, 0644); err != nil {
		t.Fatal(err)
	}
	raw, err = json.Marshal(releaseBundleState{
		Commit: sha, State: "retry_needed",
		Artifacts: map[string]string{
			"xDrive-unsigned.ipa": "verified",
			"unpublished.ipa":     "missing_upstream",
		},
		Message: "1 verified; 1 installer package pending retry",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "status.json"), raw, 0644); err != nil {
		t.Fatal(err)
	}
	listing := readReleaseBundleListing(root)
	if listing.State != "retry_needed" || len(listing.Artifacts) != 2 ||
		!listing.Artifacts[0].Cached || listing.Artifacts[0].CacheStatus != "verified" ||
		len(listing.Artifacts[0].DownloadURLs) != 3 ||
		listing.Artifacts[1].Cached || listing.Artifacts[1].CacheStatus != "missing_upstream" ||
		len(listing.Artifacts[1].DownloadURLs) != 2 {
		t.Fatalf("partial cache incorrectly listed: %+v", listing)
	}
}

func TestReleaseBundleMissingVerifiedFileDowngradesCacheStatus(t *testing.T) {
	root, _, _ := bundleTestFixture(t)
	sha := strings.Repeat("a", 40)
	path := filepath.Join(root, "packages", sha, "xDrive-unsigned.ipa")
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	listing := readReleaseBundleListing(root)
	if len(listing.Artifacts) != 1 || listing.Artifacts[0].Cached ||
		listing.Artifacts[0].CacheStatus != "retry_needed" {
		t.Fatalf("missing package advertised as verified: %+v", listing)
	}
}

func TestReleaseBundleAuthenticatedDownloadRejectsSameSizeCorruption(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root, body, manifest := bundleTestFixture(t)
	name := manifest.Artifacts[0].Filename
	path := filepath.Join(root, "packages", manifest.Commit, name)
	mutated := bytes.Repeat([]byte{0x55}, len(body))
	if err := os.WriteFile(path, mutated, 0644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XD_RELEASE_BUNDLE_DIR", root)
	server := &Server{}
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		req := httptest.NewRequest(method, "/api/v1/release-bundles/current/artifacts/"+name, nil)
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = req
		ctx.Params = gin.Params{{Key: "name", Value: name}}
		server.releaseBundleArtifactDownload(ctx)
		if recorder.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s served corrupted same-length package: HTTP %d", method, recorder.Code)
		}
		if bytes.Equal(recorder.Body.Bytes(), mutated) {
			t.Fatalf("%s exposed corrupt installer bytes", method)
		}
	}
}

func TestReleaseBundleCurrentServerCommitFencesHistoricalCache(t *testing.T) {
	root, _, manifest := bundleTestFixture(t)
	currentServer := strings.Repeat("e", 40)
	old := readReleaseBundleListingForServerCommit(root, manifest.Commit)
	if old.State != "ready" || len(old.Artifacts) != 1 || !old.Artifacts[0].Cached {
		t.Fatalf("fixture should have valid current cache: %+v", old)
	}
	// A new binary is active but its independent Host worker has not yet
	// fetched the new manifest. Never advertise the previous Commit.
	afterUpgrade := readReleaseBundleListingForServerCommit(root, currentServer)
	if afterUpgrade.Commit != currentServer || afterUpgrade.State != "unavailable" ||
		afterUpgrade.CachedCommit != manifest.Commit || len(afterUpgrade.Artifacts) != 0 {
		t.Fatalf("previous Server installer leaked into current release: %+v", afterUpgrade)
	}
	// A failed attempt for this exact Server commit still surfaces its
	// independent retry warning without linking to old downloaded bytes.
	status, err := json.Marshal(releaseBundleState{
		Commit: currentServer, State: "retry_needed",
		Message: "Bundle fetch failed; Server is available",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "status.json"), status, 0644); err != nil {
		t.Fatal(err)
	}
	retry := readReleaseBundleListingForServerCommit(root, currentServer)
	if retry.State != "retry_needed" || retry.Commit != currentServer ||
		len(retry.Artifacts) != 0 {
		t.Fatalf("current-commit retry warning was lost or unsafe: %+v", retry)
	}
}
