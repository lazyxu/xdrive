package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type caddyLocalComparisonFixture struct {
	server *Server
	dir    string
	id     string
	sha    string
	env    caddyHostEnvSnapshot
	host   caddyHostStatus
	record map[string]any
}

func newCaddyLocalComparisonFixture(t *testing.T) *caddyLocalComparisonFixture {
	t.Helper()
	dir := t.TempDir()
	id, sha := strings.Repeat("1", 24), strings.Repeat("a", 64)
	archive := filepath.Join(dir, "caddy-deploy-results")
	if err := os.Mkdir(archive, 0750); err != nil {
		t.Fatal(err)
	}
	env := caddyHostEnvSnapshot{
		Protocol: caddyHostEnvProtocol, Domain: "media.example.com",
		DomainEnabled: true, LANIP: "192.168.1.9", LANEnabled: true,
		SHA256: sha, ObservedAt: time.Now().UTC(),
	}
	host := caddyHostStatus{
		State: "healthy", HTTPSConfigured: true,
		TLSCheckSupported: true, TLSState: "verified",
		TLSVerifiedDomainSHA256:   caddyLocalHash(env.Domain),
		RuntimeTLSAlignment:       "matched-local",
		LiveConfigSHA256:          strings.Repeat("d", 64),
		HostLocalGenerationSHA256: strings.Repeat("c", 64),
		HostLocalLiveConfigSHA256: strings.Repeat("d", 64),
		InstanceGenerationState:   "same-instance-local",
		LANHTTPSConfigured:        true, LANTLSState: "verified",
		LANVerifiedIPSHA256: caddyLocalHash(env.LANIP),
	}
	return &caddyLocalComparisonFixture{
		server: &Server{HostControlDir: dir, CaddyHostEnvAuthoritative: true},
		dir:    dir, id: id, sha: sha, env: env, host: host,
		record: map[string]any{
			"protocol": caddyHostEnvProtocol, "state": "deployed",
			"request_id": id, "sha256": sha,
			"host_local_generation_sha256":  strings.Repeat("c", 64),
			"host_local_live_config_sha256": strings.Repeat("d", 64),
		},
	}
}

func (f *caddyLocalComparisonFixture) write(t *testing.T) {
	t.Helper()
	for _, item := range []struct {
		file  string
		value any
	}{
		{caddyHostEnvSnapshotName, f.env},
		{caddyHostStatusName, f.host},
		{filepath.Join("caddy-deploy-results", f.id+".json"), f.record},
	} {
		payload, err := json.Marshal(item.value)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(f.dir, item.file), payload, 0640); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(f.dir, "heartbeat"), []byte("live"), 0600); err != nil {
		t.Fatal(err)
	}
}

