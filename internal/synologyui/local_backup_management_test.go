package synologyui

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type fakeLocalBackupManagementAgent struct {
	*fakeAgent
	settings client.LocalBoundBackupSettings
	rules    client.LocalBoundIgnoreRules
	removed  bool
	calls    []string
}

func (f *fakeLocalBackupManagementAgent) Sources(ctx context.Context) ([]localbackupipc.BackupSource, error) {
	if f.removed {
		return []localbackupipc.BackupSource{}, nil
	}
	items, err := f.fakeAgent.Sources(ctx)
	for i := range items {
		if items[i].ID == f.settings.SourceID {
			items[i].Name = f.settings.Name
			items[i].SyncMode = f.settings.SyncMode
		}
	}
	return items, err
}

func (f *fakeLocalBackupManagementAgent) LocalBackupSettings(_ context.Context, id uint64) (client.LocalBoundBackupSettings, error) {
	f.calls = append(f.calls, "settings")
	if id != f.settings.SourceID { return client.LocalBoundBackupSettings{}, errors.New("foreign") }
	return f.settings, nil
}
func (f *fakeLocalBackupManagementAgent) RenameLocalBackupSource(_ context.Context, id, revision uint64, name string) (client.LocalBoundBackupSettings, error) {
	f.calls = append(f.calls, "rename")
	if id != f.settings.SourceID || revision != f.settings.Revision { return client.LocalBoundBackupSettings{}, errors.New("stale") }
	f.settings.Revision++
	f.settings.Name = name
	return f.settings, nil
}
func (f *fakeLocalBackupManagementAgent) RetargetLocalBackupSource(_ context.Context, id, revision, target uint64) (client.LocalBoundBackupSettings, error) {
	f.calls = append(f.calls, "target")
	if id != f.settings.SourceID || revision != f.settings.Revision { return client.LocalBoundBackupSettings{}, errors.New("stale") }
	f.settings.Revision++
	f.settings.TargetNodeID = &target
	f.settings.TargetPath = "/Backup/Retargeted"
	return f.settings, nil
}
func (f *fakeLocalBackupManagementAgent) SetLocalBackupMode(_ context.Context, id, revision uint64, mode string) (client.LocalBoundBackupSettings, error) {
	f.calls = append(f.calls, "mode")
	if id != f.settings.SourceID || revision != f.settings.Revision { return client.LocalBoundBackupSettings{}, errors.New("stale") }
	f.settings.Revision++
	f.settings.SyncMode = mode
	return f.settings, nil
}
func (f *fakeLocalBackupManagementAgent) LocalBackupRules(_ context.Context, id uint64) (client.LocalBoundIgnoreRules, error) {
	f.calls = append(f.calls, "rules")
	if id != f.rules.SourceID { return client.LocalBoundIgnoreRules{}, errors.New("foreign") }
	return f.rules, nil
}
func (f *fakeLocalBackupManagementAgent) SaveLocalBackupRules(_ context.Context, id, revision uint64, rules string) (client.LocalBoundIgnoreRules, error) {
	f.calls = append(f.calls, "save-rules")
	if id != f.rules.SourceID || revision != f.rules.Revision { return client.LocalBoundIgnoreRules{}, errors.New("stale") }
	f.rules.Revision++
	f.rules.IgnoreRules = rules
	return f.rules, nil
}
func (f *fakeLocalBackupManagementAgent) RemoveLocalBackupSource(_ context.Context, id, revision uint64) (client.LocalBoundBackupRemoval, error) {
	f.calls = append(f.calls, "remove")
	if id != f.settings.SourceID || revision != f.settings.Revision { return client.LocalBoundBackupRemoval{}, errors.New("stale") }
	f.removed = true
	return client.LocalBoundBackupRemoval{SourceID: id, LocalGrantRemoved: true}, nil
}

func requestLocalBackupMutation(g *Gateway, path, payload, origin, csrfToken string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "https://nas.example:5001"+path, strings.NewReader(payload))
	r.Header.Set("Cookie", "id=dsm-session")
	if origin != "" { r.Header.Set("Origin", origin) }
	if csrfToken != "" { r.Header.Set("X-CSRF-Token", csrfToken) }
	w := httptest.NewRecorder()
	g.ServeHTTP(w, r)
	return w
}

