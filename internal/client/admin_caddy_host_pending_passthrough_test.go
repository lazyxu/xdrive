package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// A Desktop Agent decodes the real Server DTO into the Go client and encodes
// it again as IPC JSON. Dropping host_apply_pending at either boundary would
// silently hide the operator reconciliation fence in Desktop (not in Web).
func TestCaddyHostPendingSurvivesGoClientAndIPCJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/admin/services/caddy/https":
			_, _ = w.Write([]byte(`{"desired_lan_enabled":true,"desired_lan_ip":"192.168.2.4","desired_enabled":false,"desired_domain":"","editable":false,"apply_state":"pending","apply_supported":false,"host_apply_pending":true}`))
		case "/api/v1/admin/services/caddy/alidns":
			_, _ = w.Write([]byte(`{"configured":true,"revision":3,"editable":false,"apply_state":"pending","apply_supported":false,"host_apply_pending":true}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	c := &Client{BaseURL: server.URL, HTTP: server.Client()}
	https, err := c.AdminCaddyHTTPSConfig(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !https.HostApplyPending || https.Editable || https.ApplySupported {
		t.Fatalf("HTTPS Go client lost the pending read-only fence: %+v", https)
	}
	alidns, err := c.AdminCaddyAliDNSConfig(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !alidns.HostApplyPending || alidns.Editable || alidns.ApplySupported {
		t.Fatalf("AliDNS Go client lost the pending read-only fence: %+v", alidns)
	}

	for _, item := range []any{https, alidns} {
		raw, err := json.Marshal(item)
		if err != nil {
			t.Fatal(err)
		}
		var receipt struct {
			HostApplyPending bool `json:"host_apply_pending"`
			Editable         bool `json:"editable"`
			ApplySupported   bool `json:"apply_supported"`
		}
		if err := json.Unmarshal(raw, &receipt); err != nil {
			t.Fatal(err)
		}
		if !receipt.HostApplyPending || receipt.Editable || receipt.ApplySupported {
			t.Fatalf("Desktop IPC would lose the Host pending fence: %s", raw)
		}
	}
}
