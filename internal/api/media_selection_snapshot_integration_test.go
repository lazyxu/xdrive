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

func TestMediaSelectionPostgresFreezesOnlyOwnerMatchedDay(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	base, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, err := base.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer baseSQL.Close()
	schema := "media_selection_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := base.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = base.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	dsnURL, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	values := dsnURL.Query()
	values.Set("search_path", schema)
	dsnURL.RawQuery = values.Encode()
	db, err := gorm.Open(postgres.Open(dsnURL.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	dbSQL, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer dbSQL.Close()
	dbSQL.SetMaxOpenConns(2)
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.MediaMetadata{}, &meta.PhotoAsset{}, &meta.PhotoMetadata{}); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{Username: "selection-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	other := meta.User{Username: "selection-other", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	for _, account := range []*meta.User{&owner, &other} {
		if err := db.Create(account).Error; err != nil {
			t.Fatal(err)
		}
	}
	root := meta.Node{OwnerID: owner.ID, Name: "", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	dayCaptured := time.Date(2026, time.March, 8, 8, 30, 0, 0, time.UTC)
	otherCaptured := time.Date(2026, time.March, 9, 8, 30, 0, 0, time.UTC)
	files := []meta.Node{
		{OwnerID: owner.ID, ParentID: &root.ID, Name: "selected.jpg", Type: meta.NodeTypeFile, Revision: 2},
		{OwnerID: owner.ID, ParentID: &root.ID, Name: "outside-day.jpg", Type: meta.NodeTypeFile, Revision: 1},
		{OwnerID: other.ID, Name: "other-user.jpg", Type: meta.NodeTypeFile, Revision: 1},
	}
	if err := db.Create(&files).Error; err != nil {
		t.Fatal(err)
	}
	for i := range files {
		date := &dayCaptured
		if i == 1 {
			date = &otherCaptured
		}
		mm := meta.MediaMetadata{
			NodeID: files[i].ID, OwnerID: files[i].OwnerID, NodeRevision: files[i].Revision,
			MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			CapturedAt: date, IndexState: meta.MediaIndexStateReady,
		}
		if err := db.Create(&mm).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{
			OwnerID: files[i].OwnerID, PrimaryNodeID: files[i].ID,
			Kind: meta.PhotoAssetKindImage, EvidenceKey: fmt.Sprintf("selection:%d", i),
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoMetadata{AssetID: asset.ID, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	server := &Server{DB: db}
	options := mediaQueryOptions{TimeZone: "America/New_York", SortBy: "captured"}
	q, err := server.mediaItemsBaseQuery(context.Background(), owner.ID, options, "")
	if err != nil {
		t.Fatal(err)
	}
	start, end, err := mediaSelectionDayBounds(options, "2026-03-08")
	if err != nil {
		t.Fatal(err)
	}
	var rows []mediaSelectionNode
	if err := q.Where("xd_media_metadata.captured_at >= ? AND xd_media_metadata.captured_at < ?", start, end).
		Select("n.id AS id, n.revision AS revision").Order("n.id ASC").Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].ID != files[0].ID || rows[0].Revision != 2 {
		t.Fatalf("owner-scoped frozen-day identities=%+v", rows)
	}
	q2, err := server.mediaItemsBaseQuery(context.Background(), other.ID, options, "")
	if err != nil {
		t.Fatal(err)
	}
	rows = nil
	if err := q2.Select("n.id AS id, n.revision AS revision").Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].ID != files[2].ID {
		t.Fatalf("cross-owner result leaked: %+v", rows)
	}
}
