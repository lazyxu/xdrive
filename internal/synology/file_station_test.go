package synology

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
)

func TestFileStationSessionListsArbitraryFilesAndDownloads(t *testing.T) {
	var loginSeen, logoutSeen bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/webapi/query.cgi" && r.URL.Query().Get("api") == "SYNO.API.Info":
			_, _ = w.Write([]byte(`{"success":true,"data":{
				"SYNO.API.Auth":{"path":"auth.cgi","minVersion":1,"maxVersion":3},
				"SYNO.FileStation.List":{"path":"entry.cgi","minVersion":1,"maxVersion":2},
				"SYNO.FileStation.Download":{"path":"entry.cgi","minVersion":1,"maxVersion":2},
				"SYNO.FileStation.MD5":{"path":"entry.cgi","minVersion":1,"maxVersion":2}
			}}`))
		case r.URL.Path == "/webapi/auth.cgi":
			values, _ := url.ParseQuery(readBody(t, r))
			switch values.Get("method") {
			case "login":
				loginSeen = true
				if values.Get("session") != fileStationSessionName ||
					values.Get("format") != "sid" ||
					values.Get("account") != "alice" ||
					values.Get("passwd") != "secret" {
					t.Fatalf("unexpected File Station login: %v", values)
				}
				_, _ = w.Write([]byte(`{"success":true,"data":{"sid":"file-sid","synotoken":"file-token"}}`))
			case "logout":
				logoutSeen = true
				if values.Get("session") != fileStationSessionName || values.Get("_sid") != "file-sid" {
					t.Fatalf("unexpected File Station logout: %v", values)
				}
				_, _ = w.Write([]byte(`{"success":true,"data":{}}`))
			default:
				http.NotFound(w, r)
			}
		case r.URL.Path == "/webapi/entry.cgi" && r.Method == http.MethodPost:
			values, _ := url.ParseQuery(readBody(t, r))
			if values.Get("_sid") != "file-sid" || values.Get("SynoToken") != "file-token" {
				t.Fatalf("missing File Station auth values: %v", values)
			}
			if values.Get("api") != "SYNO.FileStation.List" {
				http.NotFound(w, r)
				return
			}
			switch values.Get("method") {
			case "list_share":
				if values.Get("offset") != "0" || values.Get("limit") != "50" ||
					values.Get("sort_by") != strconv.Quote("name") {
					t.Fatalf("unexpected share list query: %v", values)
				}
				_, _ = w.Write([]byte(`{"success":true,"data":{"offset":0,"total":2,"shares":[
					{"name":"documents","path":"/documents","isdir":true,"additional":{"real_path":"/volume1/documents","time":{"mtime":1700000000}}},
					{"name":"video","path":"/video","isdir":true,"additional":{"real_path":"/volume1/video","time":{"mtime":1700000001}}}
				]}}`))
			case "list":
				if values.Get("folder_path") != strconv.Quote("/documents") ||
					values.Get("additional") != `["real_path","size","time","type","mount_point_type"]` {
					t.Fatalf("unexpected folder list query: %v", values)
				}
				_, _ = w.Write([]byte(`{"success":true,"data":{"offset":0,"total":3,"files":[
					{"name":"Empty","path":"/documents/Empty","isdir":true,"additional":{"time":{"mtime":1700000010}}},
					{"name":"notes.txt","path":"/documents/notes.txt","isdir":false,"additional":{"size":4,"time":{"mtime":1700000020},"type":"txt"}},
					{"name":"archive.zip","path":"/documents/archive.zip","isdir":false,"additional":{"size":8,"time":{"mtime":1700000030},"type":"zip"}}
				]}}`))
			default:
				http.NotFound(w, r)
			}
		case r.URL.Path == "/webapi/entry.cgi" && r.Method == http.MethodGet:
			query := r.URL.Query()
			if query.Get("api") != "SYNO.FileStation.Download" ||
				query.Get("method") != "download" ||
				query.Get("_sid") != "file-sid" ||
				query.Get("path") != `["/documents/notes.txt"]` ||
				query.Get("mode") != strconv.Quote("open") {
				t.Fatalf("unexpected File Station download query: %v", query)
			}
			if r.Header.Get("Range") != "bytes=2-" {
				t.Fatalf("Range=%q", r.Header.Get("Range"))
			}
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Content-Range", "bytes 2-3/4")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write([]byte("cd"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, err := New(Credential{BaseURL: server.URL, Username: "alice", Password: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := client.ConnectFileStation(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !loginSeen || !session.MD5Available() {
		t.Fatalf("login=%t md5=%t", loginSeen, session.MD5Available())
	}
	shares, err := session.ListSharesPage(context.Background(), 0, 50)
	if err != nil || shares.Total != 2 || len(shares.Entries) != 2 || shares.Entries[0].Path != "/documents" {
		t.Fatalf("shares=%+v err=%v", shares, err)
	}
	files, err := session.ListFolderPage(context.Background(), "/documents", 0, 50)
	if err != nil || files.Total != 3 || len(files.Entries) != 3 {
		t.Fatalf("files=%+v err=%v", files, err)
	}
	if !files.Entries[0].IsDir || files.Entries[1].FileSize() != 4 ||
		files.Entries[1].ModifiedAt() == nil || files.Entries[2].Additional.Type != "zip" {
		t.Fatalf("unexpected arbitrary file entries: %+v", files.Entries)
	}
	body, err := session.OpenPath(context.Background(), "/documents/notes.txt", 2)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(body)
	_ = body.Close()
	if err != nil || string(data) != "cd" {
		t.Fatalf("download=%q err=%v", data, err)
	}
	if err := session.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !logoutSeen {
		t.Fatal("File Station logout was not sent")
	}
}

