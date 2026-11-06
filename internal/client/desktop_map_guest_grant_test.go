package client

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestNativeDesktopMapGrantRequiresFreshNativeSecretAndNoRedirect(t *testing.T) {
	var redirected atomic.Int32
	var issued atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/auth/desktop-map/issue", func(w http.ResponseWriter, r *http.Request) {
		issued.Add(1)
		data, _ := io.ReadAll(io.LimitReader(r.Body, 1024))
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer test-access" ||
			!strings.Contains(string(data), `"native_refresh_token":"test-native-refresh"`) {
			t.Error("Desktop Agent grant request did not include exact native proof")
			w.WriteHeader(403)
			return
		}
		w.Header().Set("Location", "/redirected-credential")
		w.WriteHeader(http.StatusTemporaryRedirect)
	})
	mux.HandleFunc("/redirected-credential", func(w http.ResponseWriter, r *http.Request) {
		redirected.Add(1)
		w.WriteHeader(http.StatusOK)
	})
	server := httptest.NewTLSServer(mux)
	defer server.Close()
	cli := NewManagedSession(server.URL, SessionTokens{
		AccessToken:"test-access", RefreshToken:"test-native-refresh",
		AccessExpiresAt:time.Now().Add(time.Hour), RefreshExpiresAt:time.Now().Add(time.Hour),
	}, nil, nil)
	cli.HTTP = server.Client()
	_, err := cli.IssueDesktopMapGuestGrant(context.Background())
	if !errors.Is(err, ErrAuthRedirect) || redirected.Load()!=0 || issued.Load()!=1 {
		t.Fatalf("native refresh credential was redirected: err=%v, issued=%d, redirected=%d",
			err,issued.Load(),redirected.Load())
	}
}

func TestNativeDesktopMapGrantRejectsMalformedServerAndReceipt(t *testing.T) {
	httpClient := NewManagedSession("http://localhost:18080", SessionTokens{
		AccessToken:"native",RefreshToken:"native-refresh",
	}, nil, nil)
	if _,err:=httpClient.IssueDesktopMapGuestGrant(context.Background());err==nil {
		t.Fatal("native map grant must not use plaintext HTTP")
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request) {
		w.Header().Set("Content-Type","application/json")
		_,_ = io.WriteString(w,`{"ticket":"invalid","username":"owner","expires_in":30}`)
	}))
	defer server.Close()
	cli:=NewManagedSession(server.URL,SessionTokens{
		AccessToken:"native",RefreshToken:"native-refresh",
		AccessExpiresAt:time.Now().Add(time.Hour),RefreshExpiresAt:time.Now().Add(time.Hour),
	},nil,nil)
	cli.HTTP=server.Client()
	if _,err:=cli.IssueDesktopMapGuestGrant(context.Background());err==nil {
		t.Fatal("native Agent accepted success-shaped untrusted Server ticket")
	}
}
