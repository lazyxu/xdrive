package synologyui

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type fakeAgent struct {
	runs, controls, scheduleWrites int
	own                            bool
	savedSchedule                  localbackupipc.Schedule
}

func (f *fakeAgent) Sources(context.Context) ([]localbackupipc.BackupSource, error) {
	return []localbackupipc.BackupSource{
		{ID: 42, Name: "Photos", Kind: "local_folder", Direction: "push", SyncMode: "backup"},
		{ID: 99, Name: "Foreign", Kind: "local_folder", Direction: "push", SyncMode: "backup"},
	}, nil
}
func (f *fakeAgent) ReadSchedule(_ context.Context, id uint64) (localbackupipc.Schedule, error) {
	if id != 42 || !f.own {
		return localbackupipc.Schedule{}, errors.New("foreign device")
	}
	if f.savedSchedule.Revision != 0 {
		return f.savedSchedule, nil
	}
	return localbackupipc.Schedule{SourceID: id, Revision: 1, ScheduleType: "manual"}, nil
}
func (f *fakeAgent) SaveSchedule(ctx context.Context, id, previous uint64, spec localbackupipc.Schedule) (localbackupipc.Schedule, error) {
	current, err := f.ReadSchedule(ctx, id)
	if err != nil || previous == 0 || previous != current.Revision || spec.SourceID != id {
		return localbackupipc.Schedule{}, errors.New("stale or foreign owner schedule")
	}
	f.scheduleWrites++
	spec.Revision = previous + 1
	f.savedSchedule = spec
	return spec, nil
}
func (f *fakeAgent) Start(_ context.Context, id uint64) (localbackupipc.Summary, error) {
	f.runs++
	return validStatus(id), nil
}
func (f *fakeAgent) Status(_ context.Context, id uint64) (localbackupipc.Summary, error) {
	return validStatus(id), nil
}
func (f *fakeAgent) History(_ context.Context, id uint64) (localbackupipc.HistoryPage, error) {
	return localbackupipc.HistoryPage{SourceID: id, Items: []localbackupipc.HistoryItem{}}, nil
}
func (f *fakeAgent) Control(_ context.Context, id uint64, action string) (localbackupipc.Summary, error) {
	f.controls++
	return validStatus(id), nil
}
func validStatus(id uint64) localbackupipc.Summary {
	return localbackupipc.Summary{SourceID: id, Revision: 1, State: "partial"}
}

