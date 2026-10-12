package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestPhotoHostModelInfoRequiresExactHostRequestToken(t *testing.T) {
	desired := photoHostDesired{Revision: 7, Enabled: true}
	gate := meta.AdminPhotoHostApply{
		Revision: 7, State: "host-verified", RequestID: "0123456789abcdef01234567",
	}
	if !photoHostModelInfoAllowed(desired, gate, true, "host-verified") {
		t.Fatal("fresh exact host receipt should permit a manual Info check")
	}
	for name, tc := range map[string]struct {
		desired photoHostDesired
		gate    meta.AdminPhotoHostApply
		present bool
		receipt string
	}{
		"no saved revision": {photoHostDesired{}, gate, true, "host-verified"},
		"saved disable":     {photoHostDesired{Revision: 7}, gate, true, "host-verified"},
		"missing gate":      {desired, gate, false, "host-verified"},
		"stale revision":    {photoHostDesired{Revision: 8, Enabled: true}, gate, true, "host-verified"},
		"queued":            {desired, meta.AdminPhotoHostApply{Revision: 7, State: "queued", RequestID: gate.RequestID}, true, "host-verified"},
		"bad token":         {desired, meta.AdminPhotoHostApply{Revision: 7, State: "host-verified", RequestID: "raw-client-id"}, true, "host-verified"},
		"host drift":        {desired, gate, true, ""},
	} {
		t.Run(name, func(t *testing.T) {
			if photoHostModelInfoAllowed(tc.desired, tc.gate, tc.present, tc.receipt) {
				t.Fatal("untrusted host evidence authorized model readiness")
			}
		})
	}
}

func TestPhotoHostModelInfoIndependentAndRedacted(t *testing.T) {
	leak := "SECRET_MODEL_PATH_/run/private"
	probes := []photoHostModelInfoTask{
		{ID: "photo-face", Configured: true, Probe: func(context.Context) (string, error) { return "", nil }},
		{ID: "photo-smart", Configured: true, Probe: func(context.Context) (string, error) { return "", errors.New(leak) }},
		{ID: "photo-semantic", Configured: false},
		{ID: "photo-creative", Configured: true, Probe: func(context.Context) (string, error) { return "", nil }},
	}
	out := runPhotoHostModelInfoChecks(context.Background(), probes)
	if len(out) != 4 {
		t.Fatalf("expected four fixed states, got %+v", out)
	}
	for i, expected := range []string{"ready", "failed", "unconfigured", "ready"} {
		if out[i].ID != probes[i].ID || out[i].State != expected {
			t.Fatalf("model %d incorrectly reported: %+v", i, out[i])
		}
		if strings.Contains(out[i].Detail, leak) {
			t.Fatal("raw model error escaped trusted boundary")
		}
	}
	for _, item := range unverifiedPhotoHostModelInfoChecks() {
		if item.State != "unknown" {
			t.Fatalf("unproven host was presented as active: %+v", item)
		}
	}
}

func TestPhotoHostModelInfoTimeoutFailsClosed(t *testing.T) {
	block := make(chan struct{})
	defer close(block)
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	begin := time.Now()
	out := runPhotoHostModelInfoChecks(ctx, []photoHostModelInfoTask{
		{ID: "photo-face", Configured: true, Probe: func(context.Context) (string, error) {
			<-block
			return "0123456789abcdef0123456789abcdef", nil
		}},
	})
	if time.Since(begin) > time.Second || len(out) != 1 || out[0].State != "unknown" {
		t.Fatalf("timed-out model probe produced false success or blocked request: %+v", out)
	}
}

// The exact 32-char instance nonce must not leak through JSON. A healthy
// legacy, mixed generation, partial or malformed set never passes coherence.
func TestPhotoHostFourModelRuntimeSessionCoherence(t *testing.T) {
	session := "0123456789abcdef0123456789abcdef"
	tasks := make([]photoHostModelInfoTask, 4)
	for i, id := range []string{"photo-face", "photo-smart", "photo-semantic", "photo-creative"} {
		tasks[i] = photoHostModelInfoTask{
			ID: id, Configured: true, Probe: func(context.Context) (string, error) {
				return session, nil
			},
		}
	}
	checks := runPhotoHostModelInfoChecks(context.Background(), tasks)
	if !photoHostModelInstanceCoherent(checks) {
		t.Fatalf("all four same-session live responses not recognized: %+v", checks)
	}
	raw, err := json.Marshal(checks)
	if err != nil || strings.Contains(string(raw), session) || strings.Contains(string(raw), "runtimeInstanceID") {
		t.Fatal("private runtime session leaked in administrator response")
	}
	for _, tc := range []struct {
		name   string
		change func([]photoHostModelInfoCheck) []photoHostModelInfoCheck
	}{
		{"legacy", func(items []photoHostModelInfoCheck) []photoHostModelInfoCheck {
			items[1].runtimeInstanceID = ""
			return items
		}},
		{"different process", func(items []photoHostModelInfoCheck) []photoHostModelInfoCheck {
			items[2].runtimeInstanceID = strings.Repeat("a", 32)
			return items
		}},
		{"failed Info", func(items []photoHostModelInfoCheck) []photoHostModelInfoCheck {
			items[0].State = "failed"
			return items
		}},
		{"partial", func(items []photoHostModelInfoCheck) []photoHostModelInfoCheck {
			return items[:3]
		}},
		{"wrong order", func(items []photoHostModelInfoCheck) []photoHostModelInfoCheck {
			items[0], items[1] = items[1], items[0]
			return items
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			copyChecks := append([]photoHostModelInfoCheck(nil), checks...)
			if photoHostModelInstanceCoherent(tc.change(copyChecks)) {
				t.Fatal("unsafe model same-process claim")
			}
		})
	}
}

