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

type fakeDSMOwnerFolderCreator struct {
	*fakeServerLoginAgent
	writes      int
	forged      bool
	changeAfter bool
}

func (f *fakeDSMOwnerFolderCreator) ServerConnection(ctx context.Context) (localbackupipc.ServerConnection, error) {
	if f.changeAfter && f.writes >= 3 {
		return localbackupipc.ServerConnection{
			Configured: true, Server: "https://different.example", Username: "foreign",
		}, nil
	}
	return f.fakeServerLoginAgent.ServerConnection(ctx)
}

func (f *fakeDSMOwnerFolderCreator) OwnerCreateFolder(_ context.Context, parent uint64, name string) (localbackupipc.OwnerFileNode, error) {
	f.writes++
	if parent != 17 || name != "新文件夹" {
		return localbackupipc.OwnerFileNode{}, context.Canceled
	}
	if f.forged {
		parent = 99
	}
	return localbackupipc.OwnerFileNode{
		ID: 57, ParentID: &parent, Name: name, Type: "dir", Revision: 1,
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}, nil
}

func TestDSMOwnerCreateFolderExactPOSTCSRFAndOwnerBinding(t *testing.T) {
	g, base := newFixture(t)
	owner := &fakeDSMOwnerFolderCreator{
		fakeServerLoginAgent: &fakeServerLoginAgent{fakeAgent: base},
	}
	g.Connect = func(context.Context) (Agent, error) { return owner, nil }
	_, key, err := loadAuthority(g.ConfigDir)
	if err != nil {
		t.Fatal(err)
	}
	scope := dsmOwnerScope(key, "dsmadmin", "id=dsm-session",
		"nas.example:5001", "https://drive.example.com", "owner")
	if len(scope) != 64 {
		t.Fatal("missing Server Owner scope")
	}
	body := fmt.Sprintf("{\"parent_id\":17,\"name\":\"新文件夹\",\"owner_scope\":\"%s\"}", scope)
	token := getCSRF(t, g)
	path := DSMCGIPath + "?op=cloud-create-folder"
	for _, tc := range []struct{ name, method, body, origin, token, path string }{
		{"missing csrf", "POST", body, "https://nas.example:5001", "", path},
		{"foreign origin", "POST", body, "https://evil.example", token, path},
		{"bad token", "POST", body, "https://nas.example:5001", "bad", path},
		{"GET refused", "GET", "", "", "", path},
		{"direct Agent bypass", "POST", body, "https://nas.example:5001", token, "/v1/cloud-create-folder"},
		{"extra query", "POST", body, "https://nas.example:5001", token, path + "&path=/volume1"},
		{"duplicate name", "POST", strings.Replace(body, "\"name\":\"新文件夹\"", "\"name\":\"New\",\"name\":\"新文件夹\"", 1), "https://nas.example:5001", token, path},
		{"unknown field", "POST", strings.Replace(body, "\"name\":\"新文件夹\"", "\"name\":\"新文件夹\",\"path\":\"/home\"", 1), "https://nas.example:5001", token, path},
		{"forged owner", "POST", strings.Replace(body, scope, strings.Repeat("a", 64), 1), "https://nas.example:5001", token, path},
		{"oversized parent", "POST", strings.Replace(body, "\"parent_id\":17", "\"parent_id\":999999999999999999", 1), "https://nas.example:5001", token, path},
		{"path name", "POST", strings.Replace(body, "新文件夹", "../wrong", 1), "https://nas.example:5001", token, path},
		{"trailing data", "POST", body + "{}", "https://nas.example:5001", token, path},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := requestServerLogin(g, tc.method, tc.body, tc.origin, tc.token, tc.path)
			if w.Code == http.StatusOK || owner.writes != 0 {
				t.Fatalf("unsafe folder create admitted: %d %s", w.Code, w.Body.String())
			}
		})
	}
	ok := requestServerLogin(g, "POST", body, "https://nas.example:5001", token, path)
	if ok.Code != http.StatusOK || owner.writes != 1 {
		t.Fatalf("Owner folder creation failed: %d %s", ok.Code, ok.Body.String())
	}
	var node localbackupipc.OwnerFileNode
	if err := json.Unmarshal(ok.Body.Bytes(), &node); err != nil ||
		!localbackupipc.ValidateOwnerCreatedFolder(node, 17, "新文件夹") {
		t.Fatalf("unverified created folder: %+v %v", node, err)
	}
	owner.forged = true
	denied := requestServerLogin(g, "POST", body, "https://nas.example:5001", token, path)
	if denied.Code == http.StatusOK || owner.writes != 2 {
		t.Fatalf("foreign folder result was acknowledged: %d", denied.Code)
	}
	owner.forged = false
	owner.changeAfter = true
	changed := requestServerLogin(g, "POST", body, "https://nas.example:5001", token, path)
	if changed.Code == http.StatusOK || owner.writes != 3 {
		t.Fatalf("Owner switch after mutation was acknowledged: %d", changed.Code)
	}
}

func TestDSMOwnerCreateFolderRequiresRealAgentCapability(t *testing.T) {
	g, agent := newFixture(t)
	g.Connect = func(context.Context) (Agent, error) { return agent, nil }
	_, key, err := loadAuthority(g.ConfigDir)
	if err != nil {
		t.Fatal(err)
	}
	scope := dsmOwnerScope(key, "dsmadmin", "id=dsm-session", "nas.example:5001",
		"https://drive.example.com", "owner")
	body := fmt.Sprintf("{\"parent_id\":17,\"name\":\"New\",\"owner_scope\":\"%s\"}", scope)
	result := requestServerLogin(g, "POST", body, "https://nas.example:5001", getCSRF(t, g),
		DSMCGIPath+"?op=cloud-create-folder")
	if result.Code != http.StatusNotImplemented {
		t.Fatalf("old Agent must not claim Owner folder-create capability: %d", result.Code)
	}
}
