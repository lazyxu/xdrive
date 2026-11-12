package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
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
		InstallMode: "manual",
	}
	listing := client.ReleaseBundleListing{
		Commit: sha, Channel: "master",
		Artifacts: []client.ReleaseBundleArtifact{artifact},
	}
	target := xupdate.Result{
		Commit: sha, Channel: xupdate.ChannelMaster,
		UpdateAvailable: true,
		Asset:           xupdate.Asset{Name: artifact.Filename, Digest: "sha256:" + digest},
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
		"channel digest absent": func() xupdate.Result {
			v := target
			v.Asset.Digest = ""
			return v
		}(),
		"other filename": func() xupdate.Result {
			v := target
			v.Asset.Name = "another.exe"
			return v
		}(),
		"conflicting source size": func() xupdate.Result {
			v := target
			v.Asset.Size = artifact.Size + 1
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
	testingOnly := listing
	testingOnly.Artifacts = append([]client.ReleaseBundleArtifact(nil), listing.Artifacts...)
	testingOnly.Artifacts[0].InstallMode = "manual_test_only"
	if actual := matchCurrentServerBundle(target, testingOnly, "windows"); actual.Bundle != nil {
		t.Fatal("testing-only installer was selected by normal channel auto-update")
	}
}

// GitLab does not consistently supply asset.digest in its Release metadata.
// Before using the authenticated Server cache as a preferred download origin,
// read the Server version/hash listing and separately fetch GitLab SHA256SUMS.
// Matching metadata permits Server → GitLab → GitHub; mismatches must not
// substitute bytes from a different or tampered update channel.
func TestGitLabChecksumEnablesServerFirstOnlyForExactRelease(t *testing.T) {
	commit := strings.Repeat("a", 40)
	payload := []byte("independently verified GitLab package")
	sum := sha256.Sum256(payload)
	digest := hex.EncodeToString(sum[:])
	var reads atomic.Int32
	badDigest := strings.Repeat("b", 64)
	var wrong atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reads.Add(1)
		if r.URL.Path != "/SHA256SUMS.txt" {
			http.NotFound(w, r)
			return
		}
		checksum := digest
		if wrong.Load() {
			checksum = badDigest
		}
		_, _ = fmt.Fprintf(w, "%s  xDriveSetup-amd64.exe\n", checksum)
	}))
	defer server.Close()

	artifact := client.ReleaseBundleArtifact{
		Platform: "windows", Filename: "xDriveSetup-amd64.exe",
		BuildCommit: commit, SHA256: digest, Size: int64(len(payload)),
		InstallMode: "manual", Cached: true,
	}
	listing := client.ReleaseBundleListing{
		Commit: commit, Channel: xupdate.ChannelMaster,
		ServerVersion: "snapshot",
		Artifacts: []client.ReleaseBundleArtifact{artifact},
	}
	release := xupdate.Result{
		Current: "snapshot", Latest: "snapshot", Commit: commit,
		Channel: xupdate.ChannelMaster, UpdateAvailable: true,
		Asset: xupdate.Asset{Name: artifact.Filename},
		Checksums: xupdate.Asset{Name: "SHA256SUMS.txt", URL: server.URL + "/SHA256SUMS.txt"},
	}
	matched := matchCurrentServerBundleWithGitLabChecksum(
		context.Background(), release, listing, "windows", xupdate.SourceGitLab,
	)
	if matched.Bundle == nil || matched.Bundle.SHA256 != digest ||
		matched.Bundle.Size != artifact.Size || matched.Asset.Digest != "sha256:"+digest {
		t.Fatalf("GitLab checksum did not authorize matching Server-first bytes: %+v", matched)
	}
	if reads.Load() != 1 {
		t.Fatalf("expected one GitLab checksum download after Server listing, got %d", reads.Load())
	}

	wrong.Store(true)
	conflicting := matchCurrentServerBundleWithGitLabChecksum(
		context.Background(), release, listing, "windows", xupdate.SourceGitLab,
	)
	if conflicting.Bundle != nil || conflicting.Asset.Digest != "sha256:"+badDigest {
		t.Fatalf("mismatching GitLab release digest replaced Server package: %+v", conflicting)
	}
	wrong.Store(false)

	before := reads.Load()
	staleServer := listing
	staleServer.Commit = strings.Repeat("c", 40)
	if mismatched := matchCurrentServerBundleWithGitLabChecksum(
		context.Background(), release, staleServer, "windows", xupdate.SourceGitLab,
	); mismatched.Bundle != nil || reads.Load() != before {
		t.Fatal("wrong Server Commit caused checksum fetch or package substitution")
	}
	staleServer = listing
	staleServer.ServerVersion = "v2.0.0"
	if mismatched := matchCurrentServerBundleWithGitLabChecksum(
		context.Background(), release, staleServer, "windows", xupdate.SourceGitLab,
	); mismatched.Bundle != nil || reads.Load() != before {
		t.Fatal("wrong Server version caused checksum fetch or package substitution")
	}
	if direct := matchCurrentServerBundleWithGitLabChecksum(
		context.Background(), release, listing, "windows", xupdate.SourceGitHub,
	); direct.Bundle != nil || reads.Load() != before {
		t.Fatal("GitHub update without independent digest improperly used Server cache")
	}
}
