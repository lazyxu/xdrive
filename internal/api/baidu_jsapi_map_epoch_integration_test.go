package api

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBaiduJSAPIMapEpochOwnerIsolationAndRevocation(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL fixture requires XD_TEST_DATABASE_URL")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "map_epoch_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	fixtureDSN := parsed.String()
	openDB := func() *gorm.DB {
		t.Helper()
		conn, err := gorm.Open(postgres.Open(fixtureDSN), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		return conn
	}
	db := openDB()
	if err := db.AutoMigrate(&meta.User{}, &meta.BaiduJSAPIMapEpoch{}); err != nil {
		t.Fatal(err)
	}
	alice := meta.User{Username: "map-alice", PasswordHash: "not-used", Role: meta.UserRoleUser, SessionVersion: 1}
	bob := meta.User{Username: "map-bob", PasswordHash: "not-used", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&alice).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&bob).Error; err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := loadBaiduMapEpoch(ctx, db, alice.ID); !errors.Is(err, errBaiduMapEpochUnavailable) {
		t.Fatalf("missing epoch did not fail closed: %v", err)
	}
	initial, err := ensureBaiduMapEpochTx(ctx, db, alice.ID)
	if err != nil || initial.Epoch != 1 || initial.RevokedAfter != nil {
		t.Fatalf("bad initial epoch: %#v %v", initial, err)
	}
	if _, err := ensureBaiduMapEpochTx(ctx, db, alice.ID); err != nil {
		t.Fatal(err)
	}
	if peer, err := ensureBaiduMapEpochTx(ctx, db, bob.ID); err != nil || peer.Epoch != 1 {
		t.Fatalf("wrong peer epoch: %#v %v", peer, err)
	}
	when := time.Now().UTC().Add(-2 * time.Second)
	changed, err := advanceBaiduMapEpochTx(ctx, db, alice.ID, when)
	if err != nil || changed.Epoch != 2 || changed.RevokedAfter == nil {
		t.Fatalf("revocation failed: %#v %v", changed, err)
	}
	otherDB := openDB() // An independently opened Server process sees persisted state.
	persisted, err := loadBaiduMapEpoch(ctx, otherDB, alice.ID)
	if err != nil || persisted.Epoch != 2 || persisted.RevokedAfter == nil {
		t.Fatalf("revocation was not visible across connections: %#v %v", persisted, err)
	}
	if baidumapjsapi.AccessAfterRevocation(when.Add(-time.Minute), when.Add(time.Second), persisted.RevokedAfter) {
		t.Fatal("previous access token can re-mint after map logout")
	}
	if !baidumapjsapi.AccessAfterRevocation(when.Add(time.Second), when.Add(2*time.Second), persisted.RevokedAfter) {
		t.Fatal("new access token blocked after cutoff")
	}
	peer, err := loadBaiduMapEpoch(ctx, db, bob.ID)
	if err != nil || peer.Epoch != 1 || peer.RevokedAfter != nil {
		t.Fatalf("another owner was revoked: %#v %v", peer, err)
	}
	// A clock going backwards must not roll the revocation cutoff backwards.
	next, err := advanceBaiduMapEpochTx(ctx, otherDB, alice.ID, when.Add(-time.Hour))
	if err != nil || next.Epoch != 3 || next.RevokedAfter == nil || next.RevokedAfter.Before(*persisted.RevokedAfter) {
		t.Fatalf("non-monotonic revocation: %#v %v", next, err)
	}
	disabledAt := time.Now().UTC()
	if err := db.Model(&meta.User{}).Where("id = ?", bob.ID).Update("disabled_at", disabledAt).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := ensureBaiduMapEpochTx(ctx, db, bob.ID); err == nil {
		t.Fatal("disabled account reinitialized map epoch")
	}
	if err := db.Model(&meta.User{}).Where("id = ?", bob.ID).Updates(map[string]any{
		"disabled_at": nil, "must_change_password": true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := ensureBaiduMapEpochTx(ctx, db, bob.ID); err == nil {
		t.Fatal("password-change-required account initialized map epoch")
	}
	rollback := errors.New("rollback fixture")
	if err := db.Transaction(func(tx *gorm.DB) error {
		if _, err := advanceBaiduMapEpochTx(ctx, tx, alice.ID, when.Add(time.Minute)); err != nil {
			return err
		}
		return rollback
	}); !errors.Is(err, rollback) {
		t.Fatalf("transaction not rolled back: %v", err)
	}
	check, err := loadBaiduMapEpoch(ctx, otherDB, alice.ID)
	if err != nil || check.Epoch != 3 {
		t.Fatalf("rollback leaked revocation change: %#v %v", check, err)
	}
	if _, err := advanceBaiduMapEpochTx(ctx, db, 0, when); err == nil {
		t.Fatal("zero owner was allowed to revoke")
	}
	if _, err := advanceBaiduMapEpochTx(ctx, db, bob.ID, time.Time{}); err == nil {
		t.Fatal("zero revocation time was allowed")
	}
	if _, err := advanceBaiduMapEpochTx(ctx, db, bob.ID+10000, when); err == nil {
		t.Fatal("nonexistent owner was allowed to create a map epoch")
	}
}

func TestBaiduJSAPIMapEpochRejectUnavailableDatabase(t *testing.T) {
	// Non-Postgres zero-state guards run on every Go target. Production DB
	// integration above tests active-user predicates and the PostgreSQL FK.
	ctx := context.Background()
	if _, err := ensureBaiduMapEpochTx(ctx, nil, 1); err == nil {
		t.Fatal("nil DB accepted")
	}
	if _, err := loadBaiduMapEpoch(ctx, nil, 1); err == nil {
		t.Fatal("nil DB accepted")
	}
	if _, err := advanceBaiduMapEpochTx(ctx, nil, 1, time.Now()); err == nil {
		t.Fatal("nil transaction accepted")
	}
}
