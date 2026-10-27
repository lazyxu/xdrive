package synologyui

import (
	"context"
	"net/http"
	"net/http/cgi"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDSMRealCGIPathRoutesToSharedOwnerGateway(t *testing.T) {
	g, a := newFixture(t)
	handler := CGIHandler(g)
	send := func(method, suffix, origin, csrfToken string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "https://nas.example:5001"+DSMCGIPath+suffix, nil)
		r.Header.Set("Cookie", "id=dsm-session")
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if csrfToken != "" {
			r.Header.Set("X-CSRF-Token", csrfToken)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	b := send("GET", "?op=bootstrap", "", "")
	if b.Code != http.StatusOK {
		t.Fatalf("bootstrap HTTP %d", b.Code)
	}
	token := getCSRF(t, g)
	for _, query := range []string{"?op=sources", "?op=status&source_id=42", "?op=history&source_id=42", "?op=schedule&source_id=42"} {
		if w := send("GET", query, "", ""); w.Code != http.StatusOK {
			t.Fatalf("%s: HTTP %d", query, w.Code)
		}
	}
	if w := send("POST", "?op=run&source_id=42", "https://nas.example:5001", token); w.Code != http.StatusOK {
		t.Fatalf("run CGI HTTP %d", w.Code)
	}
	scheduleBody := `{"revision":1,"schedule_type":"manual","schedule_expression":"","schedule_timezone":""}`
	scheduleRequest := httptest.NewRequest("POST",
		"https://nas.example:5001"+DSMCGIPath+"?op=schedule&source_id=42",
		strings.NewReader(scheduleBody))
	scheduleRequest.Header.Set("Cookie", "id=dsm-session")
	scheduleRequest.Header.Set("Origin", "https://nas.example:5001")
	scheduleRequest.Header.Set("X-CSRF-Token", token)
	scheduleReply := httptest.NewRecorder()
	handler.ServeHTTP(scheduleReply, scheduleRequest)
	if scheduleReply.Code != http.StatusOK || a.scheduleWrites != 1 {
		t.Fatal("DSM CGI schedule did not use original owning Agent")
	}
	if a.runs != 1 {
		t.Fatal("original owning Agent was not used")
	}
	for _, query := range []string{
		"?op=status&source_id=99",
		"?op=run&source_id=42&source_id=43",
		"?op=run&source_id=42&x=1",
		"?op=run&source_id=42&action=cancel",
		"?op=control&source_id=42&action=pause&action=cancel",
		"?op=run&source_id=42;action=cancel",
		"?op=run&op=control&source_id=42",
		"?op=delete&source_id=42",
		"?op=run&source_id=42%QQ",
	} {
		w := send("POST", query, "https://nas.example:5001", token)
		if w.Code == http.StatusOK {
			t.Fatalf("unsafe CGI request accepted: %s", query)
		}
	}
	if a.runs != 1 {
		t.Fatal("invalid CGI request triggered backup")
	}
	if a.controls != 0 {
		t.Fatal("duplicate or invalid control action reached owning Agent")
	}
	if w := send("GET", "/v1/status?op=status&source_id=42", "", ""); w.Code != http.StatusForbidden {
		t.Fatal("unexpected PATH_INFO accepted")
	}
	if w := send("GET", "?op=status&source_id=42", "", ""); w.Code != http.StatusOK {
		t.Fatal("valid read unavailable after rejected CGI requests")
	}
}

func TestCGIRequiresTrustedRouteAndHTTPS(t *testing.T) {
	handler := CGIHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("unverified request reached backing gateway")
	}))
	for _, path := range []string{
		"/wrong/backup.cgi?op=sources",
		"/webman/3rdparty/xdrivenas/backup.cgi/extra?op=sources",
		"/webman/3rdparty/xdrivenas/%62ackup.cgi?op=sources",
	} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", "https://nas.example:5001"+path, nil))
		if w.Code != http.StatusForbidden {
			t.Fatalf("%s: HTTP %d", path, w.Code)
		}
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "http://nas.example:5000"+DSMCGIPath+"?op=sources", nil))
	if w.Code != http.StatusForbidden {
		t.Fatal("plaintext DSM CGI accepted")
	}
}

// Exercise net/http/cgi's actual DSM environment-to-Request conversion rather
// than only httptest.NewRequest: HTTPS, cookie and Origin must survive intact.
func TestCGIEnvironmentRequestFromDSM(t *testing.T) {
	g, agent := newFixture(t)
	token := getCSRF(t, g)
	env := map[string]string{
		"REQUEST_METHOD":    "POST",
		"SERVER_PROTOCOL":   "HTTP/1.1",
		"HTTP_HOST":         "nas.example:5001",
		"REQUEST_URI":       DSMCGIPath + "?op=run&source_id=42",
		"HTTPS":             "on",
		"REMOTE_ADDR":       "192.0.2.10",
		"REMOTE_PORT":       "41234",
		"HTTP_COOKIE":       "id=dsm-session",
		"HTTP_ORIGIN":       "https://nas.example:5001",
		"HTTP_X_CSRF_TOKEN": token,
	}
	call := func() int {
		t.Helper()
		req, err := cgi.RequestFromMap(env)
		if err != nil {
			t.Fatal(err)
		}
		w := httptest.NewRecorder()
		CGIHandler(g).ServeHTTP(w, req)
		return w.Code
	}
	if code := call(); code != http.StatusOK || agent.runs != 1 {
		t.Fatalf("DSM HTTPS CGI request rejected: status=%d runs=%d", code, agent.runs)
	}
	// HTTP downgrade is refused before reaching the original owning Agent.
	env["HTTPS"] = "off"
	if code := call(); code != http.StatusForbidden || agent.runs != 1 {
		t.Fatalf("plaintext CGI accepted: status=%d runs=%d", code, agent.runs)
	}
	env["HTTPS"] = "on"
	// A forged proxy username cannot override the real DSM auth result.
	env["HTTP_REMOTE_USER"] = "dsmadmin"
	env["HTTP_X_FORWARDED_USER"] = "dsmadmin"
	g.Authenticate = func(context.Context) (string, error) { return "other", nil }
	if code := call(); code != http.StatusForbidden || agent.runs != 1 {
		t.Fatalf("spoofed CGI user accepted: status=%d runs=%d", code, agent.runs)
	}
}
