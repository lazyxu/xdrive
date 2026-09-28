package update

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/version"
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
		switch {
		case strings.Contains(r.URL.Path, "/repository/commits/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"id": full})
		case strings.Contains(r.URL.Path, "/releases/snapshot"):
			_ = json.NewEncoder(w).Encode(gitLabTestRelease("snapshot", "2026-09-27T12:00:00Z", full, server.URL))
		case strings.Contains(r.URL.Path, "/releases"):
			_ = json.NewEncoder(w).Encode([]map[string]any{
				gitLabTestRelease("snapshot", "2026-09-27T12:00:00Z", full, server.URL),
				gitLabTestRelease("v1.2.0", "2026-09-26T12:00:00Z", full, server.URL),
				gitLabTestRelease("v1.10.0", "2026-09-25T12:00:00Z", full, server.URL),
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	t.Setenv("XD_UPDATE_GITLAB_BASE_URL", server.URL)
	t.Setenv("XD_UPDATE_GITLAB_PROJECT", "xuliang/xdrive")
	oldCommit := version.Commit
	t.Cleanup(func() { version.Commit = oldCommit })

	stable, err := CheckAssetTargetFromSource(context.Background(), "v1.2.0", "pkg.bin", ChannelStable, SourceGitLab)
	if err != nil {
		t.Fatal(err)
	}
	if stable.Latest != "v1.10.0" || !stable.UpdateAvailable {
		t.Fatalf("stable=%+v", stable)
	}
	if stable.PublishedAt != "2026-09-25T12:00:00Z" || stable.ReleaseName == "" || stable.ReleaseNotes == "" || stable.ReleaseURL == "" {
		t.Fatalf("stable release metadata=%+v", stable)
	}
	if stable.Asset.URL != server.URL+"/assets/pkg.bin" {
		t.Fatalf("stable asset URL=%q", stable.Asset.URL)
	}

	version.Commit = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	master, err := CheckAssetTargetFromSource(context.Background(), "snapshot", "pkg.bin", ChannelMaster, SourceGitLab)
	if err != nil {
		t.Fatal(err)
	}
	if master.Latest != "snapshot" || master.Commit != full || !master.UpdateAvailable {
		t.Fatalf("master=%+v", master)
	}
	version.Commit = full
	current, err := CheckAssetTargetFromSource(context.Background(), "snapshot", "pkg.bin", ChannelMaster, SourceGitLab)
	if err != nil {
		t.Fatal(err)
	}
	if current.UpdateAvailable {
		t.Fatalf("same snapshot reported update: %+v", current)
	}
}

func TestGitLabSourceMasterPrefersPublishedCommitMarker(t *testing.T) {
	const (
		published = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
		staleTag  = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/repository/commits/") {
			_ = json.NewEncoder(w).Encode(map[string]any{"id": published})
			return
		}
		if !strings.Contains(r.URL.Path, "/releases/snapshot") {
			http.NotFound(w, r)
			return
		}
		release := gitLabTestRelease("snapshot", "2026-09-28T12:00:00Z", staleTag, server.URL)
		release["description"] = "Rolling development snapshot. XDRIVE_RELEASE_COMMIT=" + published
		_ = json.NewEncoder(w).Encode(release)
	}))
	defer server.Close()

	t.Setenv("XD_UPDATE_GITLAB_BASE_URL", server.URL)
	t.Setenv("XD_UPDATE_GITLAB_PROJECT", "xuliang/xdrive")
	oldCommit := version.Commit
	version.Commit = staleTag
	t.Cleanup(func() { version.Commit = oldCommit })

	result, err := CheckAssetTargetFromSource(context.Background(), "snapshot", "pkg.bin", ChannelMaster, SourceGitLab)
	if err != nil {
		t.Fatal(err)
	}
	if result.Commit != published || !result.UpdateAvailable {
		t.Fatalf("master=%+v", result)
	}
}

func gitLabTestRelease(tag, releasedAt, commit, base string) map[string]any {
	assetBase := base
	if assetBase == "" {
		assetBase = "http://example.invalid"
	}
	return map[string]any{
		"tag_name":    tag,
		"name":        "xDrive " + tag,
		"description": "Release notes for " + tag,
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
