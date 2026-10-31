package synologyui

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type fakeDSMBinder struct {
	*fakeDSMNativeDraftReader
	weakIdentity bool
	failBind     bool
	switchOwner  bool
}

func (f *fakeDSMBinder) AuthorizeLocalRoot(_ context.Context, id uint64, path string) (localbackupipc.LocalBackupRootGrant, error) {
	f.binds++
	if f.switchOwner {
		f.ownerName = "changed-owner"
	}
	if id != 57 || path != f.wantPath {
		return localbackupipc.LocalBackupRootGrant{}, errors.New("invalid native bound root")
	}
	if f.failBind {
		return localbackupipc.LocalBackupRootGrant{}, errors.New("lost native grant acknowledgement")
	}
	return localbackupipc.LocalBackupRootGrant{
		SourceID: id, Path: path, Status: "awaiting_executor",
		StrongIdentity: !f.weakIdentity,
	}, nil
}

func dsmDraftBindFixture(t *testing.T) (*Gateway, *fakeDSMBinder, string, string) {
	t.Helper()
	g, base, selection, scope := newDSMSourceCreateFixture(t)
	reader := &fakeDSMNativeDraftReader{
		fakeNASSourceCreator: base,
		items: []localbackupipc.LocalBackupDraft{{
			SourceID: 57, Name: "NAS Photos", Revision: 1,
			Created: time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC),
		}},
	}
	agent := &fakeDSMBinder{fakeDSMNativeDraftReader: reader}
	g.Connect = func(context.Context) (Agent, error) { return agent, nil }
	return g, agent, selection, scope
}

func dsmDraftBindBody(id uint64, selection, scope string, confirmed bool) string {
	data, _ := json.Marshal(map[string]any{
		"source_id": id, "selection_id": selection,
		"owner_scope": scope, "confirmed": confirmed,
	})
	return string(data)
}

func TestDSMNativeDraftBindOnlyExplicitVerifiedOwningRoot(t *testing.T) {
	g, agent, selection, scope := dsmDraftBindFixture(t)
	response := requestServerLogin(g, http.MethodPost,
		dsmDraftBindBody(57, selection, scope, true),
		"https://nas.example:5001", getCSRF(t, g),
		DSMCGIPath+"?op=nas-draft-bind")
	if response.Code != http.StatusOK || agent.reads != 1 ||
		agent.preflights != 1 || agent.binds != 1 || agent.creates != 0 ||
		agent.runs != 0 {
		t.Fatalf("original native draft was not safely rebound: %d %s", response.Code, response.Body.String())
	}
	var ack map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &ack); err != nil ||
		len(ack) != 2 || ack["source_id"] != float64(57) ||
		ack["state"] != "authorized" {
		t.Fatalf("invalid native binding acknowledgement: %s %v", response.Body.String(), err)
	}
	for _, secret := range []string{agent.wantPath, scope, selection, "root_id",
		"device_token", "content_sha256", "backup_complete"} {
		if strings.Contains(response.Body.String(), secret) {
			t.Fatalf("DSM native draft bind leaked %q", secret)
		}
	}
}

