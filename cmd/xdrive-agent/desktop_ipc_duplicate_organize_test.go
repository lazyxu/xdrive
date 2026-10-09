package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDesktopIPCDuplicateOrganizeRejectsMalformedSelection(t *testing.T) {
	for _, query := range []string{
		"?keeper_id=1&node_id=1",
		"?keeper_id=1&node_id=1&node_id=1",
		"?keeper_id=1&node_id=1&node_id=0",
		"?keeper_id=3&node_id=1&node_id=2",
		"?keeper_id=bad&node_id=1&node_id=2",
	} {
		req := httptest.NewRequest(http.MethodGet, "/v1/media/duplicate-organize/plan"+query, nil)
		rec := httptest.NewRecorder()
		(&desktopIPCHandler{}).mediaDuplicateOrganizePlan(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("query %q returned %d, want 400", query, rec.Code)
		}
	}
}
