package api

import (
	"testing"
	"time"
)

func TestShareUploadAdmissionIsRateNotLifetimeQuota(t *testing.T) {
	shareID := uint64(987654321012345)
	now := time.Now()
	for i := 0; i < shareUploadAdmissionRate; i++ {
		if !admitPublicShareUpload(shareID, now) {
			t.Fatalf("unexpected short-window refusal at request %d", i)
		}
	}
	if admitPublicShareUpload(shareID, now) {
		t.Fatal("a bounded request window must protect an exposed public API")
	}
	// No cumulative number-of-files, total-bytes, or lifetime session cap.
	if !admitPublicShareUpload(shareID, now.Add(shareUploadAdmissionWindow)) {
		t.Fatal("rate window did not reset; this must not become a lifetime share quota")
	}
}
