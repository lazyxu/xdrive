package api

import (
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	adminpkg "github.com/lazyxu/xdrive/internal/admin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBootstrapAndRecoveryAdminCanLogin(t *testing.T) {
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
		&meta.AuditEvent{}, &meta.Share{}, &meta.UploadPart{}, &meta.UploadSession{}, &meta.FileVersion{}, &meta.File{},
		&meta.Node{}, &meta.RefreshToken{}, &meta.User{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{},
		&meta.FileVersion{}, &meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{}, &meta.AuditEvent{},
	); err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	router := (&Server{
		DB: db, Store: store, Auth: auth.New("admin-login-test-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
	}).Router()

	adminUser, err := adminpkg.Bootstrap(db, "recovery-admin", "initial-admin-password")
	if err != nil {
		t.Fatal(err)
	}
	initial := loginTestUser(t, router, adminUser.Username, "initial-admin-password", http.StatusOK)
	if initial.Role != meta.UserRoleAdmin || initial.MustChangePassword {
		t.Fatalf("unexpected initial admin login: %#v", initial)
	}
	request(t, router, http.MethodGet, "/api/v1/admin/users", initial.AccessToken, nil, http.StatusOK)

	if _, err := adminpkg.ResetPassword(db, adminUser.Username, "temporary-admin-password", true); err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodGet, "/api/v1/admin/users", initial.AccessToken, nil, http.StatusUnauthorized)
	loginTestUser(t, router, adminUser.Username, "initial-admin-password", http.StatusUnauthorized)

	temporary := loginTestUser(t, router, adminUser.Username, "temporary-admin-password", http.StatusOK)
	if temporary.Role != meta.UserRoleAdmin || !temporary.MustChangePassword {
		t.Fatalf("unexpected temporary-password admin login: %#v", temporary)
	}
	request(t, router, http.MethodGet, "/api/v1/admin/users", temporary.AccessToken, nil, http.StatusForbidden)

	if _, err := adminpkg.ResetPassword(db, adminUser.Username, "final-admin-password", false); err != nil {
		t.Fatal(err)
	}
	final := loginTestUser(t, router, adminUser.Username, "final-admin-password", http.StatusOK)
	if final.Role != meta.UserRoleAdmin || final.MustChangePassword {
		t.Fatalf("unexpected recovered admin login: %#v", final)
	}
	request(t, router, http.MethodGet, "/api/v1/admin/users", final.AccessToken, nil, http.StatusOK)
}
