package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestMediaSelectionCannotChangeDuringDurableSubmission(t *testing.T) {
	gin.SetMode(gin.TestMode)
	token := uuid.NewString()
	s := &Server{mediaSelections: map[string]*mediaSelectionSnapshot{
		token: {ownerID: 7, version: 3, submitting: true,
			nodes:     []mediaSelectionNode{{ID: 10, Revision: 1}},
			memberIDs: map[uint64]struct{}{10: {}},
			excluded:  map[uint64]struct{}{}, expiresAt: time.Now().Add(time.Minute)},
	}}
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPatch, "/api/v1/media/selection-snapshots/"+token+"/exclusion",
		strings.NewReader(`{"node_id":10,"excluded":true,"version":3}`))
	c.Set("userID", uint64(7))
	c.Params = gin.Params{{Key: "token", Value: token}}
	c.Request.Header.Set("Content-Type", "application/json")
	// The submitting guard refuses even a syntactically valid optimistic edit.
	s.updateMediaSelectionExclusion(c)
	if rec.Code != http.StatusConflict {
		t.Fatalf("submitting exclusion status=%d", rec.Code)
	}
	if s.mediaSelections[token].version != 3 || len(s.mediaSelections[token].excluded) != 0 {
		t.Fatal("a submitting selection changed under its frozen job")
	}
}
