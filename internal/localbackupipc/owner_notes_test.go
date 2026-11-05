package localbackupipc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

const ownerNotesFixtureID = "12345678-1234-1234-1234-123456789abc"

func ownerNotesFixtureRow(title, markdown, source string, rev uint64) client.NotesRow {
	digest := sha256.Sum256([]byte(markdown))
	return client.NotesRow{ID: ownerNotesFixtureID, Source: source, Title: title,
		NodeID: 87, Revision: rev, Bytes: int64(len(markdown)),
		SHA256: hex.EncodeToString(digest[:])}
}

func TestOwnerNotesClientCapabilityAuthAndFileVersion(t *testing.T) {
	var hits []string
	reply := func(w http.ResponseWriter, value any) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(value)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer owner-test-secret" ||
			r.Header.Get("Cookie") != "" {
			t.Errorf("missing Agent authentication or leaked Cookie")
		}
		hits = append(hits, r.Method+" "+r.URL.String())
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/cloud/notes/namespace":
			reply(w, client.NotesNamespace{SystemNodeID: 1, NotesNodeID: 2,
				IOSBackupNodeID: 3, MyNotesNodeID: 4})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/cloud/notes":
			reply(w, client.NotesPage{Items: []client.NotesRow{
				ownerNotesFixtureRow("Test", "# Note", "mine", 1),
			}})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/cloud/notes/"+ownerNotesFixtureID:
			reply(w, client.NotesDetail{NotesRow: ownerNotesFixtureRow("Test", "# Note", "mine", 1),
				Markdown: "# Note"})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/cloud/notes":
			w.WriteHeader(http.StatusCreated)
			reply(w, ownerNotesFixtureRow("Test", "# Note", "mine", 1))
		case r.Method == http.MethodPut && r.URL.Path == "/v1/cloud/notes/"+ownerNotesFixtureID:
			reply(w, ownerNotesFixtureRow("Test", "updated", "mine", 2))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/cloud/notes/"+ownerNotesFixtureID+"/versions":
			reply(w, client.NotesVersions{NodeID: 87, Items: []client.NotesVersion{
				{ID: 91, Revision: 1, Bytes: 6, SHA256: ownerNotesFixtureRow("Test", "# Note", "mine", 1).SHA256},
			}})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/cloud/notes/version-content":
			reply(w, map[string]string{"markdown": "# Note"})
		case r.Method == http.MethodDelete && r.URL.Path == "/v1/cloud/notes/"+ownerNotesFixtureID:
			if r.URL.Query().Get("revision") != "2" {
				t.Errorf("delete lost exact Notes revision")
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "unexpected Notes route", http.StatusNotFound)
		}
	}))
	defer srv.Close()
	c := &Client{baseURL: srv.URL, token: "owner-test-secret",
		capabilities: []string{"cloud-notes"}, http: srv.Client()}
	ctx := context.Background()
	if ns, err := c.OwnerNotesInitialize(ctx); err != nil || ns.MyNotesNodeID != 4 {
		t.Fatalf("namespace: %+v %v", ns, err)
	}
	if page, err := c.OwnerNotesList(ctx, "mine", "中文", 0); err != nil || len(page.Items) != 1 {
		t.Fatalf("list: %+v %v", page, err)
	}
	if note, err := c.OwnerNotesRead(ctx, ownerNotesFixtureID); err != nil || note.Markdown != "# Note" {
		t.Fatalf("read: %+v %v", note, err)
	}
	if row, err := c.OwnerNotesCreate(ctx, client.NotesWrite{Title: "Test", Markdown: "# Note"}); err != nil || row.Revision != 1 {
		t.Fatalf("create: %+v %v", row, err)
	}
	if row, err := c.OwnerNotesUpdate(ctx, ownerNotesFixtureID, client.NotesWrite{
		Title: "Test", Markdown: "updated", ExpectedRevision: 1,
	}); err != nil || row.Revision != 2 {
		t.Fatalf("update: %+v %v", row, err)
	}
	if page, err := c.OwnerNotesVersions(ctx, ownerNotesFixtureID); err != nil || page.NodeID != 87 {
		t.Fatalf("versions: %+v %v", page, err)
	}
	if text, err := c.OwnerNotesReadVersion(ctx, 87, 91); err != nil || text != "# Note" {
		t.Fatalf("history: %q %v", text, err)
	}
	if err := c.OwnerNotesDelete(ctx, ownerNotesFixtureID, 2); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if len(hits) != 8 ||
		hits[1] != "GET /v1/cloud/notes?offset=0&q=%E4%B8%AD%E6%96%87&source=mine" {
		t.Fatalf("unexpected Agent Notes route sequence: %v", hits)
	}
	withoutCapability := &Client{baseURL: srv.URL, token: "owner-test-secret", http: srv.Client()}
	if _, err := withoutCapability.OwnerNotesRead(ctx, ownerNotesFixtureID); err == nil {
		t.Fatal("Client without Notes capability did not fail closed")
	}
	if len(hits) != 8 {
		t.Fatalf("invalid capability reached Agent: %v", hits)
	}
}

