package client

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCurrentBundlePublisherRequiresExactTagAndAssetDigest(t *testing.T) {
	listing, item := bundleClientFixture(t, []byte("exact-current-server-package"))
	tag := "bundle-" + listing.Commit
	for _, tc := range []struct {
		name                string
		wrongRef            bool
		wrongDigest         bool
		missingFile         bool
		mutableRelease      bool
		redirect            bool
		wrongManifestDigest bool
		wrongManifestBytes  bool
		wrongManifestCommit bool
		wrongManifestMode   bool
		wrongManifestSource bool
		missingManifestItem bool
		extraReleaseAsset   bool
		redirectManifest    bool
		missingManifestID   bool
		oversizedManifest   bool
		invalidManifestJSON bool
		wantError           bool
	}{
		{name: "exact immutable verified manifest and package"},
		{name: "mutable release must fail closed", mutableRelease: true, wantError: true},
		{name: "cross commit tag", wrongRef: true, wantError: true},
		{name: "altered published package hash", wrongDigest: true, wantError: true},
		{name: "missing package", missingFile: true, wantError: true},
		{name: "metadata redirect rejected", redirect: true, wantError: true},
		{name: "manifest SHA-256 differs from Release asset metadata", wrongManifestDigest: true, wantError: true},
		{name: "manifest bytes differ after metadata check", wrongManifestBytes: true, wantError: true},
		{name: "manifest claims another source Commit", wrongManifestCommit: true, wantError: true},
		{name: "manifest install mode disagrees with authenticated Server", wrongManifestMode: true, wantError: true},
		{name: "manifest has a swapped GitHub source", wrongManifestSource: true, wantError: true},
		{name: "selected installer absent from manifest", missingManifestItem: true, wantError: true},
		{name: "extra published package absent from manifest", extraReleaseAsset: true, wantError: true},
		{name: "manifest binary endpoint redirects outside GitHub", redirectManifest: true, wantError: true},
		{name: "manifest asset ID absent", missingManifestID: true, wantError: true},
		{name: "oversized manifest metadata", oversizedManifest: true, wantError: true},
		{name: "invalid manifest JSON even with matching digest", invalidManifestJSON: true, wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			entry := map[string]any{
				"platform": item.Platform, "filename": item.Filename,
				"build_commit": listing.Commit, "size": item.Size,
				"sha256": item.SHA256, "install_mode": item.InstallMode,
				"sources": map[string]string{
					"gitlab": item.Sources.GitLab, "github": item.Sources.GitHub,
				},
			}
			manifest := map[string]any{
				"schema_version": 1, "commit": listing.Commit, "channel": "master",
				"artifacts": []any{entry},
			}
			if tc.wrongManifestCommit {
				manifest["commit"] = strings.Repeat("d", 40)
			}
			if tc.wrongManifestMode {
				entry["install_mode"] = "manual_test_only"
			}
			if tc.wrongManifestSource {
				entry["sources"] = map[string]string{
					"gitlab": item.Sources.GitLab, "github": "https://untrusted.invalid/xDriveSetup-amd64.exe",
				}
			}
			if tc.missingManifestItem {
				manifest["artifacts"] = []any{}
			}
			raw, err := json.Marshal(manifest)
			if err != nil {
				t.Fatal(err)
			}
			raw = append(raw, '\n')
			if tc.invalidManifestJSON {
				raw = []byte("{invalid manifest\n")
			}
			hash := sha256.Sum256(raw)
			manifestDigest := "sha256:" + hex.EncodeToString(hash[:])
			if tc.wrongManifestDigest {
				manifestDigest = "sha256:" + strings.Repeat("0", 64)
			}
			manifestID := int64(1234)
			if tc.missingManifestID {
				manifestID = 0
			}
			manifestSize := int64(len(raw))
			if tc.oversizedManifest {
				manifestSize = currentBundleManifestLimit + 1
			}
			manifestReads := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				if req.Header.Get("Authorization") != "" || req.Header.Get("Cookie") != "" {
					t.Error("Owner credentials leaked to public GitHub publisher")
				}
				if tc.redirect {
					http.Redirect(w, req, "https://untrusted.invalid/unsafe", http.StatusTemporaryRedirect)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				switch req.URL.Path {
				case "/repos/lazyxu/xdrive/git/ref/tags/" + tag:
					refSHA := listing.Commit
					if tc.wrongRef {
						refSHA = strings.Repeat("c", 40)
					}
					_ = json.NewEncoder(w).Encode(map[string]any{
						"ref":    "refs/tags/" + tag,
						"object": map[string]string{"type": "commit", "sha": refSHA},
					})
				case "/repos/lazyxu/xdrive/releases/tags/" + tag:
					digest := "sha256:" + item.SHA256
					if tc.wrongDigest {
						digest = "sha256:" + strings.Repeat("0", 64)
					}
					assets := []map[string]any{{
						"id": manifestID, "name": "release-bundle.json",
						"size": manifestSize, "digest": manifestDigest,
					}}
					if !tc.missingFile {
						assets = append(assets, map[string]any{
							"id": 1235, "name": item.Filename,
							"size": item.Size, "digest": digest,
						})
					}
					if tc.extraReleaseAsset {
						assets = append(assets, map[string]any{
							"id": 1236, "name": "other.exe",
							"size": 9, "digest": "sha256:" + strings.Repeat("e", 64),
						})
					}
					_ = json.NewEncoder(w).Encode(map[string]any{
						"tag_name": tag, "draft": false, "prerelease": true,
						"immutable": !tc.mutableRelease, "assets": assets,
					})
				case "/repos/lazyxu/xdrive/releases/assets/1234":
					manifestReads++
					if req.Header.Get("Accept") != "application/octet-stream" {
						t.Errorf("manifest download did not request raw asset bytes")
					}
					if tc.redirectManifest {
						http.Redirect(w, req, "https://untrusted.invalid/manifest", http.StatusFound)
						return
					}
					if tc.wrongManifestBytes {
						_, _ = w.Write([]byte("wrong manifest bytes"))
					} else {
						_, _ = w.Write(raw)
					}
				default:
					http.NotFound(w, req)
				}
			}))
			defer server.Close()
			httpClient := server.Client()
			httpClient.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			}
			err = verifyCurrentBundlePublisher(context.Background(), server.URL, httpClient, listing.Commit, item)
			if (err != nil) != tc.wantError {
				t.Fatalf("%s public Bundle verification: err=%v wantError=%t", tc.name, err, tc.wantError)
			}
			if !tc.wantError && manifestReads != 1 {
				t.Fatalf("immutable manifest bytes were not verified exactly once: reads=%d", manifestReads)
			}
		})
	}
}

