package auth

import (
	"testing"
	"time"
)

func TestPublicShareThumbnailPurposeAndScope(t *testing.T) {
	manager := New("public-thumbnail-test-secret", time.Hour)
	raw, expires, err := manager.IssuePublicShareThumbnail(11, 23, 7, 90*time.Second)
	if err != nil || !expires.After(time.Now()) {
		t.Fatalf("invalid thumbnail ticket: %v", err)
	}
	claims, err := manager.ParsePublicShareThumbnail(raw)
	if err != nil || claims.ShareID != 11 || claims.NodeID != 23 || claims.NodeRevision != 7 {
		t.Fatalf("incorrect scoped thumbnail claims %+v err=%v", claims, err)
	}
	if _, err := manager.ParsePublicSharePreview(raw); err == nil {
		t.Fatal("thumbnail ticket is not an original public preview ticket")
	}
	if _, err := manager.ParsePublicShareDownload(raw); err == nil {
		t.Fatal("thumbnail ticket is not a public file download ticket")
	}
	if _, _, err := manager.IssuePublicShareThumbnail(11, 23, 7, 3*time.Minute); err == nil {
		t.Fatal("unbounded thumbnail ticket TTL accepted")
	}
	if _, _, err := manager.IssuePublicShareThumbnail(11, 0, 7, time.Minute); err == nil {
		t.Fatal("missing thumbnail node accepted")
	}
}
