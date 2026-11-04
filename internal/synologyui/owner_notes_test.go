package synologyui

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

const dsmNotesFixtureID = "12345678-1234-1234-1234-123456789abc"

type dsmNotesFixture struct {
	*fakeAgent
	owner         string
	enabled       bool
	writes, reads int
}

func (f *dsmNotesFixture) OwnerNotesAvailable() bool {
	return f.enabled
}
func (f *dsmNotesFixture) ServerConnection(context.Context) (localbackupipc.ServerConnection, error) {
	return localbackupipc.ServerConnection{Configured: true, Server: "https://server.example",
		Username: f.owner}, nil
}
func (f *dsmNotesFixture) LoginServer(context.Context, string, string, string) error {
	return errors.New("not an Owner Notes route")
}
func (f *dsmNotesFixture) OwnerQuota(context.Context) (localbackupipc.OwnerQuota, error) {
	return localbackupipc.OwnerQuota{
		QuotaBytes: 8192, PhysicalUsedBytes: 1024, AvailableBytes: 6912,
		ReservedBytes: 256, LogicalFileBytes: 1500,
	}, nil
}
func (f *dsmNotesFixture) notesRow(markdown string, rev uint64) client.NotesRow {
	h := sha256.Sum256([]byte(markdown))
	return client.NotesRow{
		ID: dsmNotesFixtureID, Source: "mine", Title: "Title", NodeID: 87,
		Revision: rev, Bytes: int64(len(markdown)), SHA256: hex.EncodeToString(h[:]),
	}
}
func (f *dsmNotesFixture) OwnerNotesInitialize(context.Context) (client.NotesNamespace, error) {
	f.writes++
	return client.NotesNamespace{SystemNodeID: 1, NotesNodeID: 2,
		IOSBackupNodeID: 3, MyNotesNodeID: 4}, nil
}
func (f *dsmNotesFixture) OwnerNotesList(_ context.Context, source, q string, offset int) (client.NotesPage, error) {
	f.reads++
	if source != "mine" || offset != 0 {
		return client.NotesPage{}, errors.New("invalid source")
	}
	return client.NotesPage{Items: []client.NotesRow{f.notesRow("text", 1)}}, nil
}
func (f *dsmNotesFixture) OwnerNotesRead(_ context.Context, id string) (client.NotesDetail, error) {
	f.reads++
	return client.NotesDetail{NotesRow: f.notesRow("text", 1), Markdown: "text"}, nil
}
func (f *dsmNotesFixture) OwnerNotesCreate(_ context.Context, write client.NotesWrite) (client.NotesRow, error) {
	f.writes++
	return f.notesRow(write.Markdown, 1), nil
}
func (f *dsmNotesFixture) OwnerNotesUpdate(_ context.Context, id string, write client.NotesWrite) (client.NotesRow, error) {
	f.writes++
	return f.notesRow(write.Markdown, write.ExpectedRevision+1), nil
}
func (f *dsmNotesFixture) OwnerNotesDelete(context.Context, string, uint64) error {
	f.writes++
	return nil
}
func (f *dsmNotesFixture) OwnerNotesVersions(context.Context, string) (client.NotesVersions, error) {
	f.reads++
	return client.NotesVersions{NodeID: 87, Items: []client.NotesVersion{{ID: 91, Revision: 1, Bytes: 4}}}, nil
}
func (f *dsmNotesFixture) OwnerNotesReadVersion(context.Context, uint64, uint64) (string, error) {
	f.reads++
	return "text", nil
}

