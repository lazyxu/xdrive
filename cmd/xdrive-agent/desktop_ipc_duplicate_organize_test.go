package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDesktopIPCDuplicateOrganizeApplyRejectsUnsafeRequests(t *testing.T) {
	valid := strings.Repeat("a", 64)
	for _, body := range []string{
		`{}`,
		`{"keeper_node_id":1,"node_ids":[1,2],"expected_plan_revision":"` + valid + `","confirm":false}`,
		`{"keeper_node_id":1,"node_ids":[1,2],"expected_plan_revision":"invalid","confirm":true}`,
		`{"keeper_node_id":1,"node_ids":[1,1],"expected_plan_revision":"` + valid + `","confirm":true}`,
		`{"keeper_node_id":3,"node_ids":[1,2],"expected_plan_revision":"` + valid + `","confirm":true}`,
		`{"keeper_node_id":1,"node_ids":[1,0],"expected_plan_revision":"` + valid + `","confirm":true}`,
		`{"keeper_node_id":1,"node_ids":[1,2],"expected_plan_revision":"` + valid + `","selected_description":"` + strings.Repeat("x", 4097) + `","confirm":true}`,
	} {
		request := httptest.NewRequest(
			http.MethodPost, "/v1/media/duplicate-organize/apply", strings.NewReader(body),
		)
		recorder := httptest.NewRecorder()
		(&desktopIPCHandler{}).mediaDuplicateOrganizeApply(recorder, request)
		if recorder.Code != http.StatusBadRequest {
			t.Errorf("body %s: status=%d want=400", body, recorder.Code)
		}
	}
	// A valid request to a legacy controller fails explicitly, never
	// invokes a read-only fallback or implicitly considers the merge done.
	body := `{"keeper_node_id":1,"node_ids":[1,2],"expected_plan_revision":"` + valid + `","confirm":true}`
	request := httptest.NewRequest(
		http.MethodPost, "/v1/media/duplicate-organize/apply", strings.NewReader(body),
	)
	recorder := httptest.NewRecorder()
	(&desktopIPCHandler{}).mediaDuplicateOrganizeApply(recorder, request)
	if recorder.Code != http.StatusNotImplemented {
		t.Errorf("unsupported capability status=%d want=501", recorder.Code)
	}
}

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
