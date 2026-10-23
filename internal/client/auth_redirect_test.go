package client

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestLoginRedirectNeverForwardsPassword(t *testing.T) {
	for _, status := range []int{301, 302, 303, 307, 308} {
		for _, mode := range []string{"same-origin", "cross-origin"} {
			t.Run(fmt.Sprintf("%d/%s", status, mode), func(t *testing.T) {
				var received atomic.Int32
				var leaked atomic.Int32
				other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					leaked.Add(1)
					w.WriteHeader(http.StatusOK)
				}))
				defer other.Close()
				entry := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path != "/api/v1/auth/login" || r.Method != http.MethodPost {
						leaked.Add(1)
						w.WriteHeader(http.StatusOK)
						return
					}
					received.Add(1)
					target := other.URL + "/capture"
					if mode == "same-origin" {
						target = "/capture"
					}
					w.Header().Set("Location", target)
					w.WriteHeader(status)
				}))
				defer entry.Close()
				_, err := New(entry.URL, "").Login(context.Background(), "alice", "secret-password")
				if !errors.Is(err, ErrAuthRedirect) {
					t.Fatalf("expected redirect rejection, got %v", err)
				}
				if err.Error() != ErrAuthRedirect.Error() {
					t.Fatal("redirect error contains a target URL")
				}
				if received.Load() != 1 || leaked.Load() != 0 {
					t.Fatalf("entry=%d forwarded=%d", received.Load(), leaked.Load())
				}
			})
		}
	}
}

func TestRefreshRedirectNeverForwardsToken(t *testing.T) {
	var leaked atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		leaked.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer other.Close()
	entry := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/auth/refresh" || r.Method != http.MethodPost {
			t.Errorf("unexpected refresh request %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Location", other.URL+"/capture")
		w.WriteHeader(http.StatusTemporaryRedirect)
	}))
	defer entry.Close()
	c := NewSession(entry.URL, SessionTokens{
		AccessToken:     "old-access",
		RefreshToken:    "sensitive-refresh",
		AccessExpiresAt: time.Now().Add(time.Minute),
	}, nil)
	_, err := c.RefreshSession(context.Background())
	if !errors.Is(err, ErrAuthRedirect) {
		t.Fatalf("expected redirect rejection, got %v", err)
	}
	if leaked.Load() != 0 {
		t.Fatal("refresh token was forwarded")
	}
	if c.sessionTokens().RefreshToken != "sensitive-refresh" {
		t.Fatal("failed refresh changed token state")
	}
}

func TestLogoutRedirectNeverForwardsToken(t *testing.T) {
	for _, status := range []int{http.StatusFound, http.StatusTemporaryRedirect, http.StatusPermanentRedirect} {
		for _, mode := range []string{"same-origin", "cross-origin"} {
			t.Run(fmt.Sprintf("%d/%s", status, mode), func(t *testing.T) {
				var forwarded atomic.Int32
				destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					forwarded.Add(1)
					w.WriteHeader(http.StatusOK)
				}))
				defer destination.Close()
				entry := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path != "/api/v1/auth/logout" || r.Method != http.MethodPost {
						forwarded.Add(1)
						w.WriteHeader(http.StatusOK)
						return
					}
					target := destination.URL + "/capture"
					if mode == "same-origin" {
						target = "/capture"
					}
					w.Header().Set("Location", target)
					w.WriteHeader(status)
				}))
				defer entry.Close()
				c := NewSession(entry.URL, SessionTokens{RefreshToken: "sensitive-logout"}, nil)
				err := c.LogoutSession(context.Background())
				if !errors.Is(err, ErrAuthRedirect) || err.Error() != ErrAuthRedirect.Error() {
					t.Fatalf("expected sanitized logout redirect rejection, got %v", err)
				}
				if forwarded.Load() != 0 {
					t.Fatal("logout refresh token forwarded to redirect target")
				}
				if c.sessionTokens().RefreshToken != "sensitive-logout" {
					t.Fatal("failed logout changed token state")
				}
			})
		}
	}
}

func TestAuthRejectsHTTP3xxWithoutLocation(t *testing.T) {
	for _, status := range []int{http.StatusMultipleChoices, http.StatusFound, http.StatusNotModified} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			entry := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
			}))
			defer entry.Close()
			_, err := New(entry.URL, "").Login(context.Background(), "alice", "sensitive-password")
			if !errors.Is(err, ErrAuthRedirect) {
				t.Fatalf("expected 3xx rejection even without Location, got %v", err)
			}
		})
	}
}

func TestAuthRedirectGuardPreservesVerifiedIPHTTPSLogin(t *testing.T) {
	var calls atomic.Int32
	entry := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/api/v1/auth/login" || r.Method != http.MethodPost {
			t.Errorf("unexpected login request %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(AuthResponse{Username: "alice", Token: "test-token"})
	}))
	defer entry.Close()
	trusted := New(entry.URL, "")
	trusted.HTTP = entry.Client()
	result, err := trusted.Login(context.Background(), "alice", "secret-password")
	if err != nil || result.Username != "alice" || calls.Load() != 1 {
		t.Fatalf("trusted TLS login failed: user=%q calls=%d err=%v", result.Username, calls.Load(), err)
	}
	untrusted := New(entry.URL, "")
	if _, err := untrusted.Login(context.Background(), "alice", "secret-password"); err == nil {
		t.Fatal("an untrusted TLS certificate must still be rejected")
	}
}

func TestChangePasswordRedirectNeverForwardsCredentials(t *testing.T) {
	for _, status := range []int{http.StatusFound, http.StatusTemporaryRedirect, http.StatusPermanentRedirect} {
		for _, mode := range []string{"same-origin", "cross-origin"} {
			t.Run(fmt.Sprintf("%d/%s", status, mode), func(t *testing.T) {
				var forwarded atomic.Int32
				var original atomic.Int32
				target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					forwarded.Add(1)
					w.WriteHeader(http.StatusOK)
				}))
				defer target.Close()
				entry := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path != "/api/v1/me/change-password" || r.Method != http.MethodPost {
						forwarded.Add(1)
						w.WriteHeader(http.StatusOK)
						return
					}
					original.Add(1)
					location := target.URL + "/password-capture"
					if mode == "same-origin" {
						location = "/password-capture"
					}
					w.Header().Set("Location", location)
					w.WriteHeader(status)
				}))
				defer entry.Close()

				c := NewSession(entry.URL, SessionTokens{AccessToken: "existing-access"}, nil)
				_, err := c.ChangePassword(context.Background(), "old-secret", "new-secret")
				if !errors.Is(err, ErrAuthRedirect) || err.Error() != ErrAuthRedirect.Error() {
					t.Fatalf("expected sanitized password change redirect refusal, got %v", err)
				}
				if original.Load() != 1 || forwarded.Load() != 0 {
					t.Fatalf("original requests=%d forwarded=%d", original.Load(), forwarded.Load())
				}
				if c.sessionTokens().AccessToken != "existing-access" {
					t.Fatal("denied password change must not mutate authenticated session")
				}
			})
		}
	}
}
