package synology

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestClientTestAuthenticatesAndChecksPhotosAPI(t *testing.T) {
	var loginSeen, logoutSeen bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Query().Get("api") == "SYNO.API.Info":
			_, _ = w.Write([]byte(`{"success":true,"data":{
				"SYNO.API.Auth":{"path":"entry.cgi","minVersion":1,"maxVersion":7},
				"SYNO.Foto.Browse.Item":{"path":"entry.cgi","minVersion":1,"maxVersion":1},
				"SYNO.Foto.Download":{"path":"entry.cgi","minVersion":1,"maxVersion":2}
			}}`))
		case r.URL.Path == "/webapi/entry.cgi":
			body, _ := url.ParseQuery(readBody(t, r))
			switch body.Get("method") {
			case "login":
				loginSeen = true
				if body.Get("version") != "6" || body.Get("account") != "alice" ||
					body.Get("passwd") != "secret" || body.Get("format") != "sid" {
					t.Fatalf("unexpected login body: %v", body)
				}
				_, _ = w.Write([]byte(`{"success":true,"data":{"sid":"sid-1","synotoken":"csrf-1"}}`))
			case "logout":
				logoutSeen = true
				if body.Get("_sid") != "sid-1" {
					t.Fatalf("logout sid=%q", body.Get("_sid"))
				}
				_, _ = w.Write([]byte(`{"success":true,"data":{}}`))
			default:
				http.NotFound(w, r)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, err := New(Credential{BaseURL: server.URL, Username: "alice", Password: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	info, err := client.Test(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if info.Username != "alice" || !loginSeen || !logoutSeen {
		t.Fatalf("info=%+v login=%t logout=%t", info, loginSeen, logoutSeen)
	}
}

func TestClientTestMapsAuthenticationFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("api") == "SYNO.API.Info" {
			_, _ = w.Write([]byte(`{"success":true,"data":{
				"SYNO.API.Auth":{"path":"entry.cgi","minVersion":1,"maxVersion":6},
				"SYNO.Foto.Browse.Item":{"path":"entry.cgi","minVersion":1,"maxVersion":1},
				"SYNO.Foto.Download":{"path":"entry.cgi","minVersion":1,"maxVersion":1}
			}}`))
			return
		}
		_, _ = w.Write([]byte(`{"success":false,"error":{"code":400}}`))
	}))
	defer server.Close()

	client, err := New(Credential{BaseURL: server.URL, Username: "alice", Password: "wrong"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Test(context.Background())
	if !errors.Is(err, ErrAuthentication) {
		t.Fatalf("err=%v", err)
	}
}

func TestClientTestRequiresPhotosAPI(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"success":true,"data":{"SYNO.API.Auth":{"path":"entry.cgi","minVersion":1,"maxVersion":6}}}`))
	}))
	defer server.Close()

	client, err := New(Credential{BaseURL: server.URL, Username: "alice", Password: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Test(context.Background())
	if !errors.Is(err, ErrPhotosMissing) {
		t.Fatalf("err=%v", err)
	}
}

func TestNewRejectsNonOriginBaseURL(t *testing.T) {
	for _, raw := range []string{
		"", "nas.local", "ftp://nas.local", "https://user@nas.local", "https://nas.local/photo",
		"https://nas.local?x=1", "https://nas.local/#x",
	} {
		t.Run(strings.ReplaceAll(raw, "/", "_"), func(t *testing.T) {
			if _, err := New(Credential{BaseURL: raw, Username: "alice", Password: "secret"}); err == nil {
				t.Fatalf("accepted %q", raw)
			}
		})
	}
}

func readBody(t *testing.T, r *http.Request) string {
	t.Helper()
	data, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestClientRetriesTransientHTTPFailure(t *testing.T) {
	var attempts int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte(`{"success":true,"data":{"SYNO.API.Auth":{"path":"entry.cgi","minVersion":1,"maxVersion":6}}}`))
	}))
	defer server.Close()

	client, err := New(Credential{BaseURL: server.URL, Username: "alice", Password: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	client.apiRetryBaseDelay = time.Millisecond
	client.apiRetryMaxDelay = 5 * time.Millisecond
	if _, err := client.apiInfo(context.Background()); err != nil {
		t.Fatal(err)
	}
	if attempts != 3 {
		t.Fatalf("attempts=%d want=3", attempts)
	}
}

func TestAPIErrorClassifiesExpiredSession(t *testing.T) {
	for _, code := range []int{106, 107, 119} {
		envelope := apiEnvelope{Success: false}
		envelope.Error = &struct {
			Code int `json:"code"`
		}{Code: code}
		if err := apiError(envelope); !errors.Is(err, ErrSessionExpired) {
			t.Fatalf("code=%d err=%v", code, err)
		}
	}
}
