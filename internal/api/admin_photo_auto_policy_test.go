package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPhotoAutoPolicyLeavesManualAndPlaceTasksEnabled(t *testing.T) {
	s := &Server{}
	if !s.photoAutoAllows(photoIntelligenceFace, background.TriggerSystemEvent) {
		t.Fatal("default policy must preserve existing automatic analysis")
	}
	s.setPhotoAutoRuntime(photoAutoDesired{AutoEnabled: false, Revision: 1})
	for _, kind := range []photoIntelligenceTaskKind{
		photoIntelligenceFace, photoIntelligenceSmartSearch,
		photoIntelligenceSemanticSearch, photoIntelligencePersonCluster,
	} {
		for _, trigger := range []background.Trigger{background.TriggerSystemEvent, background.TriggerReconcile, background.TriggerSchedule} {
			if s.photoAutoAllows(kind, trigger) {
				t.Fatalf("%s/%s must pause when auto analysis is disabled", kind, trigger)
			}
		}
		for _, trigger := range []background.Trigger{background.TriggerUserAction, background.TriggerAdminAction} {
			if !s.photoAutoAllows(kind, trigger) {
				t.Fatalf("%s/%s manual task was incorrectly disabled", kind, trigger)
			}
		}
	}
	if !s.photoAutoAllows(photoIntelligencePlace, background.TriggerReconcile) {
		t.Fatal("GeoNames place-label resolution has a separate lifecycle")
	}
	// An out-of-order read cannot restore the old policy.
	s.setPhotoAutoRuntime(photoAutoDesired{AutoEnabled: true, Revision: 0})
	if s.photoAutoAllows(photoIntelligenceFace, background.TriggerReconcile) {
		t.Fatal("stale policy rolled back an administrator disable")
	}
	s.setPhotoAutoRuntime(photoAutoDesired{AutoEnabled: true, Revision: 2})
	if !s.photoAutoAllows(photoIntelligenceFace, background.TriggerSystemEvent) {
		t.Fatal("re-enabling automatic analysis must take effect without restart")
	}
}

