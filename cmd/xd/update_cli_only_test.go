package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	xupdate "github.com/lazyxu/xdrive/internal/update"
)

func TestPortableCLIOnlyDistributionRequiresSiblingAgentAndNoDesktop(t *testing.T) {
	dir := t.TempDir()
	xd := filepath.Join(dir, "xd")
	agent := filepath.Join(dir, "xdrive-agent")
	desktop := filepath.Join(dir, "xdrive-desktop")
	if err := os.WriteFile(xd, []byte("xd"), 0o700); err != nil {
		t.Fatal(err)
	}
	if portableCLIOnlyDistribution(xd, "linux") {
		t.Fatal("xd without the original Agent is not a confirmed CLI-only pair")
	}
	if err := os.WriteFile(agent, []byte("agent"), 0o700); err != nil {
		t.Fatal(err)
	}
	if !portableCLIOnlyDistribution(xd, "linux") {
		t.Fatal("paired portable Go binaries were not recognized as CLI-only")
	}
	if err := requireExistingDesktopDistribution(xd, "linux"); err == nil {
		t.Fatal("standalone CLI-only pair allowed Desktop installer")
	}
	if err := os.WriteFile(desktop, []byte("desktop"), 0o700); err != nil {
		t.Fatal(err)
	}
	if portableCLIOnlyDistribution(xd, "linux") {
		t.Fatal("installed Desktop package incorrectly classified as CLI-only")
	}
	if err := requireExistingDesktopDistribution(xd, "linux"); err != nil {
		t.Fatalf("existing Desktop distribution was not recognized: %v", err)
	}
}