func TestPhotoHostDockerHealthcheckDigestIsCorroborationNotTaskProof(t *testing.T) {
	session := "0123456789abcdef0123456789abcdef"
	ids := [...]string{"photo-face", "photo-smart", "photo-semantic", "photo-creative"}
	checks := make([]photoHostModelInfoCheck, len(ids))
	for i, id := range ids {
		checks[i] = photoHostModelInfoCheck{ID: id, State: "ready", runtimeInstanceID: session}
	}
	digestBytes := sha256.Sum256([]byte(session))
	digest := hex.EncodeToString(digestBytes[:])
	host := photoIntelligenceHostStatus{State: "healthy", ProfileConfigured: true, sessionDigest: digest}
	if !photoHostDockerHealthcheckMatched(checks, host) {
		t.Fatal("four valid coherent models did not match the fixed-container healthcheck digest")
	}
	raw, err := json.Marshal(adminPhotoHostPreflightDTO{
		ModelInfoChecks: checks, ModelInstanceCoherent: true, DockerHealthcheckMatched: true,
	})
	if err != nil || strings.Contains(string(raw), session) || strings.Contains(string(raw), digest) {
		t.Fatal("private session identity or healthcheck digest leaked to admin JSON")
	}
	for _, tc := range []struct {
		name string
		host photoIntelligenceHostStatus
	}{
		{"legacy host", photoIntelligenceHostStatus{State: "healthy", ProfileConfigured: true}},
		{"wrong digest", photoIntelligenceHostStatus{State: "healthy", ProfileConfigured: true, sessionDigest: strings.Repeat("f", 64)}},
		{"malformed digest", photoIntelligenceHostStatus{State: "healthy", ProfileConfigured: true, sessionDigest: "invalid"}},
		{"unhealthy", photoIntelligenceHostStatus{State: "unhealthy", ProfileConfigured: true, sessionDigest: digest}},
		{"profile disabled", photoIntelligenceHostStatus{State: "healthy", sessionDigest: digest}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if photoHostDockerHealthcheckMatched(checks, tc.host) {
				t.Fatal("unsupported or stale Docker healthcheck was accepted")
			}
		})
	}
	mixed := append([]photoHostModelInfoCheck(nil), checks...)
	mixed[1].runtimeInstanceID = strings.Repeat("a", 32)
	if photoHostDockerHealthcheckMatched(mixed, host) {
		t.Fatal("mixed model generation was accepted")
	}
}

func TestPhotoHostSocketOwnerRequiresDigestAndFourCoherentInfo(t *testing.T) {
	session := "0123456789abcdef0123456789abcdef"
	ids := [...]string{"photo-face", "photo-smart", "photo-semantic", "photo-creative"}
	checks := make([]photoHostModelInfoCheck, len(ids))
	for i, id := range ids {
		checks[i] = photoHostModelInfoCheck{ID: id, State: "ready", runtimeInstanceID: session}
	}
	hash := sha256.Sum256([]byte(session))
	digest := hex.EncodeToString(hash[:])
	host := photoIntelligenceHostStatus{State: "healthy", ProfileConfigured: true, sessionDigest: digest, socketOwned: true}
	if !photoHostDockerSocketOwnerVerified(checks, host) {
		t.Fatal("valid private kernel+digest Info proof lost")
	}
	raw, err := json.Marshal(adminPhotoHostPreflightDTO{ModelInfoChecks: checks, SocketOwnerVerified: true})
	if err != nil || strings.Contains(string(raw), session) || strings.Contains(string(raw), digest) ||
		strings.Contains(string(raw), "/run/xdrive-photo-face/") || strings.Contains(string(raw), "81203") {
		t.Fatal("private host process/socket identity leaked to administrator")
	}
	for _, tc := range []struct {
		name string
		host photoIntelligenceHostStatus
	}{
		{"old runner", photoIntelligenceHostStatus{State: "healthy", ProfileConfigured: true, sessionDigest: digest}},
		{"no digest", photoIntelligenceHostStatus{State: "healthy", ProfileConfigured: true, socketOwned: true}},
		{"mismatched digest", photoIntelligenceHostStatus{State: "healthy", ProfileConfigured: true, socketOwned: true, sessionDigest: strings.Repeat("f", 64)}},
		{"stopped host", photoIntelligenceHostStatus{State: "stopped", ProfileConfigured: true, socketOwned: true, sessionDigest: digest}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if photoHostDockerSocketOwnerVerified(checks, tc.host) {
				t.Fatal("false-positive host process proof")
			}
		})
	}
}

