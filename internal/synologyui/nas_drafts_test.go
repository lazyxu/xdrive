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

type fakeDSMNativeDraftReader struct {
	*fakeNASSourceCreator
	items       []localbackupipc.LocalBackupDraft
	readErr     error
	reads       int
	changeOwner bool
}

func (f *fakeDSMNativeDraftReader) LocalDrafts(context.Context) ([]localbackupipc.LocalBackupDraft, error) {
	f.reads++
	if f.changeOwner {
		f.ownerName = "other-owner"
	}
	return f.items, f.readErr
}

func nativeDraftFixture(t *testing.T) (*Gateway, *fakeDSMNativeDraftReader, string) {
	t.Helper()
	g, base, _, scope := newDSMSourceCreateFixture(t)
	reader := &fakeDSMNativeDraftReader{fakeNASSourceCreator: base}
	g.Connect = func(context.Context) (Agent, error) { return reader, nil }
	return g, reader, scope
}

func TestDSMNativeDraftInspectionOwnedUnboundReadOnlyAndNoSecrets(t *testing.T) {
	g, agent, scope := nativeDraftFixture(t)
	created := time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC)
	agent.items = []localbackupipc.LocalBackupDraft{
		{SourceID: 57, Name: "NAS Photos", Revision: 1, Created: created},
		{SourceID: 58, Name: "NAS Documents", Revision: 1, Created: created},
	}
	reply := requestServerLogin(g, http.MethodGet, "", "", "",
		DSMCGIPath + "?op=nas-drafts")
	if reply.Code != http.StatusOK || agent.reads != 1 ||
		agent.creates != 0 || agent.binds != 0 || agent.preflights != 0 {
		t.Fatalf("DSM read-only draft inspection is unsafe: HTTP %d %s", reply.Code, reply.Body.String())
	}
	var body struct {
		OwnerScope string `json:"owner_scope"`
		Items      []struct {
			SourceID  uint64    `json:"source_id"`
			Name      string    `json:"name"`
			Revision  uint64    `json:"revision"`
			CreatedAt time.Time `json:"created_at"`
		} `json:"items"`
	}
	if err := json.Unmarshal(reply.Body.Bytes(), &body); err != nil ||
		body.OwnerScope != scope || len(body.Items) != 2 ||
		body.Items[0].SourceID != 57 || body.Items[0].Revision != 1 ||
		body.Items[1].SourceID != 58 || !body.Items[0].CreatedAt.Equal(created) {
		t.Fatalf("unverified local draft projection: %s (%v)", reply.Body.String(), err)
	}
	for _, secret := range []string{agent.wantPath, "device_id", "root_id", "device_token",
		"fingerprint", "local_path", "backup_complete", "current_cas_verified"} {
		if strings.Contains(reply.Body.String(), secret) {
			t.Fatalf("native draft inspection disclosed %q", secret)
		}
	}
	agent.items = nil
	empty := requestServerLogin(g, http.MethodGet, "", "", "",
		DSMCGIPath + "?op=nas-drafts")
	if empty.Code != http.StatusOK ||
		!strings.Contains(empty.Body.String(), `"items":[]`) {
		t.Fatalf("no owning drafts must mean empty inventory, not a new Source: %d %s",
			empty.Code, empty.Body.String())
	}
}

