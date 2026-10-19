package auth

import (
	"testing"
	"time"
)

func TestPublicShareArchiveTicketIsPurposeLimited(t *testing.T) {
	manager := New("public-zip-is-not-an-owner-session", time.Hour)
	const runID = "00000000-0000-4000-8000-000000000001"
	token, expiry, err := manager.IssuePublicShareArchive(13, 51, 2, runID, time.Minute)
	if err != nil || expiry.Before(time.Now()) {
		t.Fatalf("issue public archive ticket: %v", err)
	}
	claims, err := manager.ParsePublicShareArchive(token)
	if err != nil || claims.ShareID != 13 || claims.RootID != 51 ||
		claims.RootRevision != 2 || claims.PrepareID != runID {
		t.Fatalf("public archive claims: %+v %v", claims, err)
	}
	if _, err := manager.ParsePublicShareDownload(token); err == nil {
		t.Fatal("archive ticket must not authorize a single public file download")
	}
	if _, _, err := manager.Parse(token); err == nil {
		t.Fatal("archive ticket must not become an account bearer")
	}
	file, _, err := manager.IssuePublicShareDownload(13, 51, 2, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.ParsePublicShareArchive(file); err == nil {
		t.Fatal("public file ticket must not authorize a whole-folder archive")
	}
	for _, input := range []struct {
		shareID   uint64
		rootID    uint64
		revision  uint64
		prepareID string
		ttl       time.Duration
	}{
		{0, 51, 2, runID, time.Minute},
		{13, 0, 2, runID, time.Minute},
		{13, 51, 0, runID, time.Minute},
		{13, 51, 2, "not-a-uuid", time.Minute},
		{13, 51, 2, runID, 0},
		{13, 51, 2, runID, 11 * time.Minute},
	} {
		if _, _, err := manager.IssuePublicShareArchive(input.shareID, input.rootID, input.revision, input.prepareID, input.ttl); err == nil {
			t.Fatalf("issued invalid archive claim: %+v", input)
		}
	}
}
