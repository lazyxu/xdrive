package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/photointelligence"
)

func TestPhotoOCRAutoDiagnosisReproducesFalseEnablement(t *testing.T) {
	yes, no := true, false
	cases := []struct {
		name   string
		row    serviceDependency
		probe  string
		state  string
		reason string
	}{
		{"no analyzer", serviceDependency{ID: "photo-smart", Status: "disabled"}, "", "disabled", "analyzer_unconfigured"},
		{"host profile disabled", serviceDependency{ID: "photo-smart", Status: "disabled", PhotoHostProfileConfigured: &no}, "", "disabled", "deployment_profile_disabled"},
		{"model unreachable", serviceDependency{ID: "photo-smart", Status: "unavailable"}, "probe_unreachable", "unavailable", "probe_unreachable"},
		{"model authentication rejected", serviceDependency{ID: "photo-smart", Status: "unavailable"}, "probe_auth_rejected", "unavailable", "probe_auth_rejected"},
		{"observed stopped host", serviceDependency{ID: "photo-smart", Status: "unavailable", PhotoHostRuntimeState: "stopped"}, "probe_unreachable", "unavailable", "host_stopped"},
		{"healthy Info but automatic OCR paused", serviceDependency{ID: "photo-smart", Status: "ready", AutomaticPolicyState: "paused", PhotoHostRuntimeState: "healthy", PhotoHostProfileConfigured: &yes}, "", "disabled", "auto_paused"},
		{"unapplied policy revision", serviceDependency{ID: "photo-smart", Status: "ready", AutomaticPolicyState: "pending", PhotoHostRuntimeState: "healthy", PhotoHostProfileConfigured: &yes}, "", "unknown", "auto_pending"},
		{"default unmanaged policy", serviceDependency{ID: "photo-smart", Status: "ready", AutomaticPolicyState: "unmanaged", PhotoHostRuntimeState: "healthy", PhotoHostProfileConfigured: &yes}, "", "unknown", "auto_unmanaged"},
		{"policy unreadable", serviceDependency{ID: "photo-smart", Status: "ready", AutomaticPolicyState: "unknown", PhotoHostRuntimeState: "healthy", PhotoHostProfileConfigured: &yes}, "", "unknown", "auto_unknown"},
		{"missing trusted host", serviceDependency{ID: "photo-smart", Status: "ready", AutomaticPolicyState: "enabled"}, "", "unknown", "host_unverified"},
		{"host unhealthy despite ready Info", serviceDependency{ID: "photo-smart", Status: "ready", AutomaticPolicyState: "enabled", PhotoHostRuntimeState: "unhealthy", PhotoHostProfileConfigured: &yes}, "", "unavailable", "host_unhealthy"},
		{"model Info conflicts with profile", serviceDependency{ID: "photo-smart", Status: "ready", AutomaticPolicyState: "enabled", PhotoHostRuntimeState: "healthy", PhotoHostProfileConfigured: &no}, "", "unknown", "host_profile_mismatch"},
		{"all green except owner worker not initialized", serviceDependency{ID: "photo-smart", Status: "ready", AutomaticPolicyState: "enabled", PhotoHostRuntimeState: "healthy", PhotoHostProfileConfigured: &yes}, "", "unavailable", "runner_unavailable"},
		{"another model is not OCR", serviceDependency{ID: "photo-semantic", Status: "ready", AutomaticPolicyState: "enabled", PhotoHostRuntimeState: "healthy", PhotoHostProfileConfigured: &yes}, "", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			state, reason := photoOCRAutoDiagnosis(tc.row, tc.probe, false)
			if state != tc.state || reason != tc.reason {
				t.Fatalf("state/reason = %s/%s, want %s/%s", state, reason, tc.state, tc.reason)
			}
		})
	}
}

func TestPhotoOCRVerifiedRequiresInitializedSmartRunner(t *testing.T) {
	yes := true
	item := serviceDependency{
		ID: "photo-smart", Status: "ready",
		AutomaticPolicyState: "enabled", PhotoHostRuntimeState: "healthy",
		PhotoHostProfileConfigured: &yes,
	}
	state, reason := photoOCRAutoDiagnosis(item, "", true)
	if state != "enabled" || reason != "ready" {
		t.Fatalf("verified runner was ignored: %q / %q", state, reason)
	}
	state, reason = photoOCRAutoDiagnosis(item, "", false)
	if state != "unavailable" || reason != "runner_unavailable" {
		t.Fatalf("no scheduler/SmartRunner incorrectly marked OCR enabled: %q / %q", state, reason)
	}
}

