package sourceaccount

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestAccountAdvisoryLockCoordinatesConnections(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	key := "source-account-test:" + uuid.NewString()

	first, err := Acquire(ctx, db, key)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()

	if second, acquired, err := TryAcquire(ctx, db, key); err != nil {
		t.Fatal(err)
	} else if acquired || second != nil {
		if second != nil {
			second.Close()
		}
		t.Fatal("same account lock was acquired concurrently")
	}

	other, acquired, err := TryAcquire(ctx, db, key+":other")
	if err != nil || !acquired || other == nil {
		t.Fatalf("different account lock acquired=%t lease=%v err=%v", acquired, other, err)
	}
	other.Close()

	first.Close()
	third, acquired, err := TryAcquire(ctx, db, key)
	if err != nil || !acquired || third == nil {
		t.Fatalf("released account lock acquired=%t lease=%v err=%v", acquired, third, err)
	}
	third.Close()
}

func TestLockIDIsStableAndAccountScoped(t *testing.T) {
	if lockID(" account-a ") != lockID("account-a") {
		t.Fatal("lock id did not normalize surrounding whitespace")
	}
	if lockID("account-a") == lockID("account-b") {
		t.Fatal("different account keys collided in deterministic test")
	}
}
