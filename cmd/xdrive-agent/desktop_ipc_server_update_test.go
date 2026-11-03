package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

type serverUpdateIPCController struct {
	*fakeDesktopIPCController
	calls          int
	backupFileData bool
}

func (f *serverUpdateIPCController) CloudStartServerUpdate(ctx context.Context, source, channel string, backupFileData bool) (client.ServerUpdateState, error) {
	f.calls++
	f.backupFileData = backupFileData
	return f.fakeDesktopIPCController.CloudStartServerUpdate(ctx, source, channel, backupFileData)
}

func TestDesktopIPCServerUpdateSources(t *testing.T) {
	for _, tc := range []struct {
		source  string
		channel string
		backup  bool
	}{
		{"xdrive", "master", true},
		{" XDRIVE ", " MASTER ", false},
		{"github", "master", true},
		{"github", "stable", false},
		{"gitlab", "master", false},
		{"gitlab", "stable", true},
	} {
		t.Run(tc.source+"/"+tc.channel, func(t *testing.T) {
			source, channel := strings.ToLower(strings.TrimSpace(tc.source)), strings.ToLower(strings.TrimSpace(tc.channel))
			ctrl := &serverUpdateIPCController{fakeDesktopIPCController: &fakeDesktopIPCController{
				cloudServerUpdate: client.ServerUpdateState{Supported: true, State: "queued", Source: source, Channel: channel},
			}}
			handler := newDesktopIPCHandler(ctrl, "secret", func() {})
			body := fmt.Sprintf(`{"source":%q,"channel":%q,"backup_file_data":%t}`, tc.source, tc.channel, tc.backup)
			res := desktopIPCRequest(t, handler, http.MethodPost, "/v1/server-update", body)
			if res.Code != http.StatusAccepted {
				t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
			}
			if ctrl.calls != 1 || ctrl.cloudServerUpdateSource != source || ctrl.cloudServerUpdateChannel != channel || ctrl.backupFileData != tc.backup {
				t.Fatalf("server update arguments changed: calls=%d source=%q channel=%q backup=%v", ctrl.calls, ctrl.cloudServerUpdateSource, ctrl.cloudServerUpdateChannel, ctrl.backupFileData)
			}
			var state client.ServerUpdateState
			if err := json.Unmarshal(res.Body.Bytes(), &state); err != nil || state.Source != source || state.Channel != channel || state.State != "queued" {
				t.Fatalf("server update result changed: state=%+v err=%v", state, err)
			}
		})
	}
}

func TestDesktopIPCServerUpdateRejectsUnsupportedSourceChannel(t *testing.T) {
	for _, body := range []string{
		`{"source":"xdrive","channel":"stable"}`,
		`{"source":" XDRIVE ","channel":" STABLE "}`,
		`{"source":"other","channel":"master"}`,
		`{"source":"github","channel":"other"}`,
		`{"source":"gitlab","channel":""}`,
		`{"source":"","channel":"master"}`,
	} {
		t.Run(body, func(t *testing.T) {
			ctrl := &serverUpdateIPCController{fakeDesktopIPCController: &fakeDesktopIPCController{}}
			handler := newDesktopIPCHandler(ctrl, "secret", func() {})
			res := desktopIPCRequest(t, handler, http.MethodPost, "/v1/server-update", body)
			if res.Code != http.StatusBadRequest || !strings.Contains(res.Body.String(), "invalid_server_update") {
				t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
			}
			if ctrl.calls != 0 {
				t.Fatal("invalid server update reached controller")
			}
		})
	}
}