func TestDSMNativeDraftInspectionRequiresOwnerAndStrictGET(t *testing.T) {
	g, agent, _ := nativeDraftFixture(t)
	base := DSMCGIPath + "?op=nas-drafts"
	for _, tc := range []struct {
		method, path string
		expected     int
	}{
		{http.MethodGet, base + "&path=/volume1/photo", http.StatusBadRequest},
		{http.MethodGet, base + "&source_id=57", http.StatusBadRequest},
		{http.MethodPost, base, http.StatusMethodNotAllowed},
		{http.MethodGet, "/v1/nas-drafts", http.StatusForbidden},
	} {
		res := requestServerLogin(g, tc.method, "", "https://nas.example:5001",
			getCSRF(t, g), tc.path)
		if res.Code != tc.expected || agent.reads != 0 {
			t.Fatalf("untrusted DSM draft request accepted: %s %s HTTP %d reads=%d",
				tc.method, tc.path, res.Code, agent.reads)
		}
	}
	g.Authenticate = func(context.Context) (string, error) {
		return "foreign-dsm-user", nil
	}
	res := requestServerLogin(g, http.MethodGet, "", "", "", base)
	if res.Code != http.StatusForbidden || agent.reads != 0 {
		t.Fatalf("other DSM principal read private draft inventory: %d", res.Code)
	}
}

func TestDSMNativeDraftInspectionNeverLeaksUncertainOrForeignState(t *testing.T) {
	for _, tc := range []struct {
		name        string
		items       []localbackupipc.LocalBackupDraft
		changeOwner bool
		readErr     error
		wantStatus  int
	}{
		{"Owner switched mid-read", nil, true, nil, http.StatusConflict},
		{"Agent draft read failure", nil, false, errors.New("private native error"), http.StatusServiceUnavailable},
		{"zero ID", []localbackupipc.LocalBackupDraft{{SourceID: 0, Revision: 1, Name: "NAS", Created: time.Now()}}, false, nil, http.StatusServiceUnavailable},
		{"unexpected revision", []localbackupipc.LocalBackupDraft{{SourceID: 57, Revision: 2, Name: "NAS", Created: time.Now()}}, false, nil, http.StatusServiceUnavailable},
		{"unsorted", []localbackupipc.LocalBackupDraft{
			{SourceID: 58, Revision: 1, Name: "NAS 1", Created: time.Now()},
			{SourceID: 57, Revision: 1, Name: "NAS 2", Created: time.Now()},
		}, false, nil, http.StatusServiceUnavailable},
		{"unsafe name", []localbackupipc.LocalBackupDraft{{SourceID: 57, Revision: 1, Name: "NAS\nRoot", Created: time.Now()}}, false, nil, http.StatusServiceUnavailable},
		{"missing creation time", []localbackupipc.LocalBackupDraft{{SourceID: 57, Revision: 1, Name: "NAS"}}, false, nil, http.StatusServiceUnavailable},
		{"oversized inventory", func() []localbackupipc.LocalBackupDraft {
			items := make([]localbackupipc.LocalBackupDraft, 101)
			for i := range items {
				items[i] = localbackupipc.LocalBackupDraft{
					SourceID: uint64(i + 1), Revision: 1, Name: "NAS", Created: time.Now(),
				}
			}
			return items
		}(), false, nil, http.StatusServiceUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			g, agent, _ := nativeDraftFixture(t)
			agent.items = tc.items
			agent.changeOwner = tc.changeOwner
			agent.readErr = tc.readErr
			res := requestServerLogin(g, http.MethodGet, "", "", "",
				DSMCGIPath + "?op=nas-drafts")
			if res.Code != tc.wantStatus || agent.reads != 1 ||
				strings.Contains(res.Body.String(), `"source_id"`) ||
				strings.Contains(res.Body.String(), agent.wantPath) {
				t.Fatalf("unsafe/incomplete draft was exposed: HTTP %d (%s), reads=%d",
					res.Code, res.Body.String(), agent.reads)
			}
		})
	}
}

func TestDSMNativeDraftInspectionOldAgentFailsClosed(t *testing.T) {
	g, base := newFixture(t)
	g.Connect = func(context.Context) (Agent, error) {
		return &fakeServerLoginAgent{fakeAgent: base}, nil
	}
	res := requestServerLogin(g, http.MethodGet, "", "", "",
		DSMCGIPath + "?op=nas-drafts")
	if res.Code != http.StatusNotImplemented {
		t.Fatalf("old Agent cannot claim native draft inspection: %d", res.Code)
	}
}
