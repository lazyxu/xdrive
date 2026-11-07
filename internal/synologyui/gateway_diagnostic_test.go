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