// Windows cannot emulate the POSIX group/mode constraints on the Host's
// immutable receipt directory. The production archive integration is tested
// on Linux; Windows exercises the same read-only comparison from the bounded
// Host-owned terminal bytes, without relaxing production archive checks.
func (f *caddyLocalComparisonFixture) testStatus(t *testing.T) caddyEnvDeployStatus {
	t.Helper()
	if runtime.GOOS == "windows" {
		state := caddyEnvDeployStatus{State: f.record["state"].(string)}
		if state.State == "deployed" {
			raw, err := json.Marshal(f.record)
			if err != nil {
				t.Fatal(err)
			}
			state.LocalRuntimeState = f.server.caddyLocalRuntimeComparison(raw, f.id, f.sha)
		}
		return state
	}
	state, err := f.server.readCaddyEnvDeployStatus(f.id)
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func TestCaddyHistoricalReceiptCurrentLocalStateFailsClosed(t *testing.T) {
	type scenario struct {
		name   string
		change func(*caddyLocalComparisonFixture)
		want   string
	}
	cases := []scenario{
		{"matching both enabled", func(*caddyLocalComparisonFixture) {}, caddyLocalMatching},
		{"matching LAN only", func(f *caddyLocalComparisonFixture) {
			f.env.Domain = ""
			f.env.DomainEnabled = false
			f.host.HTTPSConfigured = false
			f.host.TLSState = "disabled"
			f.host.TLSVerifiedDomainSHA256 = ""
			f.host.RuntimeTLSAlignment = "unverified"
			f.host.LiveConfigSHA256 = ""
			f.host.InstanceGenerationState = "unverified"
		}, caddyLocalMatching},
		{"new Docker generation", func(f *caddyLocalComparisonFixture) {
			f.host.HostLocalGenerationSHA256 = strings.Repeat("e", 64)
		}, caddyLocalChanged},
		{"in-place reload", func(f *caddyLocalComparisonFixture) {
			f.host.HostLocalLiveConfigSHA256 = strings.Repeat("e", 64)
			f.host.LiveConfigSHA256 = strings.Repeat("e", 64)
		}, caddyLocalChanged},
		{"new committed env", func(f *caddyLocalComparisonFixture) {
			f.env.SHA256 = strings.Repeat("e", 64)
		}, caddyLocalChanged},
		{"saved pending env", func(f *caddyLocalComparisonFixture) {
			f.env.PendingRedeploy = true
		}, caddyLocalUnverified},
		{"legacy archive cannot assert current state", func(f *caddyLocalComparisonFixture) {
			delete(f.record, "host_local_generation_sha256")
			delete(f.record, "host_local_live_config_sha256")
		}, caddyLocalUnverified},
		{"legacy current sampler", func(f *caddyLocalComparisonFixture) {
			f.host.HostLocalGenerationSHA256 = ""
			f.host.HostLocalLiveConfigSHA256 = ""
		}, caddyLocalUnverified},
		{"one-sided witness", func(f *caddyLocalComparisonFixture) {
			delete(f.record, "host_local_live_config_sha256")
		}, caddyLocalUnverified},
		{"invalid historical witness", func(f *caddyLocalComparisonFixture) {
			f.record["host_local_generation_sha256"] = strings.Repeat("G", 64)
		}, caddyLocalUnverified},
		{"forged historical local state", func(f *caddyLocalComparisonFixture) {
			f.record["local_runtime_state"] = caddyLocalMatching
		}, caddyLocalUnverified},
		{"current SNI differs from configured domain", func(f *caddyLocalComparisonFixture) {
			f.host.TLSVerifiedDomainSHA256 = strings.Repeat("f", 64)
		}, caddyLocalUnverified},
		{"current LAN IP differs", func(f *caddyLocalComparisonFixture) {
			f.host.LANVerifiedIPSHA256 = strings.Repeat("f", 64)
		}, caddyLocalUnverified},
		{"one enabled ingress unavailable", func(f *caddyLocalComparisonFixture) {
			f.host.LANTLSState = "unavailable"
			f.host.LANVerifiedIPSHA256 = ""
			f.host.HostLocalGenerationSHA256 = ""
			f.host.HostLocalLiveConfigSHA256 = ""
		}, caddyLocalUnverified},
		{"current configuration incomplete", func(f *caddyLocalComparisonFixture) {
			f.host.LiveConfigSHA256 = ""
			f.host.HostLocalLiveConfigSHA256 = ""
		}, caddyLocalUnverified},
		{"host unhealthy", func(f *caddyLocalComparisonFixture) {
			f.host.State = "unhealthy"
			f.host.TLSState = "unavailable"
			f.host.TLSVerifiedDomainSHA256 = ""
			f.host.InstanceGenerationState = "unverified"
			f.host.RuntimeTLSAlignment = "unverified"
			f.host.LiveConfigSHA256 = ""
			f.host.HostLocalGenerationSHA256 = ""
			f.host.HostLocalLiveConfigSHA256 = ""
			f.host.LANTLSState = "failed"
			f.host.LANVerifiedIPSHA256 = ""
		}, caddyLocalUnverified},
		{"failed receipt", func(f *caddyLocalComparisonFixture) {
			f.record["state"] = "failed"
			f.record["error"] = "installer-busy"
			delete(f.record, "host_local_generation_sha256")
			delete(f.record, "host_local_live_config_sha256")
		}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newCaddyLocalComparisonFixture(t)
			tc.change(f)
			f.write(t)
			value := f.testStatus(t)
			if value.LocalRuntimeState != tc.want {
				t.Fatalf("local state = %q, want %q", value.LocalRuntimeState, tc.want)
			}
			if tc.want == caddyLocalMatching && runtime.GOOS != "windows" {
				w := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(w)
				c.Request = httptest.NewRequest(http.MethodGet,
					"/api/v1/admin/services/caddy/config/deploy?request_id="+f.id, nil)
				f.server.adminCaddyEnvDeployStatus(c)
				if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "\"local_runtime_state\":\"matching-local\"") {
					t.Fatalf("missing scoped admin local comparison: HTTP %d: %s", w.Code, w.Body.String())
				}
				if strings.Contains(w.Body.String(), strings.Repeat("c", 64)) ||
					strings.Contains(w.Body.String(), strings.Repeat("d", 64)) ||
					strings.Contains(w.Body.String(), "host_local_") ||
					strings.Contains(w.Body.String(), "applied_receipt") {
					t.Fatal("private Host witness or fake Applied proof leaked into admin JSON")
				}
			}
		})
	}
}

