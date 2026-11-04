package localbackupipc

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

const notesImageIPCNote = "12345678-1234-1234-1234-123456789abc"
const notesImageIPCAsset = "00000000-0000-4000-8000-000000000000.gif"

func TestOwnerNotesImageIPCAuthenticatedUploadAndRead(t *testing.T) {
	image := []byte("GIF89a")
	sum := sha256.Sum256(image)
	digest := hex.EncodeToString(sum[:])
	relative := "_assets/" + notesImageIPCNote + "/" + notesImageIPCAsset
	var count atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count.Add(1)
		if r.Header.Get("Authorization") != "Bearer secret" ||
			r.Header.Get("Cookie") != "" {
			t.Error("owning Agent bearer was missing or leaked a Cookie")
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path ==
			"/v1/cloud/notes/"+notesImageIPCNote+"/images":
			var input struct {
				Image []byte `json:"image"`
			}
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil ||
				!bytes.Equal(input.Image, image) {
				t.Error("Notes upload lost exact image bytes")
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(client.NotesImageReceipt{
				NodeID: 123, Filename: notesImageIPCAsset, RelativePath: relative,
				ContentType: "image/gif", Bytes: int64(len(image)), SHA256: digest,
			})
		case r.Method == http.MethodGet && r.URL.Path ==
			"/v1/cloud/notes/"+notesImageIPCNote+"/images" &&
			r.URL.Query().Get("relative_path") == relative:
			_ = json.NewEncoder(w).Encode(OwnerNotesImageData{
				ContentType: "image/gif", Bytes: int64(len(image)),
				SHA256: digest, Image: image,
			})
		default:
			t.Errorf("unexpected image proxy endpoint %s %s", r.Method, r.URL)
			http.Error(w, "invalid Notes route", http.StatusNotFound)
		}
	}))
	defer srv.Close()

	c := &Client{
		baseURL: srv.URL, token: "secret",
		capabilities: []string{"cloud-notes", "cloud-notes-images"},
		http: srv.Client(),
	}
	receipt, err := c.OwnerNotesUploadImage(context.Background(), notesImageIPCNote, image)
	if err != nil || receipt.RelativePath != relative || receipt.Bytes != int64(len(image)) {
		t.Fatalf("Owner image upload mismatch: %+v %v", receipt, err)
	}
	out, err := c.OwnerNotesReadImage(context.Background(), notesImageIPCNote, relative)
	if err != nil || out.ContentType != "image/gif" ||
		out.Bytes != int64(len(image)) || !bytes.Equal(out.Image, image) {
		t.Fatalf("Owner image read mismatch: %+v %v", out, err)
	}
	if count.Load() != 2 {
		t.Fatalf("Owner image requests were duplicated: %d", count.Load())
	}
}

func TestOwnerNotesImageIPCRejectsUnsafeIdentityAndMissingCapabilityBeforeNetwork(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Error(w, "unexpected", http.StatusForbidden)
	}))
	defer srv.Close()
	c := &Client{baseURL: srv.URL, token: "secret",
		capabilities: []string{"cloud-notes", "cloud-notes-images"},
		http: srv.Client()}
	for _, noteID := range []string{"../foreign", "missing-uuid", strings.ToUpper(notesImageIPCNote)} {
		if _, err := c.OwnerNotesUploadImage(context.Background(), noteID, []byte("GIF89a")); err == nil {
			t.Fatalf("invalid note ID upload accepted: %q", noteID)
		}
	}
	for _, relative := range []string{
		"../x", "https://foreign.example/private.gif",
		"_assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/" + notesImageIPCAsset,
		"_assets/" + notesImageIPCNote + "/../../private.gif",
	} {
		if _, err := c.OwnerNotesReadImage(context.Background(), notesImageIPCNote, relative); err == nil {
			t.Fatalf("invalid Owner Notes selector accepted: %q", relative)
		}
	}
	if _, err := c.OwnerNotesUploadImage(context.Background(), notesImageIPCNote, nil); err == nil {
		t.Fatal("empty image was accepted")
	}
	if _, err := c.OwnerNotesUploadImage(context.Background(), notesImageIPCNote,
		make([]byte, client.NotesMaxImageBytes+1)); err == nil {
		t.Fatal("oversized image was accepted")
	}
	if calls.Load() != 0 {
		t.Fatalf("unsafe Notes request reached the Agent %d times", calls.Load())
	}
	c.capabilities = []string{"cloud-notes"}
	if _, err := c.OwnerNotesReadImage(context.Background(), notesImageIPCNote,
		"_assets/"+notesImageIPCNote+"/"+notesImageIPCAsset); err == nil {
		t.Fatal("Agent without image capability was permitted")
	}
	if calls.Load() != 0 {
		t.Fatal("missing Agent image capability attempted a network request")
	}
}

func TestOwnerNotesImageIPCRejectsCorruptedImageReceipt(t *testing.T) {
	image := []byte("GIF89a")
	relative := "_assets/" + notesImageIPCNote + "/" + notesImageIPCAsset
	var badMode atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch badMode.Load() {
		case 0:
			_ = json.NewEncoder(w).Encode(OwnerNotesImageData{
				ContentType: "image/gif", Bytes: int64(len(image)),
				SHA256: strings.Repeat("0", 64), Image: image,
			})
		case 1:
			_ = json.NewEncoder(w).Encode(OwnerNotesImageData{
				ContentType: "image/png", Bytes: int64(len(image)),
				Image: image,
			})
		case 2:
			_, _ = w.Write(bytes.Repeat([]byte("x"), ownerNotesImageIPCReplyMax+1))
		case 3:
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte("<script>bad</script>"))
		case 4:
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte("private source error"))
		}
	}))
	defer srv.Close()
	c := &Client{baseURL: srv.URL, token: "secret",
		capabilities: []string{"cloud-notes", "cloud-notes-images"},
		http: srv.Client()}
	for mode := int32(0); mode <= 4; mode++ {
		badMode.Store(mode)
		if _, err := c.OwnerNotesReadImage(context.Background(), notesImageIPCNote, relative); err == nil {
			t.Fatalf("invalid response mode %d was accepted", mode)
		}
	}
}
