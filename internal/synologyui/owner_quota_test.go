package synologyui

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type quotaReaderFixture struct {
	*fakeAgent
	reads int
	fail  bool
	bad   bool
}

func (f *quotaReaderFixture) OwnerQuota(context.Context) (localbackupipc.OwnerQuota, error) {
	f.reads++
	if f.fail {
		return localbackupipc.OwnerQuota{}, errors.New("PRIVATE Server session secret")
	}
	if f.bad {
		return localbackupipc.OwnerQuota{PhysicalUsedBytes: -1}, nil
	}
	return localbackupipc.OwnerQuota{
		QuotaBytes: 8192, PhysicalUsedBytes: 1024,
		ReservedBytes: 256, AvailableBytes: 6912,
		LogicalFileBytes: 1500, TrashBytes: 80, HistoryBytes: 100,
	}, nil
}

func TestDSMOwnerQuotaReadOnlyAuthenticatedAndFailClosed(t *testing.T) {
	g, agent := newFixture(t)
	quota := &quotaReaderFixture{fakeAgent: agent}
	g.Connect = func(context.Context) (Agent, error) { return quota, nil }
	handler := CGIHandler(g)
	read := func(method, suffix string, cookie bool) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "https://nas.example:5001"+DSMCGIPath+suffix, nil)
		if cookie {
			r.Header.Set("Cookie", "id=dsm-session")
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	w := read(http.MethodGet, "?op=cloud-quota", true)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"reserved_bytes":256`) ||
		!strings.Contains(w.Body.String(), `"quota_bytes":8192`) {
		t.Fatalf("Server Owner quota unavailable: HTTP %d %s", w.Code, w.Body.String())
	}
	for _, input := range []string{
		"?op=cloud-quota&source_id=42",
		"?op=cloud-quota&op=run",
		"?op=cloud-quota&limit=200",
		"?op=cloud-quota;source_id=42",
	} {
		if result := read(http.MethodGet, input, true); result.Code == http.StatusOK {
			t.Fatalf("arbitrary or duplicate quota operation accepted: %s", input)
		}
	}
	if w := read(http.MethodPost, "?op=cloud-quota", true); w.Code == http.StatusOK {
		t.Fatal("quota route accepted write")
	}
	if w := read(http.MethodGet, "?op=cloud-quota", false); w.Code == http.StatusOK {
		t.Fatal("quota route bypassed DSM session cookie")
	}
	if quota.reads != 1 || agent.runs != 0 || agent.controls != 0 {
		t.Fatal("invalid quota operation reached Owner Agent or native Backup writer")
	}
	quota.bad = true
	if w := read(http.MethodGet, "?op=cloud-quota", true); w.Code != http.StatusServiceUnavailable {
		t.Fatal("invalid quota bytes exposed to JavaScript")
	}
	quota.bad = false
	quota.fail = true
	if w := read(http.MethodGet, "?op=cloud-quota", true); w.Code != http.StatusServiceUnavailable ||
		strings.Contains(w.Body.String(), "PRIVATE") {
		t.Fatal("upstream token leaked into DSM quota response")
	}
	g.Authenticate = func(context.Context) (string, error) { return "other", nil }
	before := quota.reads
	if w := read(http.MethodGet, "?op=cloud-quota", true); w.Code != http.StatusForbidden ||
		quota.reads != before {
		t.Fatal("foreign DSM principal received Agent Server Owner quota")
	}
}

func TestDSMQuotaMissingAgentCapabilityIsNotFakeZero(t *testing.T) {
	g, agent := newFixture(t)
	w := request(g, http.MethodGet, "/v1/cloud-quota", "", "")
	if w.Code != http.StatusNotImplemented || agent.runs != 0 {
		t.Fatalf("missing Agent quota capability should be unavailable, HTTP %d", w.Code)
	}
}
