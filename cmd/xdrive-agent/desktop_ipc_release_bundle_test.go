package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

type releaseBundleIPCTestController struct {
	*fakeDesktopIPCController
	listing       client.ReleaseBundleListing
	retryCount    int
	downloadCount int
	installCount  int
	commit        string
	filename      string
	destination   string
}

func (f *releaseBundleIPCTestController) CloudReleaseBundleState(context.Context) (client.ReleaseBundleListing, error) {
	return f.listing, nil
}
func (f *releaseBundleIPCTestController) CloudRetryReleaseBundle(context.Context) error {
	f.retryCount++
	return nil
}
func (f *releaseBundleIPCTestController) CloudDownloadReleaseBundle(_ context.Context, commit, filename, destination string) error {
	f.downloadCount++
	f.commit, f.filename, f.destination = commit, filename, destination
	return nil
}
func (f *releaseBundleIPCTestController) CloudInstallCurrentServerCommit(_ context.Context, commit, filename string) (clientUpdateState, error) {
	f.installCount++
	f.commit, f.filename = commit, filename
	return clientUpdateState{Status: clientUpdateStatusInstall, CurrentVersion: "snapshot"}, nil
}

func TestDesktopCurrentBundleIPCRequiresFixedAuthenticatedRouteAndExplicitInstall(t *testing.T) {
	commit := strings.Repeat("a", 40)
	filename := "xDriveSetup-amd64.exe"
	f := &releaseBundleIPCTestController{
		fakeDesktopIPCController: &fakeDesktopIPCController{},
		listing: client.ReleaseBundleListing{
			Commit: commit, Channel: "master", ServerVersion: "snapshot",
			Artifacts: []client.ReleaseBundleArtifact{},
		},
	}
	handler := newDesktopIPCHandler(f, "secret", func() {})
	rr := desktopIPCRequest(t, handler, http.MethodGet, "/v1/release-bundle/current", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("current Bundle HTTP %d %s", rr.Code, rr.Body.String())
	}
	var decoded client.ReleaseBundleListing
	if err := json.Unmarshal(rr.Body.Bytes(), &decoded); err != nil || decoded.Commit != commit {
		t.Fatalf("Owner Bundle identity was not preserved: %+v %v", decoded, err)
	}
	rr = desktopIPCRequest(t, handler, http.MethodPost, "/v1/release-bundle/retry", "{}")
	if rr.Code != http.StatusAccepted || f.retryCount != 1 {
		t.Fatalf("explicit Host cache retry failed: status=%d calls=%d", rr.Code, f.retryCount)
	}
	for _, input := range []string{
		`{"commit":"` + commit + `","filename":"` + filename + `"}`,
		`{"commit":"short","filename":"` + filename + `","confirm":true}`,
		`{"commit":"` + commit + `","filename":"../evil.exe","confirm":true}`,
	} {
		rr = desktopIPCRequest(t, handler, http.MethodPost, "/v1/release-bundle/install", input)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("unauthorized implicit install accepted: %d %s", rr.Code, rr.Body.String())
		}
	}
	if f.installCount != 0 {
		t.Fatal("nonconfirmed or malformed installer reached native controller")
	}
	rr = desktopIPCRequest(t, handler, http.MethodPost, "/v1/release-bundle/install",
		`{"commit":"`+commit+`","filename":"`+filename+`","confirm":true}`)
	if rr.Code != http.StatusAccepted || f.installCount != 1 || f.commit != commit || f.filename != filename {
		t.Fatalf("confirmed exact install failed: status=%d calls=%d", rr.Code, f.installCount)
	}
}

func TestDesktopBundleIPCRejectsBadFileIdentityBeforeDownload(t *testing.T) {
	f := &releaseBundleIPCTestController{fakeDesktopIPCController: &fakeDesktopIPCController{}}
	handler := newDesktopIPCHandler(f, "secret", func() {})
	for _, body := range []string{
		`{"commit":"invalid","filename":"xDriveSetup-amd64.exe","destination":"C:\\Temp\\xDrive.exe"}`,
		`{"commit":"` + strings.Repeat("a", 40) + `","filename":"../evil","destination":"C:\\Temp\\xDrive.exe"}`,
		`{"commit":"` + strings.Repeat("a", 40) + `","filename":"xDriveSetup-amd64.exe","destination":""}`,
	} {
		rr := desktopIPCRequest(t, handler, http.MethodPost, "/v1/release-bundle/download", body)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("malformed installer file identity accepted: %d %s", rr.Code, rr.Body.String())
		}
	}
	if f.downloadCount != 0 {
		t.Fatal("invalid download request reached Agent")
	}
}
