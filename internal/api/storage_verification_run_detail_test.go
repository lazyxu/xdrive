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

func storageVerificationDetailRequest(t *testing.T, s *Server, id string, query string) (int, storageVerificationRunDetail, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Params = gin.Params{{Key: "runID", Value: id}}
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/storage/verification-runs/1"+query, nil)
	s.adminStorageVerificationRunDetail(c)
	var detail storageVerificationRunDetail
	_ = json.Unmarshal(recorder.Body.Bytes(), &detail)
	return recorder.Code, detail, recorder.Body.String()
}

func TestStorageVerificationDetailRejectsUnsafeIdentityBeforeQuery(t *testing.T) {
	server := &Server{DB: &gorm.DB{}}
	for _, id := range []string{"", "0", "01", "-1", "1.0", "../private", "18446744073709551616"} {
		if status, _, _ := storageVerificationDetailRequest(t, server, id, ""); status != http.StatusBadRequest {
			t.Fatalf("accepted noncanonical run id %q: %d", id, status)
		}
	}
	if status, _, _ := storageVerificationDetailRequest(t, server, "1", "?path=/private"); status != http.StatusBadRequest {
		t.Fatalf("accepted unexpected query: %d", status)
	}
	if status, _, _ := storageVerificationDetailRequest(t, &Server{}, "1", ""); status != http.StatusServiceUnavailable {
		t.Fatalf("missing database should be unavailable: %d", status)
	}
}

func TestStorageVerificationDetailReadsOnlyTerminalBoundedEvidence(t *testing.T) {
	db := newSystemMaintenanceTaskTestDB(t)
	server := &Server{DB: db}
	now := time.Now().UTC().Truncate(time.Second)
	create := func(kind, state, report string, finished bool) string {
		t.Helper()
		run := meta.SystemMaintenanceRun{
			Kind: kind, Status: state, Phase: meta.SystemMaintenancePhaseFinished,
			StartedAt: now.Add(-time.Minute), ReportJSON: report,
			Summary: "/private/summary", Error: "secret-storage-key",
		}
		if finished {
			run.FinishedAt = &now
		}
		if err := db.Create(&run).Error; err != nil {
			t.Fatal(err)
		}
		return strconv.FormatUint(run.ID, 10)
	}
	evidence, err := json.Marshal(storageVerifyEvidence{
		Protocol: storageVerifyEvidenceProtocol, Mode: "deep",
		ReferencedFiles: 7, PhysicalObjects: 7, HashedObjects: 7, HashedBytes: 2048,
		MissingObjects: 1, IssueCount: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	validID := create(meta.SystemMaintenanceKindStorageVerify, meta.SystemMaintenanceStatusIssues, string(evidence), true)
	status, detail, body := storageVerificationDetailRequest(t, server, validID, "")
	if status != http.StatusOK || detail.Run.RunID != validID || detail.Run.Mode != "deep" ||
		detail.Protocol != storageVerificationDetailProtocol || detail.Evidence == nil ||
		detail.Evidence.MissingObjects != 1 || detail.Evidence.HashedBytes != 2048 {
		t.Fatalf("missing authentic historical receipt: %d %+v %s", status, detail, body)
	}
	if strings.Contains(body, "/private/") || strings.Contains(body, "secret-storage-key") {
		t.Fatalf("exposed private task data: %s", body)
	}
	legacyID := create(meta.SystemMaintenanceKindStorageVerifyFast, meta.SystemMaintenanceStatusSuccess, "", true)
	status, old, _ := storageVerificationDetailRequest(t, server, legacyID, "")
	if status != http.StatusOK || old.Evidence != nil || old.Run.Mode != "fast" {
		t.Fatalf("historical task without report claimed evidence: %d %+v", status, old)
	}
	forgedID := create(meta.SystemMaintenanceKindStorageVerify, meta.SystemMaintenanceStatusSuccess,
		`{"storage_key":"/private/never-expose"}`, true)
	status, forged, body := storageVerificationDetailRequest(t, server, forgedID, "")
	if status != http.StatusOK || forged.Evidence != nil || strings.Contains(body, "never-expose") {
		t.Fatalf("exposed forged evidence: %d %+v %s", status, forged, body)
	}
	for _, id := range []string{
		create(meta.SystemMaintenanceKindSourceVerify, meta.SystemMaintenanceStatusSuccess, string(evidence), true),
		create(meta.SystemMaintenanceKindStorageVerify, meta.SystemMaintenanceStatusRunning, string(evidence), false),
		"18446744073709551615",
	} {
		if status, _, _ := storageVerificationDetailRequest(t, server, id, ""); status != http.StatusNotFound {
			t.Fatalf("nonterminal or nonverification task exposed: id=%s status=%d", id, status)
		}
	}
}