func TestOwnerNotesClientRejectsInvalidIdentityBeforeAgent(t *testing.T) {
	c := &Client{capabilities: []string{"cloud-notes"}}
	ctx := context.Background()
	for _, id := range []string{"../other", "bad", strings.ToUpper(ownerNotesFixtureID)} {
		if _, err := c.OwnerNotesRead(ctx, id); err == nil {
			t.Fatalf("invalid note ID accepted: %q", id)
		}
		if err := c.OwnerNotesDelete(ctx, id, 2); err == nil {
			t.Fatalf("invalid delete ID accepted: %q", id)
		}
	}
	if _, err := c.OwnerNotesList(ctx, "other", "", 0); err == nil {
		t.Fatal("invalid notes source accepted")
	}
	if _, err := c.OwnerNotesList(ctx, "mine", "", 1); err == nil {
		t.Fatal("invalid notes offset accepted")
	}
	if _, err := c.OwnerNotesCreate(ctx, client.NotesWrite{
		Title: "Note", Markdown: strings.Repeat("x", client.NotesMaxMarkdownBytes+1),
	}); err == nil {
		t.Fatal("oversized Markdown accepted")
	}
	if _, err := c.OwnerNotesReadVersion(ctx, 0, 1); err == nil {
		t.Fatal("invalid history node accepted")
	}
}

func TestOwnerNotesClientRejectsForeignOrCorruptedResponse(t *testing.T) {
	var corrupt bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		value := client.NotesDetail{NotesRow: ownerNotesFixtureRow("Test", "ok", "mine", 1), Markdown: "ok"}
		if corrupt {
			value.Markdown = "changed"
		} else {
			value.ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(value); err != nil {
			t.Error(err)
		}
	}))
	defer srv.Close()
	c := &Client{baseURL: srv.URL, token: "owner-test-secret",
		capabilities: []string{"cloud-notes"}, http: srv.Client()}
	for i := 0; i < 2; i++ {
		if _, err := c.OwnerNotesRead(context.Background(), ownerNotesFixtureID); err == nil {
			t.Fatalf("unverified Notes read %d accepted", i)
		}
		corrupt = true
	}
}


func TestOwnerNotesImportIOSIsExplicitOwnerBoundAndOneShot(t *testing.T) {
	markdown := "# Imported snapshot"
	externalID := "manual:12345678-1234-1234-1234-123456789abc"
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodPost || r.URL.Path != "/v1/cloud/notes/import-ios" ||
			r.Header.Get("Authorization") != "Bearer owner-test-secret" || r.Header.Get("Cookie") != "" {
			t.Errorf("unexpected Owner Notes import request: %s %s", r.Method, r.URL)
		}
		var input client.NotesImportWrite
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
		}
		if input.Title != "Imported" || input.Markdown != markdown || input.ExternalID != externalID {
			t.Errorf("manual import body changed: %+v", input)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(ownerNotesFixtureRow("Imported", markdown, "ios_notes", 2))
	}))
	defer srv.Close()
	c := &Client{baseURL: srv.URL, token: "owner-test-secret",
		capabilities: []string{"cloud-notes"}, http: srv.Client()}
	row, err := c.OwnerNotesImportIOS(context.Background(), client.NotesImportWrite{
		Title: "Imported", Markdown: markdown, ExternalID: externalID,
	})
	if err != nil || row.Source != "ios_notes" || row.Revision != 2 || calls != 1 {
		t.Fatalf("manual iOS import: %+v %v calls=%d", row, err, calls)
	}
	if _, err := c.OwnerNotesImportIOS(context.Background(), client.NotesImportWrite{
		Title: "Imported", Markdown: markdown, ExternalID: "title:guess",
	}); err == nil || calls != 1 {
		t.Fatalf("invalid manual identity reached Agent: err=%v calls=%d", err, calls)
	}
	withoutCapability := &Client{baseURL: srv.URL, token: "owner-test-secret", http: srv.Client()}
	if _, err := withoutCapability.OwnerNotesImportIOS(context.Background(), client.NotesImportWrite{
		Title: "Imported", Markdown: markdown,
	}); err == nil || calls != 1 {
		t.Fatalf("Agent without Notes capability was permitted: err=%v calls=%d", err, calls)
	}
}
