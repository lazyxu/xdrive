package main

import (
    "strings"
    "testing"

    "github.com/lazyxu/xdrive/internal/client"
    xupdate "github.com/lazyxu/xdrive/internal/update"
)

func TestCurrentServerPersonalUnsignedInstallerRequiresExplicitWindowsMasterConsent(t *testing.T) {
    commit := strings.Repeat("a", 40)
    win := client.ReleaseBundleArtifact{
        Platform: "windows", Filename: "xDriveSetup-amd64.exe",
        BuildCommit: commit, InstallMode: "manual_test_only",
    }
    if currentServerInstallAllowed(win, "windows", xupdate.ChannelMaster, commit, win.Filename, false) {
        t.Fatal("unsigned private Windows package was admitted without explicit consent")
    }
    if !currentServerInstallAllowed(win, "windows", xupdate.ChannelMaster, commit, win.Filename, true) {
        t.Fatal("verified private Windows Snapshot was not admitted after explicit consent")
    }
    for _, tc := range []struct { name, platform, channel, commit, filename string }{
        {"stable", "windows", xupdate.ChannelStable, commit, win.Filename},
        {"linux", "linux", xupdate.ChannelMaster, commit, win.Filename},
        {"wrong commit", "windows", xupdate.ChannelMaster, strings.Repeat("b", 40), win.Filename},
        {"wrong file", "windows", xupdate.ChannelMaster, commit, "other.exe"},
    } {
        if currentServerInstallAllowed(win, tc.platform, tc.channel, tc.commit, tc.filename, true) {
            t.Errorf("%s admitted personal unsigned installer", tc.name)
        }
    }
    signed := win
    signed.InstallMode = "manual"
    if !currentServerInstallAllowed(signed, "windows", xupdate.ChannelMaster, commit, signed.Filename, false) {
        t.Fatal("signed Windows client path regressed")
    }
    if currentServerInstallAllowed(signed, "windows", xupdate.ChannelMaster, commit, signed.Filename, true) {
        t.Fatal("unsigned consent altered ordinary signed installer admission")
    }
    ios := client.ReleaseBundleArtifact{
        Platform: "ios", Filename: "xDrive-unsigned.ipa",
        BuildCommit: commit, InstallMode: "manual_test_only",
    }
    if currentServerInstallAllowed(ios, "ios", xupdate.ChannelMaster, commit, ios.Filename, true) {
        t.Fatal("unsigned iOS IPA became a native installer")
    }
}