func TestPublishedBundleManifestRedirectPinsOnlyPublicGitHubAssetCDN(t *testing.T) {
	via, err := http.NewRequest(http.MethodGet, "https://api.github.com/repos/lazyxu/xdrive/releases/assets/1234", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name   string
		target string
		ok     bool
	}{
		{"GitHub release asset CDN", "https://release-assets.githubusercontent.com/asset", true},
		{"GitHub object CDN", "https://objects.githubusercontent.com/asset", true},
		{"foreign host", "https://untrusted.invalid/asset", false},
		{"plain HTTP", "http://release-assets.githubusercontent.com/asset", false},
		{"credentialed URL", "https://user:password@release-assets.githubusercontent.com/asset", false},
		{"unapproved port", "https://release-assets.githubusercontent.com:8443/asset", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			next, err := http.NewRequest(http.MethodGet, tc.target, nil)
			if err != nil {
				t.Fatal(err)
			}
			next.Header.Set("Authorization", "Bearer should-not-forward")
			next.Header.Set("Cookie", "secret=should-not-forward")
			err = publishedBundleManifestRedirectAllowed("https://api.github.com", next, []*http.Request{via})
			if (err == nil) != tc.ok {
				t.Fatalf("manifest CDN redirect err=%v wantAllowed=%t", err, tc.ok)
			}
			if tc.ok && (next.Header.Get("Authorization") != "" || next.Header.Get("Cookie") != "") {
				t.Fatal("public asset CDN redirect leaked authentication headers")
			}
		})
	}
}
