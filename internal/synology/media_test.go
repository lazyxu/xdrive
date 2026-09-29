package synology

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
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
				"SYNO.Foto.Download":{"path":"entry.cgi","minVersion":1,"maxVersion":2},
				"SYNO.FotoTeam.Browse.Folder":{"path":"entry.cgi","minVersion":1,"maxVersion":1},
				"SYNO.FotoTeam.Browse.Item":{"path":"entry.cgi","minVersion":1,"maxVersion":1},
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
	for _, fn := range []func(Space) (string, error){folderAPI, itemAPI, downloadAPI} {
		if _, err := fn(Space("other")); err == nil || !strings.Contains(err.Error(), "unsupported") {
			t.Fatalf("unexpected err=%v", err)
		}
	}
}