func TestPhotoOCRProbeFailureReasonsDoNotLeakSecrets(t *testing.T) {
	const secret = "SECRET_SHOULD_NEVER_LEAK"
	cases := []struct {
		name   string
		err    error
		reason string
	}{
		{"no error", nil, ""},
		{"deadline", fmt.Errorf("%s: %w", secret, context.DeadlineExceeded), "probe_timeout"},
		{"cancelled", context.Canceled, "probe_interrupted"},
		{"socket", fmt.Errorf("%s: %w", secret, &net.OpError{Op: "dial", Net: "unix", Err: errors.New("missing socket")}), "probe_unreachable"},
		{"401", errors.New("smart analyzer returned HTTP 401: " + secret), "probe_auth_rejected"},
		{"403", errors.New("smart analyzer returned HTTP 403: " + secret), "probe_auth_rejected"},
		{"bad protocol", errors.New("unsupported smart analyzer protocol version 0"), "probe_invalid_response"},
		{"bad JSON", errors.New("decode smart analyzer response: " + secret), "probe_invalid_response"},
		{"missing endpoint", errors.New("smart analyzer returned HTTP 404: /private/" + secret), "probe_endpoint_missing"},
		{"model timeout HTTP 408", errors.New("smart analyzer returned HTTP 408: " + secret), "probe_timeout"},
		{"model busy HTTP 429", errors.New("smart analyzer returned HTTP 429: " + secret), "probe_busy"},
		{"model boot failed", errors.New("smart analyzer returned HTTP 503: /private/" + secret), "probe_server_error"},
		{"model HTTP 501", errors.New("smart analyzer returned HTTP 501: " + secret), "probe_server_error"},
		{"model HTTP 507", errors.New("smart analyzer returned HTTP 507: " + secret), "probe_server_error"},
		{"model HTTP 599", errors.New("smart analyzer returned HTTP 599: " + secret), "probe_server_error"},
		{"unknown 4xx", errors.New("smart analyzer returned HTTP 418: " + secret), "probe_failed"},
		{"malformed status", errors.New("smart analyzer returned HTTP nonsense: " + secret), "probe_failed"},
		{"untrusted prefix", errors.New("untrusted smart analyzer returned HTTP 503: " + secret), "probe_failed"},
		{"other", errors.New("other failure " + secret), "probe_failed"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reason := photoOCRProbeFailureReason(tc.err)
			if reason != tc.reason || strings.Contains(reason, secret) {
				t.Fatalf("unsafe reason: %q, want %q", reason, tc.reason)
			}
		})
	}
}

type diagnosticOCRAnalyzer struct {
	info photointelligence.SmartAnalyzerInfo
	err  error
}

func (a diagnosticOCRAnalyzer) Info(context.Context) (photointelligence.SmartAnalyzerInfo, error) {
	return a.info, a.err
}
func (a diagnosticOCRAnalyzer) Analyze(context.Context, photointelligence.SmartAnalysisTask) (photointelligence.SmartAnalysisResult, error) {
	return photointelligence.SmartAnalysisResult{}, nil
}

func TestAdminServiceDependenciesOCRFailureReasonsAndMalformedInfo(t *testing.T) {
	missing := photoHostInventoryFromAdmin(t, &Server{})["photo-smart"]
	if missing.OCRAutoState != "disabled" || missing.OCRReason != "analyzer_unconfigured" {
		t.Fatalf("no analyzer must have reason: %+v", missing)
	}

	const secret = "PRIVATE_SMART_TOKEN"
	rejected := photoHostInventoryFromAdmin(t, &Server{PhotoSmartAnalyzer: diagnosticOCRAnalyzer{
		err: errors.New("smart analyzer returned HTTP 403: " + secret),
	}})["photo-smart"]
	if rejected.Status != "unavailable" || rejected.OCRAutoState != "unavailable" || rejected.OCRReason != "probe_auth_rejected" {
		t.Fatalf("model auth failure not classified: %+v", rejected)
	}
	raw, err := json.Marshal(rejected)
	if err != nil || strings.Contains(string(raw), secret) || strings.Contains(string(raw), "smart analyzer returned HTTP") {
		t.Fatal("private model error leaked to service response")
	}

	// Real authenticated /admin/services inventory must classify every 5xx
	// as a fixed model-service reason, without any upstream response body.
	for _, status := range []int{501, 507, 599} {
		blocked := photoHostInventoryFromAdmin(t, &Server{PhotoSmartAnalyzer: diagnosticOCRAnalyzer{
			err: fmt.Errorf("smart analyzer returned HTTP %d: %s", status, secret),
		}})["photo-smart"]
		if blocked.Status != "unavailable" || blocked.OCRAutoState != "unavailable" ||
			blocked.OCRReason != "probe_server_error" {
			t.Fatalf("HTTP %d model error misclassified: %+v", status, blocked)
		}
		payload, err := json.Marshal(blocked)
		if err != nil || strings.Contains(string(payload), secret) {
			t.Fatalf("HTTP %d leaked raw model error: %v", status, err)
		}
	}

	// The authenticated dependency inventory should report actionable,
	// redacted non-5xx failures just like per-photo OCR details.
	for _, tc := range []struct {
		status int
		reason string
	}{{408, "probe_timeout"}, {429, "probe_busy"}} {
		blocked := photoHostInventoryFromAdmin(t, &Server{PhotoSmartAnalyzer: diagnosticOCRAnalyzer{
			err: fmt.Errorf("smart analyzer returned HTTP %d: %s", tc.status, secret),
		}})["photo-smart"]
		if blocked.Status != "unavailable" || blocked.OCRAutoState != "unavailable" ||
			blocked.OCRReason != tc.reason {
			t.Fatalf("HTTP %d model error misclassified: %+v", tc.status, blocked)
		}
		payload, err := json.Marshal(blocked)
		if err != nil || strings.Contains(string(payload), secret) ||
			strings.Contains(string(payload), "smart analyzer returned HTTP") {
			t.Fatalf("HTTP %d leaked raw model error: %v", tc.status, err)
		}
	}

	invalid := photoHostInventoryFromAdmin(t, &Server{PhotoSmartAnalyzer: diagnosticOCRAnalyzer{
		info: photointelligence.SmartAnalyzerInfo{ProtocolVersion: photointelligence.SmartAnalyzerProtocolVersion, Name: "broken"},
	}})["photo-smart"]
	if invalid.Status == "ready" || invalid.OCRAutoState == "enabled" || invalid.OCRReason != "probe_invalid_response" {
		t.Fatalf("malformed model Info must fail closed: %+v", invalid)
	}
}
