package auth

import (
	"testing"
	"time"
)

func TestDownloadStreamTicketRoundTripAndAudienceIsolation(t *testing.T) {
	manager := New("download-stream-test-secret", time.Hour)
	token, expiresAt, err := manager.IssueDownloadStream(
		7,
		3,
		"file",
		"42",
		9,
		10*time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !expiresAt.After(time.Now()) {
		t.Fatalf("expiresAt=%s", expiresAt)
	}
	claims, err := manager.ParseDownloadStream(token)
	if err != nil {
		t.Fatal(err)
	}
	if claims.UserID != 7 ||
		claims.SessionVersion != 3 ||
		claims.ResourceKind != "file" ||
		claims.ResourceID != "42" ||
		claims.ResourceRevision != 9 {
		t.Fatalf("claims=%+v", claims)
	}
	if _, err := manager.ParsePreviewStream(token); err == nil {
		t.Fatal("download ticket must not be accepted as a preview ticket")
	}
	if _, _, err := manager.IssueDownloadStream(7, 3, "", "42", 9, time.Minute); err == nil {
		t.Fatal("empty resource kind was accepted")
	}
	if _, _, err := manager.IssueDownloadStream(7, 3, "file", "", 9, time.Minute); err == nil {
		t.Fatal("empty resource id was accepted")
	}
	if _, _, err := manager.IssueDownloadStream(7, 3, "file", "42", 9, 31*time.Minute); err == nil {
		t.Fatal("oversized download ticket ttl was accepted")
	}
}
