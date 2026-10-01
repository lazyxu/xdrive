package synology

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestSessionListsSpacesAndOpensRangeDownload(t *testing.T) {
	var loginSeen, logoutSeen bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Query().Get("api") == "SYNO.API.Info":
			_, _ = w.Write([]byte(`{"success":true,"data":{
				"SYNO.API.Auth":{"path":"entry.cgi","minVersion":1,"maxVersion":7},
				"SYNO.Foto.Browse.Folder":{"path":"entry.cgi","minVersion":1,"maxVersion":1},
				"SYNO.Foto.Browse.Item":{"path":"entry.cgi","minVersion":1,"maxVersion":1},
				"SYNO.Foto.Browse.Album":{"path":"entry.cgi","minVersion":1,"maxVersion":4},
				"SYNO.Foto.Download":{"path":"entry.cgi","minVersion":1,"maxVersion":2},
				"SYNO.FotoTeam.Browse.Folder":{"path":"entry.cgi","minVersion":1,"maxVersion":1},
				"SYNO.FotoTeam.Browse.Item":{"path":"entry.cgi","minVersion":1,"maxVersion":1},
				"SYNO.FotoTeam.Browse.Album":{"path":"entry.cgi","minVersion":1,"maxVersion":2},
				"SYNO.FotoTeam.Download":{"path":"entry.cgi","minVersion":1,"maxVersion":2}
			}}`))
		case r.URL.Path == "/webapi/entry.cgi":
			data, _ := io.ReadAll(r.Body)
			values, _ := url.ParseQuery(string(data))
			if values.Get("method") == "login" {
				loginSeen = true
				_, _ = w.Write([]byte(`{"success":true,"data":{"sid":"sid-1","synotoken":"token-1"}}`))
				return
			}
			if values.Get("method") == "logout" {
				logoutSeen = true
				_, _ = w.Write([]byte(`{"success":true,"data":{}}`))
				return
			}
			http.NotFound(w, r)
		case r.URL.Path == "/photo/webapi/entry.cgi" && r.Method == http.MethodPost:
			data, _ := io.ReadAll(r.Body)
			values, _ := url.ParseQuery(string(data))
			if values.Get("_sid") != "sid-1" || values.Get("SynoToken") != "token-1" {
				t.Fatalf("missing session values: %v", values)
			}
			switch values.Get("api") {
			case "SYNO.Foto.Browse.Folder":
				_, _ = w.Write([]byte(`{"success":true,"data":{"offset":0,"total":1,"list":[{"id":10,"name":"2026","parent":0,"owner_user_id":7}]}}`))
			case "SYNO.Foto.Browse.Album":
				if values.Get("offset") != "0" || values.Get("limit") != "100" {
					t.Fatalf("album pagination=%v", values)
				}
				_, _ = w.Write([]byte(`{"success":true,"data":{"offset":0,"total":1,"list":[{"id":101,"name":"Trips","type":"normal","item_count":1,"create_time":1600000000,"shared":false}]}}`))
			case "SYNO.Foto.Browse.Item":
				if values.Get("id") != "101" || values.Get("additional") != `["thumbnail"]` {
					t.Fatalf("album item query=%v", values)
				}
				_, _ = w.Write([]byte(`{"success":true,"data":{"offset":0,"total":1,"list":[{"id":98,"filename":"trip.jpg","filesize":5,"folder_id":10,"indexed_time":1233,"owner_user_id":7,"time":999,"type":"photo","additional":{"thumbnail":{"cache_key":"98_1233","unit_id":98}}}]}}`))
			case "SYNO.FotoTeam.Browse.Item":
				if values.Get("additional") != `["thumbnail"]` {
					t.Fatalf("additional=%q", values.Get("additional"))
				}
				_, _ = w.Write([]byte(`{"success":true,"data":{"offset":0,"total":1,"list":[{"id":99,"filename":"a.jpg","filesize":6,"folder_id":10,"indexed_time":1234,"owner_user_id":7,"time":1000,"type":"photo","additional":{"thumbnail":{"cache_key":"99_1234","unit_id":99}}}]}}`))
			default:
				http.NotFound(w, r)
			}
		case r.URL.Path == "/photo/webapi/entry.cgi" && r.Method == http.MethodGet:
			if r.URL.Query().Get("api") != "SYNO.FotoTeam.Download" ||
				r.URL.Query().Get("_sid") != "sid-1" ||
				r.URL.Query().Get("SynoToken") != "token-1" ||
				r.URL.Query().Get("unit_id") != "[99]" {
				t.Fatalf("download query=%v", r.URL.Query())
			}
			if got := r.Header.Get("Range"); got != "bytes=2-" {
				t.Fatalf("Range=%q", got)
			}
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Content-Range", "bytes 2-5/6")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write([]byte("cdef"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, err := New(Credential{BaseURL: server.URL, Username: "alice", Password: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := client.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !session.Available(SpacePersonal) || !session.Available(SpaceShared) || !loginSeen {
		t.Fatalf("availability personal=%t shared=%t login=%t", session.Available(SpacePersonal), session.Available(SpaceShared), loginSeen)
	}
	folders, err := session.ListFoldersPage(context.Background(), SpacePersonal, 0, 500)
	if err != nil || folders.Total != 1 || len(folders.List) != 1 || folders.List[0].Name != "2026" {
		t.Fatalf("folders=%+v err=%v", folders, err)
	}
	items, err := session.ListItemsPage(context.Background(), SpaceShared, 0, 500)
	if err != nil || items.Total != 1 || len(items.List) != 1 || items.List[0].Space != SpaceShared {
		t.Fatalf("items=%+v err=%v", items, err)
	}
	if !session.AlbumsAvailable(SpacePersonal) || !session.AlbumsAvailable(SpaceShared) {
		t.Fatalf("album availability personal=%t shared=%t", session.AlbumsAvailable(SpacePersonal), session.AlbumsAvailable(SpaceShared))
	}
	albums, err := session.ListAlbumsPage(context.Background(), SpacePersonal, 0, 100)
	if err != nil || albums.Total != 1 || len(albums.List) != 1 ||
		albums.List[0].ID != 101 || albums.List[0].Name != "Trips" || albums.List[0].Space != SpacePersonal {
		t.Fatalf("albums=%+v err=%v", albums, err)
	}
	albumItems, err := session.ListAlbumItemsPage(context.Background(), SpacePersonal, 101, 0, 100)
	if err != nil || albumItems.Total != 1 || len(albumItems.List) != 1 ||
		albumItems.List[0].ID != 98 || albumItems.List[0].Space != SpacePersonal {
		t.Fatalf("album items=%+v err=%v", albumItems, err)
	}
	body, err := session.OpenItem(context.Background(), items.List[0], 2)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(body)
	_ = body.Close()
	if err != nil || string(data) != "cdef" {
		t.Fatalf("download=%q err=%v", data, err)
	}
	if err := session.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !logoutSeen {
		t.Fatal("logout was not sent")
	}
}

