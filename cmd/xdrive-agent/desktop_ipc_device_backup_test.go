package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
)

type deviceBackupReadFake struct {
	*fakeDesktopIPCController
	overview  client.DeviceBackupOverview
	history   client.DeviceBackupRunPage
	gotSource uint64
	gotLimit  int
	gotOffset int
}

func (f *deviceBackupReadFake) CloudDeviceBackupOverview(context.Context) (client.DeviceBackupOverview, error) {
	return f.overview, f.err
}

func (f *deviceBackupReadFake) CloudDeviceBackupRuns(_ context.Context, source uint64, limit, offset int) (client.DeviceBackupRunPage, error) {
	f.gotSource, f.gotLimit, f.gotOffset = source, limit, offset
	return f.history, f.err
}

func TestDesktopIPCDeviceBackupReadOnlyRedactionPaginationAndAuth(t *testing.T) {
	ctrl := &deviceBackupReadFake{
		fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1},
		overview: client.DeviceBackupOverview{
			Devices: []client.DeviceBackupDevice{{
				ID: "device-A", Name: "工作站 A", Platform: "windows",
				ConnectionState: "unknown",
				Folders: []client.DeviceBackupFolder{{
					SourceID: 12, Name: "项目备份", TargetPath: "/我的文件/设备",
					SyncMode: "backup", Status: "paused",
					LatestRun: &client.DeviceBackupRun{ID: "run-A", SourceID: 12, StartedAt: time.Now().UTC()},
				}},
			}},
		},
		history: client.DeviceBackupRunPage{Items: []client.DeviceBackupRun{{ID: "run-A", SourceID: 12, StartedAt: time.Now().UTC()}}, HasMore: true},
	}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})
	res := desktopIPCRequest(t, handler, http.MethodGet, "/v1/device-backups", "")
	if res.Code != http.StatusOK {
		t.Fatalf("device backups status=%d body=%s", res.Code, res.Body.String())
	}
	var overview client.DeviceBackupOverview
	if err := json.Unmarshal(res.Body.Bytes(), &overview); err != nil {
		t.Fatal(err)
	}
	if len(overview.Devices) != 1 || overview.Devices[0].Folders[0].SourceID != 12 {
		t.Fatalf("unexpected device backup projection %+v", overview)
	}
	if res.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("sensitive read requires no-store, got %q", res.Header().Get("Cache-Control"))
	}
	for _, privateField := range []string{"root_fingerprint", "device_token", "active_transfer_path", "last_error", "checkpoint", "ignore_rules", "local_path"} {
		if strings.Contains(res.Body.String(), privateField) {
			t.Fatalf("private field %q appeared in read DTO", privateField)
		}
	}
	res = desktopIPCRequest(t, handler, http.MethodGet, "/v1/device-backups/runs?source_id=12&limit=20&offset=40", "")
	if res.Code != http.StatusOK || ctrl.gotSource != 12 || ctrl.gotLimit != 20 || ctrl.gotOffset != 40 {
		t.Fatalf("history forwarding status=%d source=%d limit=%d offset=%d", res.Code, ctrl.gotSource, ctrl.gotLimit, ctrl.gotOffset)
	}
	for _, path := range []string{
		"/v1/device-backups/runs?source_id=0",
		"/v1/device-backups/runs?source_id=no",
		"/v1/device-backups/runs?source_id=12&limit=101",
		"/v1/device-backups/runs?source_id=12&offset=-1",
	} {
		res = desktopIPCRequest(t, handler, http.MethodGet, path, "")
		if res.Code != http.StatusBadRequest {
			t.Fatalf("invalid query %q accepted: %d", path, res.Code)
		}
	}
	unauthenticated := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/v1/device-backups", nil)
	unauthenticated.RemoteAddr = "127.0.0.1:43210"
	forbidden := httptest.NewRecorder()
	handler.ServeHTTP(forbidden, unauthenticated)
	if forbidden.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated desktop IPC status=%d", forbidden.Code)
	}
	res = desktopIPCRequest(t, handler, http.MethodPost, "/v1/device-backups", "{}")
	if res.Code != http.StatusMethodNotAllowed {
		t.Fatalf("backup read IPC must not mutate: %d", res.Code)
	}
}

func TestDesktopIPCDeviceBackupReadDoesNotFallBackToGenericSources(t *testing.T) {
	ctrl := &fakeDesktopIPCController{revision: 1}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})
	for _, path := range []string{"/v1/device-backups", "/v1/device-backups/runs?source_id=1"} {
		res := desktopIPCRequest(t, handler, http.MethodGet, path, "")
		if res.Code != http.StatusNotImplemented {
			t.Fatalf("missing safe reader on %q must fail closed: got %d", path, res.Code)
		}
	}
}
