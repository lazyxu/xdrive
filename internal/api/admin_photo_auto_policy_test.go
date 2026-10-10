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
	if err := db.AutoMigrate(&meta.User{}, &meta.AuditEvent{}, &meta.AdminPhotoAutoSetting{}); err != nil {
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
}
