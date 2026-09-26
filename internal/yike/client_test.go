package yike

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestClientRejectsInvalidCookie(t *testing.T) {
	if _, err := NewWithBaseURL("https://photo.example", "", nil); err == nil {
		t.Fatal("empty cookie was accepted")
	}
	if _, err := NewWithBaseURL("https://photo.example", "a=b\nc=d", nil); err == nil {
		t.Fatal("newline cookie was accepted")
	}
}

func TestUserInfoAndRootFilePagination(t *testing.T) {
	var mu sync.Mutex
	var cursors []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Cookie") != "BDUSS=test-cookie" {
			t.Fatalf("Cookie=%q", r.Header.Get("Cookie"))
		}
		switch r.URL.Path {
		case "/youai/user/v1/getuinfo":
			_, _ = w.Write([]byte(`{"errno":0,"youa_id":"12345"}`))
		case "/youai/file/v1/list":
			cursor := r.URL.Query().Get("cursor")
			mu.Lock()
			cursors = append(cursors, cursor)
			mu.Unlock()
			if r.URL.Query().Get("need_filter_hidden") != "0" {
				t.Fatalf("need_filter_hidden=%q", r.URL.Query().Get("need_filter_hidden"))
			}
			if cursor == "" {
				_, _ = w.Write([]byte(`{"errno":0,"has_more":1,"cursor":"next-1","list":[{"fsid":11,"path":"/a.jpg","size":10,"mtime":100}]}`))
				return
			}
			if cursor != "next-1" {
				t.Fatalf("unexpected cursor %q", cursor)
			}
			_, _ = w.Write([]byte(`{"errno":0,"has_more":0,"cursor":"","list":[{"fsid":12,"path":"/b.mov","size":20,"mtime":200}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, err := NewWithBaseURL(server.URL+"/youai", "BDUSS=test-cookie", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	info, err := client.UserInfo(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if info.YouaID != "12345" {
		t.Fatalf("youa_id=%q", info.YouaID)
	}
	files, err := client.ListAllFiles(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 2 || files[0].FSID != 11 || files[1].FSID != 12 {
		t.Fatalf("files=%+v", files)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(cursors) != 2 || cursors[0] != "" || cursors[1] != "next-1" {
		t.Fatalf("cursors=%v", cursors)
	}
}

func TestAlbumAndAlbumFilePagination(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/youai/album/v1/list":
			_, _ = w.Write([]byte(`{"errno":0,"has_more":0,"cursor":"","total_count":1,"list":[{"album_id":"album-1","tid":7,"title":"Trip"}]}`))
		case "/youai/album/v1/listfile":
			if r.URL.Query().Get("album_id") != "album-1" || r.URL.Query().Get("limit") != "1000" {
				t.Fatalf("query=%v", r.URL.Query())
			}
			_, _ = w.Write([]byte(`{"errno":0,"has_more":0,"cursor":"","total_count":2,"list":[
				{"fsid":21,"path":"/a.jpg","size":10,"mtime":100,"album_id":"album-1","tid":7,"uk":123},
				{"fsid":22,"path":"/shared.jpg","size":20,"mtime":200,"album_id":"album-1","tid":7,"uk":999}
			]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, err := NewWithBaseURL(server.URL+"/youai", "cookie=1", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	albums, err := client.ListAllAlbums(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(albums) != 1 || albums[0].AlbumID != "album-1" || albums[0].Title != "Trip" {
		t.Fatalf("albums=%+v", albums)
	}
	files, err := client.ListAllAlbumFiles(context.Background(), "album-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 2 || files[0].OwnerUK(123) != 123 || files[1].OwnerUK(123) != 999 {
		t.Fatalf("album files=%+v", files)
	}
}

func TestDownloadLinksAreReadOnly(t *testing.T) {
	var mu sync.Mutex
	var methodsAndPaths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		methodsAndPaths = append(methodsAndPaths, r.Method+" "+r.URL.Path)
		mu.Unlock()
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/youai/file/v2/download":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"errno": 0,
				"dlink": serverURL(r) + "/download/root",
			})
		case r.Method == http.MethodHead && r.URL.Path == "/youai/album/v1/download":
			if r.URL.Query().Get("fsid") != "22" || r.URL.Query().Get("album_id") != "album-1" ||
				r.URL.Query().Get("tid") != "7" || r.URL.Query().Get("uk") != "999" {
				t.Fatalf("shared query=%v", r.URL.Query())
			}
			w.Header().Set("Location", serverURL(r)+"/download/shared")
			w.WriteHeader(http.StatusFound)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, err := NewWithBaseURL(server.URL+"/youai", "cookie=1", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	rootLink, err := client.DownloadFileLink(context.Background(), 11)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(rootLink.URL, "/download/root") {
		t.Fatalf("root URL=%q", rootLink.URL)
	}
	ownAlbumLink, err := client.DownloadAlbumFileLink(context.Background(), 123, AlbumFile{
		File: File{FSID: 21}, AlbumID: "album-1", TID: 7, UK: 123,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(ownAlbumLink.URL, "/download/root") {
		t.Fatalf("own album URL=%q", ownAlbumLink.URL)
	}
	sharedLink, err := client.DownloadAlbumFileLink(context.Background(), 123, AlbumFile{
		File: File{FSID: 22}, AlbumID: "album-1", TID: 7, UK: 999,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(sharedLink.URL, "/download/shared") {
		t.Fatalf("shared URL=%q", sharedLink.URL)
	}

	mu.Lock()
	defer mu.Unlock()
	for _, request := range methodsAndPaths {
		if strings.HasPrefix(request, "POST ") || strings.Contains(request, "copyfile") ||
			strings.Contains(request, "addfile") || strings.Contains(request, "delete") {
			t.Fatalf("read-only client mutated Yike source: %s", request)
		}
	}
}

func TestSharedAlbumDownloadDoesNotCopyOnFailure(t *testing.T) {
	var requests []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.Method+" "+r.URL.Path)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client, err := NewWithBaseURL(server.URL+"/youai", "cookie=1", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.DownloadAlbumFileLink(context.Background(), 123, AlbumFile{
		File: File{FSID: 22}, AlbumID: "album-1", TID: 7, UK: 999,
	})
	if err == nil {
		t.Fatal("shared album direct-link failure was accepted")
	}
	if len(requests) != 1 || requests[0] != "HEAD /youai/album/v1/download" {
		t.Fatalf("unexpected fallback requests=%v", requests)
	}
}

func TestPaginationRejectsRepeatedCursor(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"errno":0,"has_more":1,"cursor":"same","list":[]}`))
	}))
	defer server.Close()
	client, err := NewWithBaseURL(server.URL+"/youai", "cookie=1", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.ListAllFiles(context.Background()); err == nil {
		t.Fatal("repeated pagination cursor was accepted")
	}
}

func TestExternalIDDeduplicatesAlbumMembership(t *testing.T) {
	first, err := ExternalID(999, 22)
	if err != nil {
		t.Fatal(err)
	}
	second, err := ExternalID(999, 22)
	if err != nil {
		t.Fatal(err)
	}
	if first != second || first != "yike:999:22" {
		t.Fatalf("external ids %q %q", first, second)
	}
	if _, err := ExternalID(0, 22); err == nil {
		t.Fatal("zero owner UK was accepted")
	}
}

func TestAPIErrnoIsReturned(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"errno":50820}`))
	}))
	defer server.Close()
	client, err := NewWithBaseURL(server.URL+"/youai", "cookie=1", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.ListAlbumsPage(context.Background(), ""); err == nil ||
		!strings.Contains(err.Error(), "50820") {
		t.Fatalf("unexpected errno error: %v", err)
	}
}

func serverURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}
