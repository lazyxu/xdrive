package auth

import (
	"testing"
	"time"
)

func TestPublicShareDownloadTicketRoundTripAndIsolation(t *testing.T) {
	manager := New("public-share-download-secret", time.Hour)
	token, expiresAt, err := manager.IssuePublicShareDownload(5, 7, 9, 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if !expiresAt.After(time.Now()) {
		t.Fatalf("expiresAt=%s", expiresAt)
	}
	claims, err := manager.ParsePublicShareDownload(token)
	if err != nil {
		t.Fatal(err)
	}
	if claims.ShareID != 5 || claims.NodeID != 7 || claims.NodeRevision != 9 {
		t.Fatalf("claims=%+v", claims)
	}
	if _, err := manager.ParseDownloadStream(token); err == nil {
		t.Fatal("public share ticket must not be accepted as an authenticated download ticket")
	}
	if _, _, err := manager.IssuePublicShareDownload(5, 7, 9, 11*time.Minute); err == nil {
		t.Fatal("oversized public share ticket ttl was accepted")
	}
}
