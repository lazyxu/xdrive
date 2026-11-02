package synologyui

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type fakeDSMOwnerNodeRenamer struct {
	*fakeServerLoginAgent
	writes      int
	forge       bool
	changeAfter bool
}

func (f *fakeDSMOwnerNodeRenamer) ServerConnection(ctx context.Context) (localbackupipc.ServerConnection, error) {
	if f.changeAfter && f.writes >= 3 {
		return localbackupipc.ServerConnection{
			Configured: true, Server: "https://changed.example", Username: "foreign",
		}, nil
	}
	return f.fakeServerLoginAgent.ServerConnection(ctx)
}

func (f *fakeDSMOwnerNodeRenamer) OwnerRenameNode(_ context.Context,
	id, revision, parent uint64, kind, name string,
) (localbackupipc.OwnerFileNode, error) {
	f.writes++
	if id != 42 || revision != 1 || parent != 17 ||
		kind != "file" || name != "新照片.jpg" {
		return localbackupipc.OwnerFileNode{}, context.Canceled
	}
	if f.forge {
		parent = 99
	}
	return localbackupipc.OwnerFileNode{
		ID: id, ParentID: &parent, Name: name, Type: kind, Size: 123,
		Revision: revision + 1, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}, nil
}

func TestDSMOwnerNodeRenameExactPOSTAndCurrentOwner(t *testing.T) {
	g, base := newFixture(t)
	owner := &fakeDSMOwnerNodeRenamer{fakeServerLoginAgent: &fakeServerLoginAgent{fakeAgent: base}}
	g.Connect = func(context.Context) (Agent, error) { return owner, nil }
	_, key, err := loadAuthority(g.ConfigDir)
	if err != nil {
		t.Fatal(err)
	}
	scope := dsmOwnerScope(key, "dsmadmin", "id=dsm-session",
		"nas.example:5001", "https://drive.example.com", "owner")
	body := fmt.Sprintf("{\"id\":42,\"revision\":1,\"parent_id\":17,\"type\":\"file\",\"name\":\"新照片.jpg\",\"owner_scope\":%q}", scope)
	token := getCSRF(t, g)
	path := DSMCGIPath + "?op=cloud-rename-node"
	for _, tc := range []struct {
		name, method, body, origin, token, path string
	}{
		{"missing csrf", "POST", body, "https://nas.example:5001", "", path},
		{"foreign origin", "POST", body, "https://evil.example", token, path},
		{"invalid token", "POST", body, "https://nas.example:5001", "wrong", path},
		{"GET refused", "GET", "", "", "", path},
		{"direct Agent bypass", "POST", body, "https://nas.example:5001", token, "/v1/cloud-rename-node"},
		{"extra query", "POST", body, "https://nas.example:5001", token, path + "&path=/volume1"},
		{"duplicate id", "POST", strings.Replace(body, "\"id\":42", "\"id\":42,\"id\":43", 1), "https://nas.example:5001", token, path},
		{"extra credential", "POST", strings.Replace(body, "\"name\":", "\"token\":\"private\",\"name\":", 1), "https://nas.example:5001", token, path},
		{"foreign owner", "POST", strings.Replace(body, scope, strings.Repeat("b", 64), 1), "https://nas.example:5001", token, path},
		{"missing revision", "POST", strings.Replace(body, "\"revision\":1,", "", 1), "https://nas.example:5001", token, path},
		{"root parent", "POST", strings.Replace(body, "\"parent_id\":17", "\"parent_id\":0", 1), "https://nas.example:5001", token, path},
		{"bad name", "POST", strings.Replace(body, "新照片.jpg", "../private", 1), "https://nas.example:5001", token, path},
		{"trailing data", "POST", body + "{}", "https://nas.example:5001", token, path},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp := requestServerLogin(g, tc.method, tc.body, tc.origin, tc.token, tc.path)
			if resp.Code == http.StatusOK || owner.writes != 0 {
				t.Fatalf("unsafe Owner rename admitted: %d %s", resp.Code, resp.Body.String())
			}
		})
	}
	valid := requestServerLogin(g, "POST", body, "https://nas.example:5001", token, path)
	if valid.Code != http.StatusOK || owner.writes != 1 {
		t.Fatalf("valid Owner rename failed: %d %s", valid.Code, valid.Body.String())
	}
	var node localbackupipc.OwnerFileNode
	if err := json.Unmarshal(valid.Body.Bytes(), &node); err != nil ||
		!localbackupipc.ValidateOwnerRenamedNode(node, 42, 1, 17, "file", "新照片.jpg") {
		t.Fatalf("unverified renamed Owner node: %+v %v", node, err)
	}
	owner.forge = true
	forged := requestServerLogin(g, "POST", body, "https://nas.example:5001", token, path)
	if forged.Code == http.StatusOK || owner.writes != 2 {
		t.Fatalf("forged parent acknowledged: %d", forged.Code)
	}
	owner.forge = false
	owner.changeAfter = true
	changed := requestServerLogin(g, "POST", body, "https://nas.example:5001", token, path)
	if changed.Code == http.StatusOK || owner.writes != 3 {
		t.Fatalf("post-commit switched Owner acknowledged: %d", changed.Code)
	}
}

func TestDSMOwnerNodeRenameOldAgentFailsClosed(t *testing.T) {
	g, base := newFixture(t)
	g.Connect = func(context.Context) (Agent, error) { return base, nil }
	_, key, err := loadAuthority(g.ConfigDir)
	if err != nil {
		t.Fatal(err)
	}
	scope := dsmOwnerScope(key, "dsmadmin", "id=dsm-session",
		"nas.example:5001", "https://drive.example.com", "owner")
	body := fmt.Sprintf("{\"id\":42,\"revision\":1,\"parent_id\":17,\"type\":\"file\",\"name\":\"新照片.jpg\",\"owner_scope\":%q}", scope)
	result := requestServerLogin(g, "POST", body, "https://nas.example:5001", getCSRF(t, g),
		DSMCGIPath+"?op=cloud-rename-node")
	if result.Code != http.StatusNotImplemented {
		t.Fatalf("old Agent unexpectedly permitted Owner rename: %d", result.Code)
	}
}
