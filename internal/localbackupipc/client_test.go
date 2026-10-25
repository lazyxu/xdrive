package localbackupipc

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
)

func testEndpoint(t *testing.T, route http.Handler) (string, *httptest.Server) {
	t.Helper()
	server := httptest.NewServer(route)
	t.Cleanup(server.Close)
	dir := t.TempDir()
	payload, err := json.Marshal(discovery{
		Version: 1, BaseURL: server.URL,
		Token: strings.Repeat("a", 64), PID: os.Getpid(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, discoveryName), payload, 0o600); err != nil {
		t.Fatal(err)
	}
	return dir, server
}

func testHello(w http.ResponseWriter) {
	_ = json.NewEncoder(w).Encode(hello{
		DiscoveryVersion: 1, ProtocolMin: 2, ProtocolMax: 2,
		PID: os.Getpid(), Platform: runtime.GOOS,
		Capabilities: []string{"device-backup-local-common-batch", "device-backup-local-schedule"},
	})
}

func TestSharedSummaryNeverCertifiesWholeSource(t *testing.T) {
	ok := Summary{SourceID: 42, Revision: 7, State: "partial",
		InspectedFiles: 5, ConfirmedFiles: 2, SkippedFiles: 1,
		UnsupportedFiles: 2}
	if !ValidateSummary(ok, 42) {
		t.Fatal("bounded partial file-level result rejected")
	}
	tests := map[string]func(*Summary){
		"wrong_source":      func(s *Summary) { s.SourceID++ },
		"fake_complete":     func(s *Summary) { s.State = "complete" },
		"whole_source":      func(s *Summary) { s.BackupComplete = true },
		"legacy_retirement": func(s *Summary) { s.RetirementSafe = true },
		"physical_CAS":      func(s *Summary) { s.CurrentCASVerified = true },
		"invalid_sum":       func(s *Summary) { s.SkippedFiles = 10 },
		"fake_running":      func(s *Summary) { s.Running = true },
		"missing_revision":  func(s *Summary) { s.Revision = 0 },
		"negative_count":    func(s *Summary) { s.UnsupportedFiles = -1 },
		"fake_stop":         func(s *Summary) { s.StopRequested = "cancel" },
	}
	for name, change := range tests {
		t.Run(name, func(t *testing.T) {
			v := ok
			change(&v)
			if ValidateSummary(v, 42) {
				t.Fatalf("forged backup result accepted: %+v", v)
			}
		})
	}
}

func TestDiscoveryRejectsUntrustedTargetsAndSymlinks(t *testing.T) {
	dir, _ := testEndpoint(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		testHello(w)
	}))
	for _, raw := range []string{
		"not-json",
		`{"version":1,"base_url":"https://127.0.0.1:1234","token":"x","pid":1234}`,
		`{"version":1,"base_url":"http://192.168.0.1:1234","token":"x","pid":1234}`,
	} {
		if err := os.WriteFile(filepath.Join(dir, discoveryName), []byte(raw), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := readDiscovery(dir); err == nil {
			t.Fatal("invalid discovery accepted")
		}
	}
	if runtime.GOOS != "windows" {
		target := filepath.Join(dir, "elsewhere.json")
		_ = os.WriteFile(target, []byte("{}"), 0o600)
		_ = os.Remove(filepath.Join(dir, discoveryName))
		if err := os.Symlink(target, filepath.Join(dir, discoveryName)); err == nil {
			if _, err := readDiscovery(dir); err == nil {
				t.Fatal("symlinked bearer token accepted")
			}
		}
	}
}

