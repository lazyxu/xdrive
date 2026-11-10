package synologyui

import (
	"crypto/tls"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDSMClipboardPlaintextTargetAndNodeValidation(t *testing.T) {
	ownerScope := strings.Repeat("a", 64)
	target := "a8d11b3e-eaf7-4a8a-aedb-3c51908c6df2"
	event := "dcdf65ec-d439-4875-aa53-c9fcd7a67137"
	base := fmt.Sprintf(`{"owner_scope":%q,"client_event_id":%q,"kind":"image/x-xdrive-node-ref","content":"asset:118","target_device_id":%q,"node_id":118}`,
		ownerScope, event, target)
	parse := func(raw string) error {
		req := httptest.NewRequest(http.MethodPost,
			"https://nas.example/v1/cloud-clipboard-create", strings.NewReader(raw))
		_, err := parseDSMClipboardWrite(req)
		return err
	}
	if err := parse(base); err != nil { t.Fatal("valid plaintext Node ref rejected:",err) }
	invalid := map[string]string{
		"missing-target": strings.Replace(base,target,"",1),
		"wrong-node": strings.Replace(base,`"node_id":118`,`"node_id":119`,1),
		"bad-content": strings.Replace(base,"asset:118","asset:117",1),
		"bad-kind": strings.Replace(base,"image/x-xdrive-node-ref","image/png",1),
		"cross-purpose-text": strings.Replace(base,"image/x-xdrive-node-ref","text/plain",1),
		"old-encrypted-wire": strings.TrimSuffix(base,"}") + `,"nonce":"old","ciphertext":"old"}`,
		"extra-authority": strings.TrimSuffix(base,"}") + `,"client_device_token":"secret"}`,
	}
	for name, raw := range invalid {
		t.Run(name, func(t *testing.T) {
			if err := parse(raw); err == nil { t.Fatal("malformed or unauthorized payload passed CGI") }
		})
	}
	broadcast := fmt.Sprintf(`{"owner_scope":%q,"client_event_id":%q,"kind":"text/plain","content":"hello"}`,
		ownerScope, event)
	if err := parse(broadcast); err != nil { t.Fatal("plaintext broadcast rejected:",err) }
	if !isDSMClipboardRoute("/v1/cloud-clipboard-devices") ||
		isDSMClipboardWrite("/v1/cloud-clipboard-devices") {
		t.Fatal("recipient lookup must remain GET-only")
	}
	for _, old := range []string{"/v1/cloud-clipboard-vault", "/v1/cloud-clipboard-check", "/v1/cloud-clipboard-decrypt"} {
		if isDSMClipboardRoute(old) { t.Fatalf("legacy encrypted operation exposed: %s",old) }
	}
}

func TestDSMClipboardCGIHasExplicitSameOriginOperationAllowlist(t *testing.T) {
	operations := []string{"cloud-clipboard-capability", "cloud-clipboard-list", "cloud-clipboard-devices",
		"cloud-clipboard-create", "cloud-clipboard-delete", "cloud-clipboard-clear",
		"cloud-clipboard-enable-device", "cloud-clipboard-revoke-device"}
	for _, operation := range operations {
		t.Run(operation, func(t *testing.T) {
			var called bool
			handler := CGIHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				if r.URL.Path != "/v1/"+operation { t.Fatalf("CGI escaped allowlist: %q", r.URL.Path) }
				w.WriteHeader(http.StatusNoContent)
			}))
			req := httptest.NewRequest(http.MethodGet, "https://nas.example"+DSMCGIPath+"?op="+operation,nil)
			req.TLS = &tls.ConnectionState{}
			resp := httptest.NewRecorder()
			handler.ServeHTTP(resp,req)
			if !called || resp.Code != http.StatusNoContent { t.Fatalf("valid CGI route rejected: %d",resp.Code) }
		})
	}
	for _, old := range []string{"cloud-clipboard-vault","cloud-clipboard-check","cloud-clipboard-decrypt","cloud-clipboard-device-token"} {
		req := httptest.NewRequest(http.MethodGet, "https://nas.example"+DSMCGIPath+"?op="+old,nil)
		req.TLS = &tls.ConnectionState{}
		resp := httptest.NewRecorder()
		CGIHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("unlisted operation reached Agent")
		})).ServeHTTP(resp,req)
		if resp.Code != http.StatusNotFound { t.Fatalf("removed operation %s must fail closed: %d",old,resp.Code) }
	}
}

func TestDSMClipboardDeviceMutationMinimalOwnerScopeOnly(t *testing.T) {
	owner := strings.Repeat("a",64)
	check := func(endpoint, body string, accepted bool) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost,"https://nas.example/v1/"+endpoint,strings.NewReader(body))
		_,err := parseDSMClipboardWrite(req)
		if accepted && err != nil { t.Fatalf("safe %s rejected: %v",endpoint,err) }
		if !accepted && err == nil { t.Fatalf("unsafe %s accepted",endpoint) }
	}
	check("cloud-clipboard-enable-device",fmt.Sprintf(`{"owner_scope":%q}`,owner),true)
	check("cloud-clipboard-clear",fmt.Sprintf(`{"owner_scope":%q}`,owner),true)
	check("cloud-clipboard-enable-device",fmt.Sprintf(`{"owner_scope":%q,"id":9}`,owner),false)
	deviceID := "a8d11b3e-eaf7-4a8a-aedb-3c51908c6df2"
	check("cloud-clipboard-revoke-device",fmt.Sprintf(`{"owner_scope":%q,"device_id":%q}`,owner,deviceID),true)
	check("cloud-clipboard-revoke-device",fmt.Sprintf(`{"owner_scope":%q,"device_id":"bad"}`,owner),false)
	check("cloud-clipboard-revoke-device",fmt.Sprintf(`{"owner_scope":%q,"device_id":%q,"client_event_id":"leak"}`,owner,deviceID),false)
}
