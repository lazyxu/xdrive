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
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceaccount"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func photoHostAdmissionWorkloadTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL not configured")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "photo_host_tasks_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error })
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
	if err := db.AutoMigrate(&meta.PhotoHostAdmissionGate{}); err != nil {
		t.Fatal(err)
	}
	// Only the cancellation epoch columns required by the production lease
	// are needed; no User/Source table or customer data is created.
	if err := db.Exec(`CREATE TABLE xd_background_owner_cancellations (
		owner_id bigint NOT NULL, kind varchar(64) NOT NULL,
		requested_epoch bigint NOT NULL DEFAULT 0,
		applied_epoch bigint NOT NULL DEFAULT 0,
		initiator varchar(16) NOT NULL DEFAULT '',
		initiator_id bigint NOT NULL DEFAULT 0,
		requested_at timestamptz NOT NULL DEFAULT now(),
		applied_at timestamptz,
		created_at timestamptz NOT NULL DEFAULT now(),
		updated_at timestamptz NOT NULL DEFAULT now(),
		PRIMARY KEY (owner_id, kind)
	)`).Error; err != nil {
		t.Fatal(err)
	}
	return db
}

func TestPhotoHostOwnerAdmissionOneSessionAndCancellationPostgres(t *testing.T) {
	db := photoHostAdmissionWorkloadTestDB(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	server := &Server{DB: db}
	desc := background.Descriptor{Scope: background.ScopeUser, OwnerID: 42}
	provider := server.photoHostOwnerAdmissionLeaseProvider("photo.face", 0)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	lease, acquired, err := provider(ctx, desc)
	if err != nil || !acquired || lease.Heartbeat == nil || lease.Release == nil {
		t.Fatalf("one-connection photo owner admission failed: accepted=%v err=%v", acquired, err)
	}
	// Even the cancellation epoch and heartbeat can run with exactly one
	// pooled DB connection while BOTH global/shared and task/exclusive locks live.
	if err := lease.Heartbeat(ctx); err != nil {
		t.Fatal(err)
	}
	if err := lease.Release(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if err := lease.Release(context.Background(), nil); err != nil {
		t.Fatal(err)
	}

	sqlDB.SetMaxOpenConns(5)
	lease, acquired, err = provider(context.Background(), desc)
	if err != nil || !acquired {
		t.Fatalf("reacquire photo owner lease: %v / %v", acquired, err)
	}
	if err := db.Exec("INSERT INTO xd_background_owner_cancellations (owner_id, kind, requested_epoch) VALUES (?, ?, ?)", 42, "photo.face", 1).Error; err != nil {
		t.Fatal(err)
	}
	if err := lease.Heartbeat(context.Background()); !errors.Is(err, context.Canceled) {
		t.Fatalf("owner cancellation must interrupt task heartbeat, got %v", err)
	}
	_ = lease.Release(context.Background(), context.Canceled)
	if again, ok, err := provider(context.Background(), desc); !errors.Is(err, context.Canceled) || ok {
		if again.Release != nil {
			_ = again.Release(context.Background(), nil)
		}
		t.Fatalf("old cancel epoch admitted new task: %v / %v", ok, err)
	}
}

func TestPhotoHostTwoWorkersShareBarrierWithoutPoolMultiplicationPostgres(t *testing.T) {
	db := photoHostAdmissionWorkloadTestDB(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(5)
	serverA := &Server{DB: db}
	serverB := &Server{DB: db}
	pFace := serverA.photoHostOwnerAdmissionLeaseProvider("photo.face", 0)
	pSmart := serverB.photoHostOwnerAdmissionLeaseProvider("photo.smart_search", 0)
	a, ok, err := pFace(context.Background(), background.Descriptor{Scope: background.ScopeUser, OwnerID: 100})
	if err != nil || !ok {
		t.Fatalf("first Photo task rejected: %v / %v", ok, err)
	}
	defer func() { _ = a.Release(context.Background(), nil) }()
	b, ok, err := pSmart(context.Background(), background.Descriptor{Scope: background.ScopeUser, OwnerID: 101})
	if err != nil || !ok {
		t.Fatalf("second Photo task rejected: %v / %v", ok, err)
	}
	defer func() { _ = b.Release(context.Background(), nil) }()
	writer, acquired, err := sourceaccount.TryAcquire(context.Background(), db, photoHostAdmissionLockName)
	if err != nil || acquired {
		if writer != nil {
			writer.Close()
		}
		t.Fatalf("global exclusive writer overtook active Photo tasks: %v / %v", acquired, err)
	}
	// A competing task with the exact same existing owner lock must defer.
	competing, admitted, err := serverB.photoHostOwnerAdmissionLeaseProvider("photo.face", 0)(
		context.Background(), background.Descriptor{Scope: background.ScopeUser, OwnerID: 100})
	if competing.Release != nil {
		_ = competing.Release(context.Background(), nil)
	}
	if err != nil || admitted {
		t.Fatalf("duplicate owner task overtook held lock: %v / %v", admitted, err)
	}
	_ = a.Release(context.Background(), nil)
	_ = b.Release(context.Background(), nil)
	writer, acquired, err = sourceaccount.TryAcquire(context.Background(), db, photoHostAdmissionLockName)
	if err != nil || !acquired {
		t.Fatalf("writer cannot freeze after all tasks released: %v / %v", acquired, err)
	}
	creative := serverA.photoHostCreativeAdmissionLeaseProvider("creative:gen-1")
	c, permitted, err := creative(context.Background(), background.Descriptor{Scope: background.ScopeUser, OwnerID: 100})
	if c.Release != nil {
		_ = c.Release(context.Background(), nil)
	}
	if err != nil || permitted {
		writer.Close()
		t.Fatalf("Creative overtook exclusive maintenance: %v / %v", permitted, err)
	}
	writer.Close()

	if err := db.Create(&meta.PhotoHostAdmissionGate{
		Name: photoHostAdmissionSettingName, Revision: 1, Frozen: true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	c, permitted, err = creative(context.Background(), background.Descriptor{Scope: background.ScopeUser, OwnerID: 100})
	if c.Release != nil {
		_ = c.Release(context.Background(), nil)
	}
	if err != nil || permitted {
		t.Fatalf("frozen gate admitted Creative generation: %v / %v", permitted, err)
	}
	if err := db.Model(&meta.PhotoHostAdmissionGate{}).Where("name = ?", photoHostAdmissionSettingName).
		Updates(map[string]any{"revision": 2, "frozen": false}).Error; err != nil {
		t.Fatal(err)
	}
	c, permitted, err = creative(context.Background(), background.Descriptor{Scope: background.ScopeUser, OwnerID: 100})
	if err != nil || !permitted || c.Heartbeat == nil {
		t.Fatalf("unfrozen Creative task rejected: %v / %v", permitted, err)
	}
	if err := c.Heartbeat(context.Background()); err != nil {
		t.Fatal(err)
	}
	_ = c.Release(context.Background(), nil)
}
