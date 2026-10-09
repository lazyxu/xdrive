package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestMediaDuplicateOrganizeApplyRequiresExplicitReviewedPlan(t *testing.T) {
	validToken := strings.Repeat("a", 64)
	for _, tc := range []struct {
		name  string
		body  string
		valid bool
	}{
		{name: "valid", body: `{"keeper_node_id":1,"node_ids":[1,2],"expected_plan_revision":"` + validToken + `","confirm":true}`, valid: true},
		{name: "missing confirm", body: `{"keeper_node_id":1,"node_ids":[1,2],"expected_plan_revision":"` + validToken + `"}`},
		{name: "stale malformed token", body: `{"keeper_node_id":1,"node_ids":[1,2],"expected_plan_revision":"not-hex","confirm":true}`},
		{name: "keeper outside selection", body: `{"keeper_node_id":3,"node_ids":[1,2],"expected_plan_revision":"` + validToken + `","confirm":true}`},
		{name: "duplicates", body: `{"keeper_node_id":1,"node_ids":[1,1],"expected_plan_revision":"` + validToken + `","confirm":true}`},
		{name: "only one node", body: `{"keeper_node_id":1,"node_ids":[1],"expected_plan_revision":"` + validToken + `","confirm":true}`},
		{name: "invalid node", body: `{"keeper_node_id":0,"node_ids":[0,2],"expected_plan_revision":"` + validToken + `","confirm":true}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var input mediaDuplicateOrganizeApplyInput
			err := json.Unmarshal([]byte(tc.body), &input)
			if err != nil {
				t.Fatal(err)
			}
			if got := mediaDuplicateOrganizeApplyInputValid(input); got != tc.valid {
				t.Fatalf("input validation=%v want=%v", got, tc.valid)
			}
			if tc.valid {
				return
			}
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodPost,
				"/api/v1/media/duplicate-organize/apply",
				strings.NewReader(tc.body))
			ctx.Request.Header.Set("Content-Type", "application/json")
			(&Server{}).applyMediaDuplicateOrganize(ctx)
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("malformed confirmation accepted: status=%d body=%s",
					recorder.Code, recorder.Body.String())
			}
		})
	}
}
