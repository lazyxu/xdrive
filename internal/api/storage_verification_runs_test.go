package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func storageVerificationHistoryRequest(t *testing.T, s *Server, rawQuery string) (int, storageVerificationHistoryPage, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest(http.MethodGet,
		"/api/v1/admin/storage/verification-runs"+rawQuery, nil)
	s.adminStorageVerificationRuns(c)
	var page storageVerificationHistoryPage
	_ = json.Unmarshal(response.Body.Bytes(), &page)
	return response.Code, page, response.Body.String()
}

func TestStorageVerificationHistoryRejectsUnboundedAndNoncanonicalCursors(t *testing.T) {
	server := &Server{}
	if status, _, _ := storageVerificationHistoryRequest(t, server, ""); status != http.StatusServiceUnavailable {
		t.Fatalf("missing DB was not unavailable: %d", status)
	}
	// Invalid input is rejected before touching the database. Run this
	// guard even when integration PostgreSQL credentials are absent.
	server.DB = &gorm.DB{}
	for _, raw := range []string{
		"?limit=0", "?limit=51", "?limit=01", "?limit=-1",
		"?limit=1&limit=2", "?cursor=0", "?cursor=01", "?cursor=-3",
		"?cursor=18446744073709551616", "?cursor=../private",
		"?cursor=1&cursor=2", "?path=/root/secret", "?limit=1&unexpected=1",
	} {
		if status, _, body := storageVerificationHistoryRequest(t, server, raw);
			status != http.StatusBadRequest {
			t.Fatalf("invalid query %q accepted: %d %s", raw, status, body)
		}
	}
}

func TestStorageVerificationHistoryKeysetAndSafeProjection(t *testing.T) {
	db := newSystemMaintenanceTaskTestDB(t)
	server := &Server{DB: db}
	now := time.Now().UTC().Truncate(time.Second)
	makeRun := func(kind, status, secret string) uint64 {
		t.Helper()
		run := meta.SystemMaintenanceRun{
			Kind: kind, Status: status,
			Phase: meta.SystemMaintenancePhaseFinished,
			StartedAt: now.Add(-time.Minute), FinishedAt: &now,
			Summary: "/root/secret-"+secret, Error: "private:"+secret,
			ReportJSON: `{"storage_key":"/root/private"}`,
		}
		if err := db.Create(&run).Error; err != nil {
			t.Fatal(err)
		}
		return run.ID
	}
	_ = makeRun(meta.SystemMaintenanceKindStorageOptimization, meta.SystemMaintenanceStatusSuccess, "unrelated")
	deepA := makeRun(meta.SystemMaintenanceKindStorageVerify, meta.SystemMaintenanceStatusSuccess, "deepA")
	_ = makeRun(meta.SystemMaintenanceKindStorageVerify, meta.SystemMaintenanceStatusRunning, "active")
	fastB := makeRun("storage_verify_fast", meta.SystemMaintenanceStatusIssues, "fastB")
	deepC := makeRun(meta.SystemMaintenanceKindStorageVerify, meta.SystemMaintenanceStatusFailed, "deepC")
	_ = makeRun(meta.SystemMaintenanceKindSourceVerify, meta.SystemMaintenanceStatusSuccess, "foreign")
	status, first, body := storageVerificationHistoryRequest(t, server, "?limit=2")
	if status != http.StatusOK || len(first.Items) != 2 ||
		first.Items[0].RunID != strconv.FormatUint(deepC, 10) ||
		first.Items[1].RunID != strconv.FormatUint(fastB, 10) ||
		first.Items[0].Mode != "deep" || first.Items[1].Mode != "fast" ||
		first.NextCursor != strconv.FormatUint(fastB, 10) {
		t.Fatalf("wrong first historical page: %d %+v %s", status, first, body)
	}
	if strings.Contains(body, "/root/") || strings.Contains(body, "private:") {
		t.Fatalf("private Host data leaked: %s", body)
	}
	status, second, body := storageVerificationHistoryRequest(t, server, "?limit=2&cursor="+first.NextCursor)
	if status != http.StatusOK || len(second.Items) != 1 ||
		second.Items[0].RunID != strconv.FormatUint(deepA, 10) ||
		second.NextCursor != "" {
		t.Fatalf("wrong next page: %d %+v %s", status, second, body)
	}
}
