package synologyui

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

// This fixture joins the real DSM CGI operation router to its existing
// narrow owning-Agent interfaces. Server/CAS responses are simulated: a
// successful native Root binding is NOT an upload or physical CAS receipt.
type dsmBootstrapManualRunAgent struct {
	*fakeNASSourceCreator
	runs           int
	claimsPhysical bool
}

func (a *dsmBootstrapManualRunAgent) Sources(context.Context) ([]localbackupipc.BackupSource, error) {
	if a.creates == 0 {
		return []localbackupipc.BackupSource{}, nil
	}
	// A paused Source may exist even after an ambiguous Root binding, but
	// the CGI must not expose it as a runnable local Source without proof.
	return []localbackupipc.BackupSource{{
		ID: 57, Name: "NAS Photos", Kind: "local_folder", Direction: "push", SyncMode: "backup",
	}}, nil
}

func (a *dsmBootstrapManualRunAgent) ReadSchedule(_ context.Context, id uint64) (localbackupipc.Schedule, error) {
	if id != 57 || a.creates != 1 || a.binds != 1 || a.failBind ||
		a.ownerName == "different-owner" || a.changeOwnerOnBind {
		return localbackupipc.Schedule{}, errors.New("not an authenticated owning Source")
	}
	return localbackupipc.Schedule{SourceID: id, Revision: 1, ScheduleType: "manual"}, nil
}

func (a *dsmBootstrapManualRunAgent) summary(id uint64) localbackupipc.Summary {
	return localbackupipc.Summary{
		SourceID: id, Revision: 1, State: "uncertain",
		InspectedFiles: 2, ConfirmedFiles: 1, UncertainFiles: 1, ConfirmedBytes: 9,
		// Deliberately exercise the CGI's rejection of a forged stronger claim.
		BackupComplete: a.claimsPhysical, RetirementSafe: a.claimsPhysical,
		CurrentCASVerified: a.claimsPhysical,
	}
}

func (a *dsmBootstrapManualRunAgent) Start(_ context.Context, id uint64) (localbackupipc.Summary, error) {
	a.runs++
	return a.summary(id), nil
}

func (a *dsmBootstrapManualRunAgent) Status(_ context.Context, id uint64) (localbackupipc.Summary, error) {
	return a.summary(id), nil
}

