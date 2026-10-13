package baidumapjsapi

import (
	"strings"
	"testing"
	"time"
)

func TestInspectMapSessionOwnerRequiresAuthenticatedCookie(t *testing.T) {
	now := time.Date(2026, 10, 13, 6, 0, 0, 0, time.UTC)
	key := []byte(strings.Repeat("q", 32))
	state := MapSessionState{OwnerID: 91, SessionVersion: 3, ConfigurationRevision: 8, RevocationEpoch: 7, AccountActive: true, RuntimeAuthorized: true}
	cookie, err := IssueMapSession(key, state, now)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := InspectMapSessionOwner(key, cookie.Value, now.Add(time.Second))
	if err != nil || owner != state.OwnerID {
		t.Fatalf("owner %d: %v", owner, err)
	}
	for _, tc := range []struct {
		name        string
		stringValue string
		secret      []byte
		at          time.Time
	}{
		{"tampered", cookie.Value + "!", key, now.Add(time.Second)},
		{"wrong key", cookie.Value, []byte(strings.Repeat("x", 32)), now.Add(time.Second)},
		{"expired", cookie.Value, key, now.Add(MapSessionTTL)},
		{"before issue", cookie.Value, key, now.Add(-time.Second)},
		{"missing", "", key, now},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := InspectMapSessionOwner(tc.secret, tc.stringValue, tc.at); err == nil {
				t.Fatal("invalid cookie accepted")
			}
		})
	}
}
