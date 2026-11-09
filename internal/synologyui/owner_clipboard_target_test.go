package synologyui

import (
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDSMClipboardV2StrictDeviceTargetAndNodeValidation(t *testing.T) {
	ownerScope := strings.Repeat("a", 64)
	target := "a8d11b3e-eaf7-4a8a-aedb-3c51908c6df2"
	event := "dcdf65ec-d439-4875-aa53-c9fcd7a67137"
	encoded := func(bytes int) string {
		return base64.StdEncoding.EncodeToString(make([]byte, bytes))
	}
	nonce := encoded(12)
	cipher := encoded(40)
	ephemeral := encoded(32)
	wrapped := encoded(60)
	base := fmt.Sprintf(`{"owner_scope":%q,"client_event_id":%q,"kind":"image/x-xdrive-node-ref","nonce":%q,"ciphertext":%q,"target_device_id":%q,"ephemeral_key":%q,"wrapped_key":%q,"node_id":118}`,
		ownerScope, event, nonce, cipher, target, ephemeral, wrapped)
	parse := func(raw string) error {
		req := httptest.NewRequest(http.MethodPost,
			"https://nas.example/v1/cloud-clipboard-create", strings.NewReader(raw))
		_, err := parseDSMClipboardWrite(req)
		return err
	}
	if err := parse(base); err != nil {
		t.Fatalf("valid Owner directed Node envelope rejected: %v", err)
	}
	invalid := map[string]string{
		"missing-target":        strings.Replace(base, target, "", 1),
		"short-wrapped-key":     strings.Replace(base, wrapped, encoded(59), 1),
		"bad-ephemeral-key":     strings.Replace(base,
			`"ephemeral_key":`+fmt.Sprintf("%q", ephemeral), `"ephemeral_key":"plaintext"`, 1),
		"media-without-node":    strings.Replace(base, `"node_id":118`, `"node_id":0`, 1),
		"bad-kind":              strings.Replace(base, "image/x-xdrive-node-ref", "image/png", 1),
		"cross-purpose-text":    strings.Replace(base, "image/x-xdrive-node-ref", "text/plain", 1),
		"extra-Owner-authority": strings.TrimSuffix(base, "}") + `,"client_device_token":"secret"}`,
	}
	for name, raw := range invalid {
		t.Run(name, func(t *testing.T) {
			if err := parse(raw); err == nil {
				t.Fatal("malformed or unauthorized device-targeted payload passed CGI")
			}
		})
	}
	v1 := fmt.Sprintf(`{"owner_scope":%q,"client_event_id":%q,"kind":"text/plain","nonce":%q,"ciphertext":%q}`,
		ownerScope, event, nonce, cipher)
	if err := parse(v1); err != nil {
		t.Fatal("existing text-only DSM Clipboard route must remain usable:", err)
	}
	if !isDSMClipboardRoute("/v1/cloud-clipboard-devices") ||
		isDSMClipboardWrite("/v1/cloud-clipboard-devices") {
		t.Fatal("public-key recipient lookup must remain GET-only")
	}
}

func TestDSMClipboardCGIHasExplicitSameOriginOperationAllowlist(t *testing.T) {
	operations := []string{"cloud-clipboard-capability", "cloud-clipboard-vault",
		"cloud-clipboard-check", "cloud-clipboard-list", "cloud-clipboard-devices",
		"cloud-clipboard-create", "cloud-clipboard-delete", "cloud-clipboard-clear",
		"cloud-clipboard-enable-device", "cloud-clipboard-decrypt",
		"cloud-clipboard-revoke-device"}
	for _, operation := range operations {
		t.Run(operation, func(t *testing.T) {
			var called bool
			handler := CGIHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				if r.URL.Path != "/v1/"+operation {
					t.Fatalf("CGI operation escaped allowlist: %q", r.URL.Path)
				}
				w.WriteHeader(http.StatusNoContent)
			}))
			req := httptest.NewRequest(http.MethodGet,
				"https://nas.example"+DSMCGIPath+"?op="+operation, nil)
			req.TLS = &tls.ConnectionState{}
			resp := httptest.NewRecorder()
			handler.ServeHTTP(resp, req)
			if !called || resp.Code != http.StatusNoContent {
				t.Fatalf("valid Clipboard CGI route rejected: %d", resp.Code)
			}
		})
	}
	req := httptest.NewRequest(http.MethodGet,
		"https://nas.example"+DSMCGIPath+"?op=cloud-clipboard-device-token", nil)
	req.TLS = &tls.ConnectionState{}
	resp := httptest.NewRecorder()
	CGIHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("unlisted device credentials must not reach Agent")
	})).ServeHTTP(resp, req)
	if resp.Code != http.StatusNotFound {
		t.Fatalf("unlisted operation must fail closed: %d", resp.Code)
	}
}

func TestDSMClipboardDeviceMutationMinimalOwnerScopeOnly(t *testing.T) {
	owner := strings.Repeat("a", 64)
	check := func(endpoint, body string, accepted bool) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost,
			"https://nas.example/v1/"+endpoint, strings.NewReader(body))
		_, err := parseDSMClipboardWrite(req)
		if accepted && err != nil {
			t.Fatalf("safe %s rejected: %v", endpoint, err)
		}
		if !accepted && err == nil {
			t.Fatalf("unsafe %s accepted", endpoint)
		}
	}
	check("cloud-clipboard-enable-device", fmt.Sprintf(`{"owner_scope":%q}`, owner), true)
	check("cloud-clipboard-enable-device", fmt.Sprintf(`{"owner_scope":%q,"id":9}`, owner), false)
	check("cloud-clipboard-decrypt", fmt.Sprintf(`{"owner_scope":%q,"id":9}`, owner), true)
	check("cloud-clipboard-decrypt", fmt.Sprintf(`{"owner_scope":%q}`, owner), false)
	check("cloud-clipboard-decrypt", fmt.Sprintf(`{"owner_scope":%q,"id":9,"ciphertext":"secret"}`, owner), false)
	check("cloud-clipboard-decrypt", fmt.Sprintf(`{"owner_scope":%q,"id":9,"device_token":"secret"}`, owner), false)
	deviceID := "a8d11b3e-eaf7-4a8a-aedb-3c51908c6df2"
	check("cloud-clipboard-revoke-device",
		fmt.Sprintf(`{"owner_scope":%q,"device_id":%q}`, owner, deviceID), true)
	check("cloud-clipboard-revoke-device",
		fmt.Sprintf(`{"owner_scope":%q,"device_id":"bad"}`, owner), false)
	check("cloud-clipboard-revoke-device",
		fmt.Sprintf(`{"owner_scope":%q,"device_id":%q,"client_event_id":"leak"}`, owner, deviceID), false)
	check("cloud-clipboard-revoke-device",
		fmt.Sprintf(`{"owner_scope":%q,"device_id":%q,"node_id":118}`, owner, deviceID), false)
}
