package main

import (
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestCurrentReleaseBundleDownloadAdmitsOnlyApprovedManualOrUnsignedTestingIPA(t *testing.T) {
	commit := strings.Repeat("a", 40)
	item := client.ReleaseBundleArtifact{
		Platform: "windows",
		Filename: "xDriveSetup-amd64.exe",
		BuildCommit: commit,
		InstallMode: "manual",
	}
	if !releaseBundleDownloadAllowed(item, commit, item.Filename) {
		t.Fatal("approved manual Windows installer could not be saved")
	}
	item.InstallMode = "manual_test_only"
	if releaseBundleDownloadAllowed(item, commit, item.Filename) {
		t.Fatal("testing-only Windows package unexpectedly allowed")
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
