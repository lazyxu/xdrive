package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	adminpkg "github.com/lazyxu/xdrive/internal/admin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestAuditLogCoversSecurityAndDestructiveActions(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(
		&meta.AuditEvent{}, &meta.Share{}, &meta.UploadPart{}, &meta.UploadSession{},
		&meta.ContentBlob{}, &meta.FileVersion{}, &meta.File{}, &meta.Node{}, &meta.RefreshToken{}, &meta.User{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.ContentBlob{},
		&meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{}, &meta.AuditEvent{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	router := (&Server{
		DB: db, Store: store, Auth: auth.New("audit-integration-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
	}).Router()

	adminUser, err := adminpkg.Bootstrap(db, "audit-admin", "admin-password")
	if err != nil {
		t.Fatal(err)
	}
	adminSession := loginTestUser(t, router, adminUser.Username, "admin-password", http.StatusOK)
	loginTestUser(t, router, "does-not-exist", "do-not-store-this-password", http.StatusUnauthorized)

	createRes := request(t, router, http.MethodPost, "/api/v1/admin/users", adminSession.AccessToken,
		strings.NewReader(`{"username":"audit-user","password":"initial-user-password","role":"user","must_change_password":false,"quota_bytes":1024}`),
		http.StatusCreated)
	var managed userDTO
	if err := json.Unmarshal(createRes.Body.Bytes(), &managed); err != nil {
		t.Fatal(err)
	}

	request(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/admin/users/%d", managed.ID), adminSession.AccessToken,
		strings.NewReader(`{"role":"admin","quota_bytes":2048}`), http.StatusOK)
	request(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/admin/users/%d", managed.ID), adminSession.AccessToken,
		strings.NewReader(`{"disabled":true}`), http.StatusOK)
	request(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/admin/users/%d", managed.ID), adminSession.AccessToken,
		strings.NewReader(`{"disabled":false,"role":"user"}`), http.StatusOK)

	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/admin/users/%d/reset-password", managed.ID), adminSession.AccessToken,
		strings.NewReader(`{"password":"reset-user-password","must_change_password":false}`), http.StatusNoContent)
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/admin/users/%d/revoke-sessions", managed.ID),
		adminSession.AccessToken, nil, http.StatusNoContent)

	userSession := loginTestUser(t, router, "audit-user", "reset-user-password", http.StatusOK)
	changeRes := request(t, router, http.MethodPost, "/api/v1/me/change-password", userSession.AccessToken,
		strings.NewReader(`{"current_password":"reset-user-password","new_password":"final-user-password"}`), http.StatusOK)
	var changed authResponse
	if err := json.Unmarshal(changeRes.Body.Bytes(), &changed); err != nil {
		t.Fatal(err)
	}
	if changed.AccessToken == "" {
		t.Fatal("password change returned no replacement session")
	}

	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", changed.AccessToken, nil, http.StatusOK)
	file := uploadTestFile(t, router, changed.AccessToken, root.ID, "audit.txt", "v1")
	file = requestNodeWithHeaders(t, router, http.MethodPut, fmt.Sprintf("/api/v1/files/%d/content", file.ID),
		changed.AccessToken, strings.NewReader("v2"), http.StatusOK,
		map[string]string{"If-Match": fmt.Sprintf("\"%d\"", file.Revision)})
	versionsRes := request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/versions", file.ID),
		changed.AccessToken, nil, http.StatusOK)
	var versions []fileVersionDTO
	if err := json.Unmarshal(versionsRes.Body.Bytes(), &versions); err != nil {
		t.Fatal(err)
	}
	if len(versions) == 0 {
		t.Fatal("expected version history")
	}
	file = requestNodeWithHeaders(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/files/%d/versions/%d/restore", file.ID, versions[0].ID),
		changed.AccessToken, nil, http.StatusOK,
		map[string]string{"If-Match": fmt.Sprintf("\"%d\"", file.Revision)})
	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", file.ID),
		changed.AccessToken, nil, http.StatusNoContent,
		map[string]string{"If-Match": fmt.Sprintf("\"%d\"", file.Revision)})
	trashRes := request(t, router, http.MethodGet, "/api/v1/trash", changed.AccessToken, nil, http.StatusOK)
	var trash []nodeDTO
	if err := json.Unmarshal(trashRes.Body.Bytes(), &trash); err != nil {
		t.Fatal(err)
	}
	if len(trash) != 1 {
		t.Fatalf("trash=%+v", trash)
	}
	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/trash/%d", file.ID),
		changed.AccessToken, nil, http.StatusNoContent,
		map[string]string{"If-Match": fmt.Sprintf("\"%d\"", trash[0].Revision)})

	request(t, router, http.MethodGet, "/api/v1/admin/audit", changed.AccessToken, nil, http.StatusForbidden)
	auditRes := request(t, router, http.MethodGet, "/api/v1/admin/audit?limit=200", adminSession.AccessToken, nil, http.StatusOK)
	var events []auditEventDTO
	if err := json.Unmarshal(auditRes.Body.Bytes(), &events); err != nil {
		t.Fatal(err)
	}
	if len(events) == 0 {
		t.Fatal("audit API returned no events")
	}

	seen := map[string]int{}
	for _, event := range events {
		seen[event.Action]++
	}
	for _, action := range []string{
		auditpkg.ActionLoginSuccess,
		auditpkg.ActionLoginFailure,
		auditpkg.ActionAdminUserCreate,
		auditpkg.ActionAdminRoleChange,
		auditpkg.ActionAdminQuotaChange,
		auditpkg.ActionAdminUserDisable,
		auditpkg.ActionAdminUserEnable,
		auditpkg.ActionAdminPasswordReset,
		auditpkg.ActionAdminSessionRevoke,
		auditpkg.ActionPasswordChange,
		auditpkg.ActionVersionRestore,
		auditpkg.ActionPermanentDelete,
	} {
		if seen[action] == 0 {
			t.Fatalf("missing audit action %q; seen=%v", action, seen)
		}
	}

	raw := auditRes.Body.String()
	for _, secret := range []string{
		"do-not-store-this-password",
		"initial-user-password",
		"reset-user-password",
		"final-user-password",
		adminSession.AccessToken,
		adminSession.RefreshToken,
	} {
		if secret != "" && strings.Contains(raw, secret) {
			t.Fatalf("audit response leaked secret material %q", secret)
		}
	}

	filtered := request(t, router, http.MethodGet,
		"/api/v1/admin/audit?action="+auditpkg.ActionLoginFailure+"&result=failure&limit=20",
		adminSession.AccessToken, nil, http.StatusOK)
	var failures []auditEventDTO
	if err := json.Unmarshal(filtered.Body.Bytes(), &failures); err != nil {
		t.Fatal(err)
	}
	if len(failures) == 0 || failures[0].Action != auditpkg.ActionLoginFailure || failures[0].Result != auditpkg.ResultFailure {
		t.Fatalf("filtered audit events=%+v", failures)
	}

	rangeRes := request(t, router, http.MethodGet,
		"/api/v1/admin/audit?range=true&limit=2&offset=0",
		adminSession.AccessToken, nil, http.StatusOK)
	var firstRange auditEventRangeDTO
	if err := json.Unmarshal(rangeRes.Body.Bytes(), &firstRange); err != nil {
		t.Fatal(err)
	}
	if firstRange.TotalCount != int64(len(events)) ||
		firstRange.Offset != 0 || firstRange.Limit != 2 ||
		firstRange.SnapshotMaxID == 0 || len(firstRange.Items) != 2 {
		t.Fatalf("unexpected first audit range: %+v", firstRange)
	}
	if firstRange.Items[0].ID != firstRange.SnapshotMaxID {
		t.Fatalf("snapshot max id %d does not match newest row %d", firstRange.SnapshotMaxID, firstRange.Items[0].ID)
	}

	if err := auditpkg.Record(db, auditpkg.Event{
		ActorUsername: "snapshot-test",
		ActorRole:     "system",
		Action:        auditpkg.ActionBackup,
		TargetType:    "system",
		TargetID:      "snapshot",
		Result:        auditpkg.ResultSuccess,
	}); err != nil {
		t.Fatal(err)
	}

	stableRes := request(t, router, http.MethodGet,
		fmt.Sprintf(
			"/api/v1/admin/audit?range=true&limit=2&offset=0&snapshot_max_id=%d",
			firstRange.SnapshotMaxID,
		),
		adminSession.AccessToken, nil, http.StatusOK)
	var stableRange auditEventRangeDTO
	if err := json.Unmarshal(stableRes.Body.Bytes(), &stableRange); err != nil {
		t.Fatal(err)
	}
	if stableRange.TotalCount != firstRange.TotalCount ||
		stableRange.SnapshotMaxID != firstRange.SnapshotMaxID ||
		len(stableRange.Items) != len(firstRange.Items) ||
		stableRange.Items[0].ID != firstRange.Items[0].ID {
		t.Fatalf("audit snapshot drifted after append: first=%+v stable=%+v", firstRange, stableRange)
	}

	freshRes := request(t, router, http.MethodGet,
		"/api/v1/admin/audit?range=true&limit=2&offset=0",
		adminSession.AccessToken, nil, http.StatusOK)
	var freshRange auditEventRangeDTO
	if err := json.Unmarshal(freshRes.Body.Bytes(), &freshRange); err != nil {
		t.Fatal(err)
	}
	if freshRange.TotalCount != firstRange.TotalCount+1 ||
		freshRange.SnapshotMaxID <= firstRange.SnapshotMaxID ||
		len(freshRange.Items) == 0 ||
		freshRange.Items[0].Action != auditpkg.ActionBackup {
		t.Fatalf("fresh audit snapshot did not include appended event: %+v", freshRange)
	}

	filteredRangeRes := request(t, router, http.MethodGet,
		"/api/v1/admin/audit?range=true&limit=20&offset=0&action="+auditpkg.ActionLoginFailure+"&result=failure",
		adminSession.AccessToken, nil, http.StatusOK)
	var filteredRange auditEventRangeDTO
	if err := json.Unmarshal(filteredRangeRes.Body.Bytes(), &filteredRange); err != nil {
		t.Fatal(err)
	}
	if filteredRange.TotalCount != int64(len(failures)) || len(filteredRange.Items) == 0 {
		t.Fatalf("filtered audit range=%+v failures=%d", filteredRange, len(failures))
	}
}
