package api

import (
	"testing"
	"time"
)

func TestPublicSharePreviewRateBounded(t *testing.T) {
	const fakeShareID = 9000000001
	now := time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
	for i := 0; i < publicSharePreviewTicketsPM; i++ {
		if !admitPublicSharePreview(fakeShareID, now, false) {
			t.Fatalf("ticket %d rejected too early", i)
		}
	}
	if admitPublicSharePreview(fakeShareID, now, false) {
		t.Fatal("unmetered preview ticket accepted")
	}
	for i := 0; i < publicSharePreviewStreamsPM; i++ {
		if !admitPublicSharePreview(fakeShareID, now, true) {
			t.Fatalf("stream %d rejected too early", i)
		}
	}
	if admitPublicSharePreview(fakeShareID, now, true) {
		t.Fatal("unmetered preview stream accepted")
	}
	if !admitPublicSharePreview(fakeShareID, now.Add(time.Minute), false) {
		t.Fatal("fresh window did not recover")
	}
}