func TestDSMNativeDraftBindFailClosedWithoutConfirmedSourceOrSelection(t *testing.T) {
	g, agent, selection, scope := dsmDraftBindFixture(t)
	url := DSMCGIPath + "?op=nas-draft-bind"
	body := dsmDraftBindBody(57, selection, scope, true)
	for _, tc := range []struct {
		name, method, payload, origin, token, path string
	}{
		{"unconfirmed", "POST", dsmDraftBindBody(57, selection, scope, false), "https://nas.example:5001", getCSRF(t, g), url},
		{"foreign ID", "POST", dsmDraftBindBody(99, selection, scope, true), "https://nas.example:5001", getCSRF(t, g), url},
		{"zero ID", "POST", dsmDraftBindBody(0, selection, scope, true), "https://nas.example:5001", getCSRF(t, g), url},
		{"foreign owner", "POST", dsmDraftBindBody(57, selection, strings.Repeat("f", 64), true), "https://nas.example:5001", getCSRF(t, g), url},
		{"invalid share", "POST", dsmDraftBindBody(57, strings.Repeat("0", 64), scope, true), "https://nas.example:5001", getCSRF(t, g), url},
		{"arbitrary local path", "POST", strings.TrimSuffix(body, "}") + `,"path":"/etc"}`, "https://nas.example:5001", getCSRF(t, g), url},
		{"duplicate source id", "POST", strings.TrimSuffix(body, "}") + `,"source_id":58}`, "https://nas.example:5001", getCSRF(t, g), url},
		{"wrong method", "GET", "", "", "", url},
		{"missing CSRF", "POST", body, "https://nas.example:5001", "", url},
		{"wrong origin", "POST", body, "https://evil.example", getCSRF(t, g), url},
		{"query injection", "POST", body, "https://nas.example:5001", getCSRF(t, g), url + "&source_id=57"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := agent.binds
			got := requestServerLogin(g, tc.method, tc.payload, tc.origin, tc.token, tc.path)
			if got.Code == http.StatusOK || agent.binds != before {
				t.Fatalf("unsafe draft bind accepted: %s HTTP %d %s", tc.name, got.Code, got.Body.String())
			}
		})
	}
	agent.items = nil
	noDraft := requestServerLogin(g, "POST", body, "https://nas.example:5001",
		getCSRF(t, g), url)
	if noDraft.Code != http.StatusConflict || agent.binds != 0 {
		t.Fatalf("unknown/previously bound Source was rebound: %d %s", noDraft.Code, noDraft.Body.String())
	}
}

func TestDSMNativeDraftBindWeakUnknownOrRotatedOwnerNeedsInspection(t *testing.T) {
	for _, name := range []string{"weak", "uncertain", "owner-changed"} {
		t.Run(name, func(t *testing.T) {
			g, agent, selection, scope := dsmDraftBindFixture(t)
			switch name {
			case "weak":
				agent.weakIdentity = true
			case "uncertain":
				agent.failBind = true
			case "owner-changed":
				agent.switchOwner = true
			}
			got := requestServerLogin(g, "POST",
				dsmDraftBindBody(57, selection, scope, true),
				"https://nas.example:5001", getCSRF(t, g),
				DSMCGIPath+"?op=nas-draft-bind")
			if got.Code != http.StatusOK || agent.binds != 1 ||
				agent.creates != 0 || agent.runs != 0 ||
				!strings.Contains(got.Body.String(), `"state":"needs_inspection"`) ||
				strings.Contains(got.Body.String(), `"state":"authorized"`) {
				t.Fatalf("uncertain native bind misrepresented success: %d %s", got.Code, got.Body.String())
			}
		})
	}
}

// A valid draft read cannot authorize the binding if the Agent's actual
// Server Owner changes between listing the creating-device drafts and the
// irreversible native Root grant.
func TestDSMNativeDraftBindOwnerChangedBeforeGrantRefusesMutation(t *testing.T) {
	g, agent, selection, scope := dsmDraftBindFixture(t)
	agent.changeOwner = true
	result := requestServerLogin(g, http.MethodPost,
		dsmDraftBindBody(57, selection, scope, true),
		"https://nas.example:5001", getCSRF(t, g),
		DSMCGIPath+"?op=nas-draft-bind")
	if result.Code != http.StatusConflict || agent.reads != 1 ||
		agent.binds != 0 || agent.creates != 0 ||
		agent.runs != 0 {
		t.Fatalf("rotated Owner reached irreversible native grant: HTTP %d %s",
			result.Code, result.Body.String())
	}
}

func TestDSMNativeDraftBindOldAgentUnavailable(t *testing.T) {
	g, base := newFixture(t)
	g.Connect = func(context.Context) (Agent, error) { return base, nil }
	result := requestServerLogin(g, "POST",
		dsmDraftBindBody(57, strings.Repeat("a", 64), strings.Repeat("b", 64), true),
		"https://nas.example:5001", getCSRF(t, g),
		DSMCGIPath+"?op=nas-draft-bind")
	if result.Code != http.StatusNotImplemented {
		t.Fatalf("old Agent accepted unknown Root bind: %d", result.Code)
	}
}
