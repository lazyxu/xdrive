package client

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

const notesTestID = "12345678-1234-1234-1234-123456789abc"

func testNotesReceipt(title, markdown, source string, revision uint64) NotesRow {
	sum := sha256.Sum256([]byte(markdown))
	return NotesRow{
		ID: notesTestID, Source: source, Title: title, NodeID: 87,
		Revision: revision, SHA256: hex.EncodeToString(sum[:]),
		Bytes: int64(len(markdown)), CreatedAt: "2026-11-03T02:00:00Z",
		UpdatedAt: "2026-11-03T02:00:00Z",
	}
}

func TestNotesOwnerClientRoutesRevisionAndHistory(t *testing.T) {
	type actual struct {
		Method string
		Path   string
		Auth   string
		Match  string
		Body   string
	}
	var seen []actual
	markdown := "# Hello\n\n笔记"
	receipt := testNotesReceipt("中文标题", markdown, "mine", 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(r.Body, 2*NotesMaxMarkdownBytes))
		seen = append(seen, actual{Method: r.Method, Path: r.URL.String(),
			Auth: r.Header.Get("Authorization"), Match: r.Header.Get("If-Match"),
			Body: string(body)})
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/api/v1/notes/namespace" && r.Method == "POST":
			_ = json.NewEncoder(w).Encode(NotesNamespace{SystemNodeID: 5,
				NotesNodeID: 6, IOSBackupNodeID: 7, MyNotesNodeID: 8})
		case r.URL.Path == "/api/v1/notes" && r.Method == "GET":
			_ = json.NewEncoder(w).Encode(NotesPage{Items: []NotesRow{receipt}})
		case r.URL.Path == "/api/v1/notes" && r.Method == "POST":
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(receipt)
		case r.URL.Path == "/api/v1/notes/"+notesTestID && r.Method == "GET":
			_ = json.NewEncoder(w).Encode(NotesDetail{NotesRow: receipt, Markdown: markdown})
		case r.URL.Path == "/api/v1/notes/"+notesTestID && r.Method == "PUT":
			var update NotesWrite
			if err := json.Unmarshal(body, &update); err != nil {
				t.Errorf("invalid mutation JSON: %v", err)
			}
			_ = json.NewEncoder(w).Encode(testNotesReceipt(update.Title, update.Markdown, "mine", 2))
		case r.URL.Path == "/api/v1/notes/"+notesTestID && r.Method == "DELETE":
			w.WriteHeader(http.StatusNoContent)
		case r.URL.Path == "/api/v1/notes/"+notesTestID+"/versions" && r.Method == "GET":
			_ = json.NewEncoder(w).Encode(NotesVersions{NodeID: 87, Items: []NotesVersion{
				{ID: 91, Revision: 1, SHA256: receipt.SHA256, Bytes: receipt.Bytes},
			}})
		case r.URL.Path == "/api/v1/files/87/versions/91/content" && r.Method == "GET":
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			_, _ = io.WriteString(w, markdown)
		default:
			http.Error(w, "unexpected Notes request", http.StatusNotFound)
		}
	}))
	defer srv.Close()
	cli := New(srv.URL, "owner-bearer")
	ctx := context.Background()
	ns, err := cli.NotesInitialize(ctx)
	if err != nil || ns.MyNotesNodeID != 8 || ns.IOSBackupNodeID != 7 {
		t.Fatalf("bad Owner namespace: %+v %v", ns, err)
	}
	page, err := cli.NotesList(ctx, "mine", "中文", 0)
	if err != nil || len(page.Items) != 1 {
		t.Fatalf("failed Notes list: %+v %v", page, err)
	}
	read, err := cli.NotesRead(ctx, notesTestID)
	if err != nil || read.Markdown != markdown || read.NodeID != 87 {
		t.Fatalf("bad Markdown read: %+v %v", read, err)
	}
	created, err := cli.NotesCreate(ctx, NotesWrite{Title: "中文标题", Markdown: markdown})
	if err != nil || created.ID != notesTestID {
		t.Fatalf("bad create: %+v %v", created, err)
	}
	next, err := cli.NotesUpdate(ctx, notesTestID, NotesWrite{
		Title: "中文标题", Markdown: "updated", ExpectedRevision: 1,
	})
	if err != nil || next.Revision != 2 {
		t.Fatalf("bad update: %+v %v", next, err)
	}
	versions, err := cli.NotesVersions(ctx, notesTestID)
	if err != nil || len(versions.Items) != 1 || versions.NodeID != 87 {
		t.Fatalf("bad history: %+v %v", versions, err)
	}
	oldText, err := cli.NotesReadVersion(ctx, 87, 91)
	if err != nil || oldText != markdown {
		t.Fatalf("old Markdown bytes not retained: %q %v", oldText, err)
	}
	if err := cli.NotesDelete(ctx, notesTestID, 2); err != nil {
		t.Fatal(err)
	}
	if len(seen) != 8 {
		t.Fatalf("unexpected number of Server requests: %d", len(seen))
	}
	for _, hit := range seen {
		if hit.Auth != "Bearer owner-bearer" {
			t.Errorf("Owner credential omitted or leaked: %+v", hit)
		}
	}
	if seen[1].Path != "/api/v1/notes?offset=0&q="+url.QueryEscape("中文")+"&source=mine" {
		t.Errorf("Notes query did not preserve Unicode and source: %s", seen[1].Path)
	}
	if seen[4].Method != http.MethodPut || !strings.Contains(seen[4].Body, "\"expected_revision\":1") {
		t.Fatalf("optimistic version absent from update: %+v", seen[4])
	}
	if seen[7].Method != http.MethodDelete || seen[7].Match != "2" {
		t.Fatalf("If-Match revision missing: %+v", seen[7])
	}
}

