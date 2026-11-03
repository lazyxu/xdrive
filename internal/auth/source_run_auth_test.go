package auth

import (
	"testing"
	"time"
)

func TestSourceRunAccessUsesDistinctClaims(t *testing.T) {
	manager := New("long-test-signing-key", time.Hour)
	normal, err := manager.Issue(14, 3)
	if err != nil { t.Fatal(err) }
	ordinary, err := manager.ParseClaims(normal)
	if err != nil { t.Fatal(err) }
	if ordinary.SourceID != 0 || ordinary.SourceRunID != "" {
		t.Fatalf("ordinary Owner JWT must not hold Source write scope: %+v", ordinary)
	}
	scoped, err := manager.IssueSourceRunAccess(14, 3, 52, "run-1")
	if err != nil { t.Fatal(err) }
	claims, err := manager.ParseClaims(scoped)
	if err != nil { t.Fatal(err) }
	if claims.UserID != 14 || claims.SessionVersion != 3 || claims.SourceID != 52 || claims.SourceRunID != "run-1" {
		t.Fatalf("unexpected source-run scope: %+v", claims)
	}
	id, ver, err := manager.Parse(scoped)
	if err != nil || id != 14 || ver != 3 { t.Fatalf("legacy identity parse regression: %d, %d, %v", id, ver, err) }
}

func TestSourceRunAccessRejectsIncompleteScope(t *testing.T) {
	manager := New("long-test-signing-key", time.Hour)
	for _, tc := range []struct { uid uint64; src uint64; run string }{
		{0, 1, "run"}, {1, 0, "run"}, {1, 2, ""},
	} {
		if _, err := manager.IssueSourceRunAccess(tc.uid, 1, tc.src, tc.run); err == nil {
			t.Fatalf("issued invalid source scope: %+v", tc)
		}
	}
}
