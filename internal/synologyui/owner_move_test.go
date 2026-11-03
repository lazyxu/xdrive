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
	"time"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type fakeDSMOwnerMover struct {
	*fakeServerLoginAgent
	moves       int
	changeAfter bool
}

func (f *fakeDSMOwnerMover) OwnerMoveNode(_ context.Context,
	id, revision, sourceParent, targetParent uint64, kind, name string,
) (localbackupipc.OwnerFileNode, error) {
	if id != 42 || revision != 7 || sourceParent != 17 ||
		targetParent != 29 || kind != "file" || name != "a.txt" {
		return localbackupipc.OwnerFileNode{}, context.Canceled
	}
	f.moves++
	return localbackupipc.OwnerFileNode{
		ID: id, Revision: revision + 1, Name: name, Type: kind,
		ParentID: &targetParent, Size: 8,
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}, nil
}

func (f *fakeDSMOwnerMover) ServerConnection(ctx context.Context) (localbackupipc.ServerConnection, error) {
	if f.changeAfter && f.moves >= 2 {
		return localbackupipc.ServerConnection{
			Configured: true, Server: "https://foreign.example", Username: "foreign",
		}, nil
	}
	return f.fakeServerLoginAgent.ServerConnection(ctx)
}

func TestDSMOwnerMoveStrictSingleNodeAndCSRF(t *testing.T) {
	g, base := newFixture(t)
	mover := &fakeDSMOwnerMover{fakeServerLoginAgent: &fakeServerLoginAgent{fakeAgent: base}}
	g.Connect = func(context.Context) (Agent, error) { return mover, nil }
	_, key, err := loadAuthority(g.ConfigDir)
	if err != nil {
		t.Fatal(err)
	}
	scope := dsmOwnerScope(key, "dsmadmin", "id=dsm-session",
		"nas.example:5001", "https://drive.example.com", "owner")
	payload := map[string]any{
		"id": 42, "revision": 7, "parent_id": 17, "target_parent_id": 29,
		"type": "file", "name": "a.txt", "owner_scope": scope,
	}
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	body := string(bodyBytes)
	token := getCSRF(t, g)
	path := DSMCGIPath + "?op=cloud-move-node"
	for _, tc := range []struct {
		name, method, body, origin, token, path string
	}{
		{"missing csrf", "POST", body, "https://nas.example:5001", "", path},
		{"wrong origin", "POST", body, "https://evil.example", token, path},
		{"wrong token", "POST", body, "https://nas.example:5001", "invalid", path},
		{"GET refused", "GET", "", "", "", path},
		{"Agent direct", "POST", body, "https://nas.example:5001", token, "/v1/cloud-move-node"},
		{"foreign Owner", "POST", strings.Replace(body, scope, strings.Repeat("b", 64), 1),
			"https://nas.example:5001", token, path},
		{"arbitrary path", "POST", body, "https://nas.example:5001", token, path + "&path=/volume1"},
		{"missing field", "POST", string(bodyBytes[:len(bodyBytes)-1]), "https://nas.example:5001", token, path},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp := requestServerLogin(g, tc.method, tc.body, tc.origin, tc.token, tc.path)
			if resp.Code == http.StatusOK || mover.moves != 0 {
				t.Fatalf("unsafe Owner move accepted: %d %s", resp.Code, resp.Body.String())
			}
		})
	}
	for _, mutation := range []func(map[string]any){
		func(m map[string]any) { m["revision"] = 0 },
		func(m map[string]any) { m["target_parent_id"] = 17 },
		func(m map[string]any) { m["target_parent_id"] = 42 },
		func(m map[string]any) { m["type"] = "symlink" },
		func(m map[string]any) { m["name"] = "../path" },
	} {
		clone := map[string]any{}
		for k, v := range payload {
			clone[k] = v
		}
		mutation(clone)
		bad, _ := json.Marshal(clone)
		resp := requestServerLogin(g, "POST", string(bad), "https://nas.example:5001", token, path)
		if resp.Code == http.StatusOK || mover.moves != 0 {
			t.Fatal("forged Owner selector reached native Agent")
		}
	}
	resp := requestServerLogin(g, "POST", body, "https://nas.example:5001", token, path)
	if resp.Code != http.StatusOK || mover.moves != 1 {
		t.Fatalf("valid Owner move failed: %d %s", resp.Code, resp.Body.String())
	}
	mover.changeAfter = true
	resp = requestServerLogin(g, "POST", body, "https://nas.example:5001", token, path)
	if resp.Code == http.StatusOK || mover.moves != 2 {
		t.Fatalf("changed Owner incorrectly acknowledged: %d", resp.Code)
	}
}

func TestDSMOwnerMoveParserRejectsDuplicateAndUnknownJSON(t *testing.T) {
	for _, bad := range [][]byte{
		[]byte(fmt.Sprintf("{%q:42,%q:43}", "id", "id")),
		[]byte(fmt.Sprintf("{%q:%q}", "local_path", "/volume1/photo")),
		bytes.Repeat([]byte("x"), 1025),
	} {
		req := httptest.NewRequest("POST", "https://nas.example/v1/cloud-move-node",
			bytes.NewReader(bad))
		if _, err := parseDSMOwnerNodeMove(req); err == nil {
			t.Fatal("malformed Owner move accepted")
		}
	}
}
