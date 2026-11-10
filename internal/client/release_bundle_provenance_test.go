package client

import (
	"context"
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
		name        string
		wrongCommit bool
		wrongDigest bool
		missingFile bool
		mutableRelease bool
		redirect    bool
		wantError   bool
	}{
		{name: "exact verified package"},
		{name: "mutable release must fail closed", mutableRelease: true, wantError: true},
		{name: "cross commit ref", wrongCommit: true, wantError: true},
		{name: "altered asset hash", wrongDigest: true, wantError: true},
		{name: "missing package", missingFile: true, wantError: true},
		{name: "redirect rejected", redirect: true, wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
					t.Error("Owner credentials leaked to GitHub publisher")
				}
				if tc.redirect {
					http.Redirect(w, r, "https://evil.example/unsafe", http.StatusTemporaryRedirect)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/repos/lazyxu/xdrive/git/ref/tags/" + tag:
					refSHA := listing.Commit
					if tc.wrongCommit {
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
					assets := []map[string]any{{"name": "release-bundle.json", "size": 100, "digest": digest}}
					if !tc.missingFile {
						assets = append(assets, map[string]any{
							"name": item.Filename, "size": item.Size, "digest": digest,
						})
					}
					_ = json.NewEncoder(w).Encode(map[string]any{
						"tag_name": tag, "draft": false, "prerelease": true,
						"immutable": !tc.mutableRelease, "assets": assets,
					})
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			h := server.Client()
			h.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
			err := verifyCurrentBundlePublisher(context.Background(), server.URL, h, listing.Commit, item)
			if (err != nil) != tc.wantError {
				t.Fatalf("%s verification: err=%v, wantError=%t", tc.name, err, tc.wantError)
			}
		})
	}
}
