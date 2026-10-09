package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDesktopIPCMediaCleanupOffsetValidation(t *testing.T) {
	for _, tc := range []struct {
		query string
		want  int
		ok    bool
	}{
		{query: "", want: 0, ok: true},
		{query: "?offset=48", want: 48, ok: true},
		{query: "?offset=10000000", want: 10000000, ok: true},
		{query: "?offset=-2"},
		{query: "?offset=10000001"},
		{query: "?offset=broken"},
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/v1/media/duplicates"+tc.query, nil)
		got, ok := desktopIPCMediaCleanupOffset(recorder, request)
		if ok != tc.ok || (ok && got != tc.want) {
			t.Errorf("query %q got offset=%d valid=%v want %d valid=%v",
				tc.query, got, ok, tc.want, tc.ok)
		}
		if !ok && recorder.Code != http.StatusBadRequest {
			t.Errorf("query %q responded status %d", tc.query, recorder.Code)
		}
	}
}
