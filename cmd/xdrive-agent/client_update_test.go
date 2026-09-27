package main

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	xupdate "github.com/lazyxu/xdrive/internal/update"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

type fakeClientUpdateBackend struct {
	result          xupdate.Result
	checkN          int
	downloadN       int
	installN        int
	installStart    bool
	lastSource      string
	blockDownload   bool
	downloadStarted chan struct{}
}

func (f *fakeClientUpdateBackend) Target(string) (string, string, error) {
	return "master", "", nil
}

func (f *fakeClientUpdateBackend) Check(_ context.Context, _ string, _ string, _ string, source string) (xupdate.Result, error) {
	f.checkN++
	f.lastSource = source
	return f.result, nil
}

func (f *fakeClientUpdateBackend) Download(ctx context.Context, _ xupdate.Result, progress xupdate.ProgressFunc) (string, error) {
	f.downloadN++
	if progress != nil {
		progress(xupdate.ProgressEvent{Step: 3, Stage: "download", Current: 50, Total: 100, BytesPerSecond: 10})
	}
	if f.blockDownload {
		if f.downloadStarted != nil {
			close(f.downloadStarted)
		}
		<-ctx.Done()
		return "", ctx.Err()
	}
	return filepath.Join("cache", "installer.exe"), nil
}

func (f *fakeClientUpdateBackend) Install(_ context.Context, _ string, _ string, _ string, source string, progress xupdate.ProgressFunc) (bool, xupdate.Result, error) {
	f.installN++
	f.lastSource = source
	if progress != nil {
		progress(xupdate.ProgressEvent{Step: 5, Stage: "install", Message: "starting installer"})
	}
	return f.installStart, f.result, nil
}

func testUpdateManagerWithCapability(t *testing.T, backend *fakeClientUpdateBackend, installSupported bool) *clientUpdateManager {
	t.Helper()
	root := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))
	t.Setenv("APPDATA", filepath.Join(root, "config"))
	t.Setenv("HOME", filepath.Join(root, "home"))
	t.Setenv("USERPROFILE", filepath.Join(root, "home"))
	return newClientUpdateManagerWithBackend(context.Background(), backend, installSupported)
}

func testUpdateManager(t *testing.T, backend *fakeClientUpdateBackend) *clientUpdateManager {
	t.Helper()
	return testUpdateManagerWithCapability(t, backend, true)
}

func TestClientUpdateManagerDefaultsToManual(t *testing.T) {
	backend := &fakeClientUpdateBackend{}
	manager := testUpdateManager(t, backend)
	state := manager.Snapshot()
	if state.Mode != userconfig.UpdateModeManual {
		t.Fatalf("mode=%q want=%q", state.Mode, userconfig.UpdateModeManual)
	}
	if state.Status != clientUpdateStatusIdle {
		t.Fatalf("status=%q want=%q", state.Status, clientUpdateStatusIdle)
	}
	if state.Source != userconfig.UpdateSourceGitHub {
		t.Fatalf("source=%q want=%q", state.Source, userconfig.UpdateSourceGitHub)
	}
}

