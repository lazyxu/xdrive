package client

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAdminServiceDependencyCaddyFieldsSurviveClientSerialization(t *testing.T) {
	const raw = `{"id":"caddy","configuration_state":"configured","installation_state":"observed","health_state":"ready","activation_state":"deployment-only","https_configured":false,"local_tls_state":"disabled","caddy_internal_http_state":"reachable"}`
	var result ServiceDependency
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	if result.HTTPSConfigured == nil || *result.HTTPSConfigured ||
		result.LocalTLSState != "disabled" || result.InstallationState != "observed" ||
		result.ActivationState != "deployment-only" || result.CaddyInternalHTTPState != "reachable" {
		t.Fatalf("Go Client lost Caddy or lifecycle observation: %+v", result)
	}
	data, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"https_configured":false`) ||
		!strings.Contains(string(data), `"local_tls_state":"disabled"`) ||
		!strings.Contains(string(data), `"activation_state":"deployment-only"`) ||
		!strings.Contains(string(data), `"caddy_internal_http_state":"reachable"`) {
		t.Fatalf("Desktop Agent forward would lose observed fields: %s", data)
	}
}

func TestAdminServiceDependencyCaddyMissingHostReasonSurvivesClientSerialization(t *testing.T) {
	var result ServiceDependency
	if err := json.Unmarshal([]byte("{\"id\":\"caddy\",\"status\":\"unknown\",\"caddy_host_witness_reason\":\"snapshot-missing\"}"), &result); err != nil {
		t.Fatal(err)
	}
	if result.CaddyHostWitnessReason != "snapshot-missing" {
		t.Fatalf("Desktop client lost Caddy diagnosis: %+v", result)
	}
	out, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), "\"caddy_host_witness_reason\":\"snapshot-missing\"") {
		t.Fatalf("Desktop client dropped read-only diagnostic: %s", out)
	}
}

func TestAdminServiceDependencyIndependentDomainHTTPSStateSurvivesClientSerialization(t *testing.T) {
	const raw = `{"id":"caddy","status":"unknown","installation_state":"unknown","health_state":"unknown","activation_state":"deployment-only","caddy_local_domain_https_state":"verified"}`
	var result ServiceDependency
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	if result.CaddyLocalDomainHTTPSState != "verified" || result.InstallationState != "unknown" {
		t.Fatalf("Desktop Agent promoted trusted Host state or dropped local TLS: %+v", result)
	}
	out, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), `"caddy_local_domain_https_state":"verified"`) {
		t.Fatalf("Desktop Agent dropped independent local HTTPS: %s", out)
	}
}
