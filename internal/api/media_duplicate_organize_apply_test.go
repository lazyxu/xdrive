package api

import (
	"encoding/json"
	"errors"
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

func TestMediaDuplicateOrganizeDescriptionChoiceRequiresExplicitSelection(t *testing.T) {
	plan := mediaDuplicateOrganizePlan{
		AssetComparison: duplicateAssetIdentical,
		Descriptions:    []string{"different", "first"},
		KeeperNodeID:    11,
		Members: []mediaDuplicateOrganizeMember{
			{NodeID: 11, Description: "first"},
			{NodeID: 12, Description: "different"},
		},
	}
	if _, err := mediaDuplicateOrganizeDescriptionChoice(plan, nil); !errors.Is(err, errMediaDuplicateOrganizeConflict) {
		t.Fatalf("conflicting descriptions without a selection must fail: %v", err)
	}
	for _, value := range []string{"", "First", "other", "first "} {
		if _, err := mediaDuplicateOrganizeDescriptionChoice(plan, &value); !errors.Is(err, errMediaDuplicateOrganizeConflict) {
			t.Fatalf("unreviewed description choice %q accepted: %v", value, err)
		}
	}
	selected := "different"
	if _, err := mediaDuplicateOrganizeDescriptionChoice(plan, &selected); !errors.Is(err, errMediaDuplicateOrganizeConflict) {
		t.Fatalf("overwriting keeper's independent original description is unsafe: %v", err)
	}
	selected = "first"
	got, err := mediaDuplicateOrganizeDescriptionChoice(plan, &selected)
	if err != nil || got != selected {
		t.Fatalf("preserving selected keeper description not accepted: %q %v", got, err)
	}
	plan.Members[0].Description = ""
	selected = "different"
	got, err = mediaDuplicateOrganizeDescriptionChoice(plan, &selected)
	if err != nil || got != selected {
		t.Fatalf("empty-description keeper must allow a reviewed source variant: %q %v", got, err)
	}
	plan.Descriptions = []string{"first"}
	plan.ReadyForManualReview = true
	if got, err := mediaDuplicateOrganizeDescriptionChoice(plan, nil); err != nil || got != "first" {
		t.Fatalf("single nonconflicting description changed: %q %v", got, err)
	}
	if _, err := mediaDuplicateOrganizeDescriptionChoice(plan, &selected); !errors.Is(err, errMediaDuplicateOrganizeConflict) {
		t.Fatalf("unneeded override accepted without a conflict: %v", err)
	}
	plan.ReadyForManualReview = false
	if _, err := mediaDuplicateOrganizeDescriptionChoice(plan, nil); !errors.Is(err, errMediaDuplicateOrganizeConflict) {
		t.Fatalf("unready singleton plan accepted: %v", err)
	}
}
