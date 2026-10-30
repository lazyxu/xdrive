package synologyui

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type fakeNASSourceCreator struct {
	*fakeServerLoginAgent
	preflights         int
	creates            int
	binds              int
	failBind           bool
	failCreate         bool
	changeOwnerOnBind  bool
	ownerName          string
	wantPath           string
}

func (f *fakeNASSourceCreator) ServerConnection(context.Context) (localbackupipc.ServerConnection, error) {
	username := f.ownerName
	if username == "" {
		username = "owner"
	}
	return localbackupipc.ServerConnection{
		Configured: true, Server: "https://drive.example.com", Username: username,
	}, nil
}

func (f *fakeNASSourceCreator) PreflightLocalRoot(_ context.Context, path string) error {
	f.preflights++
	if path != f.wantPath {
		return errors.New("unverified directory")
	}
	return nil
}

func (f *fakeNASSourceCreator) CreateLocalBackupSource(
	_ context.Context, name string, target uint64,
) (localbackupipc.LocalBackupSource, error) {
	f.creates++
	if f.failCreate {
		return localbackupipc.LocalBackupSource{}, errors.New("ambiguous native reply")
	}
	if name != "NAS Photos" || target != 17 {
		return localbackupipc.LocalBackupSource{}, errors.New("invalid Owner target")
	}
	return localbackupipc.LocalBackupSource{
		ID: 57, Name: name, Kind: "local_folder",
		Direction: "push", SyncMode: "backup", Status: "paused",
		Revision: 1, TargetNodeID: &target,
	}, nil
}

func (f *fakeNASSourceCreator) AuthorizeLocalRoot(
	_ context.Context, id uint64, path string,
) (localbackupipc.LocalBackupRootGrant, error) {
	f.binds++
	if f.failBind {
		return localbackupipc.LocalBackupRootGrant{}, errors.New("Root permission not confirmed")
	}
	if id != 57 || path != f.wantPath {
		return localbackupipc.LocalBackupRootGrant{}, errors.New("unsafe native Root request")
	}
	if f.changeOwnerOnBind {
		f.ownerName = "different-owner"
	}
	return localbackupipc.LocalBackupRootGrant{
		SourceID: id, Path: path, Status: "awaiting_executor",
	}, nil
}

func newDSMSourceCreateFixture(t *testing.T) (*Gateway, *fakeNASSourceCreator, string, string) {
	t.Helper()
	g, base := newFixture(t)
	root := t.TempDir()
	path := filepath.Join(root, "volume1", "photos")
	if err := os.MkdirAll(path, 0755); err != nil {
		t.Fatal(err)
	}
	g.nasShareRoot = root
	agent := &fakeNASSourceCreator{
		fakeServerLoginAgent: &fakeServerLoginAgent{fakeAgent: base},
		wantPath: path,
	}
	g.Connect = func(context.Context) (Agent, error) { return agent, nil }
	_, key, err := loadAuthority(g.ConfigDir)
	if err != nil {
		t.Fatal(err)
	}
	candidates, err := enumerateNASShareChoices(context.Background(), root, key,
		"dsmadmin", "id=dsm-session", "nas.example:5001")
	if err != nil || len(candidates) != 1 {
		t.Fatalf("expected one verified readable candidate, got %v: %v", candidates, err)
	}
	scope := dsmOwnerScope(key, "dsmadmin", "id=dsm-session",
		"nas.example:5001", "https://drive.example.com", "owner")
	if len(scope) != 64 {
		t.Fatal("invalid pinned DSM Owner scope")
	}
	return g, agent, candidates[0].SelectionID, scope
}

func sourceCreateBody(selection, scope string, confirmed bool) string {
	payload := map[string]any{
		"selection_id": selection, "owner_scope": scope,
		"target_id": 17, "name": "NAS Photos", "confirmed": confirmed,
	}
	data, _ := json.Marshal(payload)
	return string(data)
}

func TestDSMSourceCreateOwnerScopedPositiveAndNoSecrets(t *testing.T) {
	g, agent, selection, scope := newDSMSourceCreateFixture(t)
	csrfToken := getCSRF(t, g)
	conn := requestServerLogin(g, "GET", "", "", "", DSMCGIPath+"?op=server-connection")
	if conn.Code != http.StatusOK {
		t.Fatalf("cannot read pinned Owner scope: %d", conn.Code)
	}
	var info map[string]any
	if err := json.Unmarshal(conn.Body.Bytes(), &info); err != nil ||
		info["owner_scope"] != scope || info["username"] != "owner" {
		t.Fatalf("Owner scope must bind Server identity: %s", conn.Body.String())
	}
	body := sourceCreateBody(selection, scope, true)
	r := requestServerLogin(g, "POST", body, "https://nas.example:5001", csrfToken,
		DSMCGIPath+"?op=nas-share-create")
	if r.Code != http.StatusOK || agent.preflights != 1 || agent.creates != 1 || agent.binds != 1 {
		t.Fatalf("native Source consent not respected: HTTP %d (%s)", r.Code, r.Body.String())
	}
	var ack map[string]any
	if err := json.Unmarshal(r.Body.Bytes(), &ack); err != nil ||
		len(ack) != 2 || ack["source_id"] != float64(57) || ack["state"] != "authorized" {
		t.Fatalf("unsafe or false source authorization acknowledgement: %s", r.Body.String())
	}
	for _, secret := range []string{agent.wantPath, selection, scope, "root_id", "device_id"} {
		if strings.Contains(r.Body.String(), secret) {
			t.Fatal("DSM browser was exposed to native path, Root, device or scope token")
		}
	}
}