func TestCaddyCurrentLocalComparisonRequiresFreshUncontendedHost(t *testing.T) {
	cases := []struct {
		name    string
		prepare func(t *testing.T, f *caddyLocalComparisonFixture)
	}{
		{"active mutation", func(t *testing.T, f *caddyLocalComparisonFixture) {
			t.Helper()
			if err := os.WriteFile(filepath.Join(f.dir, "caddy-env-active.json"), []byte("{}"), 0600); err != nil {
				t.Fatal(err)
			}
		}},
		{"queued mutation", func(t *testing.T, f *caddyLocalComparisonFixture) {
			t.Helper()
			if err := os.WriteFile(filepath.Join(f.dir, caddyHostEnvRequestName), []byte("{}"), 0600); err != nil {
				t.Fatal(err)
			}
		}},
		{"stale heartbeat", func(t *testing.T, f *caddyLocalComparisonFixture) {
			t.Helper()
			stale := time.Now().Add(-2 * time.Minute)
			if err := os.Chtimes(filepath.Join(f.dir, "heartbeat"), stale, stale); err != nil {
				t.Fatal(err)
			}
		}},
		{"stale env observation", func(t *testing.T, f *caddyLocalComparisonFixture) {
			t.Helper()
			stale := time.Now().Add(-2 * time.Minute)
			if err := os.Chtimes(filepath.Join(f.dir, caddyHostEnvSnapshotName), stale, stale); err != nil {
				t.Fatal(err)
			}
		}},
		{"stale runtime observation", func(t *testing.T, f *caddyLocalComparisonFixture) {
			t.Helper()
			stale := time.Now().Add(-2 * time.Minute)
			if err := os.Chtimes(filepath.Join(f.dir, caddyHostStatusName), stale, stale); err != nil {
				t.Fatal(err)
			}
		}},
		{"invalid admin authority", func(t *testing.T, f *caddyLocalComparisonFixture) {
			f.server.CaddyHostEnvAuthoritative = false
		}},
	}
	if runtime.GOOS != "windows" {
		cases = append(cases, struct {
			name    string
			prepare func(t *testing.T, f *caddyLocalComparisonFixture)
		}{
			"symlink active mutation",
			func(t *testing.T, f *caddyLocalComparisonFixture) {
				t.Helper()
				if err := os.Symlink("heartbeat", filepath.Join(f.dir, "caddy-env-active.json")); err != nil {
					t.Fatal(err)
				}
			},
		})
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newCaddyLocalComparisonFixture(t)
			f.write(t)
			tc.prepare(t, f)
			got := f.testStatus(t)
			if got.LocalRuntimeState != caddyLocalUnverified {
				t.Fatalf("unsafe Host state incorrectly claimed %q", got.LocalRuntimeState)
			}
		})
	}
}
