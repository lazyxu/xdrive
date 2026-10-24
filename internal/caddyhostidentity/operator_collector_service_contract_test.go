package caddyhostidentity

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The operator-only unit must not turn a key preflight into a privileged,
// network-accessible signer, nor silently install itself at boot.
func TestCaddyCollectorPreflightSystemdSandboxContract(t *testing.T) {
	path := filepath.Join("..", "..", "deploy", "xdrive-caddy-collector-preflight.service")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) == 0 || len(raw) > 8<<10 || raw[len(raw)-1] != '\n' {
		t.Fatal("missing, oversized or non-canonical Collector unit")
	}
	// Exact allowlist: new directives (including ExecStartPre, Environment,
	// SupplementaryGroups, Restart, sockets or Install) require security review.
	expected := map[string]string{
		"Unit.Description":                "xDrive Caddy Collector operator-only preflight (NO Applied)",
		"Unit.Documentation":              "https://github.com/lazyxu/xdrive/issues/2075",
		"Service.Type":                    "oneshot",
		"Service.User":                    "xdrive-caddy-collector",
		"Service.Group":                   "xdrive-caddy-collector",
		"Service.WorkingDirectory":        "/",
		"Service.ExecStart":               "/usr/local/libexec/xdrive-caddy-collector-preflight",
		"Service.UMask":                   "0077",
		"Service.NoNewPrivileges":         "yes",
		"Service.CapabilityBoundingSet":   "",
		"Service.AmbientCapabilities":     "",
		"Service.PrivateNetwork":          "yes",
		"Service.PrivateDevices":          "yes",
		"Service.PrivateTmp":              "yes",
		"Service.IPAddressDeny":           "any",
		"Service.RestrictAddressFamilies": "AF_UNIX",
		"Service.ProtectSystem":           "strict",
		"Service.ProtectHome":             "yes",
		"Service.ProtectKernelTunables":   "yes",
		"Service.ProtectKernelModules":    "yes",
		"Service.ProtectControlGroups":    "yes",
		"Service.ProtectHostname":         "yes",
		"Service.ProtectClock":            "yes",
		"Service.ProtectKernelLogs":       "yes",
		"Service.RestrictNamespaces":      "yes",
		"Service.RestrictSUIDSGID":        "yes",
		"Service.RestrictRealtime":        "yes",
		"Service.LockPersonality":         "yes",
		"Service.MemoryDenyWriteExecute":  "yes",
		"Service.SystemCallArchitectures": "native",
		"Service.ReadOnlyPaths":           "/etc/xdrive/collector /var/lib/xdrive-caddy-collector",
		"Service.TimeoutStartSec":         "10s",
	}
	section := ""
	seen := make(map[string]bool, len(expected))
	for lineNo, original := range strings.Split(string(raw), "\n") {
		line := strings.TrimSpace(original)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") {
			if line != "[Unit]" && line != "[Service]" {
				t.Fatalf("line %d: unexpected unit section %q", lineNo+1, line)
			}
			section = strings.Trim(line, "[]")
			continue
		}
		index := strings.IndexByte(line, '=')
		if section == "" || index <= 0 {
			t.Fatalf("line %d: unexpected unit syntax", lineNo+1)
		}
		key := section + "." + line[:index]
		want, permitted := expected[key]
		if !permitted || seen[key] || line[index+1:] != want {
			t.Fatalf("line %d: unauthorized, repeated or weakened unit property %s", lineNo+1, key)
		}
		seen[key] = true
	}
	if len(seen) != len(expected) {
		for key := range expected {
			if !seen[key] {
				t.Errorf("missing required Collector isolation property: %s", key)
			}
		}
	}
}
