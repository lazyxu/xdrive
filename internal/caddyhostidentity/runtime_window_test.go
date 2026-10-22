package caddyhostidentity

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestBindPrivateCaddyRuntimeWindowAcceptsStableHealthyLiveConfig(t *testing.T) {
	now := time.Date(2026, 10, 21, 15, 0, 0, 0, time.UTC)
	rawID := strings.Repeat("a", 64)
	s := privateCaddyRuntimeSample{
		dockerInspection: rawID + "|2026-10-21T14:55:00.123456789Z|1205|true|healthy",
		activeConfigSHA:  strings.Repeat("b", 64),
	}
	got, err := bindPrivateCaddyRuntimeWindow(s, s, now)
	if err != nil {
		t.Fatal(err)
	}
	if !validDigest(got.instanceSHA) || !validDigest(got.generationSHA) ||
		got.liveConfigSHA != s.activeConfigSHA ||
		got.instanceSHA == got.generationSHA {
		t.Fatal("stable Host run did not produce distinct bounded identities")
	}
	out, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != "{}" || strings.Contains(fmt.Sprintf("%+v", got), rawID) ||
		strings.Contains(fmt.Sprintf("%+v", got), "2026-10-21") {
		t.Fatal("private runtime identity exposed raw Docker facts")
	}
	// A same-container Caddy reload MUST be separately detectable.
	changed := s
	changed.activeConfigSHA = strings.Repeat("c", 64)
	if _, err := bindPrivateCaddyRuntimeWindow(s, changed, now); err == nil {
		t.Fatal("accepted in-place live Caddy config rotation")
	}
}

func TestBindPrivateCaddyRuntimeWindowRejectsMissingOrMixedProvenance(t *testing.T) {
	now := time.Date(2026, 10, 21, 15, 0, 0, 0, time.UTC)
	good := privateCaddyRuntimeSample{
		dockerInspection: strings.Repeat("a", 64) +
			"|2026-10-21T14:55:00Z|125|true|healthy",
		activeConfigSHA: strings.Repeat("b", 64),
	}
	testCases := []struct {
		name string
		mod  func(*privateCaddyRuntimeSample)
	}{
		{"missing instance", func(s *privateCaddyRuntimeSample) { s.dockerInspection = "" }},
		{"malformed instance", func(s *privateCaddyRuntimeSample) { s.dockerInspection = "docker|" + s.dockerInspection }},
		{"extra field", func(s *privateCaddyRuntimeSample) { s.dockerInspection += "|injected" }},
		{"newline", func(s *privateCaddyRuntimeSample) { s.dockerInspection += "\n" }},
		{"leading zero PID", func(s *privateCaddyRuntimeSample) {
			s.dockerInspection = strings.Replace(s.dockerInspection, "|125|", "|0125|", 1)
		}},
		{"zero PID", func(s *privateCaddyRuntimeSample) {
			s.dockerInspection = strings.Replace(s.dockerInspection, "|125|", "|0|", 1)
		}},
		{"not healthy", func(s *privateCaddyRuntimeSample) {
			s.dockerInspection = strings.Replace(s.dockerInspection, "|healthy", "|starting", 1)
		}},
		{"not running", func(s *privateCaddyRuntimeSample) {
			s.dockerInspection = strings.Replace(s.dockerInspection, "|true|", "|false|", 1)
		}},
		{"offset timestamp", func(s *privateCaddyRuntimeSample) {
			s.dockerInspection = strings.Replace(s.dockerInspection, "14:55:00Z", "14:55:00+00:00", 1)
		}},
		{"future startup", func(s *privateCaddyRuntimeSample) {
			s.dockerInspection = strings.Replace(s.dockerInspection, "14:55:00Z", "16:55:00Z", 1)
		}},
		{"missing active SHA", func(s *privateCaddyRuntimeSample) { s.activeConfigSHA = "" }},
		{"empty Caddy response SHA", func(s *privateCaddyRuntimeSample) { s.activeConfigSHA = emptySHA256 }},
		{"mixed-case SHA", func(s *privateCaddyRuntimeSample) { s.activeConfigSHA = strings.Repeat("A", 64) }},
		{"all-zero Docker ID", func(s *privateCaddyRuntimeSample) {
			s.dockerInspection = strings.Repeat("0", 64) + s.dockerInspection[64:]
		}},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			m := good
			tc.mod(&m)
			got, err := bindPrivateCaddyRuntimeWindow(good, m, now)
			if err == nil || got != (boundPrivateCaddyRuntime{}) {
				t.Fatal("admitted an altered Host runtime window")
			}
			got, err = bindPrivateCaddyRuntimeWindow(m, m, now)
			if err == nil || got != (boundPrivateCaddyRuntime{}) {
				t.Fatal("admitted a malformed self-consistent Host runtime claim")
			}
		})
	}
	// A new *self-consistent* running process with a different PID is valid.
	// It must be a different generation and must never be mixed with the
	// previous one. The old test incorrectly called the new valid sample bad.
	original, err := bindPrivateCaddyRuntimeWindow(good, good, now)
	if err != nil {
		t.Fatal("valid initial Docker generation was rejected")
	}
	changedPID := good
	changedPID.dockerInspection = strings.Replace(changedPID.dockerInspection, "|125|", "|126|", 1)
	if _, err := bindPrivateCaddyRuntimeWindow(good, changedPID, now); err == nil {
		t.Fatal("mixed process generations were accepted")
	}
	later, err := bindPrivateCaddyRuntimeWindow(changedPID, changedPID, now)
	if err != nil || later.instanceSHA != original.instanceSHA ||
		later.generationSHA == original.generationSHA ||
		later.liveConfigSHA != original.liveConfigSHA {
		t.Fatal("valid new process generation lost independent identity", err)
	}
	if _, err := bindPrivateCaddyRuntimeWindow(good, good, time.Time{}); err == nil {
		t.Fatal("zero verification time admitted")
	}
}
