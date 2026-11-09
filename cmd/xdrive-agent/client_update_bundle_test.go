package main

import (
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	xupdate "github.com/lazyxu/xdrive/internal/update"
)

func TestClientUpdateOnlyPrefersExactMatchingCurrentServerCommit(t *testing.T) {
	sha := strings.Repeat("a", 40)
	digest := strings.Repeat("b", 64)
	artifact := client.ReleaseBundleArtifact{
		Platform: "windows", Filename: "xDriveSetup-amd64.exe",
		BuildCommit: sha, SHA256: digest, Size: 1234, Cached: true,
	}
	listing := client.ReleaseBundleListing{
		Commit: sha, Channel: "master",
		Artifacts: []client.ReleaseBundleArtifact{artifact},
	}
	target := xupdate.Result{
		Commit: sha, Channel: xupdate.ChannelMaster,
		UpdateAvailable: true,
		Asset:           xupdate.Asset{Name: artifact.Filename},
	}
	preferred := matchCurrentServerBundle(target, listing, "windows")
	if preferred.Bundle == nil || preferred.Bundle.Commit != sha ||
		preferred.Asset.Size != artifact.Size ||
		preferred.Asset.Digest != "sha256:"+digest {
		t.Fatalf("matching Server Bundle was not preferred: %+v", preferred)
	}
	for name, candidate := range map[string]xupdate.Result{
		"other client commit": func() xupdate.Result {
			v := target
			v.Commit = strings.Repeat("c", 40)
			return v
		}(),
		"other filename": func() xupdate.Result {
			v := target
			v.Asset.Name = "another.exe"
			return v
		}(),
		"conflicting signed digest": func() xupdate.Result {
			v := target
			v.Asset.Digest = "sha256:" + strings.Repeat("d", 64)
			return v
		}(),
	} {
		actual := matchCurrentServerBundle(candidate, listing, "windows")
		if actual.Bundle != nil || actual.Asset.Name != candidate.Asset.Name {
			t.Errorf("%s improperly substituted Server installer: %+v", name, actual)
		}
	}
	if actual := matchCurrentServerBundle(target, listing, "linux"); actual.Bundle != nil {
		t.Fatal("cross-platform Server installer was substituted")
	}
}