func TestAgentIPCRunsSingleExistingWorkerWithOwnerToken(t *testing.T) {
	const id = uint64(42)
	requests := []string{}
	dir, _ := testEndpoint(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 64) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		requests = append(requests, r.Method+" "+r.URL.String())
		if r.URL.Path == "/v1/hello" {
			testHello(w)
			return
		}
		switch r.URL.Path {
		case "/v1/device-backups/local-common-batch":
			result := Summary{SourceID: id, State: "running", Running: true}
			if r.Method == http.MethodGet {
				result = Summary{SourceID: id, Revision: 3, State: "partial",
					InspectedFiles: 1, ConfirmedFiles: 1}
			}
			_ = json.NewEncoder(w).Encode(result)
		case "/v1/device-backups/local-schedule":
			if r.Method == http.MethodGet {
				_ = json.NewEncoder(w).Encode(Schedule{SourceID: id, Revision: 3,
					ScheduleType: "manual"})
			} else {
				var spec Schedule
				_ = json.NewDecoder(r.Body).Decode(&spec)
				spec.Revision++
				_ = json.NewEncoder(w).Encode(spec)
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	c, err := Connect(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	result, err := c.Start(context.Background(), id)
	if err != nil || !result.Running {
		t.Fatalf("shared original worker start failed: %+v %v", result, err)
	}
	result, err = c.Status(context.Background(), id)
	if err != nil || result.Running || result.ConfirmedFiles != 1 {
		t.Fatalf("shared original worker status failed: %+v %v", result, err)
	}
	schedule, err := c.ReadSchedule(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	updated, err := c.SaveSchedule(context.Background(), id, schedule.Revision,
		Schedule{SourceID: id, ScheduleType: "interval", ScheduleExpression: "6h"})
	if err != nil || updated.Revision != 4 || updated.ScheduleExpression != "6h" {
		t.Fatalf("Source-revision fenced schedule failed: %+v %v", updated, err)
	}
	for _, expected := range []string{
		"POST /v1/device-backups/local-common-batch?source_id=42",
		"GET /v1/device-backups/local-common-batch?source_id=42",
		"GET /v1/device-backups/local-schedule?source_id=42",
		"PATCH /v1/device-backups/local-schedule",
	} {
		if !strings.Contains(strings.Join(requests, "\n"), expected) {
			t.Errorf("missing existing Agent API %s", expected)
		}
	}
}

func TestAgentIPCRejectsForgedPIDAndFakeComplete(t *testing.T) {
	dir, _ := testEndpoint(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/hello" {
			_ = json.NewEncoder(w).Encode(hello{
				DiscoveryVersion: 1, ProtocolMin: 2, ProtocolMax: 2,
				PID: os.Getpid() + 1, Platform: runtime.GOOS,
				Capabilities: []string{"device-backup-local-common-batch", "device-backup-local-schedule"},
			})
			return
		}
		w.WriteHeader(http.StatusForbidden)
	}))
	if _, err := Connect(context.Background(), dir); err == nil ||
		errors.Is(err, ErrAgentUnavailable) {
		t.Fatal("forged live PID should fail closed, not trigger auto-spawn")
	}
	if _, err := Connect(context.Background(), filepath.Join(dir, "missing")); !errors.Is(err, ErrAgentUnavailable) {
		t.Fatal("absent Agent must be distinguishable from an invalid one")
	}
}

func TestHistoryRejectsFabricatedCompletion(t *testing.T) {
	now := time.Now().UTC()
	item := HistoryItem{RunID: "attempt-1", SourceID: 9, Revision: 1,
		State: "partial", InspectedFiles: 2, ConfirmedFiles: 1,
		UnsupportedFiles: 1, StartedAt: now.Add(-time.Minute), FinishedAt: now}
	if !ValidateHistory(HistoryPage{SourceID: 9, Items: []HistoryItem{item}}, 9) {
		t.Fatal("valid redacted historical per-file record rejected")
	}
	item.State = "complete"
	if ValidateHistory(HistoryPage{SourceID: 9, Items: []HistoryItem{item}}, 9) {
		t.Fatal("forged whole-source completion accepted")
	}
}

func TestMountUsesExistingAuthenticatedFullAgentIPC(t *testing.T) {
	current := filepath.Join(t.TempDir(), "initial")
	requested := filepath.Join(t.TempDir(), "new-mount")
	var calls []string
	wrongAcknowledgement := false
	dir, _ := testEndpoint(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 64) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		calls = append(calls, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "GET /v1/hello":
			_ = json.NewEncoder(w).Encode(hello{
				DiscoveryVersion: 1, ProtocolMin: 2, ProtocolMax: 2,
				PID: os.Getpid(), Platform: runtime.GOOS, RuntimeMode: "full",
				Capabilities: []string{"settings", "sync-control",
					"device-backup-local-common-batch", "device-backup-local-schedule"},
			})
		case "GET /v1/settings":
			_ = json.NewEncoder(w).Encode(MountSettings{MountPath: current})
		case "PATCH /v1/settings":
			var request struct {
				MountPath string `json:"mount_path"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil ||
				request.MountPath != requested {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			current = requested
			if wrongAcknowledgement {
				_ = json.NewEncoder(w).Encode(MountSettings{MountPath: requested + "-wrong"})
			} else {
				_ = json.NewEncoder(w).Encode(MountSettings{MountPath: current})
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	client, err := Connect(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.RequireFullMode(); err != nil {
		t.Fatalf("full Agent with verified capabilities was rejected: %v", err)
	}
	settings, err := client.MountSettings(context.Background())
	if err != nil || settings.MountPath != current {
		t.Fatalf("Agent mount settings failed: %+v %v", settings, err)
	}
	settings, err = client.UpdateMountPath(context.Background(), requested)
	if err != nil || settings.MountPath != requested {
		t.Fatalf("Agent mount-path update failed: %+v %v", settings, err)
	}
	if want := "PATCH /v1/settings"; !strings.Contains(strings.Join(calls, "\n"), want) {
		t.Fatalf("xd mount bypassed authenticated Agent settings: %v", calls)
	}
	wrongAcknowledgement = true
	if _, err := client.UpdateMountPath(context.Background(), requested); err == nil {
		t.Fatal("incorrect Agent mount-path acknowledgement must fail closed")
	}
	if _, err := client.UpdateMountPath(context.Background(), "relative/path"); err == nil {
		t.Fatal("relative mount root passed CLI validation")
	}
}

func TestMountRejectsBackupOnlyLegacyAndMissingCapabilities(t *testing.T) {
	for _, tc := range []struct {
		name         string
		mode         string
		capabilities []string
	}{
		{"backup_only", "backup_only", []string{
			"device-backup-local-common-batch", "device-backup-local-schedule"}},
		{"legacy", "", []string{
			"device-backup-local-common-batch", "device-backup-local-schedule"}},
		{"inconsistent_full", "full", []string{
			"device-backup-local-common-batch", "device-backup-local-schedule"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			settingsCalls := 0
			dir, _ := testEndpoint(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/v1/hello" {
					_ = json.NewEncoder(w).Encode(hello{
						DiscoveryVersion: 1, ProtocolMin: 2, ProtocolMax: 2,
						PID: os.Getpid(), Platform: runtime.GOOS,
						RuntimeMode: tc.mode, Capabilities: tc.capabilities,
					})
					return
				}
				settingsCalls++
				w.WriteHeader(http.StatusForbidden)
			}))
			client, err := Connect(context.Background(), dir)
			if err != nil {
				t.Fatalf("existing xd backup must remain compatible with this Agent: %v", err)
			}
			if err := client.RequireFullMode(); err == nil {
				t.Fatal("xd mount accepted non-full or incapable Agent")
			}
			if _, err := client.UpdateMountPath(context.Background(),
				filepath.Join(t.TempDir(), "mount")); err == nil {
				t.Fatal("xd mount modified settings on an unverified Agent")
			}
			if settingsCalls != 0 {
				t.Fatalf("xd mount touched forbidden Agent settings %d times", settingsCalls)
			}
		})
	}
}
