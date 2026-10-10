package api

import (
	"encoding/json"
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
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceworkerpolicy"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestSourceWorkerObservedRevisionNeverClaimsEarlyApply(t *testing.T) {
	want := sourceworkerpolicy.Values{ScanIntervalSeconds: 300, PollIntervalSeconds: 30, MaxConcurrency: 3}
	desired := sourceworkerpolicy.Desired{Values: want, Revision: 2, Source: "saved"}
	old := meta.SourceWorkerPresence{
		ScanIntervalSeconds: 21600, PollIntervalSeconds: 60, MaxConcurrency: 2, AppliedRevision: 1,
	}
	good := meta.SourceWorkerPresence{
		ScanIntervalSeconds: 300, PollIntervalSeconds: 30, MaxConcurrency: 3, AppliedRevision: 2,
	}
	for _, tc := range []struct {
		name      string
		desired   sourceworkerpolicy.Desired
		rows      []meta.SourceWorkerPresence
		truncated bool
		state     string
		applied   int
	}{
		{"before first save", sourceworkerpolicy.Desired{Values: sourceworkerpolicy.Defaults()}, []meta.SourceWorkerPresence{old}, false, "unmanaged", 0},
		{"saved no worker", desired, nil, false, "unavailable", 0},
		{"old worker", desired, []meta.SourceWorkerPresence{old}, false, "pending", 0},
		{"mixed worker", desired, []meta.SourceWorkerPresence{old, good}, false, "pending", 1},
		{"all applied", desired, []meta.SourceWorkerPresence{good, good}, false, "applied", 2},
		{"matching revision wrong values", desired, []meta.SourceWorkerPresence{{AppliedRevision: 2, ScanIntervalSeconds: 301, PollIntervalSeconds: 30, MaxConcurrency: 3}}, false, "pending", 0},
		{"truncated cannot apply", desired, []meta.SourceWorkerPresence{good}, true, "pending", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, applied, _ := summarizeSourceWorkerEffective(tc.desired, tc.rows, tc.truncated)
			if got != tc.state || applied != tc.applied {
				t.Fatalf("got state %s applied %d, want state %s applied %d", got, applied, tc.state, tc.applied)
			}
		})
	}
}

