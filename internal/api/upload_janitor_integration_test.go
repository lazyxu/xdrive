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
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestExpiredUploadCleanupDrainsMultipleBatches(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "expired_upload_cleanup_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	}()

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
	if err := db.AutoMigrate(&meta.User{}, &meta.UploadSession{}, &meta.UploadPart{}); err != nil {
		t.Fatal(err)
	}
	user := meta.User{Username: "janitor-user", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}

	expires := time.Now().Add(-time.Hour)
	sessions := make([]meta.UploadSession, 0, expiredUploadCleanupBatchSize*2+17)
	for i := 0; i < expiredUploadCleanupBatchSize*2+17; i++ {
		sessions = append(sessions, meta.UploadSession{
			ID: uuid.NewString(), OwnerID: user.ID,
			TotalSize: 1, ChunkSize: 1, ChunkCount: 1,
			Status: meta.UploadStatusActive, ReservedBytes: 2, QuotaReservedBytes: 1,
			ExpiresAt: expires.Add(time.Duration(i) * time.Millisecond),
		})
	}
	if err := db.CreateInBatches(&sessions, 100).Error; err != nil {
		t.Fatal(err)
	}

	server := &Server{DB: db}
	if err := server.cleanupExpiredUploads(context.Background(), 0); err != nil {
		t.Fatal(err)
	}
	var remaining int64
	if err := db.Model(&meta.UploadSession{}).Count(&remaining).Error; err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatalf("expired sessions remaining=%d want=0", remaining)
	}
}
