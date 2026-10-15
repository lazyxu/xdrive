package api

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceaccount"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPhotoHostAdmissionFenceFailsClosedWithoutDB(t *testing.T) {
	if _, accepted, err := tryAcquirePhotoHostAdmission(context.Background(), nil); err == nil || accepted {
		t.Fatal("missing DB must fail closed")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, accepted, err := tryAcquirePhotoHostAdmission(ctx, &gorm.DB{}); err == nil || accepted {
		t.Fatal("canceled admission must fail closed")
	}
	if err := (&photoHostAdmissionLease{}).Heartbeat(context.Background()); err == nil {
		t.Fatal("closed lease heartbeat must fail")
	}
	(&photoHostAdmissionLease{}).Close()
	if (meta.PhotoHostAdmissionGate{}).TableName() != "xd_photo_host_admission_gates" {
		t.Fatal("unexpected fixed admission table")
	}
}

func TestPhotoHostAdmissionSharedLockAndFrozenRevisionPostgres(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL not configured")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "photo_host_admission_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}

	// Old Server without migration is NOT a default-open allow decision.
	if lease, ok, err := tryAcquirePhotoHostAdmission(context.Background(), db); err == nil || ok {
		if lease != nil {
			lease.Close()
		}
		t.Fatal("missing admission table must fail closed")
	}
	if err := db.AutoMigrate(&meta.PhotoHostAdmissionGate{}); err != nil {
		t.Fatal(err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	// One connection must be enough for the lock AND the row check.
	// Reading on another pooled connection while holding the lock would hang.
	sqlDB.SetMaxOpenConns(1)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	first, ok, err := tryAcquirePhotoHostAdmission(ctx, db)
	cancel()
	if err != nil || !ok || first == nil {
		t.Fatalf("empty migrated admission gate rejected default work: accepted=%v err=%v", ok, err)
	}
	if err := first.Heartbeat(context.Background()); err != nil {
		t.Fatal(err)
	}
	first.Close()
	if err := first.Heartbeat(context.Background()); err == nil {
		t.Fatal("closed admission lease still alive")
	}

	sqlDB.SetMaxOpenConns(6)
	one, ok, err := tryAcquirePhotoHostAdmission(context.Background(), db)
	if err != nil || !ok {
		t.Fatalf("first shared lock unavailable: %v", err)
	}
	t.Cleanup(one.Close)
	two, ok, err := tryAcquirePhotoHostAdmission(context.Background(), db)
	if err != nil || !ok {
		t.Fatalf("second concurrent model read lock unavailable: %v", err)
	}
	t.Cleanup(two.Close)

	// Future authenticated maintenance writer must use this EXACT exclusive
	// key. It cannot obtain the writer lock while ANY job lease is held.
	exclusive, acquired, err := sourceaccount.TryAcquire(context.Background(), db, photoHostAdmissionLockName)
	if err != nil || acquired {
		if exclusive != nil {
			exclusive.Close()
		}
		t.Fatalf("maintenance writer overtook active photo job: %v / %v", acquired, err)
	}
	one.Close()
	exclusive, acquired, err = sourceaccount.TryAcquire(context.Background(), db, photoHostAdmissionLockName)
	if err != nil || acquired {
		if exclusive != nil {
			exclusive.Close()
		}
		t.Fatalf("maintenance writer ignored the second shared lease: %v / %v", acquired, err)
	}
	two.Close()
	exclusive, acquired, err = sourceaccount.TryAcquire(context.Background(), db, photoHostAdmissionLockName)
	if err != nil || !acquired {
		t.Fatalf("writer cannot acquire after all leases release: %v / %v", acquired, err)
	}

	// An exclusive maintenance writer blocks new readers. The row is
	// hypothetical in this phase; no API or Host action can write it.
	reader, admitted, err := tryAcquirePhotoHostAdmission(context.Background(), db)
	if reader != nil {
		reader.Close()
	}
	if err != nil || admitted {
		exclusive.Close()
		t.Fatalf("new task overtook exclusive maintenance lock: %v / %v", admitted, err)
	}
	exclusive.Close()

	// Write fixture rows directly: there is NO public/admin freeze writer yet.
	if err := db.Create(&meta.PhotoHostAdmissionGate{
		Name: photoHostAdmissionSettingName, Revision: 1, Frozen: true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	lease, admitted, err := tryAcquirePhotoHostAdmission(context.Background(), db)
	if lease != nil {
		lease.Close()
	}
	if err != nil || admitted {
		t.Fatalf("frozen gate admitted new task: %v / %v", admitted, err)
	}
	if err := db.Model(&meta.PhotoHostAdmissionGate{}).
		Where("name = ?", photoHostAdmissionSettingName).
		Updates(map[string]any{"revision": 2, "frozen": false}).Error; err != nil {
		t.Fatal(err)
	}
	lease, admitted, err = tryAcquirePhotoHostAdmission(context.Background(), db)
	if err != nil || !admitted || lease == nil {
		t.Fatalf("unfrozen revision rejected work: %v / %v", admitted, err)
	}
	lease.Close()
	if err := db.Model(&meta.PhotoHostAdmissionGate{}).
		Where("name = ?", photoHostAdmissionSettingName).
		Update("revision", 0).Error; err != nil {
		t.Fatal(err)
	}
	lease, admitted, err = tryAcquirePhotoHostAdmission(context.Background(), db)
	if lease != nil {
		lease.Close()
	}
	if err == nil || admitted || !strings.Contains(err.Error(), "invalid photo host admission revision") {
		t.Fatalf("invalid persistent revision was accepted: %v / %v", admitted, err)
	}
	if err := db.Migrator().DropTable(&meta.PhotoHostAdmissionGate{}); err != nil {
		t.Fatal(err)
	}
	lease, admitted, err = tryAcquirePhotoHostAdmission(context.Background(), db)
	if lease != nil {
		lease.Close()
	}
	if err == nil || admitted {
		t.Fatal("deleted gate table incorrectly granted photo work")
	}
}

func TestPhotoHostAdmissionLeaseReleaseIsIdempotent(t *testing.T) {
	var lease *photoHostAdmissionLease
	lease.Close()
	if err := lease.Heartbeat(context.Background()); err == nil {
		t.Fatal("nil lease heartbeat accepted")
	}
}
