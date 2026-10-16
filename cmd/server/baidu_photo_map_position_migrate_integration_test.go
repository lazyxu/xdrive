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

func TestMigrateCreatesEmptyOwnerScopedBaiduPhotoMapIndex(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL fixture required")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	// Do not leave idle connections in the shared Go/API race-test shard.
	// Existing unrelated upload tests also use the same 100-connection
	// PostgreSQL fixture. Our new indexed-map tests must release both pools.
	rootSQL, err := root.DB()
	if err != nil {
		t.Fatal(err)
	}
	rootSQL.SetMaxOpenConns(2)
	rootSQL.SetMaxIdleConns(0)
	defer rootSQL.Close()
	schema := "migrate_baidu_map_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	dbSQL, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	dbSQL.SetMaxOpenConns(2)
	dbSQL.SetMaxIdleConns(0)
	defer dbSQL.Close()
	for i := 0; i < 2; i++ {
		if err := migrate(db); err != nil {
			t.Fatal(err)
		}
	}
	if !db.Migrator().HasTable(&meta.BaiduPhotoMapConsent{}) {
		t.Fatal("missing private per-asset Baidu map consent table")
	}
	for _, field := range []string{"AssetID", "OwnerID", "Revision", "AllowIndex", "AllowBaiduConversion", "ExpiresAt", "RevokedAt", "SourceNodeID", "SourceNodeRevision", "SourceMediaUpdatedAt", "SourceLatitude", "SourceLongitude"} {
		if !db.Migrator().HasColumn(&meta.BaiduPhotoMapConsent{}, field) {
			t.Fatalf("missing privacy grant field %s", field)
		}
	}
	var grants int64
	if err := db.Model(&meta.BaiduPhotoMapConsent{}).Count(&grants).Error; err != nil || grants != 0 {
		t.Fatalf("migration cannot opt-in user photos: rows=%d err=%v", grants, err)
	}
	if !db.Migrator().HasTable(&meta.BaiduPhotoMapPosition{}) {
		t.Fatal("missing official derived-coordinate table")
	}
	for _, name := range []string{"AssetID", "OwnerID", "PrimaryNodeID", "NodeRevision",
		"MediaUpdatedAt", "ConsentRevision", "SourceLatitude", "SourceLongitude",
		"CoordinateSpace", "ProjectionVersion", "Latitude", "Longitude"} {
		if !db.Migrator().HasColumn(&meta.BaiduPhotoMapPosition{}, name) {
			t.Fatalf("missing source/version/privacy fence column %s", name)
		}
	}
	if !db.Migrator().HasIndex(&meta.BaiduPhotoMapPosition{}, "idx_xd_baidu_photo_positions_owner_space_lat_lon") {
		t.Fatal("missing bounded Owner/coordinate-space spatial range index")
	}
	var count int64
	if err := db.Model(&meta.BaiduPhotoMapPosition{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("migration must not export or backfill GPS: rows=%d err=%v", count, err)
	}
}