func newFixture(t *testing.T) (*Gateway, *fakeAgent) {
	t.Helper()
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := Authorize(dir, "dsmadmin"); err != nil {
		t.Fatal(err)
	}
	agent := &fakeAgent{own: true}
	gateway := &Gateway{ConfigDir: dir, HTTPS: true, Now: func() time.Time { return time.Unix(1800000000, 0) },
		Authenticate: func(context.Context) (string, error) { return "dsmadmin", nil },
		Connect:      func(context.Context) (Agent, error) { return agent, nil },
	}
	return gateway, agent
}
func request(g *Gateway, method, path, origin, csrfToken string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "https://nas.example:5001"+path, nil)
	r.Header.Set("Cookie", "id=dsm-session")
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	if csrfToken != "" {
		r.Header.Set("X-CSRF-Token", csrfToken)
	}
	w := httptest.NewRecorder()
	g.ServeHTTP(w, r)
	return w
}
func getCSRF(t *testing.T, g *Gateway) string {
	t.Helper()
	w := request(g, http.MethodGet, "/v1/bootstrap", "", "")
	if w.Code != 200 {
		t.Fatalf("bootstrap HTTP %d", w.Code)
	}
	var out struct {
		CSRFToken string `json:"csrf_token"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.CSRFToken) != 64 {
		t.Fatalf("bad CSRF length: %d", len(out.CSRFToken))
	}
	return out.CSRFToken
}
func TestAuthenticatedReadAndOwnerFilteredSources(t *testing.T) {
	g, _ := newFixture(t)
	for _, path := range []string{"/v1/sources", "/v1/status?source_id=42", "/v1/history?source_id=42"} {
		w := request(g, http.MethodGet, path, "", "")
		if w.Code != 200 {
			t.Fatalf("%s: HTTP %d", path, w.Code)
		}
		if w.Header().Get("Cache-Control") != "no-store, private" {
			t.Fatal("sensitive output cached")
		}
		if path == "/v1/sources" && (!contains(w.Body.String(), `"source_id":42`) || contains(w.Body.String(), `"source_id":99`)) {
			t.Fatal("leaked foreign Source")
		}
	}
	g.Authenticate = func(context.Context) (string, error) { return "other", nil }
	if w := request(g, "GET", "/v1/sources", "", ""); w.Code != 403 {
		t.Fatal("foreign DSM user admitted")
	}
}
func contains(s, part string) bool {
	for i := 0; i+len(part) <= len(s); i++ {
		if s[i:i+len(part)] == part {
			return true
		}
	}
	return false
}
func TestWritesNeedSameOriginCSRFAndOwningSource(t *testing.T) {
	g, a := newFixture(t)
	token := getCSRF(t, g)
	tests := []struct {
		origin, token string
		want          int
	}{
		{"", token, 403}, {"https://evil.example", token, 403}, {"https://nas.example:5001", "wrong", 403},
		{"http://nas.example:5001", token, 403}, {"https://nas.example:5001", token, 200},
	}
	for _, tc := range tests {
		w := request(g, "POST", "/v1/run?source_id=42", tc.origin, tc.token)
		if w.Code != tc.want {
			t.Fatalf("origin=%q got %d want %d", tc.origin, w.Code, tc.want)
		}
	}
	if a.runs != 1 {
		t.Fatalf("unexpected writes: %d", a.runs)
	}
	if w := request(g, "POST", "/v1/control?source_id=42&action=pause", "https://nas.example:5001", token); w.Code != 200 {
		t.Fatal("authorized control denied")
	}
	if a.controls != 1 {
		t.Fatal("control not called")
	}
	if w := request(g, "POST", "/v1/run?source_id=99", "https://nas.example:5001", token); w.Code != 403 {
		t.Fatal("foreign Source admitted")
	}
	if a.runs != 1 {
		t.Fatal("foreign Source triggered upload")
	}
}
func requestSchedule(g *Gateway, method, path, payload, origin, csrfToken string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "https://nas.example:5001"+path, strings.NewReader(payload))
	r.Header.Set("Cookie", "id=dsm-session")
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	if csrfToken != "" {
		r.Header.Set("X-CSRF-Token", csrfToken)
	}
	w := httptest.NewRecorder()
	g.ServeHTTP(w, r)
	return w
}

func TestSynologyScheduleOwnerRevisionCSRFAndSameAgent(t *testing.T) {
	g, agent := newFixture(t)
	url := "/v1/schedule?source_id=42"
	first := request(g, http.MethodGet, url, "", "")
	if first.Code != http.StatusOK || !contains(first.Body.String(), `"revision":1`) ||
		!contains(first.Body.String(), `"schedule_type":"manual"`) {
		t.Fatalf("owner schedule read failed: %d %s", first.Code, first.Body.String())
	}
	token := getCSRF(t, g)
	valid := `{"revision":1,"schedule_type":"interval","schedule_expression":"6h","schedule_timezone":""}`
	saved := requestSchedule(g, http.MethodPost, url, valid, "https://nas.example:5001", token)
	if saved.Code != http.StatusOK || !contains(saved.Body.String(), `"revision":2`) ||
		!contains(saved.Body.String(), `"schedule_expression":"6h"`) ||
		agent.scheduleWrites != 1 {
		t.Fatalf("same-Agent schedule save failed: code=%d writes=%d body=%s",
			saved.Code, agent.scheduleWrites, saved.Body.String())
	}
	if reread := request(g, http.MethodGet, url, "", ""); reread.Code != 200 ||
		!contains(reread.Body.String(), `"revision":2`) {
		t.Fatal("updated owning schedule was not readable")
	}
	stale := requestSchedule(g, http.MethodPost, url, valid, "https://nas.example:5001", token)
	if stale.Code != http.StatusConflict || agent.scheduleWrites != 1 {
		t.Fatal("stale Source revision rewrote schedule")
	}
	for _, path := range []string{
		"/v1/schedule?source_id=99",
		"/v1/schedule?source_id=42&source_id=42",
		"/v1/schedule?source_id=42&target=/volume1",
	} {
		w := requestSchedule(g, http.MethodPost, path, valid, "https://nas.example:5001", token)
		if w.Code == http.StatusOK || agent.scheduleWrites != 1 {
			t.Fatalf("unowned/invalid Source schedule accepted: %s", path)
		}
	}
	for _, tc := range []struct{ origin, token string }{
		{"", token}, {"https://attacker.invalid", token},
		{"https://nas.example:5001", "wrong"},
	} {
		w := requestSchedule(g, http.MethodPost, url, valid, tc.origin, tc.token)
		if w.Code != http.StatusForbidden || agent.scheduleWrites != 1 {
			t.Fatal("schedule write bypassed Origin/CSRF")
		}
	}
	g.Authenticate = func(context.Context) (string, error) { return "other", nil }
	if w := requestSchedule(g, http.MethodPost, url, valid, "https://nas.example:5001", token); w.Code != http.StatusForbidden || agent.scheduleWrites != 1 {
		t.Fatal("unapproved DSM user changed owning schedule")
	}
}

func TestSynologyScheduleRejectsUnknownDuplicateOversizedAndInvalidValues(t *testing.T) {
	g, agent := newFixture(t)
	token := getCSRF(t, g)
	url := "/v1/schedule?source_id=42"
	cases := []string{
		`{"revision":1,"revision":1,"schedule_type":"manual","schedule_expression":"","schedule_timezone":""}`,
		`{"revision":1,"schedule_type":"manual","schedule_expression":"","schedule_timezone":"","root":"/volume1"}`,
		`{"revision":1,"schedule_type":"manual","schedule_expression":"","schedule_timezone":""}{}`,
		`{"revision":0,"schedule_type":"manual","schedule_expression":"","schedule_timezone":""}`,
		`{"revision":1,"schedule_type":"mirror","schedule_expression":"","schedule_timezone":""}`,
		`{"revision":1,"schedule_type":"manual","schedule_expression":"6h","schedule_timezone":""}`,
		`{"revision":1,"schedule_type":"interval","schedule_expression":"10s","schedule_timezone":""}`,
		`{"revision":1,"schedule_type":"interval","schedule_expression":"6h","schedule_timezone":"UTC"}`,
		`{"revision":1,"schedule_type":"cron","schedule_expression":"* * *","schedule_timezone":"UTC"}`,
		`{"revision":1,"schedule_type":"cron","schedule_expression":"0 3 * * *","schedule_timezone":""}`,
		`{"revision":1,"schedule_type":"cron","schedule_expression":"0 3 * * *","schedule_timezone":"UTC\nX"}`,
		strings.Repeat("x", 1100),
	}
	for _, payload := range cases {
		w := requestSchedule(g, http.MethodPost, url, payload, "https://nas.example:5001", token)
		if (len(payload) > 1024 && w.Code != http.StatusForbidden) ||
			(len(payload) <= 1024 && w.Code != http.StatusBadRequest) || agent.scheduleWrites != 0 {
			t.Fatalf("invalid schedule accepted: HTTP %d len=%d", w.Code, len(payload))
		}
	}
	if w := requestSchedule(g, http.MethodGet, url, "", "", ""); w.Code != http.StatusOK {
		t.Fatal("rejected schedule request damaged the owning schedule")
	}
}

func TestFailClosedWithoutConfigOrHttps(t *testing.T) {
	g, _ := newFixture(t)
	g.HTTPS = false
	if w := request(g, "GET", "/v1/bootstrap", "", ""); w.Code != 403 {
		t.Fatal("non-HTTPS session accepted")
	}
	g.HTTPS = true
	g.ConfigDir = t.TempDir()
	if w := request(g, "GET", "/v1/bootstrap", "", ""); w.Code != 403 {
		t.Fatal("no explicit authority accepted")
	}
}
func TestRejectUnsafeAuthorityAndPrincipal(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("DSM POSIX mode and symlink checks run on Linux")
	}
	d := t.TempDir()
	_ = os.Chmod(d, 0700)
	for _, v := range []string{"", "../admin", "a/b", "user name", "user\nadmin"} {
		if err := Authorize(d, v); err == nil {
			t.Fatalf("accepted %q", v)
		}
	}
	if err := Authorize(d, "admin"); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(d, authorityName)
	if err := os.Chmod(p, 0666); err != nil {
		t.Fatal(err)
	}
	if _, _, err := loadAuthority(d); err == nil {
		t.Fatal("world-readable key accepted")
	}
	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("/etc/passwd", p); err != nil {
		t.Fatal(err)
	}
	if err := Authorize(d, "admin"); err == nil {
		t.Fatal("existing symlink accepted")
	}
}
