package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func photoHostInventoryFromAdmin(t *testing.T, s *Server) map[string]serviceDependency {
	t.Helper()
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/services", nil)
	s.adminServiceDependencies(ctx)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin services status %d: %s", rec.Code, rec.Body.String())
	}
	var snapshot serviceDependenciesSnapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	out := make(map[string]serviceDependency)
	for _, item := range snapshot.Services {
		out[item.ID] = item
	}
	return out
}

func TestPhotoIntelligenceHostEvidenceIsDistinctFromModelHealthAndAdmission(t *testing.T) {
	s := &Server{HostControlDir: t.TempDir()}
	for _, item := range photoHostInventoryFromAdmin(t, s) {
		if item.Group == "intelligence" &&
			(item.PhotoHostRuntimeState != "" || item.PhotoHostProfileConfigured != nil ||
				item.InstallationState == "observed") {
			t.Fatalf("missing Host Manager fabricated Photo Intelligence installation: %+v", item)
		}
	}
	statusPath := filepath.Join(s.HostControlDir, photoIntelligenceHostStatusName)
	heartbeatPath := filepath.Join(s.HostControlDir, "heartbeat")
	write := func(state string, profile bool) {
		t.Helper()
		data, err := json.Marshal(struct {
			State   string `json:"state"`
			Profile bool   `json:"profile_configured"`
		}{State: state, Profile: profile})
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(statusPath, data, 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(heartbeatPath, []byte("trusted"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		state    string
		profile  bool
		observed bool
	}{
		{"healthy", true, true},
		{"unhealthy", true, true},
		{"starting", true, true},
		{"running-unverified", false, true},
		{"stopped", true, true},
		{"unknown", true, false},
		{"healthy", false, true},
	} {
		write(tc.state, tc.profile)
		rows := photoHostInventoryFromAdmin(t, s)
		for _, id := range []string{"photo-face", "photo-smart", "photo-semantic", "photo-creative"} {
			item := rows[id]
			if item.PhotoHostRuntimeState != tc.state ||
				item.PhotoHostProfileConfigured == nil ||
				*item.PhotoHostProfileConfigured != tc.profile {
				t.Fatalf("%s Host Manager observation %q / %v: %+v", id, tc.state, tc.profile, item)
			}
			if (item.InstallationState == "observed") != tc.observed {
				t.Fatalf("%s container installation state incorrectly observed: %+v", id, item)
			}
			if item.Status != "disabled" || item.HealthState != "not-checked" ||
				item.ActivationState != "deployment-only" ||
				item.ConfigurationState != "unconfigured" {
				t.Fatalf("%s fixed-container observation fabricated model readiness: %+v", id, item)
			}
		}
		for _, id := range []string{"database", "baidu-map", "caddy", "media-worker", "background-worker"} {
			item := rows[id]
			if item.PhotoHostRuntimeState != "" || item.PhotoHostProfileConfigured != nil {
				t.Fatalf("Photo Intelligence host state leaked into %s: %+v", id, item)
			}
		}
	}
	// Old or tampered Host Manager observations must fail closed rather than
	// carrying forward the last healthy-looking state.
	write("healthy", true)
	old := time.Now().Add(-2 * time.Minute)
	if err := os.Chtimes(statusPath, old, old); err != nil {
		t.Fatal(err)
	}
	if state, trusted := s.readPhotoIntelligenceHostStatus(); trusted {
		t.Fatalf("stale observation trusted: %+v", state)
	}
	write("healthy", true)
	if err := os.Chtimes(heartbeatPath, old, old); err != nil {
		t.Fatal(err)
	}
	if state, trusted := s.readPhotoIntelligenceHostStatus(); trusted {
		t.Fatalf("expired heartbeat trusted: %+v", state)
	}
	write("healthy", true)
	future := time.Now().Add(time.Minute)
	if err := os.Chtimes(statusPath, future, future); err != nil {
		t.Fatal(err)
	}
	if state, trusted := s.readPhotoIntelligenceHostStatus(); trusted {
		t.Fatalf("future-dated observation trusted: %+v", state)
	}
	for _, raw := range []string{
		`{"state":"healthy"}`,
		`{"state":"healthy","profile_configured":"true"}`,
		`{"state":"applied","profile_configured":true}`,
		`{"state":"healthy","profile_configured":true`,
		strings.Repeat("x", 513),
	} {
		write("healthy", true)
		if err := os.WriteFile(statusPath, []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		if state, trusted := s.readPhotoIntelligenceHostStatus(); trusted {
			t.Fatalf("invalid or oversized observation trusted: %+v", state)
		}
	}
	write("healthy", true)
	if err := os.Remove(statusPath); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(heartbeatPath, statusPath); err == nil {
		if state, trusted := s.readPhotoIntelligenceHostStatus(); trusted {
			t.Fatalf("symbolic link status file trusted: %+v", state)
		}
	} else {
		t.Logf("filesystem does not support symlink test: %v", err)
	}
}

func TestPhotoIntelligenceHostStatusRequiresAdminAuth(t *testing.T) {
	gin.SetMode(gin.TestMode)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/services", nil)
	rec := httptest.NewRecorder()
	(&Server{}).Router().ServeHTTP(rec, request)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated runtime inventory returned HTTP %d", rec.Code)
	}
}

func TestPhotoHostFixedHealthcheckDigestMustBeFreshAndWellFormed(t *testing.T) {
	dir := t.TempDir()
	srv := &Server{HostControlDir: dir}
	statusPath := filepath.Join(dir, photoIntelligenceHostStatusName)
	heartbeat := filepath.Join(dir, "heartbeat")
	if err := os.WriteFile(heartbeat, []byte("trusted"), 0600); err != nil {
		t.Fatal(err)
	}
	write := func(raw string) {
		t.Helper()
		if err := os.WriteFile(statusPath, []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
	}
	good := strings.Repeat("a", 64)
	write(`{"state":"healthy","profile_configured":true,"healthcheck_session_digest":"` + good + `"}`)
	host, ok := srv.readPhotoIntelligenceHostStatus()
	if !ok || host.State != "healthy" || host.sessionDigest != good {
		t.Fatalf("valid fixed Docker healthcheck not read: %+v observed=%v", host, ok)
	}
	for _, invalid := range []string{
		`{"state":"healthy","profile_configured":true,"healthcheck_session_digest":"short"}`,
		`{"state":"healthy","profile_configured":true,"healthcheck_session_digest":"` + strings.Repeat("A", 64) + `"}`,
		`{"state":"unhealthy","profile_configured":true,"healthcheck_session_digest":"` + good + `"}`,
	} {
		write(invalid)
		if _, ok := srv.readPhotoIntelligenceHostStatus(); ok {
			t.Fatalf("invalid Docker healthcheck digest trusted: %s", invalid)
		}
	}
	write(`{"state":"healthy","profile_configured":true}`)
	legacy, ok := srv.readPhotoIntelligenceHostStatus()
	if !ok || legacy.sessionDigest != "" {
		t.Fatalf("legacy host observation invented identity: %+v", legacy)
	}
	write(`{"state":"healthy","profile_configured":true,"healthcheck_session_digest":"` + good + `"}`)
	old := time.Now().Add(-2 * time.Minute)
	if err := os.Chtimes(statusPath, old, old); err != nil {
		t.Fatal(err)
	}
	if _, ok := srv.readPhotoIntelligenceHostStatus(); ok {
		t.Fatal("stale host healthcheck digest became trusted")
	}
}

func TestPhotoHostSocketOwnerStatusIsPrivateAndFailClosed(t *testing.T) {
	dir := t.TempDir()
	srv := &Server{HostControlDir: dir}
	if err := os.WriteFile(filepath.Join(dir, "heartbeat"), []byte("trusted"), 0600); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, photoIntelligenceHostStatusName)
	write := func(value string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write(`{"state":"healthy","profile_configured":true,"socket_owner_verified":true}`)
	observed, ok := srv.readPhotoIntelligenceHostStatus()
	if !ok || !observed.socketOwned {
		t.Fatalf("fresh private host ownership lost: %+v %v", observed, ok)
	}
	write(`{"state":"healthy","profile_configured":true}`)
	legacy, ok := srv.readPhotoIntelligenceHostStatus()
	if !ok || legacy.socketOwned {
		t.Fatalf("legacy runner invented owner evidence: %+v", legacy)
	}
	for _, invalid := range []string{
		`{"state":"unhealthy","profile_configured":true,"socket_owner_verified":true}`,
		`{"state":"healthy","profile_configured":true,"socket_owner_verified":"true"}`,
		`{"state":"stopped","profile_configured":true,"socket_owner_verified":true}`,
	} {
		write(invalid)
		if _, ok := srv.readPhotoIntelligenceHostStatus(); ok {
			t.Fatal("invalid/impossible owner proof accepted")
		}
	}
}
