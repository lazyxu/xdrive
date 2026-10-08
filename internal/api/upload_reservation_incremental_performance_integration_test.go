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
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

func TestUploadChunkReservationUsesIncrementalBookkeeping(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}

	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, err := baseDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	baseSQL.SetMaxOpenConns(2)
	baseSQL.SetMaxIdleConns(0)
	t.Cleanup(func() { _ = baseSQL.Close() })

	schema := "upload_reservation_incremental_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	})

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()

	capture := &fileOperationSQLCapture{Interface: logger.Discard}
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: capture})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(2)
	sqlDB.SetMaxIdleConns(0)
	t.Cleanup(func() { _ = sqlDB.Close() })

	if err := db.AutoMigrate(&meta.User{}, &meta.UploadSession{}, &meta.UploadPart{}); err != nil {
		t.Fatal(err)
	}
	user := meta.User{
		Username:       "upload-reservation-owner",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}

	const chunkCount = 128
	session := meta.UploadSession{
		ID:            uuid.NewString(),
		OwnerID:       user.ID,
		TotalSize:     chunkCount,
		ChunkSize:     1,
		ChunkCount:    chunkCount,
		Status:        meta.UploadStatusActive,
		ReservedBytes: chunkCount * 2,
		ExpiresAt:     time.Now().Add(time.Hour),
	}
	if err := db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}

	server := &Server{DB: db}
	capture.reset()
	for index := 0; index < chunkCount; index++ {
		err := db.WithContext(context.Background()).Transaction(func(tx *gorm.DB) error {
			var current meta.UploadSession
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ? AND owner_id = ?", session.ID, user.ID).
				First(&current).Error; err != nil {
				return err
			}
			if err := tx.Create(&meta.UploadPart{
				SessionID:  session.ID,
				PartIndex:  index,
				Size:       1,
				SHA256:     fmt.Sprintf("%064x", index+1),
				StorageKey: fmt.Sprintf(".xdrive-uploads/test/%03d", index),
			}).Error; err != nil {
				return err
			}
			return server.adjustUploadReservationForPart(tx, current, 0, 1)
		})
		if err != nil {
			t.Fatal(err)
		}
	}

	var final meta.UploadSession
	if err := db.First(&final, "id = ?", session.ID).Error; err != nil {
		t.Fatal(err)
	}
	if final.ReservedBytes != chunkCount {
		t.Fatalf("final reserved bytes=%d want=%d", final.ReservedBytes, chunkCount)
	}

	fullPartScans := 0
	reservationUpdates := 0
	for _, statement := range capture.snapshot() {
		lower := strings.ToLower(statement)
		if strings.Contains(lower, "from \"xd_upload_parts\"") &&
			strings.Contains(lower, "session_id") &&
			!strings.Contains(lower, "part_index") {
			fullPartScans++
		}
		if strings.Contains(lower, "update \"xd_upload_sessions\"") &&
			strings.Contains(lower, "reserved_bytes") {
			reservationUpdates++
		}
	}
	if fullPartScans != 0 {
		t.Fatalf("full upload-part reservation scans=%d want=0", fullPartScans)
	}
	if reservationUpdates != chunkCount {
		t.Fatalf("reservation updates=%d want=%d", reservationUpdates, chunkCount)
	}

	capture.reset()
	if err := db.Transaction(func(tx *gorm.DB) error {
		var current meta.UploadSession
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", session.ID, user.ID).
			First(&current).Error; err != nil {
			return err
		}
		return server.adjustUploadReservationForPart(tx, current, 1, 1)
	}); err != nil {
		t.Fatal(err)
	}
	for _, statement := range capture.snapshot() {
		if strings.Contains(strings.ToLower(statement), "reserved_bytes") &&
			strings.Contains(strings.ToLower(statement), "update") {
			t.Fatalf("same-size part replacement unexpectedly updated reservation: %s", statement)
		}
	}
}
