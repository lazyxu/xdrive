package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
)

type deviceBackupFolderReadFake struct {
	*deviceBackupReadFake
	page        client.DeviceBackupFolderPage
	gotDeviceID string
	gotLimit    int
	gotAfterID  uint64
}

func (f *deviceBackupFolderReadFake) CloudDeviceBackupFoldersPage(_ context.Context, deviceID string, limit int, afterSourceID uint64) (client.DeviceBackupFolderPage, error) {
	f.gotDeviceID = deviceID
	f.gotLimit = limit
	f.gotAfterID = afterSourceID
	return f.page, nil
}

func TestDesktopIPCBackupFoldersReadOnlyPaginatedWithStrictBounds(t *testing.T) {
	deviceID := uuid.NewString()
	ctrl := &deviceBackupFolderReadFake{
		deviceBackupReadFake: &deviceBackupReadFake{
			fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1},
		},
		page: client.DeviceBackupFolderPage{
			Folders: []client.DeviceBackupFolder{{
				SourceID: 42, Name: "已授权的只读备份", TargetPath: "/云端/我的文件",
				SyncMode: "backup", Status: "paused",
			}},
			HasMore: true, NextAfterSourceID: 42,
		},
	}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})
	path := "/v1/device-backups/folders?device_id=" + deviceID + "&limit=20&after_source_id=41"
	res := desktopIPCRequest(t, handler, http.MethodGet, path, "")
	if res.Code != http.StatusOK || ctrl.gotDeviceID != deviceID ||
		ctrl.gotLimit != 20 || ctrl.gotAfterID != 41 {
		t.Fatalf("safe folder IPC rejected valid owner-read page: %d %s", res.Code, res.Body.String())
	}
	if res.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("read-only folder IPC cannot be cached")
	}
	var page client.DeviceBackupFolderPage
	if err := json.Unmarshal(res.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Folders) != 1 || page.Folders[0].SourceID != 42 ||
		!page.HasMore || page.NextAfterSourceID != 42 {
		t.Fatalf("lost folder page cursor or data: %+v", page)
	}
	for _, secret := range []string{
		"root_fingerprint", "device_token", "ignore_rules", "last_error",
		"local_path", "checkpoint", "active_transfer_path",
	} {
		if strings.Contains(res.Body.String(), secret) {
			t.Fatalf("folder IPC leaked private field %q", secret)
		}
	}
	for _, path := range []string{
		"/v1/device-backups/folders",
		"/v1/device-backups/folders?device_id=bad-uuid",
		"/v1/device-backups/folders?device_id=" + strings.ToUpper(deviceID),
		"/v1/device-backups/folders?device_id=" + deviceID + "&limit=0",
		"/v1/device-backups/folders?device_id=" + deviceID + "&limit=101",
		"/v1/device-backups/folders?device_id=" + deviceID + "&limit=foo",
		"/v1/device-backups/folders?device_id=" + deviceID + "&limit=01",
		"/v1/device-backups/folders?device_id=" + deviceID + "&after_source_id=0",
		"/v1/device-backups/folders?device_id=" + deviceID + "&after_source_id=-1",
		"/v1/device-backups/folders?device_id=" + deviceID + "&after_source_id=01",
		"/v1/device-backups/folders?device_id=" + deviceID + "&limit=1&limit=2",
		"/v1/device-backups/folders?device_id=" + deviceID + "&unexpected=path",
	} {
		invalid := desktopIPCRequest(t, handler, http.MethodGet, path, "")
		if invalid.Code != http.StatusBadRequest {
			t.Fatalf("invalid folder page %q returned %d", path, invalid.Code)
		}
	}
	unauthenticated := httptest.NewRequest(http.MethodGet, "http://127.0.0.1"+path, nil)
	unauthenticated.RemoteAddr = "127.0.0.1:43210"
	forbidden := httptest.NewRecorder()
	handler.ServeHTTP(forbidden, unauthenticated)
	if forbidden.Code != http.StatusUnauthorized {
		t.Fatalf("untrusted Desktop folder IPC status=%d", forbidden.Code)
	}
	writeAttempt := desktopIPCRequest(t, handler, http.MethodPost, path, "{}")
	if writeAttempt.Code != http.StatusMethodNotAllowed {
		t.Fatalf("backup read IPC accepted method POST: %d", writeAttempt.Code)
	}
}

func TestDesktopIPCBackupFoldersNeverUsesGenericSourceFallback(t *testing.T) {
	handler := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1}, "secret", func() {})
	res := desktopIPCRequest(t, handler, http.MethodGet,
		"/v1/device-backups/folders?device_id="+uuid.NewString(), "")
	if res.Code != http.StatusNotImplemented {
		t.Fatalf("old Agent must deny unsupported folder paging, not use writable Source API: %d", res.Code)
	}
}
