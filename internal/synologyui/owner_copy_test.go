package synologyui

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type fakeDSMOwnerCopier struct {
	*fakeServerLoginAgent
	writes int
}

func (f *fakeDSMOwnerCopier) OwnerCopyNode(_ context.Context,
	id, revision, sourceParent, targetParent uint64, kind, name string,
) (localbackupipc.OwnerFileNode, error) {
	if id != 42 || revision != 7 || sourceParent != 17 ||
		targetParent != 29 || kind != "file" || name != "a.txt" {
		return localbackupipc.OwnerFileNode{}, context.Canceled
	}
	f.writes++
	return localbackupipc.OwnerFileNode{
		ID: 77, ParentID: &targetParent, Revision: 1, Name: "a (1).txt",
		Type: "file", Size: 8,
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}, nil
}

func TestDSMOwnerCopyRequiresAuthenticatedPrincipalAndExactTarget(t *testing.T) {
	g, base := newFixture(t)
	copier := &fakeDSMOwnerCopier{fakeServerLoginAgent: &fakeServerLoginAgent{fakeAgent: base}}
	g.Connect = func(context.Context) (Agent, error) { return copier, nil }
	_, key, err := loadAuthority(g.ConfigDir)
	if err != nil {
		t.Fatal(err)
	}
	scope := dsmOwnerScope(key, "dsmadmin", "id=dsm-session",
		"nas.example:5001", "https://drive.example.com", "owner")
	raw := map[string]any{
		"id": 42, "revision": 7, "parent_id": 17, "target_parent_id": 29,
		"type": "file", "name": "a.txt", "owner_scope": scope,
	}
	body, err := json.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	token := getCSRF(t, g)
	route := DSMCGIPath + "?op=cloud-copy-node"
	for _, variant := range []struct {
		name, method, body, origin, token, path string
	}{
		{"no CSRF", "POST", string(body), "https://nas.example:5001", "", route},
		{"foreign origin", "POST", string(body), "https://foreign.example", token, route},
		{"bad CSRF", "POST", string(body), "https://nas.example:5001", "wrong", route},
		{"GET denied", "GET", "", "", "", route},
		{"direct Agent", "POST", string(body), "https://nas.example:5001", token, "/v1/cloud-copy-node"},
		{"different Owner", "POST", strings.Replace(string(body), scope, strings.Repeat("b", 64), 1),
			"https://nas.example:5001", token, route},
		{"arbitrary path", "POST", string(body), "https://nas.example:5001", token, route + "&path=/volume1"},
		{"trailing bytes", "POST", string(body) + "{}", "https://nas.example:5001", token, route},
	} {
		t.Run(variant.name, func(t *testing.T) {
			res := requestServerLogin(g, variant.method, variant.body, variant.origin,
				variant.token, variant.path)
			if res.Code == http.StatusOK || copier.writes != 0 {
				t.Fatalf("unverified Owner copy admitted: %d %s", res.Code, res.Body.String())
			}
		})
	}
	res := requestServerLogin(g, "POST", string(body), "https://nas.example:5001", token, route)
	if res.Code != http.StatusOK || copier.writes != 1 {
		t.Fatalf("valid Owner copy failed: %d %s", res.Code, res.Body.String())
	}
	var node localbackupipc.OwnerFileNode
	if err := json.Unmarshal(res.Body.Bytes(), &node); err != nil ||
		!localbackupipc.ValidateOwnerCopiedNode(node, 42, 7, 17, 29, "file", "a.txt") {
		t.Fatalf("Server copy receipt invalid: %+v %v", node, err)
	}
}
