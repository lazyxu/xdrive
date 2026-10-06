package api

import (
	"context"
	"os"
	"testing"

	"github.com/lazyxu/xdrive/internal/background"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBackgroundOwnerLeaseProviderCoordinatesServers(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(8)
	sqlDB.SetMaxIdleConns(2)
	t.Cleanup(func() { _ = sqlDB.Close() })

	serverA := &Server{DB: db}
	serverB := &Server{DB: db}
	ctx := context.Background()
	descriptor := background.Descriptor{
		Scope:   background.ScopeUser,
		OwnerID: 42,
	}

	providerA := serverA.backgroundOwnerLeaseProvider("media.index", 0)
	providerB := serverB.backgroundOwnerLeaseProvider("media.index", 0)
	leaseA, acquired, err := providerA(ctx, descriptor)
	if err != nil {
		t.Fatal(err)
	}
	if !acquired {
		t.Fatal("first Server did not acquire owner lease")
	}
	if leaseA.Heartbeat == nil {
		t.Fatal("distributed owner lease did not expose heartbeat")
	}
	if err := leaseA.Heartbeat(ctx); err != nil {
		t.Fatalf("owner lease heartbeat: %v", err)
	}

	if leaseB, acquired, err := providerB(ctx, descriptor); err != nil {
		t.Fatal(err)
	} else if acquired {
		if leaseB.Release != nil {
			_ = leaseB.Release(context.Background(), nil)
		}
		t.Fatal("second Server acquired the same owner/kind lease")
	}

	otherOwner := descriptor
	otherOwner.OwnerID = 43
	leaseOther, acquired, err := providerB(ctx, otherOwner)
	if err != nil {
		t.Fatal(err)
	}
	if !acquired {
		t.Fatal("different owner was incorrectly serialized")
	}
	if leaseOther.Release != nil {
		_ = leaseOther.Release(context.Background(), nil)
	}

	photoProvider := serverB.backgroundOwnerLeaseProvider("photo.face", 0)
	photoLease, acquired, err := photoProvider(ctx, descriptor)
	if err != nil {
		t.Fatal(err)
	}
	if !acquired {
		t.Fatal("different owner task kind was incorrectly serialized")
	}
	if photoLease.Release != nil {
		_ = photoLease.Release(context.Background(), nil)
	}

	if leaseA.Release == nil {
		t.Fatal("distributed owner lease did not expose release")
	}
	if err := leaseA.Release(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	leaseA.Release = nil

	leaseB, acquired, err := providerB(ctx, descriptor)
	if err != nil {
		t.Fatal(err)
	}
	if !acquired {
		t.Fatal("owner lease was not reusable after release")
	}
	if leaseB.Release != nil {
		_ = leaseB.Release(context.Background(), nil)
	}
}