func TestWindowsFullDesktopNestedExecutableIsNotMistakenForCLIOnly(t *testing.T) {
	dir := t.TempDir()
	xd := filepath.Join(dir, "xd.exe")
	agent := filepath.Join(dir, "xdrive-agent.exe")
	desktopDir := filepath.Join(dir, "desktop")
	if err := os.MkdirAll(desktopDir, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{xd, agent, filepath.Join(desktopDir, "xdrive-desktop.exe")} {
		if err := os.WriteFile(path, []byte("fixture"), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if portableCLIOnlyDistribution(xd, "windows") {
		t.Fatal("Windows full Desktop installation with desktop/ subdirectory was misclassified as CLI-only")
	}
	if err := requireExistingDesktopDistribution(xd, "windows"); err != nil {
		t.Fatalf("Windows packaged nested Desktop executable was rejected: %v", err)
	}
	if err := os.Remove(filepath.Join(desktopDir, "xdrive-desktop.exe")); err != nil {
		t.Fatal(err)
	}
	if !portableCLIOnlyDistribution(xd, "windows") {
		t.Fatal("Windows original xd + Agent ZIP pair was not recognized as CLI-only")
	}
	if err := requireExistingDesktopDistribution(xd, "windows"); err == nil {
		t.Fatal("Windows standalone ZIP was permitted to launch NSIS Desktop installer")
	}
}

func TestCLIOnlyInstallCannotLaunchDesktopInstaller(t *testing.T) {
	for _, tc := range []struct {
		install bool
		cliOnly bool
		allowed bool
	}{
		{false, false, true},
		{false, true, true},
		{true, false, true}, // an existing Desktop has its own gated installer
		{true, true, false}, // explicit or detected CLI-only: never launch GUI
	} {
		err := rejectCLIOnlyInstall(tc.install, tc.cliOnly)
		if (err == nil) != tc.allowed {
			t.Fatalf("install=%v cliOnly=%v: %v", tc.install, tc.cliOnly, err)
		}
		if !tc.allowed && !strings.Contains(err.Error(), "no Desktop installer") {
			t.Fatalf("unsafe error guidance: %v", err)
		}
	}
}

// Download-only xd/Agent archives can use the authenticated Server cache
// only when the independently selected GitLab Commit/version/digest agree.
func TestCLIOnlyGitLabServerPreferenceRequiresIndependentDigest(t *testing.T) {
	commit := strings.Repeat("a", 40)
	digest := strings.Repeat("b", 64)
	name := "xdrive-backup-linux-amd64.tar.gz"
	archive := client.ReleaseBundleArtifact{
		Platform: "cli", Filename: name, BuildCommit: commit,
		SHA256: digest, Size: 200, InstallMode: "manual", Cached: true,
	}
	listing := client.ReleaseBundleListing{
		Commit: commit, Channel: xupdate.ChannelMaster,
		ServerVersion: "snapshot", Artifacts: []client.ReleaseBundleArtifact{archive},
	}
	target := xupdate.Result{
		Commit: commit, Channel: xupdate.ChannelMaster,
		Latest: "snapshot", UpdateAvailable: true,
		Asset: xupdate.Asset{Name: name, Size: 200},
	}
	if got, ok := matchCLIOnlyServerBundle(target, listing, digest, "linux"); !ok || got.Filename != name {
		t.Fatal("matching independently pinned GitLab CLI-only archive not preferred")
	}
	for scenario, mutate := range map[string]func(*xupdate.Result, *client.ReleaseBundleListing){
		"wrong Server commit":    func(_ *xupdate.Result, l *client.ReleaseBundleListing) { l.Commit = strings.Repeat("c", 40) },
		"wrong Server version":   func(_ *xupdate.Result, l *client.ReleaseBundleListing) { l.ServerVersion = "v2.0.0" },
		"other update channel":   func(_ *xupdate.Result, l *client.ReleaseBundleListing) { l.Channel = xupdate.ChannelStable },
		"other installer name":   func(r *xupdate.Result, _ *client.ReleaseBundleListing) { r.Asset.Name = "other.tar.gz" },
		"wrong independent size": func(r *xupdate.Result, _ *client.ReleaseBundleListing) { r.Asset.Size++ },
		"testing-only installer": func(_ *xupdate.Result, l *client.ReleaseBundleListing) {
			l.Artifacts[0].InstallMode = "manual_test_only"
		},
		"Desktop installer platform": func(_ *xupdate.Result, l *client.ReleaseBundleListing) { l.Artifacts[0].Platform = "linux" },
	} {
		t.Run(scenario, func(t *testing.T) {
			r, l := target, listing
			l.Artifacts = append([]client.ReleaseBundleArtifact(nil), listing.Artifacts...)
			mutate(&r, &l)
			if _, ok := matchCLIOnlyServerBundle(r, l, digest, "linux"); ok {
				t.Fatal("untrusted CLI-only Server cache substitution")
			}
		})
	}
	if _, ok := matchCLIOnlyServerBundle(target, listing, strings.Repeat("d", 64), "linux"); ok {
		t.Fatal("conflicting GitLab SHA-256 selected Server cache")
	}
	if _, ok := matchCLIOnlyServerBundle(target, listing, digest, "windows"); ok {
		t.Fatal("cross-platform CLI archive selected")
	}
}

func TestStandaloneCLIServerFirstRequiresIndependentGitLabProvenance(t *testing.T) {
	commit := strings.Repeat("a", 40)
	digest := strings.Repeat("b", 64)
	for _, tc := range []struct{ goos, filename string }{
		{"linux", "xdrive-cli-linux-amd64.tar.gz"},
		{"windows", "xdrive-cli-windows-amd64.zip"},
	} {
		t.Run(tc.goos, func(t *testing.T) {
			artifact := client.ReleaseBundleArtifact{
				Platform: "cli", Filename: tc.filename, BuildCommit: commit,
				SHA256: digest, Size: 400, InstallMode: "manual", Cached: true,
			}
			listing := client.ReleaseBundleListing{
				Commit: commit, Channel: xupdate.ChannelMaster,
				ServerVersion: "snapshot", Artifacts: []client.ReleaseBundleArtifact{artifact},
			}
			target := xupdate.Result{
				Commit: commit, Channel: xupdate.ChannelMaster, Latest: "snapshot",
				UpdateAvailable: true, Asset: xupdate.Asset{Name: tc.filename, Size: 400},
			}
			if got, ok := matchCLIOnlyServerBundle(target, listing, digest, tc.goos); !ok ||
				got.Filename != tc.filename {
				t.Fatal("source-exact standalone pair was not eligible for Server cache")
			}
			if _, ok := matchCLIOnlyServerBundle(target, listing, strings.Repeat("f", 64), tc.goos); ok {
				t.Fatal("standalone server cache accepted a mismatched independent SHA")
			}
			wrong := listing
			wrong.Commit = strings.Repeat("c", 40)
			if _, ok := matchCLIOnlyServerBundle(target, wrong, digest, tc.goos); ok {
				t.Fatal("standalone CLI cross-commit substitution accepted")
			}
			wrong = listing
			wrong.Artifacts = append([]client.ReleaseBundleArtifact(nil), listing.Artifacts...)
			wrong.Artifacts[0].InstallMode = "manual_test_only"
			if _, ok := matchCLIOnlyServerBundle(target, wrong, digest, tc.goos); ok {
				t.Fatal("standalone CLI testing-only package accepted")
			}
			other := "linux"
			if tc.goos == "linux" {
				other = "windows"
			}
			if _, ok := matchCLIOnlyServerBundle(target, listing, digest, other); ok {
				t.Fatal("cross-platform standalone CLI archive accepted")
			}
		})
	}
}
