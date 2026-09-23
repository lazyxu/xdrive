package admin

import (
	"errors"
	"os"
	"testing"

	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBootstrapAdminWithExistingOrdinaryUser(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&meta.Node{}, &meta.User{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}); err != nil {
		t.Fatal(err)
	}
	hash, _ := auth.HashPassword("ordinary-password")
	ordinary := meta.User{Username: "existing-user", PasswordHash: hash, Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&ordinary).Error; err != nil {
		t.Fatal(err)
	}

	created, err := Bootstrap(db, "admin", "admin-password")
	if err != nil {
		t.Fatal(err)
	}
	if created.Role != meta.UserRoleAdmin || created.MustChangePassword {
		t.Fatalf("unexpected bootstrap admin: %#v", created)
	}
	if _, err := Bootstrap(db, "second-admin", "admin-password"); !errors.Is(err, ErrAdminExists) {
		t.Fatalf("second bootstrap err=%v want %v", err, ErrAdminExists)
	}
}