func TestClientUpdateManagerCheckAndDownloadDoNotInstall(t *testing.T) {
	backend := &fakeClientUpdateBackend{
		result: xupdate.Result{
			Latest:          "snapshot-abcdef123456",
			Channel:         "master",
			UpdateAvailable: true,
			ReleaseName:     "xDrive snapshot abcdef123456",
			PublishedAt:     "2026-09-27T12:00:00Z",
			ReleaseNotes:    "Improved update details",
			ReleaseURL:      "https://example.test/releases/snapshot-abcdef123456",
			Asset: xupdate.Asset{
				Name: "xDriveSetup-amd64.exe",
				Size: 100,
			},
		},
	}
	manager := testUpdateManager(t, backend)

	state, err := manager.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !state.UpdateAvailable || state.Status != clientUpdateStatusAvailable {
		t.Fatalf("check state=%+v", state)
	}
	if state.ReleaseName == "" || state.PublishedAt == "" || state.ReleaseNotes == "" || state.ReleaseURL == "" {
		t.Fatalf("release metadata missing from state=%+v", state)
	}
	if backend.checkN != 1 || backend.downloadN != 0 || backend.installN != 0 {
		t.Fatalf("unexpected backend calls check=%d download=%d install=%d", backend.checkN, backend.downloadN, backend.installN)
	}

	state, err = manager.Download(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !state.Downloaded || state.Status != clientUpdateStatusReady {
		t.Fatalf("download state=%+v", state)
	}
	if backend.checkN != 2 || backend.downloadN != 1 || backend.installN != 0 {
		t.Fatalf("unexpected backend calls check=%d download=%d install=%d", backend.checkN, backend.downloadN, backend.installN)
	}
	select {
	case <-manager.InstallStarted():
		t.Fatal("check/download must not signal installation")
	default:
	}
}

func TestClientUpdateManagerInstallSignalsRestart(t *testing.T) {
	backend := &fakeClientUpdateBackend{
		installStart: true,
		result: xupdate.Result{
			Latest:          "snapshot-fedcba654321",
			Channel:         "master",
			UpdateAvailable: true,
		},
	}
	manager := testUpdateManager(t, backend)
	manager.mu.Lock()
	manager.state.InstallSupported = true
	manager.mu.Unlock()

	state, err := manager.Install(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != clientUpdateStatusInstall || !state.UpdateAvailable || !state.Downloaded {
		t.Fatalf("install state=%+v", state)
	}
	select {
	case <-manager.InstallStarted():
	case <-time.After(time.Second):
		t.Fatal("installation did not signal Agent shutdown")
	}
}

func TestClientUpdateManagerModePersists(t *testing.T) {
	backend := &fakeClientUpdateBackend{}
	manager := testUpdateManager(t, backend)

	state, err := manager.SetMode(userconfig.UpdateModeDownload)
	if err != nil {
		t.Fatal(err)
	}
	if state.Mode != userconfig.UpdateModeDownload {
		t.Fatalf("mode=%q", state.Mode)
	}
	prefs, err := userconfig.LoadUpdatePreferences()
	if err != nil {
		t.Fatal(err)
	}
	if prefs.Mode != userconfig.UpdateModeDownload {
		t.Fatalf("persisted mode=%q", prefs.Mode)
	}
}

func TestClientUpdateManagerRejectsInstallModeWhenUnsupported(t *testing.T) {
	backend := &fakeClientUpdateBackend{}
	manager := testUpdateManagerWithCapability(t, backend, false)

	if _, err := manager.SetMode(userconfig.UpdateModeInstall); err == nil {
		t.Fatal("install mode was accepted when install capability is disabled")
	}
	if state := manager.Snapshot(); state.Mode != userconfig.UpdateModeManual || state.InstallSupported {
		t.Fatalf("unexpected unsupported-platform state: %+v", state)
	}
}

func TestClientUpdateManagerConfiguredModesRespectUserIntent(t *testing.T) {
	result := xupdate.Result{
		Latest:          "snapshot-123456abcdef",
		Channel:         "master",
		UpdateAvailable: true,
		Asset:           xupdate.Asset{Name: "xDriveSetup-amd64.exe", Size: 100},
	}
	for _, tc := range []struct {
		name          string
		mode          string
		installStart  bool
		wantChecks    int
		wantDownloads int
		wantInstalls  int
	}{
		{name: "manual", mode: userconfig.UpdateModeManual},
		{name: "check", mode: userconfig.UpdateModeCheck, wantChecks: 1},
		{name: "download", mode: userconfig.UpdateModeDownload, wantChecks: 1, wantDownloads: 1},
		{name: "install", mode: userconfig.UpdateModeInstall, installStart: true, wantInstalls: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			backend := &fakeClientUpdateBackend{result: result, installStart: tc.installStart}
			manager := testUpdateManager(t, backend)
			manager.mu.Lock()
			manager.state.Mode = tc.mode
			manager.mu.Unlock()

			manager.runConfiguredMode()

			if backend.checkN != tc.wantChecks || backend.downloadN != tc.wantDownloads || backend.installN != tc.wantInstalls {
				t.Fatalf("mode=%s calls check=%d download=%d install=%d want=%d/%d/%d",
					tc.mode, backend.checkN, backend.downloadN, backend.installN,
					tc.wantChecks, tc.wantDownloads, tc.wantInstalls)
			}
		})
	}
}

func TestClientUpdateManagerSourcePersistsAndSelectsBackend(t *testing.T) {
	backend := &fakeClientUpdateBackend{
		result: xupdate.Result{Latest: "snapshot-abcdef123456", Channel: "master"},
	}
	manager := testUpdateManager(t, backend)

	state, err := manager.SetSource(userconfig.UpdateSourceGitLab)
	if err != nil {
		t.Fatal(err)
	}
	if state.Source != userconfig.UpdateSourceGitLab || state.Status != clientUpdateStatusIdle {
		t.Fatalf("state=%+v", state)
	}
	prefs, err := userconfig.LoadUpdatePreferences()
	if err != nil {
		t.Fatal(err)
	}
	if prefs.Source != userconfig.UpdateSourceGitLab {
		t.Fatalf("persisted source=%q", prefs.Source)
	}
	if _, err := manager.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if backend.lastSource != userconfig.UpdateSourceGitLab {
		t.Fatalf("backend source=%q", backend.lastSource)
	}
}

func TestClientUpdateManagerCancelDownload(t *testing.T) {
	started := make(chan struct{})
	backend := &fakeClientUpdateBackend{
		blockDownload:   true,
		downloadStarted: started,
		result: xupdate.Result{
			Latest:          "snapshot-cancel123456",
			Channel:         "master",
			UpdateAvailable: true,
			Asset:           xupdate.Asset{Name: "xDriveSetup-amd64.exe", Size: 100},
		},
	}
	manager := testUpdateManager(t, backend)

	done := make(chan error, 1)
	go func() {
		_, err := manager.Download(context.Background())
		done <- err
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("download did not start")
	}

	state, err := manager.Cancel()
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != clientUpdateStatusAvailable || state.LastError != "" || state.Message != "更新操作已取消。" {
		t.Fatalf("cancel state=%+v", state)
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("download returned error after cancellation: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancel did not stop the in-flight download")
	}

	state = manager.Snapshot()
	if state.Status != clientUpdateStatusAvailable || state.LastError != "" {
		t.Fatalf("final state=%+v", state)
	}
}

func TestClientUpdateManagerRejectsCancelAfterInstallStarted(t *testing.T) {
	backend := &fakeClientUpdateBackend{}
	manager := testUpdateManager(t, backend)
	manager.mu.Lock()
	manager.state.Status = clientUpdateStatusInstall
	manager.mu.Unlock()

	if _, err := manager.Cancel(); err == nil {
		t.Fatal("installing update should not be cancellable")
	}
}
