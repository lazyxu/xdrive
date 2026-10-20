package api

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCaddyHostUnobservedReasonIsReadOnlyAndSourceScoped(t *testing.T) {
	var absent *Server
	if got := absent.caddyHostUnobservedReason(); got != "control-not-configured" {
		t.Fatalf("nil server: %q", got)
	}
	if got := (&Server{}).caddyHostUnobservedReason(); got != "control-not-configured" {
		t.Fatalf("no host control directory: %q", got)
	}

	dir := t.TempDir()
	s := &Server{HostControlDir: dir}
	heartbeat := filepath.Join(dir, "heartbeat")
	snapshot := filepath.Join(dir, caddyHostStatusName)
	assertReason := func(want string) {
		t.Helper()
		if observed, ok := s.readCaddyHostStatus(); ok {
			t.Fatalf("unsafe trusted host state for %s: %+v", want, observed)
		}
		if got := s.caddyHostUnobservedReason(); got != want {
			t.Fatalf("got %q, want %q", got, want)
		}
		detail := s.caddyHostUnobservedDetail()
		if detail == "" || strings.Contains(detail, dir) ||
			strings.Contains(detail, "access_key") ||
			strings.Contains(detail, "Authorization") ||
			strings.Contains(detail, "apply_supported=true") {
			t.Fatalf("untrusted diagnostic detail: %q", detail)
		}
	}

	assertReason("heartbeat-missing")
	if err := os.WriteFile(heartbeat, []byte("live"), 0600); err != nil {
		t.Fatal(err)
	}
	assertReason("snapshot-missing")
	if err := os.WriteFile(snapshot, []byte("not-json"), 0600); err != nil {
		t.Fatal(err)
	}
	assertReason("snapshot-invalid-or-changing")

	older := time.Now().Add(-2 * time.Minute)
	if err := os.Chtimes(heartbeat, older, older); err != nil {
		t.Fatal(err)
	}
	assertReason("heartbeat-stale")
	if err := os.Chtimes(heartbeat, time.Now(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(snapshot, older, older); err != nil {
		t.Fatal(err)
	}
	assertReason("snapshot-stale")
	if err := os.Chtimes(snapshot, time.Now(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(snapshot); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(snapshot, 0700); err != nil {
		t.Fatal(err)
	}
	assertReason("snapshot-invalid")
	if err := os.Remove(snapshot); err != nil {
		t.Fatal(err)
	}

	future := time.Now().Add(time.Minute)
	if err := os.Chtimes(heartbeat, future, future); err != nil {
		t.Fatal(err)
	}
	assertReason("heartbeat-stale")
}

func TestCaddyUnobservedDiagnosticFlowsToInventory(t *testing.T) {
	dir := t.TempDir()
	s := &Server{HostControlDir: dir}
	item := caddyStatusFromAdmin(t, s)
	if item.Status != "unknown" || !strings.Contains(item.Detail, "心跳文件缺失") {
		t.Fatalf("missing Heartbeat must not look healthy: %+v", item)
	}
	if err := os.WriteFile(filepath.Join(dir, "heartbeat"), []byte("live"), 0600); err != nil {
		t.Fatal(err)
	}
	item = caddyStatusFromAdmin(t, s)
	if item.Status != "unknown" || !strings.Contains(item.Detail, "状态快照缺失") ||
		!strings.Contains(item.Detail, "不代表网关未安装") {
		t.Fatalf("missing Caddy snapshot must be visible without false readiness: %+v", item)
	}
}

func TestCaddyHostUnobservedDetailCannotGrantApply(t *testing.T) {
	s := &Server{HostControlDir: t.TempDir()}
	for _, detail := range []string{
		(&Server{}).caddyHostUnobservedDetail(),
		s.caddyHostUnobservedDetail(),
	} {
		if detail == "" || strings.Contains(detail, "已生效") ||
			strings.Contains(detail, "允许重启") ||
			strings.Contains(detail, "Apply: ready") {
			t.Fatalf("diagnostic must not grant host apply: %q", detail)
		}
	}
}
