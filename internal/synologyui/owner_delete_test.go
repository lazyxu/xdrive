package synologyui

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type fakeDSMOwnerDeleter struct {
	*fakeServerLoginAgent
	writes      int
	changeAfter bool
}

func (f *fakeDSMOwnerDeleter) OwnerDeleteNode(_ context.Context,
	id, revision, parent uint64, kind, name string,
) error {
	if id != 42 || revision != 7 || parent != 17 ||
		kind != "file" || name != "report.txt" {
		return context.Canceled
	}
	f.writes++
	return nil
}

func (f *fakeDSMOwnerDeleter) ServerConnection(ctx context.Context) (localbackupipc.ServerConnection, error) {
	if f.changeAfter && f.writes >= 2 {
		return localbackupipc.ServerConnection{
			Configured: true, Server: "https://foreign.example.com", Username: "different",
		}, nil
	}
	return f.fakeServerLoginAgent.ServerConnection(ctx)
}

func TestDSMOwnerDeleteStrictSingleNodeRequest(t *testing.T) {
	good := map[string]any{
		"id":          42,
		"revision":    7,
		"parent_id":   17,
		"type":        "file",
		"name":        "report.txt",
		"owner_scope": strings.Repeat("a", 64),
	}
	makeRequest := func(body []byte, query string) error {
		r := httptest.NewRequest("POST", "https://nas.example/v1/cloud-delete-node"+query,
			bytes.NewReader(body))
		_, err := parseDSMOwnerNodeDelete(r)
		return err
	}
	valid, err := json.Marshal(good)
	if err != nil {
		t.Fatal(err)
	}
	if err := makeRequest(valid, ""); err != nil {
		t.Fatal(err)
	}
	cases := map[string][]byte{
		"duplicate": []byte(`{"id":42,"id":43,"revision":7,"parent_id":17,"type":"file","name":"report.txt","owner_scope":"` + strings.Repeat("a", 64) + `"}`),
		"extra field": append(append([]byte{}, valid[:len(valid)-1]...), []byte(`,"local_path":"/volume1/photo"}`)...),
		"missing field": []byte(`{"id":42,"revision":7}`),
		"trailing": append(append([]byte{}, valid...), []byte(` {}`)...),
	}
	for label, payload := range cases {
		if err := makeRequest(payload, ""); err == nil {
			t.Errorf("%s: invalid Owner delete accepted", label)
		}
	}
	for label, change := range map[string]func(map[string]any){
		"invalid revision": func(m map[string]any) { m["revision"] = 0 },
		"path":             func(m map[string]any) { m["name"] = "../escape" },
		"invalid scope":    func(m map[string]any) { m["owner_scope"] = "other" },
		"invalid type":     func(m map[string]any) { m["type"] = "symlink" },
	} {
		t.Run(label, func(t *testing.T) {
			payload := make(map[string]any)
			for k, v := range good {
				payload[k] = v
			}
			change(payload)
			body, err := json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
			if err := makeRequest(body, ""); err == nil {
				t.Fatal("invalid Owner delete accepted")
			}
		})
	}
	if err := makeRequest(valid, "?path=/volume1/photo"); err == nil {
		t.Fatal("native NAS path query accepted")
	}
}

func TestDSMOwnerNodeDeleteRequiresCurrentPrincipalAndCSRF(t *testing.T) {
	g, base := newFixture(t)
	owner := &fakeDSMOwnerDeleter{fakeServerLoginAgent: &fakeServerLoginAgent{fakeAgent: base}}
	g.Connect = func(context.Context) (Agent, error) { return owner, nil }
	_, key, err := loadAuthority(g.ConfigDir)
	if err != nil {
		t.Fatal(err)
	}
	scope := dsmOwnerScope(key, "dsmadmin", "id=dsm-session",
		"nas.example:5001", "https://drive.example.com", "owner")
	body := fmt.Sprintf(
		`{"id":42,"revision":7,"parent_id":17,"type":"file","name":"report.txt","owner_scope":%q}`, scope,
	)
	token := getCSRF(t, g)
	path := DSMCGIPath + "?op=cloud-delete-node"
	for _, tc := range []struct {
		name, method, body, origin, token, path string
	}{
		{"missing csrf", "POST", body, "https://nas.example:5001", "", path},
		{"wrong origin", "POST", body, "https://foreign.example", token, path},
		{"wrong token", "POST", body, "https://nas.example:5001", "bad", path},
		{"GET refused", "GET", "", "", "", path},
		{"Agent direct", "POST", body, "https://nas.example:5001", token, "/v1/cloud-delete-node"},
		{"foreign Owner", "POST", strings.Replace(body, scope, strings.Repeat("b", 64), 1),
			"https://nas.example:5001", token, path},
		{"unrelated query", "POST", body, "https://nas.example:5001", token, path + "&path=/volume1/photo"},
		{"duplicate revision", "POST", strings.Replace(body, `"revision":7`, `"revision":7,"revision":8`, 1),
			"https://nas.example:5001", token, path},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := requestServerLogin(g, tc.method, tc.body, tc.origin, tc.token, tc.path)
			if got.Code == http.StatusOK || owner.writes != 0 {
				t.Fatalf("invalid Owner trash operation admitted: %d %s", got.Code, got.Body.String())
			}
		})
	}
	ok := requestServerLogin(g, "POST", body, "https://nas.example:5001", token, path)
	if ok.Code != http.StatusOK || owner.writes != 1 ||
		strings.TrimSpace(ok.Body.String()) != `{"ok":true}` {
		t.Fatalf("valid Owner trash failed: %d %s", ok.Code, ok.Body.String())
	}
	owner.changeAfter = true
	uncertain := requestServerLogin(g, "POST", body, "https://nas.example:5001", token, path)
	if uncertain.Code == http.StatusOK || owner.writes != 2 {
		t.Fatalf("changed Owner acknowledged after mutation: %d", uncertain.Code)
	}
}

func TestDSMOwnerDeleteOldAgentCannotMutate(t *testing.T) {
	g, base := newFixture(t)
	g.Connect = func(context.Context) (Agent, error) { return base, nil }
	_, key, err := loadAuthority(g.ConfigDir)
	if err != nil {
		t.Fatal(err)
	}
	scope := dsmOwnerScope(key, "dsmadmin", "id=dsm-session",
		"nas.example:5001", "https://drive.example.com", "owner")
	body := fmt.Sprintf(
		`{"id":42,"revision":7,"parent_id":17,"type":"file","name":"report.txt","owner_scope":%q}`, scope,
	)
	got := requestServerLogin(g, "POST", body, "https://nas.example:5001",
		getCSRF(t, g), DSMCGIPath+"?op=cloud-delete-node")
	if got.Code != http.StatusNotImplemented {
		t.Fatalf("old Agent unexpectedly deleted a Server Owner item: %d", got.Code)
	}
}