func TestSessionOpenItemRejectsWrongPartialRange(t *testing.T) {
	server := newMediaTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Range", "bytes 0-5/6")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("abcdef"))
	})
	defer server.Close()

	client, err := New(Credential{BaseURL: server.URL, Username: "alice", Password: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := client.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close(context.Background())

	if _, err := session.OpenItem(context.Background(), Item{ID: 5, Space: SpacePersonal}, 2); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("wrong Content-Range err=%v want ErrUnavailable", err)
	}
}

func TestSessionOpenItemReturnsRateLimitedAfter429Retries(t *testing.T) {
	server := newMediaTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	})
	defer server.Close()

	client, err := New(Credential{BaseURL: server.URL, Username: "alice", Password: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	client.apiMaxAttempts = 1
	session, err := client.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close(context.Background())

	_, err = session.OpenItem(context.Background(), Item{ID: 5, Space: SpacePersonal}, 0)
	if !errors.Is(err, ErrRateLimited) {
		t.Fatalf("err=%v want ErrRateLimited", err)
	}
}

func TestSessionOpenItemSkipsOffsetWhenRangeIgnored(t *testing.T) {
	server := newMediaTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write([]byte("abcdef"))
	})
	defer server.Close()

	client, err := New(Credential{BaseURL: server.URL, Username: "alice", Password: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := client.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close(context.Background())

	body, err := session.OpenItem(context.Background(), Item{ID: 5, Space: SpacePersonal}, 2)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(body)
	_ = body.Close()
	if err != nil || string(data) != "cdef" {
		t.Fatalf("download=%q err=%v", data, err)
	}
}

func newMediaTestServer(t *testing.T, download func(http.ResponseWriter, *http.Request)) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Query().Get("api") == "SYNO.API.Info":
			_, _ = w.Write([]byte(`{"success":true,"data":{
				"SYNO.API.Auth":{"path":"entry.cgi","minVersion":1,"maxVersion":6},
				"SYNO.Foto.Browse.Folder":{"path":"entry.cgi","minVersion":1,"maxVersion":1},
				"SYNO.Foto.Browse.Item":{"path":"entry.cgi","minVersion":1,"maxVersion":1},
				"SYNO.Foto.Download":{"path":"entry.cgi","minVersion":1,"maxVersion":1}
			}}`))
		case r.URL.Path == "/webapi/entry.cgi":
			data, _ := io.ReadAll(r.Body)
			values, _ := url.ParseQuery(string(data))
			if values.Get("method") == "login" {
				_, _ = w.Write([]byte(`{"success":true,"data":{"sid":"sid-1"}}`))
				return
			}
			if values.Get("method") == "logout" {
				_, _ = w.Write([]byte(`{"success":true,"data":{}}`))
				return
			}
			http.NotFound(w, r)
		case r.URL.Path == "/photo/webapi/entry.cgi" && r.Method == http.MethodGet:
			download(w, r)
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestSpaceAPIHelpersRejectUnknownSpace(t *testing.T) {
	for _, fn := range []func(Space) (string, error){folderAPI, itemAPI, albumAPI, downloadAPI} {
		if _, err := fn(Space("other")); err == nil || !strings.Contains(err.Error(), "unsupported") {
			t.Fatalf("unexpected err=%v", err)
		}
	}
}

func TestSessionReportsAlbumCapabilityIndependently(t *testing.T) {
	server := newMediaTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})
	defer server.Close()

	client, err := New(Credential{BaseURL: server.URL, Username: "alice", Password: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := client.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close(context.Background())

	if session.AlbumsAvailable(SpacePersonal) {
		t.Fatal("album API unexpectedly available")
	}
	if _, err := session.ListAlbumsPage(context.Background(), SpacePersonal, 0, 100); err == nil || !strings.Contains(err.Error(), "album API is unavailable") {
		t.Fatalf("album list err=%v", err)
	}
}

func TestSessionReauthenticatesAfterSessionTimeout(t *testing.T) {
	var loginCount, listCount int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Query().Get("api") == "SYNO.API.Info":
			_, _ = w.Write([]byte(`{"success":true,"data":{
				"SYNO.API.Auth":{"path":"entry.cgi","minVersion":1,"maxVersion":6},
				"SYNO.Foto.Browse.Folder":{"path":"entry.cgi","minVersion":1,"maxVersion":1},
				"SYNO.Foto.Browse.Item":{"path":"entry.cgi","minVersion":1,"maxVersion":1},
				"SYNO.Foto.Download":{"path":"entry.cgi","minVersion":1,"maxVersion":1}
			}}`))
		case r.URL.Path == "/webapi/entry.cgi":
			data, _ := io.ReadAll(r.Body)
			values, _ := url.ParseQuery(string(data))
			if values.Get("method") == "login" {
				loginCount++
				_, _ = w.Write([]byte(fmt.Sprintf(`{"success":true,"data":{"sid":"sid-%d"}}`, loginCount)))
				return
			}
			if values.Get("method") == "logout" {
				_, _ = w.Write([]byte(`{"success":true,"data":{}}`))
				return
			}
			http.NotFound(w, r)
		case r.URL.Path == "/photo/webapi/entry.cgi":
			data, _ := io.ReadAll(r.Body)
			values, _ := url.ParseQuery(string(data))
			listCount++
			if listCount == 1 {
				if values.Get("_sid") != "sid-1" {
					t.Fatalf("first sid=%q", values.Get("_sid"))
				}
				_, _ = w.Write([]byte(`{"success":false,"error":{"code":106}}`))
				return
			}
			if values.Get("_sid") != "sid-2" {
				t.Fatalf("second sid=%q", values.Get("_sid"))
			}
			_, _ = w.Write([]byte(`{"success":true,"data":{"offset":0,"total":0,"list":[]}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, err := New(Credential{BaseURL: server.URL, Username: "alice", Password: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := client.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close(context.Background())

	if _, err := session.ListFoldersPage(context.Background(), SpacePersonal, 0, 100); err != nil {
		t.Fatal(err)
	}
	if loginCount != 2 || listCount != 2 {
		t.Fatalf("loginCount=%d listCount=%d", loginCount, listCount)
	}
}

func TestSessionMediaIdleTimeout(t *testing.T) {
	block := make(chan struct{})
	server := newMediaTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		if flusher, ok := w.(http.Flusher); ok {
			w.WriteHeader(http.StatusOK)
			flusher.Flush()
		}
		<-block
	})
	defer func() {
		close(block)
		server.Close()
	}()

	client, err := New(Credential{BaseURL: server.URL, Username: "alice", Password: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	client.downloadIdleTimeout = 50 * time.Millisecond
	client.downloadHeaderTimeout = time.Second
	session, err := client.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close(context.Background())

	body, err := session.OpenItem(context.Background(), Item{ID: 5, Space: SpacePersonal}, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer body.Close()
	buf := make([]byte, 1)
	start := time.Now()
	_, err = body.Read(buf)
	if err == nil || !strings.Contains(err.Error(), "stalled") {
		t.Fatalf("err=%v", err)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("idle timeout took %s", elapsed)
	}
}

func TestSessionRetriesTransientDownloadOpen(t *testing.T) {
	var attempts int
	server := newMediaTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write([]byte("ok"))
	})
	defer server.Close()

	client, err := New(Credential{BaseURL: server.URL, Username: "alice", Password: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	client.apiRetryBaseDelay = time.Millisecond
	client.apiRetryMaxDelay = 5 * time.Millisecond
	session, err := client.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close(context.Background())

	body, err := session.OpenItem(context.Background(), Item{ID: 5, Space: SpacePersonal}, 0)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(body)
	_ = body.Close()
	if err != nil || string(data) != "ok" {
		t.Fatalf("data=%q err=%v", data, err)
	}
	if attempts != 3 {
		t.Fatalf("attempts=%d want=3", attempts)
	}
}