func TestAdminSourceWorkerRealPostgresSaveApplyHistoryRollback(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "worker_admin_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	params := parsed.Query()
	params.Set("search_path", schema)
	parsed.RawQuery = params.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.AuditEvent{}, &meta.SourceWorkerPresence{},
		&meta.AdminSourceWorkerSetting{}, &meta.AdminSourceWorkerRevision{},
	); err != nil {
		t.Fatal(err)
	}
	admin := meta.User{Username: "worker-admin", PasswordHash: "test", Role: meta.UserRoleAdmin, SessionVersion: 1}
	member := meta.User{Username: "worker-member", PasswordHash: "test", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&member).Error; err != nil {
		t.Fatal(err)
	}
	srv := &Server{DB: db, Auth: auth.New("source-worker-config-test-secret", time.Hour)}
	adminToken, err := srv.Auth.Issue(admin.ID, admin.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	memberToken, err := srv.Auth.Issue(member.ID, member.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	router := srv.Router()
	base := "/api/v1/admin/services/source-worker"
	call := func(method, path, token, body string) *httptest.ResponseRecorder {
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
	check := func(method, path, token, body string, code int) *httptest.ResponseRecorder {
		t.Helper()
		rec := call(method, path, token, body)
		if rec.Code != code {
			t.Fatalf("%s %s got %d want %d: %s", method, path, rec.Code, code, rec.Body.String())
		}
		return rec
	}
	check(http.MethodGet, base, "", "", http.StatusUnauthorized)
	for _, suffix := range []string{"", "/revisions", "/rollback"} {
		method := http.MethodGet
		if suffix == "/rollback" {
			method = http.MethodPost
		}
		check(method, base+suffix, memberToken, "{}", http.StatusForbidden)
	}
	check(http.MethodPut, base, memberToken, `{"revision":0,"desired":{"scan_interval_seconds":120,"poll_interval_seconds":30,"max_concurrency":4}}`, http.StatusForbidden)

	var initial sourceWorkerConfigDTO
	if err := json.Unmarshal(check(http.MethodGet, base, adminToken, "", http.StatusOK).Body.Bytes(), &initial); err != nil {
		t.Fatal(err)
	}
	if initial.Revision != 0 || initial.ApplyState != "unmanaged" || initial.ActiveInstances != 0 || !initial.Editable {
		t.Fatalf("missing or deceptive initial desired state: %+v", initial)
	}
	for _, invalid := range []string{
		`{"revision":0,"desired":{"scan_interval_seconds":59,"poll_interval_seconds":30,"max_concurrency":4}}`,
		`{"revision":0,"desired":{"scan_interval_seconds":120,"poll_interval_seconds":30}}`,
		`{"revision":0,"desired":{"scan_interval_seconds":120,"poll_interval_seconds":30,"max_concurrency":9}}`,
		`{"desired":{"scan_interval_seconds":120,"poll_interval_seconds":30,"max_concurrency":4}}`,
	} {
		check(http.MethodPut, base, adminToken, invalid, http.StatusBadRequest)
	}
	put := `{"revision":0,"desired":{"scan_interval_seconds":120,"poll_interval_seconds":30,"max_concurrency":4}}`
	var saved sourceWorkerConfigDTO
	if err := json.Unmarshal(check(http.MethodPut, base, adminToken, put, http.StatusOK).Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Revision != 1 || saved.ApplyState != "unavailable" || saved.AppliedInstances != 0 {
		t.Fatalf("saving without an active Worker falsely applied policy: %+v", saved)
	}
	check(http.MethodPut, base, adminToken, put, http.StatusConflict)
	var auditCount int64
	if err := db.Model(&meta.AuditEvent{}).Count(&auditCount).Error; err != nil || auditCount != 1 {
		t.Fatalf("invalid/stale writes unexpectedly audited: %d %v", auditCount, err)
	}
	now := time.Now().UTC()
	for _, row := range []meta.SourceWorkerPresence{
		{InstanceID: uuid.NewString(), ScanIntervalSeconds: 21600, PollIntervalSeconds: 60, MaxConcurrency: 2, AppliedRevision: 0, HeartbeatAt: now, ExpiresAt: now.Add(time.Minute)},
		{InstanceID: uuid.NewString(), ScanIntervalSeconds: 120, PollIntervalSeconds: 30, MaxConcurrency: 4, AppliedRevision: 1, HeartbeatAt: now, ExpiresAt: now.Add(time.Minute)},
	} {
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	var mixed sourceWorkerConfigDTO
	if err := json.Unmarshal(check(http.MethodGet, base, adminToken, "", http.StatusOK).Body.Bytes(), &mixed); err != nil {
		t.Fatal(err)
	}
	if mixed.ApplyState != "pending" || mixed.ActiveInstances != 2 || mixed.AppliedInstances != 1 {
		t.Fatalf("mixed live workers incorrectly confirmed: %+v", mixed)
	}
	if err := db.Model(&meta.SourceWorkerPresence{}).Where("applied_revision = ?", 0).Updates(map[string]any{
		"scan_interval_seconds": int64(120), "poll_interval_seconds": int64(30),
		"max_concurrency": 4, "applied_revision": uint64(1),
	}).Error; err != nil {
		t.Fatal(err)
	}
	var confirmed sourceWorkerConfigDTO
	if err := json.Unmarshal(check(http.MethodGet, base, adminToken, "", http.StatusOK).Body.Bytes(), &confirmed); err != nil {
		t.Fatal(err)
	}
	if confirmed.ApplyState != "applied" || confirmed.AppliedInstances != 2 {
		t.Fatalf("workers did not confirm intended effective revision: %+v", confirmed)
	}
	var history sourceWorkerRevisionPage
	if err := json.Unmarshal(check(http.MethodGet, base+"/revisions", adminToken, "", http.StatusOK).Body.Bytes(), &history); err != nil {
		t.Fatal(err)
	}
	if len(history.Items) != 2 || history.Items[0].Revision != 1 || history.Items[1].Revision != 0 {
		t.Fatalf("immutable history missing initial defaults: %+v", history)
	}
	check(http.MethodPost, base+"/rollback", adminToken, `{"revision":0,"target_revision":0}`, http.StatusBadRequest)
	check(http.MethodPost, base+"/rollback", adminToken, `{"revision":1,"target_revision":99}`, http.StatusBadRequest)
	var restored sourceWorkerConfigDTO
	if err := json.Unmarshal(check(http.MethodPost, base+"/rollback", adminToken, `{"revision":1,"target_revision":0}`, http.StatusOK).Body.Bytes(), &restored); err != nil {
		t.Fatal(err)
	}
	if restored.Revision != 2 || restored.ApplyState != "pending" || restored.Desired != sourceworkerpolicy.Defaults() {
		t.Fatalf("rollback falsely claimed applied or did not restore revision zero: %+v", restored)
	}
	check(http.MethodPost, base+"/rollback", adminToken, `{"revision":1,"target_revision":0}`, http.StatusConflict)
	if err := db.Model(&meta.AuditEvent{}).Count(&auditCount).Error; err != nil || auditCount != 2 {
		t.Fatalf("expected only save+rollback committed audits: %d %v", auditCount, err)
	}
	if err := json.Unmarshal(check(http.MethodGet, base+"/revisions", adminToken, "", http.StatusOK).Body.Bytes(), &history); err != nil {
		t.Fatal(err)
	}
	if len(history.Items) != 3 || history.Items[0].Origin != "rollback" || history.Items[0].Revision != 2 {
		t.Fatalf("rollback did not append immutable revision: %+v", history)
	}
}
