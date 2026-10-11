package client

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAdminServiceDependencyCaddyFieldsSurviveClientSerialization(t *testing.T) {
	const raw = `{"id":"caddy","configuration_state":"configured","installation_state":"observed","health_state":"ready","activation_state":"deployment-only","https_configured":false,"local_tls_state":"disabled"}`
	var result ServiceDependency
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	if result.HTTPSConfigured == nil || *result.HTTPSConfigured ||
		result.LocalTLSState != "disabled" || result.InstallationState != "observed" ||
		result.ActivationState != "deployment-only" {
		t.Fatalf("Go Client lost Caddy or lifecycle observation: %+v", result)
	}
	data, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"https_configured":false`) ||
		!strings.Contains(string(data), `"local_tls_state":"disabled"`) ||
		!strings.Contains(string(data), `"activation_state":"deployment-only"`) {
		t.Fatalf("Desktop Agent forward would lose observed fields: %s", data)
	}
}
