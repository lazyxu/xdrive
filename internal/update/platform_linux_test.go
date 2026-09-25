//go:build linux

package update

import "testing"

func TestPlatformAssetNameUsesUnifiedLinuxInstaller(t *testing.T) {
	if got, want := platformAssetName(), "xdrive-linux-amd64.deb"; got != want {
		t.Fatalf("platformAssetName()=%q want=%q", got, want)
	}
}