func TestDSMNativeSourceSetupToManualRunCGIFailClosed(t *testing.T) {
	g, native, selection, scope := newDSMSourceCreateFixture(t)
	agent := &dsmBootstrapManualRunAgent{fakeNASSourceCreator: native}
	g.Connect = func(context.Context) (Agent, error) { return agent, nil }
	csrfToken := getCSRF(t, g)
	cgi := DSMCGIPath + "?op="
	origin := "https://nas.example:5001"

	// A valid DSM session/CSRF by itself cannot start an unbound Source.
	before := requestServerLogin(g, http.MethodPost, "", origin, csrfToken, cgi+"run&source_id=57")
	if before.Code != http.StatusForbidden || agent.runs != 0 {
		t.Fatalf("unbound source reached backup Runner: HTTP %d, runs %d", before.Code, agent.runs)
	}

	created := requestServerLogin(g, http.MethodPost, sourceCreateBody(selection, scope, true),
		origin, csrfToken, cgi+"nas-share-create")
	if created.Code != http.StatusOK || native.creates != 1 || native.binds != 1 || agent.runs != 0 {
		t.Fatalf("DSM Source bootstrap must not auto-run: HTTP %d, creates %d, binds %d, runs %d",
			created.Code, native.creates, native.binds, agent.runs)
	}
	var grant struct {
		SourceID uint64 `json:"source_id"`
		State    string `json:"state"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &grant); err != nil ||
		grant.SourceID != 57 || grant.State != "authorized" ||
		strings.Contains(created.Body.String(), native.wantPath) {
		t.Fatalf("invalid or secret-bearing native binding reply: %s (%v)", created.Body.String(), err)
	}

	sources := requestServerLogin(g, http.MethodGet, "", "", "", cgi+"sources")
	if sources.Code != http.StatusOK ||
		!strings.Contains(sources.Body.String(), `"source_id":57`) ||
		strings.Contains(sources.Body.String(), native.wantPath) ||
		strings.Contains(sources.Body.String(), scope) {
		t.Fatalf("authenticated local Source projection failed: %d %s", sources.Code, sources.Body.String())
	}

	run := requestServerLogin(g, http.MethodPost, "", origin, csrfToken, cgi+"run&source_id=57")
	if run.Code != http.StatusOK || agent.runs != 1 {
		t.Fatalf("explicit manual run did not reach the same Agent: HTTP %d, runs %d", run.Code, agent.runs)
	}
	var summary localbackupipc.Summary
	if err := json.Unmarshal(run.Body.Bytes(), &summary); err != nil ||
		!localbackupipc.ValidateSummary(summary, 57) || summary.State != "uncertain" ||
		summary.ConfirmedFiles != 1 || summary.UncertainFiles != 1 ||
		summary.BackupComplete || summary.RetirementSafe || summary.CurrentCASVerified {
		t.Fatalf("DSM misrepresented the original backup result: %s (%v)", run.Body.String(), err)
	}
	status := requestServerLogin(g, http.MethodGet, "", "", "", cgi+"status&source_id=57")
	if status.Code != http.StatusOK || !strings.Contains(status.Body.String(), `"state":"uncertain"`) {
		t.Fatalf("DSM cannot read the original uncertain status: %d %s", status.Code, status.Body.String())
	}
	history := requestServerLogin(g, http.MethodGet, "", "", "", cgi+"history&source_id=57")
	if history.Code != http.StatusOK || !strings.Contains(history.Body.String(), `"items":[]`) {
		t.Fatalf("DSM cannot read original empty history without inventing a receipt: %d %s", history.Code, history.Body.String())
	}

	// Even a compromised/old Agent's positive CAS or Source-wide completion
	// flags must fail closed in the DSM browser projection.
	agent.claimsPhysical = true
	for _, tc := range []struct{ method, endpoint string }{
		{http.MethodPost, cgi + "run&source_id=57"},
		{http.MethodGet, cgi + "status&source_id=57"},
	} {
		reply := requestServerLogin(g, tc.method, "", origin, csrfToken, tc.endpoint)
		if reply.Code != http.StatusServiceUnavailable ||
			strings.Contains(reply.Body.String(), `"current_cas_verified":true`) {
			t.Fatalf("unverified physical claim exposed by DSM: %s HTTP %d: %s",
				tc.endpoint, reply.Code, reply.Body.String())
		}
	}
}

func TestDSMUncertainSourceBindingCannotStartViaCGI(t *testing.T) {
	for _, tc := range []struct {
		name        string
		failBind    bool
		changeOwner bool
	}{
		{name: "Root binding failed", failBind: true},
		{name: "Owner changed after Root binding", changeOwner: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			g, native, selection, scope := newDSMSourceCreateFixture(t)
			native.failBind = tc.failBind
			native.changeOwnerOnBind = tc.changeOwner
			agent := &dsmBootstrapManualRunAgent{fakeNASSourceCreator: native}
			g.Connect = func(context.Context) (Agent, error) { return agent, nil }
			csrfToken := getCSRF(t, g)
			cgi := DSMCGIPath + "?op="
			created := requestServerLogin(g, http.MethodPost,
				sourceCreateBody(selection, scope, true), "https://nas.example:5001", csrfToken,
				cgi+"nas-share-create")
			if created.Code != http.StatusOK ||
				!strings.Contains(created.Body.String(), `"state":"needs_inspection"`) {
				t.Fatalf("native ambiguity must require inspection: %d %s", created.Code, created.Body.String())
			}
			run := requestServerLogin(g, http.MethodPost, "", "https://nas.example:5001",
				csrfToken, cgi+"run&source_id=57")
			if run.Code != http.StatusForbidden || agent.runs != 0 {
				t.Fatalf("unconfirmed Root was allowed to execute: %d %s", run.Code, run.Body.String())
			}
			sources := requestServerLogin(g, http.MethodGet, "", "", "", cgi+"sources")
			if sources.Code != http.StatusOK ||
				strings.Contains(sources.Body.String(), `"source_id":57`) {
				t.Fatalf("unconfirmed Root shown as runnable: %d %s", sources.Code, sources.Body.String())
			}
		})
	}
}
