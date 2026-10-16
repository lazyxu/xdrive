package api

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Exercise the REAL HTTP account-security endpoints against isolated Postgres.
// No production map runtime, Browser AK, upstream request or third-party JS is used.
func TestBaiduJSAPIAccountSecurityMutationRevokesMapEpoch(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL fixture requires XD_TEST_DATABASE_URL")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "map_admin_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA \"%s\"", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA \"%s\" CASCADE", schema)).Error }()
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
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}, &meta.BaiduJSAPIMapEpoch{}, &meta.Node{},
		&meta.File{}, &meta.FileVersion{}, &meta.ContentBlob{}, &meta.Share{}, &meta.UploadSession{},
		&meta.UploadPart{}, &meta.LocalPushQuotaHold{}, &meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	manager := auth.New("isolated-map-admin-security-secret", time.Hour)
	server := &Server{DB: db, Store: local, Auth: manager, RefreshTTL: 24 * time.Hour}
	router := server.Router()
	hash, err := auth.HashPassword("original-map-password")
	if err != nil {
		t.Fatal(err)
	}
	admin := meta.User{Username: "map-admin", PasswordHash: hash, Role: meta.UserRoleAdmin, SessionVersion: 1}
	owner := meta.User{Username: "map-owner", PasswordHash: hash, Role: meta.UserRoleUser, SessionVersion: 1}
	peer := meta.User{Username: "map-peer", PasswordHash: hash, Role: meta.UserRoleUser, SessionVersion: 1}
	for _, user := range []*meta.User{&admin, &owner, &peer} {
		if err := db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}).Error; err != nil {
			t.Fatal(err)
		}
	}
	ctx := context.Background()
	for _, id := range []uint64{owner.ID, peer.ID} {
		if _, err := ensureBaiduMapEpochTx(ctx, db, id); err != nil {
			t.Fatal(err)
		}
	}
	adminToken, err := manager.Issue(admin.ID, admin.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	ownerRoute := fmt.Sprintf("/api/v1/admin/users/%d", owner.ID)
	cookieKey := []byte(strings.Repeat("m", 32))
	assertRevoked := func(action func()) {
		t.Helper()
		before, err := loadBaiduMapEpoch(ctx, db, owner.ID)
		if err != nil {
			t.Fatal(err)
		}
		var live meta.User
		if err := db.First(&live, owner.ID).Error; err != nil {
			t.Fatal(err)
		}
		when := time.Now().UTC().Truncate(time.Second)
		state := baidumapjsapi.MapSessionState{
			OwnerID: owner.ID, SessionVersion: live.SessionVersion,
			ConfigurationRevision: 7, RevocationEpoch: before.Epoch,
			AccountActive: true, RuntimeAuthorized: true,
		}
		cookie, err := baidumapjsapi.IssueMapSession(cookieKey, state, when)
		if err != nil {
			t.Fatal(err)
		}
		action()
		after, err := loadBaiduMapEpoch(ctx, db, owner.ID)
		if err != nil || after.Epoch != before.Epoch+1 || after.RevokedAfter == nil {
			t.Fatalf("map revocation not atomic: before=%d after=%#v err=%v", before.Epoch, after, err)
		}
		state.RevocationEpoch = after.Epoch
		if err := baidumapjsapi.VerifyMapSession(cookieKey, cookie.Value, state, when.Add(time.Second)); err == nil {
			t.Fatal("old encrypted map cookie survived account security mutation")
		}
		other, err := loadBaiduMapEpoch(ctx, db, peer.ID)
		if err != nil || other.Epoch != 1 || other.RevokedAfter != nil {
			t.Fatalf("unrelated owner revoked: %#v %v", other, err)
		}
	}
	assertRevoked(func() {
		request(t, router, http.MethodPatch, ownerRoute, adminToken,
			strings.NewReader("{\"disabled\":true}"), http.StatusOK)
	})
	// Re-enable must not roll back the epoch or validate the old cookie.
	request(t, router, http.MethodPatch, ownerRoute, adminToken,
		strings.NewReader("{\"disabled\":false}"), http.StatusOK)
	assertRevoked(func() {
		request(t, router, http.MethodPost, ownerRoute+"/reset-password", adminToken,
			strings.NewReader("{\"password\":\"reset-map-password\",\"must_change_password\":false}"), http.StatusNoContent)
	})
	assertRevoked(func() {
		request(t, router, http.MethodPost, ownerRoute+"/revoke-sessions", adminToken, nil, http.StatusNoContent)
	})
	assertRevoked(func() {
		var live meta.User
		if err := db.First(&live, owner.ID).Error; err != nil {
			t.Fatal(err)
		}
		token, err := manager.Issue(owner.ID, live.SessionVersion)
		if err != nil {
			t.Fatal(err)
		}
		request(t, router, http.MethodPost, "/api/v1/me/change-password", token,
			strings.NewReader("{\"current_password\":\"reset-map-password\",\"new_password\":\"final-map-password\"}"), http.StatusOK)
	})
	// Fail closed: if the epoch table disappears, neither the account session
	// version nor the corresponding audit/credential mutation may commit.
	var beforeUser meta.User
	if err := db.First(&beforeUser, owner.ID).Error; err != nil {
		t.Fatal(err)
	}
	var auditsBefore int64
	if err := db.Model(&meta.AuditEvent{}).Count(&auditsBefore).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&meta.BaiduJSAPIMapEpoch{}); err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodPost, ownerRoute+"/revoke-sessions", adminToken, nil, http.StatusInternalServerError)
	var afterUser meta.User
	if err := db.First(&afterUser, owner.ID).Error; err != nil || afterUser.SessionVersion != beforeUser.SessionVersion {
		t.Fatalf("failed map revocation mutated user: before=%d after=%d err=%v",
			beforeUser.SessionVersion, afterUser.SessionVersion, err)
	}
	var auditsAfter int64
	if err := db.Model(&meta.AuditEvent{}).Count(&auditsAfter).Error; err != nil || auditsAfter != auditsBefore {
		t.Fatalf("failed map revocation emitted an audit: before=%d after=%d err=%v",
			auditsBefore, auditsAfter, err)
	}
}
