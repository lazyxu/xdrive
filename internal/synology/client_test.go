package synology

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestClientTestAuthenticatesAndChecksPhotosAPI(t *testing.T) {
	var loginSeen, logoutSeen, photosSeen bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Query().Get("api") == "SYNO.API.Info":
			_, _ = w.Write([]byte(`{"success":true,"data":{
				"SYNO.API.Auth":{"path":"auth.cgi","minVersion":1,"maxVersion":7},
				"SYNO.Foto.Browse.Folder":{"path":"entry.cgi","minVersion":1,"maxVersion":1},
				"SYNO.Foto.Browse.Item":{"path":"entry.cgi","minVersion":1,"maxVersion":1},
				"SYNO.Foto.Browse.Album":{"path":"entry.cgi","minVersion":1,"maxVersion":1},
				"SYNO.Foto.Download":{"path":"entry.cgi","minVersion":1,"maxVersion":2}
			}}`))
		case r.URL.Path == "/webapi/auth.cgi":
			body, _ := url.ParseQuery(readBody(t, r))
			switch body.Get("method") {
			case "login":
				loginSeen = true
				if body.Get("version") != "6" || body.Get("account") != "alice" ||
					body.Get("passwd") != "secret" || body.Get("format") != "sid" ||
					body.Get("session") != "SynologyPhotos" || body.Get("enable_syno_token") != "yes" {
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
		case r.URL.Path == "/photo/webapi/entry.cgi":
			body, _ := url.ParseQuery(readBody(t, r))
			photosSeen = true
			if body.Get("api") != "SYNO.Foto.Browse.Item" ||
				body.Get("method") != "list" ||
				body.Get("_sid") != "sid-1" ||
				body.Get("limit") != "1" {
				t.Fatalf("unexpected Photos probe body: %v", body)
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
	info, err := client.Test(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if info.Username != "alice" || !loginSeen || !photosSeen || !logoutSeen {
		t.Fatalf("info=%+v login=%t photos=%t logout=%t", info, loginSeen, photosSeen, logoutSeen)
	}
}

func TestClientTestMapsAuthenticationFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("api") == "SYNO.API.Info" {
			_, _ = w.Write([]byte(`{"success":true,"data":{
				"SYNO.API.Auth":{"path":"auth.cgi","minVersion":1,"maxVersion":6},
				"SYNO.Foto.Browse.Folder":{"path":"entry.cgi","minVersion":1,"maxVersion":1},
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

func TestClientTestRejectsPhotosAPISessionFailures(t *testing.T) {
	tests := []struct {
		name string
		code int
		want error
	}{
		{name: "duplicate login", code: 107, want: ErrMultipleLogin},
		{name: "permission denied", code: 105, want: ErrPermissionDenied},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch {
				case r.URL.Query().Get("api") == "SYNO.API.Info":
					_, _ = w.Write([]byte(`{"success":true,"data":{
						"SYNO.API.Auth":{"path":"auth.cgi","minVersion":1,"maxVersion":3},
						"SYNO.Foto.Browse.Folder":{"path":"entry.cgi","minVersion":1,"maxVersion":1},
						"SYNO.Foto.Browse.Item":{"path":"entry.cgi","minVersion":1,"maxVersion":1},
						"SYNO.Foto.Download":{"path":"entry.cgi","minVersion":1,"maxVersion":1}
					}}`))
				case r.URL.Path == "/webapi/auth.cgi":
					body, _ := url.ParseQuery(readBody(t, r))
					if body.Get("method") == "logout" {
						_, _ = w.Write([]byte(`{"success":true,"data":{}}`))
						return
					}
					_, _ = w.Write([]byte(`{"success":true,"data":{"sid":"sid-1"}}`))
				case r.URL.Path == "/photo/webapi/entry.cgi":
					_, _ = w.Write([]byte(fmt.Sprintf(
						`{"success":false,"error":{"code":%d}}`,
						tc.code,
					)))
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()

			client, err := New(Credential{
				BaseURL:  server.URL,
				Username: "alice",
				Password: "secret",
			})
			if err != nil {
				t.Fatal(err)
			}
			_, err = client.Test(context.Background())
			if !errors.Is(err, tc.want) {
				t.Fatalf("err=%v want=%v", err, tc.want)
			}
		})
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

func TestAPIErrorClassifiesSynologyCommonAndAuthErrors(t *testing.T) {
	tests := []struct {
		code int
		want error
	}{
		{106, ErrSessionExpired},
		{119, ErrSessionExpired},
		{107, ErrMultipleLogin},
		{105, ErrPermissionDenied},
		{400, ErrAuthentication},
		{401, ErrAuthentication},
		{402, ErrPermissionDenied},
		{403, ErrOTPRequired},
		{404, ErrOTPRequired},
		{406, ErrOTPRequired},
	}
	for _, tc := range tests {
		envelope := apiEnvelope{Success: false}
		envelope.Error = &struct {
			Code int `json:"code"`
		}{Code: tc.code}
		if err := apiError(envelope); !errors.Is(err, tc.want) {
			t.Fatalf("code=%d err=%v want=%v", tc.code, err, tc.want)
		}
	}
}

func TestDoJSONPreservesDSMAPIErrorFromHTTPForbidden(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"success":false,"error":{"code":403}}`))
	}))
	defer server.Close()

	client, err := New(Credential{BaseURL: server.URL, Username: "alice", Password: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	var envelope apiEnvelope
	err = client.doJSON(context.Background(), http.MethodPost, server.URL, strings.NewReader("x=1"), &envelope)
	if !errors.Is(err, ErrOTPRequired) {
		t.Fatalf("err=%v want ErrOTPRequired", err)
	}
	var dsmErr *DSMAPIError
	if !errors.As(err, &dsmErr) || dsmErr.Code != 403 {
		t.Fatalf("err=%v dsmErr=%+v", err, dsmErr)
	}
}

func TestDoJSONDoesNotMislabelPlainHTTPForbiddenAsBadPassword(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("forbidden"))
	}))
	defer server.Close()

	client, err := New(Credential{BaseURL: server.URL, Username: "alice", Password: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	var envelope apiEnvelope
	err = client.doJSON(context.Background(), http.MethodPost, server.URL, strings.NewReader("x=1"), &envelope)
	if !errors.Is(err, ErrHTTPForbidden) {
		t.Fatalf("err=%v want ErrHTTPForbidden", err)
	}
	if errors.Is(err, ErrAuthentication) {
		t.Fatalf("plain HTTP 403 must not be classified as bad credentials: %v", err)
	}
	diagnostic := DiagnoseConnectionError(err)
	if diagnostic.Code != "synology_http_forbidden" || !strings.Contains(diagnostic.Detail, "不等同于用户名或密码错误") {
		t.Fatalf("diagnostic=%+v", diagnostic)
	}
}

func TestDiagnoseConnectionErrorRateLimited(t *testing.T) {
	d := DiagnoseConnectionError(ErrRateLimited)
	if d.Code != "synology_rate_limited" {
		t.Fatalf("diagnostic=%+v", d)
	}
}

func TestDiagnoseConnectionErrorClassifiesSelfSignedTLS(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"success":true,"data":{}}`))
	}))
	defer server.Close()

	client, err := New(Credential{
		BaseURL:  server.URL,
		Username: "alice",
		Password: "secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	client.apiRetryBaseDelay = time.Millisecond
	client.apiRetryMaxDelay = 2 * time.Millisecond

	_, err = client.apiInfo(context.Background())
	if err == nil {
		t.Fatal("expected TLS validation error")
	}
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("err=%v want ErrUnavailable", err)
	}
	diagnostic := DiagnoseConnectionError(err)
	if diagnostic.Code != "synology_tls_unknown_authority" {
		t.Fatalf("diagnostic=%+v err=%v", diagnostic, err)
	}
	if !strings.Contains(diagnostic.Detail, "证书") {
		t.Fatalf("detail=%q", diagnostic.Detail)
	}
}

func TestDiagnoseConnectionErrorClassifiesHostnameMismatch(t *testing.T) {
	err := fmt.Errorf(
		"%w: %w",
		ErrUnavailable,
		x509.HostnameError{Certificate: &x509.Certificate{}, Host: "192.168.2.10"},
	)
	diagnostic := DiagnoseConnectionError(err)
	if diagnostic.Code != "synology_tls_hostname_mismatch" {
		t.Fatalf("diagnostic=%+v", diagnostic)
	}
}

func TestDiagnoseConnectionErrorClassifiesConnectionRefused(t *testing.T) {
	err := fmt.Errorf("%w: %w", ErrUnavailable, syscall.ECONNREFUSED)
	diagnostic := DiagnoseConnectionError(err)
	if diagnostic.Code != "synology_connection_refused" {
		t.Fatalf("diagnostic=%+v", diagnostic)
	}
}

func TestDiagnoseConnectionErrorIncludesDSMAPIErrorCode(t *testing.T) {
	envelope := apiEnvelope{Success: false}
	envelope.Error = &struct {
		Code int `json:"code"`
	}{Code: 400}
	err := apiError(envelope)
	diagnostic := DiagnoseConnectionError(err)
	if diagnostic.Code != "synology_auth_failed" ||
		!strings.Contains(diagnostic.Detail, "400") {
		t.Fatalf("diagnostic=%+v", diagnostic)
	}
}