func TestDSMOwnerLocalBackupManagementUsesOwningAgentAndRevision(t *testing.T) {
	g, base := newFixture(t)
	target := uint64(7)
	manager := &fakeLocalBackupManagementAgent{
		fakeAgent: base,
		settings: client.LocalBoundBackupSettings{
			SourceID: 42, Name: "Photos", Revision: 1, SyncMode: "backup",
			TargetNodeID: &target, TargetPath: "/Backup/Photos",
		},
		rules: client.LocalBoundIgnoreRules{SourceID: 42, Revision: 1, IgnoreRules: "**/*.tmp\n"},
	}
	g.Connect = func(context.Context) (Agent, error) { return manager, nil }

	read := request(g, http.MethodGet, "/v1/local-source?source_id=42", "", "")
	if read.Code != http.StatusOK || !strings.Contains(read.Body.String(), `"target_path":"/Backup/Photos"`) {
		t.Fatalf("local Source settings read failed: %d %s", read.Code, read.Body.String())
	}
	if foreign := request(g, http.MethodGet, "/v1/local-source?source_id=99", "", ""); foreign.Code != http.StatusForbidden {
		t.Fatalf("foreign Source settings leaked: HTTP %d", foreign.Code)
	}

	token := getCSRF(t, g)
	rename := requestLocalBackupMutation(g, "/v1/local-source-rename",
		`{"source_id":42,"revision":1,"name":"Photos Archive"}`,
		"https://nas.example:5001", token)
	if rename.Code != http.StatusOK || !strings.Contains(rename.Body.String(), `"name":"Photos Archive"`) {
		t.Fatalf("rename failed: %d %s", rename.Code, rename.Body.String())
	}
	targetUpdate := requestLocalBackupMutation(g, "/v1/local-target",
		`{"source_id":42,"revision":2,"target_node_id":8}`,
		"https://nas.example:5001", token)
	if targetUpdate.Code != http.StatusOK || !strings.Contains(targetUpdate.Body.String(), `"target_node_id":8`) {
		t.Fatalf("retarget failed: %d %s", targetUpdate.Code, targetUpdate.Body.String())
	}
	mode := requestLocalBackupMutation(g, "/v1/local-mode",
		`{"source_id":42,"revision":3,"sync_mode":"mirror"}`,
		"https://nas.example:5001", token)
	if mode.Code != http.StatusOK || !strings.Contains(mode.Body.String(), `"sync_mode":"mirror"`) {
		t.Fatalf("mode update failed: %d %s", mode.Code, mode.Body.String())
	}
	list := request(g, http.MethodGet, "/v1/sources", "", "")
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), `"sync_mode":"mirror"`) {
		t.Fatalf("Mirror Source disappeared from DSM list: %d %s", list.Code, list.Body.String())
	}
	rulesRead := request(g, http.MethodGet, "/v1/local-rules?source_id=42", "", "")
	if rulesRead.Code != http.StatusOK || !strings.Contains(rulesRead.Body.String(), "**/*.tmp") {
		t.Fatalf("rules read failed: %d %s", rulesRead.Code, rulesRead.Body.String())
	}
	rulesSave := requestLocalBackupMutation(g, "/v1/local-rules",
		`{"source_id":42,"revision":1,"ignore_rules":"**/*.log\n"}`,
		"https://nas.example:5001", token)
	if rulesSave.Code != http.StatusOK || !strings.Contains(rulesSave.Body.String(), "**/*.log") {
		t.Fatalf("rules save failed: %d %s", rulesSave.Code, rulesSave.Body.String())
	}
	remove := requestLocalBackupMutation(g, "/v1/local-bound-remove",
		`{"source_id":42,"revision":4}`,
		"https://nas.example:5001", token)
	if remove.Code != http.StatusOK || !strings.Contains(remove.Body.String(), `"local_grant_removed":true`) {
		t.Fatalf("remove failed: %d %s", remove.Code, remove.Body.String())
	}
	if remaining := request(g, http.MethodGet, "/v1/sources", "", ""); remaining.Code != http.StatusOK ||
		strings.Contains(remaining.Body.String(), `"source_id":42`) {
		t.Fatalf("removed Source remained visible: %d %s", remaining.Code, remaining.Body.String())
	}
}

func TestDSMOwnerLocalBackupManagementRejectsCSRFAndMalformedBodies(t *testing.T) {
	g, base := newFixture(t)
	target := uint64(7)
	manager := &fakeLocalBackupManagementAgent{
		fakeAgent: base,
		settings: client.LocalBoundBackupSettings{
			SourceID: 42, Name: "Photos", Revision: 1, SyncMode: "backup", TargetNodeID: &target,
		},
		rules: client.LocalBoundIgnoreRules{SourceID: 42, Revision: 1},
	}
	g.Connect = func(context.Context) (Agent, error) { return manager, nil }
	token := getCSRF(t, g)
	for _, payload := range []string{
		`{"source_id":42,"revision":1,"name":"x","name":"y"}`,
		`{"source_id":42,"revision":1,"name":"x","root":"/volume1"}`,
		`{"source_id":42,"revision":1,"name":"x"}{}`,
		`{"source_id":42,"revision":1,"name":"\u0000"}`,
	} {
		w := requestLocalBackupMutation(g, "/v1/local-source-rename", payload,
			"https://nas.example:5001", token)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("malformed local backup body got %d: %s", w.Code, w.Body.String())
		}
	}
	invalidRules := requestLocalBackupMutation(g, "/v1/local-rules",
		`{"source_id":42,"revision":1,"ignore_rules":"../outside"}`,
		"https://nas.example:5001", token)
	if invalidRules.Code != http.StatusBadRequest {
		t.Fatalf("invalid ignore rule accepted: %d", invalidRules.Code)
	}
	noCSRF := requestLocalBackupMutation(g, "/v1/local-mode",
		`{"source_id":42,"revision":1,"sync_mode":"mirror"}`, "", "")
	if noCSRF.Code != http.StatusForbidden {
		t.Fatalf("local backup policy write bypassed CSRF: %d", noCSRF.Code)
	}
	if len(manager.calls) != 0 {
		t.Fatalf("invalid requests reached owning Agent: %v", manager.calls)
	}
}