func TestNotesOwnerClientRejectsInvalidIdentityAndForgedContent(t *testing.T) {
	count := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count++
		out := NotesDetail{
			NotesRow: testNotesReceipt("Other", "# Original", "mine", 2),
			Markdown: "# Tampered",
		}
		_ = json.NewEncoder(w).Encode(out)
	}))
	defer srv.Close()
	cli := New(srv.URL, "owner-bearer")
	ctx := context.Background()
	if _, err := cli.NotesRead(ctx, "../another-owner"); err == nil {
		t.Fatal("accepted untrusted Notes ID")
	}
	if _, err := cli.NotesRead(ctx, notesTestID); err == nil {
		t.Fatal("accepted mismatched content hash")
	}
	if _, err := cli.NotesList(ctx, "admin", "", 0); err == nil {
		t.Fatal("accepted unknown source")
	}
	if _, err := cli.NotesList(ctx, "mine", "", 51); err == nil {
		t.Fatal("accepted out-of-range page offset")
	}
	if _, err := cli.NotesCreate(ctx, NotesWrite{Title: "bad\nname", Markdown: "a"}); err == nil {
		t.Fatal("accepted control character in title")
	}
	if _, err := cli.NotesCreate(ctx, NotesWrite{Title: "valid", Markdown: strings.Repeat("x", NotesMaxMarkdownBytes+1)}); err == nil {
		t.Fatal("accepted oversized Markdown")
	}
	if err := cli.NotesDelete(ctx, notesTestID, 0); err == nil {
		t.Fatal("accepted absent expected revision")
	}
	if count != 1 {
		t.Fatalf("malformed Notes calls issued extra Server requests: %d", count)
	}
}

func TestNotesReadVersionBoundsRawHTTPBody(t *testing.T) {
	tests := []struct {
		name string
		content string
		ok bool
	}{
		{name: "valid", content: "中文 Markdown", ok: true},
		{name: "oversize", content: strings.Repeat("x", NotesMaxMarkdownBytes+1)},
		{name: "bad utf8", content: string([]byte{0xff, 0xfe})},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = fmt.Fprint(w, tc.content)
			}))
			defer srv.Close()
			c := New(srv.URL, "owner-bearer")
			content, err := c.NotesReadVersion(context.Background(), 87, 91)
			if tc.ok && (err != nil || content != tc.content) {
				t.Fatalf("valid version refused: %q %v", content, err)
			}
			if !tc.ok && err == nil {
				t.Fatalf("invalid version accepted: %q", tc.name)
			}
		})
	}
}