func TestDSMSourceCreateRejectsUnverifiedOrForgedIntentBeforeMutation(t *testing.T) {
	g, agent, selection, scope := newDSMSourceCreateFixture(t)
	csrfToken := getCSRF(t, g)
	p := DSMCGIPath + "?op=nas-share-create"
	body := sourceCreateBody(selection, scope, true)
	for _, tc := range []struct { name, method, request, origin, token, path string }{
		{"invalid owner scope", "POST", sourceCreateBody(selection, strings.Repeat("f", 64), true), "https://nas.example:5001", csrfToken, p},
		{"invalid share identity", "POST", sourceCreateBody(strings.Repeat("0", 64), scope, true), "https://nas.example:5001", csrfToken, p},
		{"no explicit consent", "POST", sourceCreateBody(selection, scope, false), "https://nas.example:5001", csrfToken, p},
		{"foreign pathname", "POST", strings.TrimSuffix(body, "}")+`,"path":"/etc"}`, "https://nas.example:5001", csrfToken, p},
		{"foreign device", "POST", strings.TrimSuffix(body, "}")+`,"device_id":"untrusted"}`, "https://nas.example:5001", csrfToken, p},
		{"duplicate name", "POST", strings.TrimSuffix(body, "}")+`,"name":"another"}`, "https://nas.example:5001", csrfToken, p},
		{"bad cloud target", "POST", strings.Replace(body, `"target_id":17`, `"target_id":0`, 1), "https://nas.example:5001", csrfToken, p},
		{"extra CGI query", "POST", body, "https://nas.example:5001", csrfToken, p + "&path=/etc"},
		{"wrong origin", "POST", body, "https://foreign.example:5001", csrfToken, p},
		{"no CSRF", "POST", body, "https://nas.example:5001", "", p},
		{"wrong method", "GET", body, "", "", p},
		{"direct route bypass", "POST", body, "https://nas.example:5001", csrfToken, "/v1/nas-share-create"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := agent.creates
			r := requestServerLogin(g, tc.method, tc.request, tc.origin, tc.token, tc.path)
			if r.Code == http.StatusOK || agent.creates != before {
				t.Fatalf("untrusted NAS Source creation passed: HTTP %d, creations %d", r.Code, agent.creates)
			}
		})
	}
	agent.ownerName = "different-owner"
	r := requestServerLogin(g, "POST", body, "https://nas.example:5001", csrfToken, p)
	if r.Code != http.StatusConflict || agent.creates != 0 {
		t.Fatal("Owner switch while selecting a cloud target must fail before Source mutation")
	}
	if dsmOwnerScope(make([]byte, 32), "dsmadmin", "other-cookie",
		"nas.example:5001", "https://drive.example.com", "owner") == scope {
		t.Fatal("Owner proof must be bound to the DSM cookie")
	}
}

func TestDSMSourceCreateNativeBindingFailureRequiresInspection(t *testing.T) {
	g, agent, selection, scope := newDSMSourceCreateFixture(t)
	agent.failBind = true
	r := requestServerLogin(g, "POST", sourceCreateBody(selection, scope, true),
		"https://nas.example:5001", getCSRF(t, g),
		DSMCGIPath+"?op=nas-share-create")
	if r.Code != 200 || agent.creates != 1 || agent.binds != 1 ||
		!strings.Contains(r.Body.String(), `"state":"needs_inspection"`) ||
		strings.Contains(r.Body.String(), `"state":"authorized"`) {
		t.Fatalf("failed binding must not claim Root success, got %d %s", r.Code, r.Body.String())
	}
}

func TestDSMSourceCreateUncertainServerReplyDoesNotAutoRetry(t *testing.T) {
	g, agent, selection, scope := newDSMSourceCreateFixture(t)
	agent.failCreate = true
	r := requestServerLogin(g, "POST", sourceCreateBody(selection, scope, true),
		"https://nas.example:5001", getCSRF(t, g),
		DSMCGIPath+"?op=nas-share-create")
	if r.Code != http.StatusConflict || agent.creates != 1 || agent.binds != 0 {
		t.Fatalf("ambiguous create must be explicit with no auto retry, got %d", r.Code)
	}
}

func TestDSMSourceCreateOldAgentFailsClosed(t *testing.T) {
	g, basic := newFixture(t)
	g.Connect = func(context.Context) (Agent, error) { return basic, nil }
	r := requestServerLogin(g, "POST", sourceCreateBody(strings.Repeat("a", 64), strings.Repeat("b", 64), true),
		"https://nas.example:5001", getCSRF(t, g),
		DSMCGIPath+"?op=nas-share-create")
	if r.Code != http.StatusNotImplemented {
		t.Fatalf("old Agent cannot create Source through DSM CGI: %d", r.Code)
	}
}

func TestDSMSourceCreateChangedOwnerAfterBindingDoesNotReportAuthorized(t *testing.T) {
	g, agent, selection, scope := newDSMSourceCreateFixture(t)
	agent.changeOwnerOnBind = true
	r := requestServerLogin(g, "POST", sourceCreateBody(selection, scope, true),
		"https://nas.example:5001", getCSRF(t, g),
		DSMCGIPath+"?op=nas-share-create")
	if r.Code != http.StatusOK || agent.creates != 1 || agent.binds != 1 ||
		!strings.Contains(r.Body.String(), `"state":"needs_inspection"`) ||
		strings.Contains(r.Body.String(), `"state":"authorized"`) {
		t.Fatalf("post-bind Owner switch cannot yield confirmed authorization: %d %s", r.Code, r.Body.String())
	}
}
