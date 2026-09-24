package admin

import (
	"errors"
	"os"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestListUsersResetPasswordAndAccountState(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&meta.RefreshToken{}, &meta.Node{}, &meta.User{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}, &meta.Node{}); err != nil {
		t.Fatal(err)
	}

	adminUser, err := Bootstrap(db, "recovery-admin", "old-password")
	if err != nil {
		t.Fatal(err)
	}
	hash, err := auth.HashPassword("user-password")
	if err != nil {
		t.Fatal(err)
	}
	lastLogin := time.Now().UTC().Truncate(time.Second)
	ordinary := meta.User{
		Username: "disabled-user", PasswordHash: hash, Role: meta.UserRoleUser,
		SessionVersion: 3, MustChangePassword: true, QuotaBytes: 1234, LastLoginAt: &lastLogin,
	}
	if err := db.Create(&ordinary).Error; err != nil {
		t.Fatal(err)
	}

	users, err := ListUsers(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(users) != 2 {
		t.Fatalf("users=%+v", users)
	}
	if users[0].Username != "disabled-user" || users[0].Disabled || users[0].QuotaBytes != 1234 {
		t.Fatalf("ordinary user summary=%+v", users[0])
	}
	if users[0].LastLoginAt == nil || !users[0].LastLoginAt.Equal(lastLogin) {
		t.Fatalf("last login summary=%+v", users[0])
	}
	if users[1].Username != "recovery-admin" || users[1].Role != meta.UserRoleAdmin {
		t.Fatalf("admin summary=%+v", users[1])
	}

	refresh := meta.RefreshToken{
		UserID: adminUser.ID, TokenHash: "recovery-refresh-token-hash",
		ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := db.Create(&refresh).Error; err != nil {
		t.Fatal(err)
	}

	updated, err := ResetPassword(db, adminUser.Username, "new-password-123", true)
	if err != nil {
		t.Fatal(err)
	}
	if updated.SessionVersion != adminUser.SessionVersion+1 {
		t.Fatalf("session_version=%d want=%d", updated.SessionVersion, adminUser.SessionVersion+1)
	}
	if !updated.MustChangePassword {
		t.Fatal("must_change_password was not enabled")
	}
	if auth.CheckPassword(updated.PasswordHash, "new-password-123") != nil {
		t.Fatal("new password does not verify")
	}
	if auth.CheckPassword(updated.PasswordHash, "old-password") == nil {
		t.Fatal("old password still verifies")
	}

	var revoked meta.RefreshToken
	if err := db.First(&revoked, refresh.ID).Error; err != nil {
		t.Fatal(err)
	}
	if revoked.RevokedAt == nil {
		t.Fatal("refresh token was not revoked")
	}

	ordinaryRefresh := meta.RefreshToken{
		UserID: ordinary.ID, TokenHash: "ordinary-refresh-token-hash",
		ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := db.Create(&ordinaryRefresh).Error; err != nil {
		t.Fatal(err)
	}
	disabled, err := SetDisabled(db, ordinary.Username, true)
	if err != nil {
		t.Fatal(err)
	}
	if disabled.DisabledAt == nil || disabled.SessionVersion != ordinary.SessionVersion+1 {
		t.Fatalf("disabled user=%+v", disabled)
	}
	var disabledRefresh meta.RefreshToken
	if err := db.First(&disabledRefresh, ordinaryRefresh.ID).Error; err != nil {
		t.Fatal(err)
	}
	if disabledRefresh.RevokedAt == nil {
		t.Fatal("disable did not revoke refresh token")
	}

	enabled, err := SetDisabled(db, ordinary.Username, false)
	if err != nil {
		t.Fatal(err)
	}
	if enabled.DisabledAt != nil {
		t.Fatalf("enabled user still disabled: %+v", enabled)
	}
	if enabled.SessionVersion != disabled.SessionVersion {
		t.Fatalf("enable unexpectedly changed session_version=%d want=%d", enabled.SessionVersion, disabled.SessionVersion)
	}

	if _, err := SetDisabled(db, adminUser.Username, true); !errors.Is(err, ErrLastActiveAdmin) {
		t.Fatalf("last admin disable error=%v want=%v", err, ErrLastActiveAdmin)
	}
	if _, err := ResetPassword(db, "missing-user", "password-123", false); !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("missing user reset error=%v want=%v", err, ErrUserNotFound)
	}
	if _, err := SetDisabled(db, "missing-user", true); !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("missing user disable error=%v want=%v", err, ErrUserNotFound)
	}
}
