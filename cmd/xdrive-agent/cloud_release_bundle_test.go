package main

import (
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestCurrentReleaseBundleDownloadAdmitsOnlyApprovedCurrentCommitFiles(t *testing.T) {
	commit := strings.Repeat("a", 40)
	item := client.ReleaseBundleArtifact{
		Platform:    "windows",
		Filename:    "xDriveSetup-amd64.exe",
		BuildCommit: commit,
		InstallMode: "manual",
	}
	if !releaseBundleDownloadAllowed(item, commit, item.Filename) {
		t.Fatal("approved manual Windows installer could not be saved")
	}
	item.InstallMode = "manual_test_only"
	if !releaseBundleDownloadAllowed(item, commit, item.Filename) {
		t.Fatal("personal unsigned Windows Snapshot cannot be saved for independent verification")
	}
	item.Filename = "arbitrary.exe"
	if releaseBundleDownloadAllowed(item, commit, item.Filename) {
		t.Fatal("arbitrary Windows test-only executable was admitted")
	}
	item.Filename = "xDriveSetup-amd64.exe"
	if releaseBundleDownloadAllowed(item, strings.Repeat("b", 40), item.Filename) {
		t.Fatal("cross-Commit Windows test package was admitted")
	}
	item.Platform = "ios"
	item.Filename = "xDrive-unsigned.ipa"
	if !releaseBundleDownloadAllowed(item, commit, item.Filename) {
		t.Fatal("explicit unsigned iOS testing IPA cannot be saved for signing")
	}
	item.Filename = "unknown.ipa"
	if releaseBundleDownloadAllowed(item, commit, item.Filename) {
		t.Fatal("unexpected testing-only package was approved")
	}
	item.Filename = "xDrive-unsigned.ipa"
	if releaseBundleDownloadAllowed(item, strings.Repeat("b", 40), item.Filename) ||
		releaseBundleDownloadAllowed(item, commit, "changed.ipa") {
		t.Fatal("cross-commit or cross-filename download admitted")
	}
}
