package synologyui

import (
	"context"
	"errors"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

// Status-only reasons make simultaneous DSM Source/Share/Owner failures
// actionable without exposing any private Agent paths, credentials or errors.
func TestDSMBackupAgentOutageUsesOneSafeFailureReason(t *testing.T) {
	g, _ := newFixture(t)
	private := "private discovery path and token must not be returned"
	g.Connect = func(context.Context) (Agent, error) {
		return nil, errors.New(private)
	}
	for _, path := range []string{
		"/v1/sources", "/v1/nas-shares", "/v1/server-connection",
	} {
		reply := request(g, http.MethodGet, path, "", "")
		if reply.Code != http.StatusServiceUnavailable ||
			reply.Header().Get("X-XDrive-DSM-Failure") != "agent-unavailable" {
			t.Fatalf("%s: expected safe Agent outage, status=%d header=%q",
				path, reply.Code, reply.Header().Get("X-XDrive-DSM-Failure"))
		}
		if strings.Contains(reply.Body.String(), private) {
			t.Fatalf("%s leaked an Agent error", path)
		}
	}
}

func TestDSMShareScanErrorIsNotMisclassifiedAsAgentOutage(t *testing.T) {
	g, _ := newFixture(t)
	// Same-user Agent connected; only the restricted NAS inventory fails.
	g.nasShareRoot = filepath.Join(t.TempDir(), "missing")
	reply := request(g, http.MethodGet, "/v1/nas-shares", "", "")
	if reply.Code != http.StatusServiceUnavailable ||
		reply.Header().Get("X-XDrive-DSM-Failure") != "nas-inventory-unavailable" {
		t.Fatalf("share inventory: status=%d header=%q",
			reply.Code, reply.Header().Get("X-XDrive-DSM-Failure"))
	}
	if strings.Contains(reply.Body.String(), g.nasShareRoot) {
		t.Fatal("private NAS path leaked to browser")
	}
}

type failingDSMServerConnectionAgent struct {
	*fakeAgent
}

func (f *failingDSMServerConnectionAgent) ServerConnection(context.Context) (localbackupipc.ServerConnection, error) {
	return localbackupipc.ServerConnection{}, errors.New("private stored login state")
}

func (f *failingDSMServerConnectionAgent) LoginServer(context.Context, string, string, string) error {
	return errors.New("private stored login state")
}

func TestDSMServerStatusFailureDoesNotImplyBadLoginOrNASACL(t *testing.T) {
	g, backing := newFixture(t)
	g.Connect = func(context.Context) (Agent, error) {
		return &failingDSMServerConnectionAgent{fakeAgent: backing}, nil
	}
	reply := request(g, http.MethodGet, "/v1/server-connection", "", "")
	if reply.Code != http.StatusServiceUnavailable ||
		reply.Header().Get("X-XDrive-DSM-Failure") != "server-connection-unavailable" {
		t.Fatalf("Server login status: status=%d header=%q",
			reply.Code, reply.Header().Get("X-XDrive-DSM-Failure"))
	}
	if strings.Contains(reply.Body.String(), "private stored login state") {
		t.Fatal("private Owner credential state leaked")
	}
}

func TestDSMNativeAuthOutputDistinguishesRealSessionRejectionFromHelperOutage(t *testing.T) {
	private := "secret NAS path and credential"
	cases := []struct {
		name           string
		output         string
		runErr, ctxErr error
		user           string
		wantErr        error
	}{
		{"valid", "dsmadmin\n", nil, nil, "dsmadmin", nil},
		{"valid-crlf", "dsmadmin\r\n", nil, nil, "dsmadmin", nil},
		{"valid-no-newline", "dsmadmin", nil, nil, "dsmadmin", nil},
		{"logged-out", "", nil, nil, "", errDSMSessionRejected},
		{"blank-line", "\r\n", nil, nil, "", errDSMSessionRejected},
		{"native-failed", "", errors.New(private), nil, "", errDSMAuthHelper},
		{"native-exit-with-username", "dsmadmin", errors.New(private), nil, "", errDSMAuthHelper},
		{"timeout", "", errors.New(private), context.DeadlineExceeded, "", errDSMAuthTimeout},
		{"oversize", strings.Repeat("a", 129), nil, nil, "", errDSMAuthInvalidOutput},
		{"two-identities", "dsmadmin\nother", nil, nil, "", errDSMAuthInvalidOutput},
		{"embedded-nul", "dsmadmin\x00", nil, nil, "", errDSMAuthInvalidOutput},
		{"trailing-cr", "dsmadmin\r", nil, nil, "", errDSMAuthInvalidOutput},
		{"unsupported-name", "user name", nil, nil, "", errDSMAuthInvalidOutput},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			user, err := classifyDSMAuthenticateCGIResult(
				[]byte(tc.output), tc.runErr, tc.ctxErr)
			if user != tc.user || (tc.wantErr == nil && err != nil) ||
				(tc.wantErr != nil && !errors.Is(err, tc.wantErr)) {
				t.Fatalf("got username=%q err=%v; want username=%q err=%v",
					user, err, tc.user, tc.wantErr)
			}
			if err != nil && strings.Contains(err.Error(), private) {
				t.Fatal("native helper detail leaked through authentication error")
			}
		})
	}
}

