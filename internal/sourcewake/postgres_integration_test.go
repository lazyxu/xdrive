package sourcewake

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestNotifyWakesPostgresListener(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	listener, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = listener.Close(context.Background()) }()
	if _, err := listener.Exec(ctx, "LISTEN "+PostgreSQLChannel); err != nil {
		t.Fatal(err)
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		return Notify(tx, 42)
	}); err != nil {
		t.Fatal(err)
	}

	notification, err := listener.WaitForNotification(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if notification.Channel != PostgreSQLChannel || notification.Payload != "42" {
		t.Fatalf("notification=%+v", notification)
	}
}
