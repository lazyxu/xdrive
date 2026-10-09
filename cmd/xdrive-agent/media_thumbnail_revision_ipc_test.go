package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// The existing desktop IPC handler must forward the authenticated,
// revision-carrying thumbnail request to the controller without a new API.
func TestDesktopIPCMediaThumbnailSourceRevisionPropagation(t *testing.T) {
	ctrl := &fakeDesktopIPCController{
		cloudMediaThumbnail: agentMediaThumbnail{
			ContentType: "image/jpeg", Data: []byte("thumbnail"),
		},
	}
	handler := &desktopIPCHandler{ctrl: ctrl}
	for _, tc := range []struct {
		url          string
		wantRevision uint64
		wantStatus   int
	}{
		{"/v1/media/thumbnail?node_id=617&revision=4", 4, http.StatusOK},
		{"/v1/media/thumbnail?node_id=617", 0, http.StatusOK},
		{"/v1/media/thumbnail?node_id=617&revision=broken", 0, http.StatusBadRequest},
		{"/v1/media/thumbnail?node_id=617&revision=0", 0, http.StatusBadRequest},
	} {
		t.Run(tc.url, func(t *testing.T) {
			ctrl.cloudMediaThumbnailRevision = 0
			req := httptest.NewRequest(http.MethodGet, tc.url, nil)
			rec := httptest.NewRecorder()
			handler.mediaThumbnail(rec, req)
			if rec.Code != tc.wantStatus {
				t.Fatalf("status=%d want=%d response=%q", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if rec.Code == http.StatusOK && ctrl.cloudMediaThumbnailRevision != tc.wantRevision {
				t.Fatalf("forwarded source revision=%d want=%d",
					ctrl.cloudMediaThumbnailRevision, tc.wantRevision)
			}
		})
	}
}
