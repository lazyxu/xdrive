package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestMapAccessStrictSignedIssuedAt(t *testing.T) {
	secret := "map-unit-test-secret"
	m := New(secret, 30*time.Minute)
	now := time.Date(2026, 10, 13, 5, 4, 30, 0, time.UTC)
	issue := func(modify func(*Claims)) string {
		t.Helper()
		claims := &Claims{
			UserID: 17, SessionVersion: 3, TokenType: "access",
			RegisteredClaims: jwt.RegisteredClaims{
				Subject:   "17",
				IssuedAt:  jwt.NewNumericDate(now.Add(-1 * time.Minute)),
				ExpiresAt: jwt.NewNumericDate(now.Add(15 * time.Minute)),
			},
		}
		if modify != nil {
			modify(claims)
		}
		value, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	good := issue(nil)
	verified, err := m.ParseMapAccess(good, now)
	if err != nil || verified.UserID != 17 || verified.SessionVersion != 3 || !verified.IssuedAt.Equal(now.Add(-time.Minute)) {
		t.Fatalf("rejected valid signed map access: %v %#v", err, verified)
	}
	wrongKey, err := jwt.NewWithClaims(jwt.SigningMethodHS256, Claims{
		UserID: 17, SessionVersion: 3, TokenType: "access",
		RegisteredClaims: jwt.RegisteredClaims{Subject: "17", IssuedAt: jwt.NewNumericDate(now.Add(-time.Minute)), ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour))},
	}).SignedString([]byte("attacker-secret"))
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name  string
		token string
	}{
		{"wrong signing key", wrongKey},
		{"missing iat", issue(func(c *Claims) { c.IssuedAt = nil })},
		{"future iat", issue(func(c *Claims) { c.IssuedAt = jwt.NewNumericDate(now.Add(3 * time.Minute)) })},
		{"missing expiry", issue(func(c *Claims) { c.ExpiresAt = nil })},
		{"expired", issue(func(c *Claims) { c.ExpiresAt = jwt.NewNumericDate(now.Add(-time.Second)) })},
		{"legacy missing version", issue(func(c *Claims) { c.SessionVersion = 0 })},
		{"wrong type", issue(func(c *Claims) { c.TokenType = "preview_stream" })},
		{"wrong subject", issue(func(c *Claims) { c.Subject = "19" })},
		{"missing subject", issue(func(c *Claims) { c.Subject = "" })},
		{"no user", issue(func(c *Claims) { c.UserID = 0 })},
		{"empty", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := m.ParseMapAccess(tc.token, now); err == nil {
				t.Fatal("accepted unsafe map access")
			}
		})
	}
	if _, err := m.ParseMapAccess(good, time.Time{}); err == nil {
		t.Fatal("accepted missing trusted time")
	}
}
