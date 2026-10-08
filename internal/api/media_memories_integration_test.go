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

func TestMediaMemoriesRecentAndOnThisDayProjectionMatchesDetailRange(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	baseSQLDB, err := baseDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer baseSQLDB.Close()

	schema := "media_memories_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()

	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.MediaMetadata{}, &meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoEditRecipe{}, &meta.PhotoMetadata{}, &meta.PhotoResource{},
		&meta.PhotoPlaceLabel{},
	); err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username:       "memories-" + uuid.NewString(),
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{
		Name: "", Type: meta.NodeTypeDir,
		OwnerID: user.ID, Revision: 1,
	}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}

	addMedia := func(name string, captured time.Time) uint64 {
		t.Helper()
		node := meta.Node{
			ParentID: &root.ID,
			Name:     name,
			Type:     meta.NodeTypeFile,
			OwnerID:  user.ID,
			Revision: 1,
		}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		file := meta.File{
			NodeID:     node.ID,
			Size:       100,
			StorageKey: "memory-" + name,
			SHA256:     fmt.Sprintf("%064x", node.ID),
		}
		if err := db.Create(&file).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.MediaMetadata{
			NodeID:       node.ID,
			OwnerID:      user.ID,
			NodeRevision: node.Revision,
			SHA256:       file.SHA256,
			MediaKind:    meta.MediaKindImage,
			MIMEType:     "image/jpeg",
			CapturedAt:   &captured,
			IndexState:   meta.MediaIndexStateReady,
		}).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{
			OwnerID:       user.ID,
			PrimaryNodeID: node.ID,
			Kind:          meta.PhotoAssetKindImage,
			EvidenceKey:   "memory:" + name,
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoMetadata{
			AssetID:    asset.ID,
			MediaKind:  meta.MediaKindImage,
			MIMEType:   "image/jpeg",
			CapturedAt: &captured,
		}).Error; err != nil {
			t.Fatal(err)
		}
		return node.ID
	}

	anchor := time.Date(2026, time.October, 7, 0, 0, 0, 0, time.UTC)
	todayA := addMedia("today-a.jpg", anchor.Add(10*time.Hour))
	todayB := addMedia("today-b.jpg", anchor.Add(11*time.Hour))
	_ = addMedia("last-year.jpg", time.Date(2025, time.October, 7, 12, 0, 0, 0, time.UTC))
	_ = addMedia("two-years.jpg", time.Date(2024, time.October, 7, 13, 0, 0, 0, time.UTC))
	_ = addMedia("other-day.jpg", time.Date(2025, time.October, 8, 12, 0, 0, 0, time.UTC))

	memories, err := queryMediaMemories(
		context.Background(),
		db,
		user.ID,
		anchor,
		24,
	)
	if err != nil {
		t.Fatal(err)
	}
	byKind := make(map[string]mediaMemoryDTO)
	for _, memory := range memories {
		if _, exists := byKind[memory.Kind]; !exists {
			byKind[memory.Kind] = memory
		}
	}
	recent, ok := byKind[mediaMemoryKindRecentDay]
	if !ok || recent.ItemCount != 2 || recent.ID != "recent:2026-10-07" {
		t.Fatalf("recent memory=%+v all=%+v", recent, memories)
	}
	onThisDay, ok := byKind[mediaMemoryKindOnThisDay]
	if !ok ||
		onThisDay.ItemCount != 2 ||
		onThisDay.YearCount != 2 ||
		onThisDay.ID != "on-this-day:2026:10-07" {
		t.Fatalf("on-this-day memory=%+v all=%+v", onThisDay, memories)
	}

	server := &Server{DB: db}
	recentSpec, ok := parseMediaMemoryID(recent.ID)
	if !ok {
		t.Fatal("recent memory id did not parse")
	}
	recentRange, err := server.queryMediaMemoryItemRange(
		context.Background(),
		user.ID,
		recentSpec,
		100,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if recentRange.TotalCount != recent.ItemCount ||
		len(recentRange.Items) != 2 {
		t.Fatalf("recent range=%+v memory=%+v", recentRange, recent)
	}
	recentIDs := map[uint64]bool{}
	for _, item := range recentRange.Items {
		recentIDs[item.Node.ID] = true
	}
	if !recentIDs[todayA] || !recentIDs[todayB] {
		t.Fatalf("recent ids=%v want %d,%d", recentIDs, todayA, todayB)
	}

	onThisDaySpec, ok := parseMediaMemoryID(onThisDay.ID)
	if !ok {
		t.Fatal("on-this-day memory id did not parse")
	}
	historyRange, err := server.queryMediaMemoryItemRange(
		context.Background(),
		user.ID,
		onThisDaySpec,
		100,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if historyRange.TotalCount != onThisDay.ItemCount ||
		len(historyRange.Items) != 2 {
		t.Fatalf("history range=%+v memory=%+v", historyRange, onThisDay)
	}
}
