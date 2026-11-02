package client

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCaddyPublicCertificateInventorySurvivesAgentJSONRoundTrip(t *testing.T) {
	input := AdminCaddyHTTPSConfig{
		DesiredEnabled:         true,
		DesiredDomain:          "drive.example.com",
		DesiredLANEnabled:      true,
		DesiredLANIP:           "192.168.2.4",
		Source:                 "host-env",
		HostEnvSHA256:          strings.Repeat("a", 64),
		HostEnvPendingRedeploy: false,
		Certificates: &AdminCaddyCertificateInventory{
			Scope: "caddy-container-local-v1",
			Domain: AdminCaddyCertificateInfo{
				State: "verified-local", DNSNames: []string{"drive.example.com"},
				LeafSHA256: strings.Repeat("b", 64), LeafPEM: "-----BEGIN CERTIFICATE-----\nMQ==\n-----END CERTIFICATE-----\n",
			},
			LAN: AdminCaddyCertificateInfo{
				State: "verified-local", IPAddresses: []string{"192.168.2.4"},
				LeafSHA256: strings.Repeat("c", 64),
			},
			RootCA: &AdminCaddyPublicRootInfo{
				SHA256: strings.Repeat("d", 64),
				PEM:    "-----BEGIN CERTIFICATE-----\nMQ==\n-----END CERTIFICATE-----\n",
			},
		},
	}
	bytes, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	var output AdminCaddyHTTPSConfig
	if err := json.Unmarshal(bytes, &output); err != nil {
		t.Fatal(err)
	}
	if output.Source != "host-env" || output.HostEnvSHA256 != input.HostEnvSHA256 ||
		output.Certificates == nil || output.Certificates.RootCA == nil ||
		output.Certificates.Domain.LeafPEM != input.Certificates.Domain.LeafPEM ||
		output.Certificates.LAN.IPAddresses[0] != "192.168.2.4" ||
		output.Certificates.RootCA.SHA256 != input.Certificates.RootCA.SHA256 {
		t.Fatalf("Agent lost public TLS fields during Caddy HTTPS serialization: %#v", output)
	}
	if strings.Contains(string(bytes), "private_key") || strings.Contains(string(bytes), "access_key_secret") {
		t.Fatal("private or provider secret field included in certificate response")
	}
}
