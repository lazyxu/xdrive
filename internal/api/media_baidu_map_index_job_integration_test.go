package api

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

// Retained only as a read-only compatibility view. Legacy consent_revision is
// never evidence of permission to show or derive an Owner GPS coordinate.
func TestMediaBaiduMapLegacyJobStatusDoesNotImplyPhotoConsent(t *testing.T) {
	empty := mediaBaiduMapJobResponse(nil)
	if empty.Status != "not_queued" || empty.ConsentRevision != 0 ||
		empty.DispatchEnabled {
		t.Fatalf("legacy job response accidentally grants dispatch: %+v", empty)
	}
	pending := meta.BaiduPhotoMapIndexIntent{
		AssetID: 99, OwnerID: 1, ConsentRevision: 0,
		Status: baiduMapIndexQueued, Attempts: 1,
	}
	got := mediaBaiduMapJobResponse(&pending)
	if got.Status != baiduMapIndexQueued || got.ConsentRevision != 0 ||
		got.DispatchEnabled {
		t.Fatalf("Owner indexing incorrectly needs photo consent: %+v", got)
	}
}