func TestDSMAuthenticationFailuresUseSafeDistinctStatusAndNeverReachAgent(t *testing.T) {
	g, _ := newFixture(t)
	var connected int
	g.Connect = func(context.Context) (Agent, error) {
		connected++
		return nil, errors.New("private Agent state")
	}
	private := "private auth helper stderr and cookie"
	cases := []struct {
		name, username string
		err            error
		status         int
		reason         string
	}{
		{"logged-out", "", errDSMSessionRejected, 401, "dsm-session-rejected"},
		{"empty-identity", "", nil, 401, "dsm-session-rejected"},
		{"no-cgi-env", "", errDSMAuthEnvironment, 503, "dsm-auth-environment"},
		{"helper-timeout", "", errDSMAuthTimeout, 503, "dsm-auth-timeout"},
		{"helper-failed", "", errDSMAuthHelper, 503, "dsm-auth-helper-failed"},
		{"malformed-result", "", errDSMAuthInvalidOutput, 503, "dsm-auth-response-invalid"},
		{"malformed-identity", "bad user", nil, 503, "dsm-auth-response-invalid"},
		{"other-helper-failure", "", errors.New(private), 503, "dsm-auth-unavailable"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			g.Authenticate = func(context.Context) (string, error) {
				return tc.username, tc.err
			}
			for _, path := range []string{"/v1/bootstrap", "/v1/sources",
				"/v1/nas-shares", "/v1/server-connection"} {
				reply := request(g, http.MethodGet, path, "", "")
				if reply.Code != tc.status ||
					reply.Header().Get("X-XDrive-DSM-Failure") != tc.reason {
					t.Fatalf("%s: got HTTP %d and code %q; want HTTP %d and code %q",
						path, reply.Code, reply.Header().Get("X-XDrive-DSM-Failure"),
						tc.status, tc.reason)
				}
				if strings.Contains(reply.Body.String(), private) ||
					strings.Contains(reply.Body.String(), "cookie") {
					t.Fatal("private authentication detail leaked to DSM UI")
				}
			}
		})
	}
	if connected != 0 {
		t.Fatalf("failed DSM auth reached the owning Agent: %d", connected)
	}
}

func TestDSMPrincipalAndCSRFHaveDifferentForbiddenDiagnosticCodes(t *testing.T) {
	g, _ := newFixture(t)
	g.Authenticate = func(context.Context) (string, error) { return "other", nil }
	principal := request(g, http.MethodGet, "/v1/sources", "", "")
	if principal.Code != http.StatusForbidden ||
		principal.Header().Get("X-XDrive-DSM-Failure") != "dsm-principal-unapproved" {
		t.Fatal("unapproved DSM user did not receive fixed principal reason")
	}
	g.Authenticate = func(context.Context) (string, error) { return "dsmadmin", nil }
	csrf := request(g, http.MethodPost, "/v1/run?source_id=42",
		"https://attacker.invalid", "wrong")
	if csrf.Code != http.StatusForbidden ||
		csrf.Header().Get("X-XDrive-DSM-Failure") != "dsm-csrf-rejected" {
		t.Fatal("invalid DSM CSRF or Origin was not distinguished")
	}
	if ok := request(g, http.MethodGet, "/v1/bootstrap", "", ""); ok.Code != 200 ||
		ok.Header().Get("X-XDrive-DSM-Failure") != "" {
		t.Fatal("valid DSM bootstrap leaked an old diagnostic or failed")
	}
}
