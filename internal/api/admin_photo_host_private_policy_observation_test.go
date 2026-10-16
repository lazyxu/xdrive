package api

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/photointelligence"
)

func TestPhotoHostPrivatePolicyObservationRequiresCurrentCoherentAck(t *testing.T) {
	const session = "0123456789abcdef0123456789abcdef"
	ids := []string{"photo-face", "photo-smart", "photo-semantic", "photo-creative"}
	strict, legacy, unknown := "require-bearer-v1", "legacy", "unrecognized-mode"
	yes, no := true, false
	build := func(policy *string, auth *bool) []photoHostModelInfoCheck {
		checks := make([]photoHostModelInfoCheck, len(ids))
		for i, id := range ids {
			checks[i] = photoHostModelInfoCheck{
				ID: id, State: "ready", runtimeInstanceID: session,
				policy: policy, auth: auth,
			}
		}
		return checks
	}
	if got := photoHostPrivatePolicyObservation(build(&strict, &yes), true); got != "strict-local" {
		t.Fatalf("four verified strict model Info observations lost: %s", got)
	}
	if got := photoHostPrivatePolicyObservation(build(&legacy, &no), true); got != "legacy-local" {
		t.Fatalf("four verified legacy Info observations lost: %s", got)
	}
	mixed := build(&strict, &yes)
	mixed[2].policy = &legacy
	if got := photoHostPrivatePolicyObservation(mixed, true); got != "inconsistent" {
		t.Fatalf("inconsistent model local policies accepted as coherent: %s", got)
	}
	if got := photoHostPrivatePolicyObservation(build(&strict, &no), true); got != "inconsistent" {
		t.Fatalf("strict policy without model Bearer evidence was not inconsistent: %s", got)
	}
	for name, tc := range map[string]struct {
		checks []photoHostModelInfoCheck
		ack    bool
	}{
		"no host request acknowledgment":     {build(&strict, &yes), false},
		"missing older model policy":         {build(nil, &yes), true},
		"unknown mode":                       {build(&unknown, &yes), true},
		"missing bearer in strict old model": {build(&strict, nil), true},
		"truncated list":                     {build(&strict, &yes)[:3], true},
		"empty":                              {nil, true},
		"old generation": {func() []photoHostModelInfoCheck {
			c := build(&strict, &yes)
			c[3].runtimeInstanceID = strings.Repeat("2", 32)
			return c
		}(), true},
		"failed model Info": {func() []photoHostModelInfoCheck {
			c := build(&strict, &yes)
			c[0].State = "failed"
			return c
		}(), true},
	} {
		t.Run(name, func(t *testing.T) {
			if got := photoHostPrivatePolicyObservation(tc.checks, tc.ack); got != "unverified" {
				t.Fatalf("incomplete model evidence promoted local policy: %s", got)
			}
		})
	}
}

func TestPrivatePhotoHostPolicyFieldsArePrivateAndBackwardCompatible(t *testing.T) {
	const session = "0123456789abcdef0123456789abcdef"
	const sensitive = "private-photo-process-policy-secret"
	old := []byte("{\"runtime_instance_id\":\"" + session + "\"}")
	modern := []byte("{\"runtime_instance_id\":\"" + session +
		"\",\"private_bearer_auth_required\":true,\"private_ingress_policy_mode\":\"require-bearer-v1\"}")
	for _, result := range []struct {
		label       string
		oldValue    any
		modernValue any
	}{
		{"face", &photointelligence.FaceAnalyzerInfo{}, &photointelligence.FaceAnalyzerInfo{}},
		{"smart", &photointelligence.SmartAnalyzerInfo{}, &photointelligence.SmartAnalyzerInfo{}},
		{"semantic", &photointelligence.SemanticAnalyzerInfo{}, &photointelligence.SemanticAnalyzerInfo{}},
		{"creative", &photointelligence.CreativeAnalyzerInfo{}, &photointelligence.CreativeAnalyzerInfo{}},
	} {
		t.Run(result.label, func(t *testing.T) {
			if err := json.Unmarshal(old, result.oldValue); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(modern, result.modernValue); err != nil {
				t.Fatal(err)
			}
		})
	}
	strict, yes := "require-bearer-v1", true
	checks := []photoHostModelInfoCheck{{
		ID: "photo-face", State: "ready", Detail: "本实例模型 Info 已核验",
		runtimeInstanceID: session, policy: &strict, auth: &yes,
	}}
	bytes, err := json.Marshal(checks)
	if err != nil || strings.Contains(string(bytes), "private_ingress_policy_mode") ||
		strings.Contains(string(bytes), session) || strings.Contains(string(bytes), sensitive) ||
		strings.Contains(string(bytes), "require-bearer-v1") {
		t.Fatalf("unexported model policy/session leaked into admin JSON: %s / %v", bytes, err)
	}
	response, err := json.Marshal(adminPhotoHostPreflightDTO{
		PrivatePolicyObserved:   "strict-local",
		PrivateIngressAuthState: "unverified",
	})
	if err != nil || !strings.Contains(string(response), "\"private_ingress_policy_observation\":\"strict-local\"") ||
		strings.Contains(string(response), session) {
		t.Fatalf("sanitized administrator policy observation missing or leaked: %s / %v", response, err)
	}
}