func dsmNotesRequest(h http.Handler, method, op string, values string, body string, csrf string) *httptest.ResponseRecorder {
	url := "https://nas.example:5001" + DSMCGIPath + "?op=" + op
	if values != "" {
		url += "&" + values
	}
	req := httptest.NewRequest(method, url, bytes.NewBufferString(body))
	req.Header.Set("Cookie", "id=dsm-session")
	req.Header.Set("Origin", "https://nas.example:5001")
	if csrf != "" {
		req.Header.Set("X-CSRF-Token", csrf)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestDSMNotesCGIOwnerScopedNoGeneralProxy(t *testing.T) {
	g, original := newFixture(t)
	f := &dsmNotesFixture{fakeAgent: original, owner: "alice", enabled: true}
	g.Connect = func(context.Context) (Agent, error) { return f, nil }
	h := CGIHandler(g)
	keyAuth, key, err := loadAuthority(g.ConfigDir)
	if err != nil || keyAuth.DSMUser != "dsmadmin" {
		t.Fatalf("missing DSM authority: %v", err)
	}
	ownerScope := dsmOwnerScope(key, "dsmadmin", "id=dsm-session",
		"nas.example:5001", "https://server.example", "alice")
	csrf := getCSRF(t, g)
	if res := dsmNotesRequest(h, http.MethodGet, "cloud-notes-capability", "", "", ""); res.Code != 200 ||
		!strings.Contains(res.Body.String(), "\"available\":true") {
		t.Fatalf("Notes capability preflight failed: %d %s", res.Code, res.Body.String())
	}
	namespace := dsmNotesRequest(h, http.MethodPost, "cloud-notes-namespace", "",
		`{"owner_scope":"`+ownerScope+`"}`, csrf)
	if namespace.Code != 200 || f.writes != 1 {
		t.Fatalf("Notes namespace denied: %d %s", namespace.Code, namespace.Body.String())
	}
	for _, item := range []struct{ op, q string }{
		{"cloud-notes-list", "source=mine&q=&offset=0"},
		{"cloud-notes-read", "id=" + dsmNotesFixtureID},
		{"cloud-notes-versions", "id=" + dsmNotesFixtureID},
		{"cloud-notes-history", "node_id=87&version_id=91"},
	} {
		res := dsmNotesRequest(h, http.MethodGet, item.op, item.q, "", "")
		if res.Code != 200 {
			t.Fatalf("Notes %s: %d %s", item.op, res.Code, res.Body.String())
		}
	}
	if f.reads != 4 {
		t.Fatalf("Owner Notes reads not isolated: %d", f.reads)
	}
	if res := dsmNotesRequest(h, http.MethodPost, "cloud-notes-create", "",
		`{"owner_scope":"`+ownerScope+`","title":"Title","markdown":"text"}`, csrf); res.Code != 200 {
		t.Fatalf("Notes create rejected: %d %s", res.Code, res.Body.String())
	}
	if res := dsmNotesRequest(h, http.MethodPost, "cloud-notes-save", "",
		`{"owner_scope":"`+ownerScope+`","id":"`+dsmNotesFixtureID+`","title":"Title","markdown":"updated","expected_revision":1}`, csrf); res.Code != 200 {
		t.Fatalf("Notes save rejected: %d %s", res.Code, res.Body.String())
	}
	if res := dsmNotesRequest(h, http.MethodPost, "cloud-notes-delete", "",
		`{"owner_scope":"`+ownerScope+`","id":"`+dsmNotesFixtureID+`","revision":2}`, csrf); res.Code != 200 {
		t.Fatalf("Notes delete rejected: %d %s", res.Code, res.Body.String())
	}
	if f.writes != 4 {
		t.Fatalf("only four Notes mutations should have occurred: %d", f.writes)
	}

	badScope := strings.Repeat("0", 64)
	for _, tc := range []struct {
		name, method, op, q, body, csrf string
		want                            int
	}{
		{"foreignOwner", http.MethodPost, "cloud-notes-delete", "",
			`{"owner_scope":"`+badScope+`","id":"`+dsmNotesFixtureID+`","revision":2}`, csrf, 409},
		{"withoutCSRF", http.MethodPost, "cloud-notes-namespace", "",
			`{"owner_scope":"`+ownerScope+`"}`, "", 403},
		{"duplicateQuery", http.MethodGet, "cloud-notes-read", "id=" + dsmNotesFixtureID + "&id=" + dsmNotesFixtureID, "", "", 400},
		{"invalidRevision", http.MethodGet, "cloud-notes-history", "node_id=0&version_id=1", "", "", 400},
		{"notNotesRoute", http.MethodGet, "cloud-notes-arbitrary", "", "", "", 404},
		{"wrongMethod", http.MethodGet, "cloud-notes-save", "", "", "", 405},
	} {
		res := dsmNotesRequest(h, tc.method, tc.op, tc.q, tc.body, tc.csrf)
		if res.Code != tc.want {
			t.Errorf("%s: HTTP %d want %d: %s", tc.name, res.Code, tc.want, res.Body.String())
		}
	}
	if f.writes != 4 {
		t.Fatalf("untrusted CGI reached Notes mutation: %d", f.writes)
	}
	f.owner = "bob"
	if res := dsmNotesRequest(h, http.MethodPost, "cloud-notes-namespace", "",
		`{"owner_scope":"`+ownerScope+`"}`, csrf); res.Code != 409 {
		t.Fatalf("old Owner scope reused after switch: HTTP %d", res.Code)
	}
	f.owner = "alice"
	f.enabled = false
	if res := dsmNotesRequest(h, http.MethodGet, "cloud-notes-capability", "", "", ""); res.Code != 501 {
		t.Fatalf("Agent without Notes capability was advertised: %d", res.Code)
	}
}

func TestDSMNotesMutationParserRejectsDuplicateOrOversize(t *testing.T) {
	for _, input := range []string{
		`{"owner_scope":"` + strings.Repeat("a", 64) + `","owner_scope":"` + strings.Repeat("a", 64) + `"}`,
		`{"owner_scope":"` + strings.Repeat("a", 64) + `","unknown":true}`,
	} {
		req := httptest.NewRequest(http.MethodPost, "/v1/cloud-notes-namespace", strings.NewReader(input))
		if _, err := parseDSMNotesMutation(req); err == nil {
			t.Fatal("invalid Notes mutation was accepted")
		}
	}
	id := dsmNotesFixtureID
	if !validDSMNoteID(id) || validDSMNoteID(strings.ToUpper(id)) {
		t.Fatal("canonical Note UUID validation regressed")
	}
}