func TestAdminPhotoAutoPolicyRevisionAuditAndReplicaApply(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "admin_photo_auto_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.AuditEvent{}, &meta.AdminPhotoAutoSetting{}, &meta.AdminPhotoAutoRevision{}); err != nil {
		t.Fatal(err)
	}
	s := &Server{DB: db, Auth: auth.New("photo-auto-policy-test-secret", time.Hour)}
	if err := s.refreshPhotoAutoPolicy(context.Background()); err != nil {
		t.Fatal(err)
	}
	admin := meta.User{Username: "photo-auto-admin", PasswordHash: "test", Role: meta.UserRoleAdmin, SessionVersion: 1}
	member := meta.User{Username: "photo-auto-member", PasswordHash: "test", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&member).Error; err != nil {
		t.Fatal(err)
	}
	adminToken, err := s.Auth.Issue(admin.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	memberToken, err := s.Auth.Issue(member.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	router := s.Router()
	path := "/api/v1/admin/services/photo-intelligence"
	request := func(method, token, body string) *httptest.ResponseRecorder {
		t.Helper()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		router.ServeHTTP(rec, req)
		return rec
	}
	if rec := request(http.MethodPut, "", `{"revision":0,"auto_enabled":false}`); rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated PUT = %d", rec.Code)
	}
	if rec := request(http.MethodGet, memberToken, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("nonadmin GET = %d", rec.Code)
	}
	if rec := request(http.MethodPut, memberToken, `{"revision":0,"auto_enabled":false}`); rec.Code != http.StatusForbidden {
		t.Fatalf("nonadmin PUT = %d", rec.Code)
	}
	if rec := request(http.MethodPut, adminToken, `{"revision":0}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("missing switch must fail: %d", rec.Code)
	}
	if rec := request(http.MethodGet, adminToken, ""); rec.Code != http.StatusOK ||
		!strings.Contains(rec.Body.String(), `"auto_enabled":true`) {
		t.Fatalf("default configuration missing: %d %s", rec.Code, rec.Body.String())
	}
	rec := request(http.MethodPut, adminToken, `{"revision":0,"auto_enabled":false}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"apply_state":"applied"`) ||
		!strings.Contains(rec.Body.String(), `"auto_enabled":false`) {
		t.Fatalf("save did not hot-apply false: %d %s", rec.Code, rec.Body.String())
	}
	var row meta.AdminPhotoAutoSetting
	if err := db.Where("name = ?", photoAutoSettingName).Take(&row).Error; err != nil || row.Revision != 1 || row.AutoEnabled {
		t.Fatalf("persisted policy is invalid: %+v, %v", row, err)
	}
	var auditCount int64
	if err := db.Model(&meta.AuditEvent{}).Count(&auditCount).Error; err != nil || auditCount != 1 {
		t.Fatalf("configuration must be audited transactionally: count %d, err %v", auditCount, err)
	}
	replica := &Server{DB: db}
	recorder := httptest.NewRecorder()
	ginCtx, _ := gin.CreateTestContext(recorder)
	ginCtx.Request = httptest.NewRequest(http.MethodGet, path, nil)
	replica.adminPhotoAutoConfig(ginCtx)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"apply_state":"pending"`) {
		t.Fatalf("unrefreshed replica must report pending, not cluster success: %d %s", recorder.Code, recorder.Body.String())
	}
	if err := replica.refreshPhotoAutoPolicy(context.Background()); err != nil {
		t.Fatal(err)
	}
	recorder = httptest.NewRecorder()
	ginCtx, _ = gin.CreateTestContext(recorder)
	ginCtx.Request = httptest.NewRequest(http.MethodGet, path, nil)
	replica.adminPhotoAutoConfig(ginCtx)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"apply_state":"applied"`) {
		t.Fatalf("replica refresh did not apply: %d %s", recorder.Code, recorder.Body.String())
	}
	if rec := request(http.MethodPut, adminToken, `{"revision":0,"auto_enabled":true}`); rec.Code != http.StatusConflict {
		t.Fatalf("stale policy write = %d", rec.Code)
	}
	rec = request(http.MethodPut, adminToken, `{"revision":1,"auto_enabled":true}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"auto_enabled":true`) {
		t.Fatalf("re-enable did not apply: %d %s", rec.Code, rec.Body.String())
	}
	if err := db.Model(&meta.AuditEvent{}).Count(&auditCount).Error; err != nil || auditCount != 2 {
		t.Fatalf("expected exactly two committed audits, count %d, err %v", auditCount, err)
	}
	// New clients can save all four automatic task groups in one audited revision.
	// The current instance uses it immediately, while another replica remains pending.
	rec = request(http.MethodPut, adminToken,
		`{"revision":2,"auto_enabled":true,"kinds":{"face":false,"smart":true,"semantic":false,"person_cluster":true}}`)
	if rec.Code != http.StatusOK ||
		!strings.Contains(rec.Body.String(), `"face":false`) ||
		!strings.Contains(rec.Body.String(), `"effective_kinds"`) ||
		!strings.Contains(rec.Body.String(), `"apply_state":"applied"`) {
		t.Fatalf("per-kind policy not applied: %d %s", rec.Code, rec.Body.String())
	}
	if s.photoAutoAllows(photoIntelligenceFace, background.TriggerReconcile) ||
		!s.photoAutoAllows(photoIntelligenceSmartSearch, background.TriggerReconcile) ||
		s.photoAutoAllows(photoIntelligenceSemanticSearch, background.TriggerSystemEvent) ||
		!s.photoAutoAllows(photoIntelligencePersonCluster, background.TriggerSystemEvent) {
		t.Fatal("runtime task admission does not match persisted per-kind policy")
	}
	if err := db.Where("name = ?", photoAutoSettingName).Take(&row).Error; err != nil ||
		row.Revision != 3 || row.KindsJSON == "" {
		t.Fatalf("missing persisted per-kind policy: %+v err=%v", row, err)
	}
	recorder = httptest.NewRecorder()
	ginCtx, _ = gin.CreateTestContext(recorder)
	ginCtx.Request = httptest.NewRequest(http.MethodGet, path, nil)
	replica.adminPhotoAutoConfig(ginCtx)
	if !strings.Contains(recorder.Body.String(), `"apply_state":"pending"`) {
		t.Fatalf("another instance incorrectly claimed apply: %s", recorder.Body.String())
	}
	if err := replica.refreshPhotoAutoPolicy(context.Background()); err != nil ||
		replica.photoAutoAllows(photoIntelligenceFace, background.TriggerReconcile) {
		t.Fatalf("replica policy did not apply: %v", err)
	}
	// A malformed or partial set never mutates the running policy, revision or audit.
	for _, body := range []string{
		`{"revision":3,"auto_enabled":true,"kinds":{"face":false}}`,
		`{"revision":3,"auto_enabled":true,"kinds":{"face":null,"smart":true,"semantic":true,"person_cluster":true}}`,
	} {
		if response := request(http.MethodPut, adminToken, body); response.Code != http.StatusBadRequest {
			t.Fatalf("invalid kind switches accepted: %d %s", response.Code, response.Body.String())
		}
	}
	response := request(http.MethodPut, adminToken,
		`{"revision":2,"auto_enabled":true,"kinds":{"face":true,"smart":true,"semantic":true,"person_cluster":true}}`)
	if response.Code != http.StatusConflict {
		t.Fatalf("stale switch update accepted: %d", response.Code)
	}
	// Legacy clients may still change the global switch without clearing kinds.
	rec = request(http.MethodPut, adminToken, `{"revision":3,"auto_enabled":false}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"face":false`) {
		t.Fatalf("legacy write reset per-kind settings: %d %s", rec.Code, rec.Body.String())
	}
	if err := db.Model(&meta.AuditEvent{}).Count(&auditCount).Error; err != nil || auditCount != 4 {
		t.Fatalf("invalid/stale writes changed audit history: count %d, err %v", auditCount, err)
	}
	// Revision history is admin-only and contains only global/task switches.
	historyPath := "/api/v1/admin/services/photo-intelligence/revisions"
	rollbackPath := "/api/v1/admin/services/photo-intelligence/rollback"
	requestHistory := func(method, path, token, body string) *httptest.ResponseRecorder {
		t.Helper()
		result := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		router.ServeHTTP(result, req)
		return result
	}
	if result := requestHistory(http.MethodGet, historyPath, "", ""); result.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated history must be rejected: %d", result.Code)
	}
	if result := requestHistory(http.MethodGet, historyPath, memberToken, ""); result.Code != http.StatusForbidden {
		t.Fatalf("member must not read global policy history: %d", result.Code)
	}
	if result := requestHistory(http.MethodPost, rollbackPath, memberToken, `{"revision":4,"target_revision":2}`); result.Code != http.StatusForbidden {
		t.Fatalf("member must not roll back global policy: %d", result.Code)
	}
	history := requestHistory(http.MethodGet, historyPath, adminToken, "")
	if history.Code != http.StatusOK ||
		!strings.Contains(history.Body.String(), `"revision":0`) ||
		!strings.Contains(history.Body.String(), `"origin":"default"`) ||
		!strings.Contains(history.Body.String(), `"revision":4`) ||
		!strings.Contains(history.Body.String(), `"face":false`) {
		t.Fatalf("admin history missing default and per-kind snapshots: %d %s", history.Code, history.Body.String())
	}
	if result := requestHistory(http.MethodPost, rollbackPath, adminToken, `{"revision":4,"target_revision":4}`); result.Code != http.StatusBadRequest {
		t.Fatalf("same-revision rollback = %d", result.Code)
	}
	if result := requestHistory(http.MethodPost, rollbackPath, adminToken, `{"revision":3,"target_revision":1}`); result.Code != http.StatusConflict {
		t.Fatalf("stale rollback = %d", result.Code)
	}

	// Rollback revision 4 to the previous all-enabled (revision 2) policy.
	rollback := requestHistory(http.MethodPost, rollbackPath, adminToken, `{"revision":4,"target_revision":2}`)
	if rollback.Code != http.StatusOK ||
		!strings.Contains(rollback.Body.String(), `"revision":5`) ||
		!strings.Contains(rollback.Body.String(), `"auto_enabled":true`) ||
		!strings.Contains(rollback.Body.String(), `"apply_state":"applied"`) ||
		!strings.Contains(rollback.Body.String(), `"face":true`) {
		t.Fatalf("rollback did not hot-apply historical policy: %d %s", rollback.Code, rollback.Body.String())
	}
	if !s.photoAutoAllows(photoIntelligenceFace, background.TriggerReconcile) ||
		!s.photoAutoAllows(photoIntelligenceSemanticSearch, background.TriggerSystemEvent) {
		t.Fatal("rollback did not restore historical automatic task admission")
	}
	if err := db.Where("name = ?", photoAutoSettingName).Take(&row).Error; err != nil ||
		row.Revision != 5 || !row.AutoEnabled {
		t.Fatalf("rollback was not persisted as a new revision: %+v err=%v", row, err)
	}
	recorder = httptest.NewRecorder()
	ginCtx, _ = gin.CreateTestContext(recorder)
	ginCtx.Request = httptest.NewRequest(http.MethodGet, path, nil)
	replica.adminPhotoAutoConfig(ginCtx)
	if !strings.Contains(recorder.Body.String(), `"apply_state":"pending"`) {
		t.Fatalf("replica must remain pending before next refresh: %s", recorder.Body.String())
	}
	if err := replica.refreshPhotoAutoPolicy(context.Background()); err != nil ||
		!replica.photoAutoAllows(photoIntelligenceFace, background.TriggerReconcile) {
		t.Fatalf("replica did not apply rolled-back policy: %v", err)
	}
	if err := db.Model(&meta.AuditEvent{}).Count(&auditCount).Error; err != nil || auditCount != 5 {
		t.Fatalf("policy rollback must append exactly one audit: count %d err=%v", auditCount, err)
	}
	var latest meta.AdminPhotoAutoRevision
	if err := db.Where("name = ? AND revision = ?", photoAutoSettingName, uint64(5)).
		Take(&latest).Error; err != nil || latest.Origin != "rollback" {
		t.Fatalf("historical rollback event missing: %+v err=%v", latest, err)
	}

	// A deleted/missing revision cannot be fabricated from current settings.
	if err := db.Where("name = ? AND revision = ?", photoAutoSettingName, uint64(1)).
		Delete(&meta.AdminPhotoAutoRevision{}).Error; err != nil {
		t.Fatal(err)
	}
	if result := requestHistory(http.MethodPost, rollbackPath, adminToken, `{"revision":5,"target_revision":1}`); result.Code != http.StatusNotFound {
		t.Fatalf("missing target revision = %d", result.Code)
	}
	// Corrupt historical policy must never replace a healthy runtime.
	if err := db.Model(&meta.AdminPhotoAutoRevision{}).
		Where("name = ? AND revision = ?", photoAutoSettingName, uint64(0)).
		Update("kinds_json", "invalid").Error; err != nil {
		t.Fatal(err)
	}
	if result := requestHistory(http.MethodPost, rollbackPath, adminToken, `{"revision":5,"target_revision":0}`); result.Code != http.StatusUnprocessableEntity {
		t.Fatalf("corrupt target revision = %d", result.Code)
	}
	// A failed audit MUST abort the settings update and leave runtime unchanged.
	if err := db.Migrator().DropTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if result := requestHistory(http.MethodPost, rollbackPath, adminToken, `{"revision":5,"target_revision":2}`); result.Code != http.StatusServiceUnavailable {
		t.Fatalf("unauditable rollback must fail closed: %d %s", result.Code, result.Body.String())
	}
	if err := db.Where("name = ?", photoAutoSettingName).Take(&row).Error; err != nil ||
		row.Revision != 5 || !row.AutoEnabled {
		t.Fatalf("audit failure changed persisted policy: %+v err=%v", row, err)
	}
	if !s.photoAutoAllows(photoIntelligenceFace, background.TriggerReconcile) {
		t.Fatal("audit failure changed live automatic task admission")
	}
}
