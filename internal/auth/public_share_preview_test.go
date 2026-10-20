package auth

import (
	"testing"
	"time"
)

func TestPublicSharePreviewPurposeIsolationAndTTL(t *testing.T) {
	m := New("public-preview-test-secret", time.Hour)
	token, expires, err := m.IssuePublicSharePreview(5, 7, 9, 90*time.Second)
	if err != nil || !expires.After(time.Now()) {
		t.Fatalf("preview ticket err=%v expires=%s", err, expires)
	}
	claims, err := m.ParsePublicSharePreview(token)
	if err != nil || claims.ShareID != 5 || claims.NodeID != 7 ||
		claims.NodeRevision != 9 || claims.TokenType != "public_share_preview" {
		t.Fatalf("claims=%+v err=%v", claims, err)
	}
	if _, err := m.ParsePublicShareDownload(token); err == nil {
		t.Fatal("preview JWT must never grant a public download")
	}
	if _, err := m.ParsePreviewStream(token); err == nil {
		t.Fatal("preview JWT must never grant an Owner preview")
	}
	download, _, err := m.IssuePublicShareDownload(5, 7, 9, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.ParsePublicSharePreview(download); err == nil {
		t.Fatal("public download JWT must never grant preview")
	}
	for _, invalid := range []struct {
		share, node, rev uint64
		ttl              time.Duration
	}{
		{0, 7, 9, time.Minute},
		{5, 0, 9, time.Minute},
		{5, 7, 0, time.Minute},
		{5, 7, 9, 0},
		{5, 7, 9, 3 * time.Minute},
	} {
		if _, _, err := m.IssuePublicSharePreview(invalid.share, invalid.node, invalid.rev, invalid.ttl); err == nil {
			t.Fatalf("issued invalid preview ticket %+v", invalid)
		}
	}
}
