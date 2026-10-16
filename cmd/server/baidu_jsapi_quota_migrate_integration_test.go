package main

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestMigrateCreatesBaiduJSAPICrossReplicaQuota(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL fixture required")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "migrate_mapquota_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := parsed.Query()
	q.Set("search_path", schema)
	parsed.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasTable(&meta.BaiduJSAPILoaderFlight{}) {
		t.Fatal("JSAPI flight table missing")
	}
	if !db.Migrator().HasTable(&meta.BaiduJSAPIQuotaBucket{}) {
		t.Fatal("JSAPI quota table missing")
	}
	if !db.Migrator().HasTable(&meta.BaiduGeoconvQuotaBucket{}) {
		t.Fatal("Server Geoconv quota table missing")
	}
	if !db.Migrator().HasTable(&meta.BaiduPhotoMapIndexIntent{}) {
		t.Fatal("private photo map index intent table missing")
	}
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&meta.BaiduJSAPIQuotaBucket{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("migration must not grant/charge quota: count=%d err=%v", count, err)
	}
	if err := db.Model(&meta.BaiduGeoconvQuotaBucket{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("Geoconv migration cannot charge or export GPS: count=%d err=%v", count, err)
	}
	if err := db.Model(&meta.BaiduPhotoMapIndexIntent{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("index intent migration must not enqueue or export coordinates: count=%d err=%v", count, err)
	}
}