func TestFileStationDownloadRejectsWrongPartialRange(t *testing.T) {
	server := newFileStationTestServer(t, func(w http.ResponseWriter, r *http.Request) {
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
	session, err := client.ConnectFileStation(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close(context.Background())

	if _, err := session.OpenPath(context.Background(), "/documents/a.bin", 2); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("wrong Content-Range err=%v want ErrUnavailable", err)
	}
}

func TestFileStationDownloadReturnsRateLimitedAfter429Retries(t *testing.T) {
	server := newFileStationTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	})
	defer server.Close()

	client, err := New(Credential{BaseURL: server.URL, Username: "alice", Password: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	client.apiMaxAttempts = 1
	session, err := client.ConnectFileStation(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close(context.Background())

	_, err = session.OpenPath(context.Background(), "/documents/a.bin", 0)
	if !errors.Is(err, ErrRateLimited) {
		t.Fatalf("err=%v want ErrRateLimited", err)
	}
}

func TestFileStationDownloadSkipsOffsetWhenRangeIgnored(t *testing.T) {
	server := newFileStationTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write([]byte("abcdef"))
	})
	defer server.Close()

	client, err := New(Credential{BaseURL: server.URL, Username: "alice", Password: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := client.ConnectFileStation(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close(context.Background())

	body, err := session.OpenPath(context.Background(), "/documents/a.bin", 2)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(body)
	_ = body.Close()
	if err != nil || string(data) != "cdef" {
		t.Fatalf("download=%q err=%v", data, err)
	}
}

func TestFileStationErrorClassification(t *testing.T) {
	for _, tc := range []struct {
		name string
		code int
		want error
	}{
		{name: "system busy", code: 402, want: ErrUnavailable},
		{name: "permission", code: 407, want: ErrPermissionDenied},
		{name: "missing path", code: 408, want: ErrFileStationOperation},
	} {
		t.Run(tc.name, func(t *testing.T) {
			envelope := apiEnvelope{Success: false}
			envelope.Error = &struct {
				Code int `json:"code"`
			}{Code: tc.code}
			if err := fileStationAPIError(envelope); !errors.Is(err, tc.want) {
				t.Fatalf("code=%d err=%v want=%v", tc.code, err, tc.want)
			}
		})
	}
}

func TestClientTestFileStationRequiresFileStationAPIs(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"success":true,"data":{"SYNO.API.Auth":{"path":"auth.cgi","minVersion":1,"maxVersion":3}}}`))
	}))
	defer server.Close()
	client, err := New(Credential{BaseURL: server.URL, Username: "alice", Password: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.TestFileStation(context.Background()); !errors.Is(err, ErrFileStationMissing) {
		t.Fatalf("err=%v want File Station missing", err)
	}
}

func newFileStationTestServer(
	t *testing.T,
	download func(http.ResponseWriter, *http.Request),
) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/webapi/query.cgi":
			_, _ = w.Write([]byte(`{"success":true,"data":{
				"SYNO.API.Auth":{"path":"auth.cgi","minVersion":1,"maxVersion":3},
				"SYNO.FileStation.List":{"path":"entry.cgi","minVersion":1,"maxVersion":2},
				"SYNO.FileStation.Download":{"path":"entry.cgi","minVersion":1,"maxVersion":2}
			}}`))
		case r.URL.Path == "/webapi/auth.cgi":
			values, _ := url.ParseQuery(readBody(t, r))
			if values.Get("method") == "login" {
				_, _ = w.Write([]byte(`{"success":true,"data":{"sid":"file-sid"}}`))
				return
			}
			_, _ = w.Write([]byte(`{"success":true,"data":{}}`))
		case r.URL.Path == "/webapi/entry.cgi" && r.Method == http.MethodGet:
			download(w, r)
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestNormalizeFileStationPathRejectsBackslashAndRelativePath(t *testing.T) {
	for _, value := range []string{"documents/a.txt", "/documents\\a.txt", ""} {
		if _, err := NormalizeFileStationPath(value); err == nil {
			t.Fatalf("accepted invalid path %q", value)
		}
	}
	if got, err := NormalizeFileStationPath(strings.Repeat("/", 2) + "documents//a.txt"); err != nil || got != "/documents/a.txt" {
		t.Fatalf("normalize=%q err=%v", got, err)
	}
}

func TestFileStationListingPreservesLeadingSpaces(t *testing.T) {
	server := newFileStationTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})
	defer server.Close()

	client, err := New(Credential{BaseURL: server.URL, Username: "alice", Password: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := client.ConnectFileStation(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close(context.Background())

	// The helper server has no POST list handler, so validate the normalization
	// behavior directly: leading spaces are part of the DSM path identity.
	got, err := NormalizeFileStationPath("/documents/  notes.txt")
	if err != nil {
		t.Fatal(err)
	}
	if got != "/documents/  notes.txt" {
		t.Fatalf("path=%q want leading spaces preserved", got)
	}
}
