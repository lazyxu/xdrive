package api

import (
	"testing"
	"time"
)

func TestPublicThumbnailAdmissionBounded(t *testing.T) {
	const shareID uint64 = 98765432100
	now := time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC)
	for i := 0; i < publicShareThumbnailTicketsPM; i++ {
		if !admitPublicThumbnail(shareID, now, false) {
			t.Fatalf("ticket %d rejected too early", i)
		}
	}
	if admitPublicThumbnail(shareID, now, false) {
		t.Fatal("unbounded thumbnail ticket accepted")
	}
	for i := 0; i < publicShareThumbnailStreamsPM; i++ {
		if !admitPublicThumbnail(shareID, now, true) {
			t.Fatalf("stream %d rejected too early", i)
		}
	}
	if admitPublicThumbnail(shareID, now, true) {
		t.Fatal("unbounded thumbnail stream accepted")
	}
	if !admitPublicThumbnail(shareID, now.Add(time.Minute), false) {
		t.Fatal("new thumbnail window did not reset")
	}
}