func TestPhotoHostEnableRequestGenerationCorrelationFailsClosedOnRestart(t *testing.T) {
	session := "0123456789abcdef0123456789abcdef"
	ids := [...]string{"photo-face", "photo-smart", "photo-semantic", "photo-creative"}
	checks := make([]photoHostModelInfoCheck, len(ids))
	for i, id := range ids {
		checks[i] = photoHostModelInfoCheck{ID: id, State: "ready", runtimeInstanceID: session}
	}
	sha := sha256.Sum256([]byte(session))
	digest := hex.EncodeToString(sha[:])
	requestID := "0123456789abcdef01234567"
	host := photoIntelligenceHostStatus{
		State: "healthy", ProfileConfigured: true, sessionDigest: digest, socketOwned: true,
	}
	control := photoHostControlStatus{
		Supported: true, State: "success", Revision: 7, AppliedRevision: 7,
		Enabled: true, ProfileVerified: true, ObservedHostState: "healthy",
		RequestID: requestID, AppliedInstanceDigest: digest,
	}
	gate := meta.AdminPhotoHostApply{State: "host-verified", Revision: 7, RequestID: requestID}
	if !photoHostRequestGenerationCorrelated(checks, host, control, gate) {
		t.Fatal("fresh audited request and pinned model generation were not correlated")
	}
	for _, tc := range []struct {
		name    string
		host    photoIntelligenceHostStatus
		control photoHostControlStatus
		gate    meta.AdminPhotoHostApply
	}{
		{"legacy no generation receipt", host, func() photoHostControlStatus { old := control; old.AppliedInstanceDigest = ""; return old }(), gate},
		{"untrusted control bridge", host, func() photoHostControlStatus { old := control; old.Supported = false; return old }(), gate},
		{"wrong request token", host, control, meta.AdminPhotoHostApply{State: "host-verified", Revision: 7, RequestID: "ffffffffffffffffffffffff"}},
		{"stale desired revision", host, control, meta.AdminPhotoHostApply{State: "host-verified", Revision: 8, RequestID: requestID}},
		{"new model generation", func() photoIntelligenceHostStatus {
			newer := host
			newer.sessionDigest = strings.Repeat("f", 64)
			return newer
		}(), control, gate},
		{"kernel socket owner absent", func() photoIntelligenceHostStatus { newer := host; newer.socketOwned = false; return newer }(), control, gate},
		{"failed host request", host, func() photoHostControlStatus { changed := control; changed.State = "failed"; return changed }(), gate},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if photoHostRequestGenerationCorrelated(checks, tc.host, tc.control, tc.gate) {
				t.Fatal("stale, mismatched, or untrusted action-time model generation passed")
			}
		})
	}
	// A replacement model that is internally consistent with a NEW healthcheck
	// and kernel-owned Socket must still fail the OLD request-time seal.
	restartedSession := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	restartedChecks := append([]photoHostModelInfoCheck(nil), checks...)
	for i := range restartedChecks {
		restartedChecks[i].runtimeInstanceID = restartedSession
	}
	restartedHash := sha256.Sum256([]byte(restartedSession))
	restartedHost := host
	restartedHost.sessionDigest = hex.EncodeToString(restartedHash[:])
	if !photoHostDockerSocketOwnerVerified(restartedChecks, restartedHost) {
		t.Fatal("test fixture replacement generation must have valid current health")
	}
	if photoHostRequestGenerationCorrelated(restartedChecks, restartedHost, control, gate) {
		t.Fatal("new coherent model process inherited old audited enable generation")
	}
	raw, err := json.Marshal(adminPhotoHostPreflightDTO{
		RequestGenerationCorrelated: true,
		ModelInfoChecks:             checks,
	})
	if err != nil || strings.Contains(string(raw), digest) ||
		strings.Contains(string(raw), session) ||
		strings.Contains(string(raw), requestID) {
		t.Fatal("private request/session generation evidence leaked through preflight")
	}
}
