package client

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

const testNotesImageName = "00000000-0000-4000-8000-000000000000.gif"

func TestNotesOwnerImagePathIsFixedToNote(t *testing.T) {
	path := "_assets/" + notesTestID + "/" + testNotesImageName
	filename, mime, ok := NotesImageFilename(notesTestID, path)
	if !ok || filename != testNotesImageName || mime != "image/gif" {
		t.Fatalf("valid immutable Notes asset rejected: %q %q %v", filename, mime, ok)
	}
	for _, unsafe := range []string{
		"https://attacker.example/secret.gif",
		"/api/v1/notes/" + notesTestID + "/images/" + testNotesImageName,
		"_assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/" + testNotesImageName,
		"_assets/" + notesTestID + "/../" + testNotesImageName,
		"_assets/" + notesTestID + "/photo.gif",
		"_assets/" + notesTestID + "/" + testNotesImageName + "?token=secret",
	} {
		if _, _, ok := NotesImageFilename(notesTestID, unsafe); ok {
			t.Fatalf("unsafe Markdown reference was accepted: %q", unsafe)
		}
	}
}

func TestNotesOwnerImageUploadAndReadAuthAndIntegrity(t *testing.T) {
	// Bounded bytes: the Server determines the actual MIME from content.
	image := []byte("GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff\x21\xf9\x04\x01\x00\x00\x00\x00\x2c\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02\x44\x01\x00\x3b")
	sum := sha256.Sum256(image)
	sha := hex.EncodeToString(sum[:])
	path := "_assets/" + notesTestID + "/" + testNotesImageName
	var requests, uploads, downloads atomic.Int32
	var wrongReceipt, wrongReadHash atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Header.Get("Authorization") != "Bearer owner-bearer" ||
			r.Header.Get("Cookie") != "" {
			t.Errorf("Notes image request lost Owner bearer or sent cookies")
		}
		switch {
		case r.Method == http.MethodPost &&
			r.URL.Path == "/api/v1/notes/mine/"+notesTestID+"/images":
			uploads.Add(1)
			if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data;") {
				t.Errorf("Notes upload did not send multipart/form-data")
			}
			file, _, err := r.FormFile("image")
			if err != nil {
				t.Errorf("Notes multipart has no image: %v", err)
				http.Error(w, "invalid image", http.StatusBadRequest)
				return
			}
			received, err := io.ReadAll(io.LimitReader(file, NotesMaxImageBytes+1))
			file.Close()
			if err != nil || !bytes.Equal(received, image) {
				t.Errorf("Notes upload changed the image bytes: %v", err)
			}
			relative := path
			if wrongReceipt.Load() {
				relative = "_assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/" + testNotesImageName
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(NotesImageReceipt{
				NodeID: 92, Filename: testNotesImageName,
				RelativePath: relative, ContentType: "image/gif",
				SHA256: sha, Bytes: int64(len(image)),
			})
		case r.Method == http.MethodGet &&
			r.URL.Path == "/api/v1/notes/"+notesTestID+"/images/"+testNotesImageName:
			downloads.Add(1)
			w.Header().Set("Content-Type", "image/gif")
			if wrongReadHash.Load() {
				w.Header().Set("ETag", "\""+strings.Repeat("0", 64)+"\"")
			} else {
				w.Header().Set("ETag", "\""+sha+"\"")
			}
			_, _ = w.Write(image)
		default:
			t.Errorf("unexpected or unscoped Notes image route: %s %s", r.Method, r.URL)
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	cli := New(srv.URL, "owner-bearer")
	ctx := context.Background()
	receipt, err := cli.NotesUploadMineImage(ctx, notesTestID, image)
	if err != nil || receipt.RelativePath != path || receipt.NodeID != 92 ||
		receipt.Bytes != int64(len(image)) {
		t.Fatalf("Owner Note image upload failed: %+v %v", receipt, err)
	}
	body, err := cli.NotesReadImage(ctx, notesTestID, path)
	if err != nil || !bytes.Equal(body, image) {
		t.Fatalf("Owner Note image bytes not verified: %d %v", len(body), err)
	}
	wrongReadHash.Store(true)
	if _, err := cli.NotesReadImage(ctx, notesTestID, path); err == nil {
		t.Fatal("tampered image ETag was accepted")
	}
	wrongReceipt.Store(true)
	if _, err := cli.NotesUploadMineImage(ctx, notesTestID, image); err == nil {
		t.Fatal("foreign-Note image receipt was accepted")
	}
	if _, err := cli.NotesReadImage(ctx, notesTestID, "https://attacker.example/file"); err == nil {
		t.Fatal("arbitrary external image URL was followed")
	}
	if _, err := cli.NotesUploadMineImage(ctx, notesTestID,
		bytes.Repeat([]byte{1}, NotesMaxImageBytes+1)); err == nil {
		t.Fatal("over-limit image was uploaded")
	}
	if requests.Load() != 4 || uploads.Load() != 2 || downloads.Load() != 2 {
		t.Fatalf("invalid input reached the Server: requests=%d uploads=%d downloads=%d",
			requests.Load(), uploads.Load(), downloads.Load())
	}
}


func TestNotesIOSImageImportUsesDedicatedReadOnlyArchiveRoute(t *testing.T) {
	image := []byte("GIF89a\\x01\\x00\\x01\\x00\\x80\\x00\\x00\\x00\\x00\\x00\\xff\\xff\\xff\\x21\\xf9\\x04\\x01\\x00\\x00\\x00\\x00\\x2c\\x00\\x00\\x00\\x00\\x01\\x00\\x01\\x00\\x00\\x02\\x02\\x44\\x01\\x00\\x3b")
	sum := sha256.Sum256(image)
	sha := hex.EncodeToString(sum[:])
	path := "_assets/" + notesTestID + "/" + testNotesImageName
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Method != http.MethodPost ||
			r.URL.Path != "/api/v1/notes/ios/images/import/"+notesTestID ||
			r.Header.Get("Authorization") != "Bearer owner-bearer" ||
			r.Header.Get("Cookie") != "" {
			t.Errorf("unexpected iOS archive image route/auth: %s %s", r.Method, r.URL)
		}
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data;") {
			t.Errorf("iOS archive image import is not multipart")
		}
		file, _, err := r.FormFile("image")
		if err != nil {
			t.Errorf("iOS archive image part missing: %v", err)
		} else {
			data, readErr := io.ReadAll(io.LimitReader(file, NotesMaxImageBytes+1))
			_ = file.Close()
			if readErr != nil || !bytes.Equal(data, image) {
				t.Errorf("iOS archive image bytes changed: %v", readErr)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(NotesImageReceipt{
			NodeID: 94, Filename: testNotesImageName, RelativePath: path,
			ContentType: "image/gif", Bytes: int64(len(image)), SHA256: sha,
		})
	}))
	defer srv.Close()
	cli := New(srv.URL, "owner-bearer")
	receipt, err := cli.NotesImportIOSImage(context.Background(), notesTestID, image)
	if err != nil || receipt.NodeID != 94 || receipt.RelativePath != path ||
		receipt.SHA256 != sha {
		t.Fatalf("iOS archive image import failed: %+v %v", receipt, err)
	}
	if requests.Load() != 1 {
		t.Fatalf("manual image import was unexpectedly retried: %d", requests.Load())
	}
}
