package update

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNormalizeSource(t *testing.T) {
	for input, want := range map[string]string{
		"":         SourceGitHub,
		"github":   SourceGitHub,
		" GitLab ": SourceGitLab,
	} {
		got, err := NormalizeSource(input)
		if err != nil {
			t.Fatalf("NormalizeSource(%q): %v", input, err)
		}
		if got != want {
			t.Fatalf("NormalizeSource(%q)=%q want %q", input, got, want)
		}
	}
	if _, err := NormalizeSource("mirror"); err == nil {
		t.Fatal("expected invalid source error")
	}
}

func TestGitLabSourceStableAndMasterAreSeparated(t *testing.T) {
	const full = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "/api/v4/projects/xuliang%2Fxdrive/releases") &&
			!strings.Contains(r.RequestURI, "/api/v4/projects/xuliang%2Fxdrive/releases") {
			http.NotFound(w, r)
			return
		}
		releases := []map[string]any{
			gitLabTestRelease("snapshot-aaaaaaaaaaaa", "2026-09-27T12:00:00Z", full, server.URL),
			gitLabTestRelease("v1.2.0", "2026-09-26T12:00:00Z", full, server.URL),
			gitLabTestRelease("v1.10.0", "2026-09-25T12:00:00Z", full, server.URL),
		}
		_ = json.NewEncoder(w).Encode(releases)
	}))
	defer server.Close()

	t.Setenv("XD_UPDATE_GITLAB_BASE_URL", server.URL)
	t.Setenv("XD_UPDATE_GITLAB_PROJECT", "xuliang/xdrive")

	stable, err := CheckAssetTargetFromSource(context.Background(), "v1.2.0", "pkg.bin", ChannelStable, "", SourceGitLab)
	if err != nil {
		t.Fatal(err)
	}
	if stable.Latest != "v1.10.0" || !stable.UpdateAvailable {
		t.Fatalf("stable=%+v", stable)
	}
	if stable.Asset.URL != server.URL+"/assets/pkg.bin" {
		t.Fatalf("stable asset URL=%q", stable.Asset.URL)
	}

	master, err := CheckAssetTargetFromSource(context.Background(), "snapshot-bbbbbbbbbbbb", "pkg.bin", ChannelMaster, "", SourceGitLab)
	if err != nil {
		t.Fatal(err)
	}
	if master.Latest != "snapshot-aaaaaaaaaaaa" || master.Commit != full || !master.UpdateAvailable {
		t.Fatalf("master=%+v", master)
	}
}

func TestGitLabSourceCommitRequiresPublishedMatchingSnapshot(t *testing.T) {
	const full = "abcdef0123456789abcdef0123456789abcdef01"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/repository/commits/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"id": full})
		case strings.Contains(r.URL.Path, "/releases/snapshot-abcdef012345"):
			_ = json.NewEncoder(w).Encode(gitLabTestRelease("snapshot-abcdef012345", "2026-09-27T12:00:00Z", full, ""))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	t.Setenv("XD_UPDATE_GITLAB_BASE_URL", server.URL)
	t.Setenv("XD_UPDATE_GITLAB_PROJECT", "xuliang/xdrive")

	result, err := CheckAssetTargetFromSource(context.Background(), "snapshot-000000000000", "pkg.bin", ChannelCommit, "abcdef0", SourceGitLab)
	if err != nil {
		t.Fatal(err)
	}
	if result.Commit != full || result.Latest != "snapshot-abcdef012345" || !result.UpdateAvailable {
		t.Fatalf("result=%+v", result)
	}
}

func gitLabTestRelease(tag, releasedAt, commit, base string) map[string]any {
	assetBase := base
	if assetBase == "" {
		assetBase = "http://example.invalid"
	}
	return map[string]any{
		"tag_name":    tag,
		"released_at": releasedAt,
		"commit":      map[string]any{"id": commit},
		"assets": map[string]any{
			"links": []map[string]any{
				{"name": "pkg.bin", "direct_asset_url": assetBase + "/assets/pkg.bin"},
				{"name": "SHA256SUMS.txt", "direct_asset_url": assetBase + "/assets/SHA256SUMS.txt"},
			},
		},
	}
}
