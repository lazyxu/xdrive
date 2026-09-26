package sourcecollection

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

func TestApplySnapshotUpdatesMembershipsAndMarksMissing(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "source_collections_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.Source{}, &meta.SourceItem{}, &meta.SyncRun{},
		&meta.SourceCollection{}, &meta.SourceCollectionItem{},
	); err != nil {
		t.Fatal(err)
	}

	user := meta.User{Username: "collection-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: user.ID, Name: "Yike Photos", Kind: "yike_photos",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &root.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	items := []meta.SourceItem{
		{SourceID: source.ID, ExternalID: "yike:123:1", Kind: meta.SourceItemKindFile, Path: "Library/a.jpg", State: meta.SourceItemStatePending, LastSeenAt: now},
		{SourceID: source.ID, ExternalID: "yike:123:2", Kind: meta.SourceItemKindFile, Path: "Library/b.jpg", State: meta.SourceItemStatePending, LastSeenAt: now},
		{SourceID: source.ID, ExternalID: "yike:999:3", Kind: meta.SourceItemKindFile, Path: "Shared/999/c.jpg", State: meta.SourceItemStatePending, LastSeenAt: now},
	}
	if err := db.Create(&items).Error; err != nil {
		t.Fatal(err)
	}

	run1 := meta.SyncRun{
		ID: uuid.NewString(), SourceID: source.ID, SourceRevision: 1, TargetNodeID: &root.ID,
		Mode: meta.SourceRunModeScan, Trigger: meta.SyncRunTriggerScheduled,
		Status: meta.SyncRunStatusRunning, StartedAt: now,
	}
	if err := db.Create(&run1).Error; err != nil {
		t.Fatal(err)
	}
	report, err := ApplySnapshot(context.Background(), db, source.ID, run1.ID, []Snapshot{
		{
			ExternalID: "yike:album:one", Kind: "album", Name: "One", RemoteRevision: "r1",
			Members: []MemberSnapshot{
				{ItemExternalID: "yike:123:1", Position: 0},
				{ItemExternalID: "yike:123:2", Position: 1},
			},
		},
		{
			ExternalID: "yike:album:two", Kind: "album", Name: "Two", RemoteRevision: "r1",
			Members: []MemberSnapshot{
				{ItemExternalID: "yike:999:3", Position: 0},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if report.CollectionsActive != 2 || report.CollectionsMissing != 0 || report.Memberships != 3 {
		t.Fatalf("report=%+v", report)
	}

	var collections []meta.SourceCollection
	if err := db.Where("source_id = ?", source.ID).Order("external_id ASC").Find(&collections).Error; err != nil {
		t.Fatal(err)
	}
	if len(collections) != 2 {
		t.Fatalf("collections=%d want=2", len(collections))
	}
	for _, collection := range collections {
		if collection.State != meta.SourceCollectionStateActive || collection.LastSeenRunID != run1.ID {
			t.Fatalf("unexpected collection: %+v", collection)
		}
	}

	run2 := meta.SyncRun{
		ID: uuid.NewString(), SourceID: source.ID, SourceRevision: 1, TargetNodeID: &root.ID,
		Mode: meta.SourceRunModeScan, Trigger: meta.SyncRunTriggerScheduled,
		Status: meta.SyncRunStatusRunning, StartedAt: now.Add(time.Minute),
	}
	if err := db.Create(&run2).Error; err != nil {
		t.Fatal(err)
	}
	report, err = ApplySnapshot(context.Background(), db, source.ID, run2.ID, []Snapshot{
		{
			ExternalID: "yike:album:one", Kind: "album", Name: "One renamed", RemoteRevision: "r2",
			Members: []MemberSnapshot{
				{ItemExternalID: "yike:123:2", Position: 0},
				{ItemExternalID: "yike:999:3", Position: 1},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if report.CollectionsActive != 1 || report.CollectionsMissing != 1 || report.Memberships != 2 {
		t.Fatalf("second report=%+v", report)
	}

	var one, two meta.SourceCollection
	if err := db.Where("source_id = ? AND external_id = ?", source.ID, "yike:album:one").First(&one).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("source_id = ? AND external_id = ?", source.ID, "yike:album:two").First(&two).Error; err != nil {
		t.Fatal(err)
	}
	if one.State != meta.SourceCollectionStateActive || one.Name != "One renamed" || one.RemoteRevision != "r2" {
		t.Fatalf("active collection=%+v", one)
	}
	if two.State != meta.SourceCollectionStateMissing {
		t.Fatalf("missing collection=%+v", two)
	}

	var memberships []meta.SourceCollectionItem
	if err := db.Where("collection_id = ?", one.ID).Order("position ASC").Find(&memberships).Error; err != nil {
		t.Fatal(err)
	}
	if len(memberships) != 2 || memberships[0].SourceItemID != items[1].ID || memberships[1].SourceItemID != items[2].ID {
		t.Fatalf("updated memberships=%+v", memberships)
	}
	var staleCount int64
	if err := db.Model(&meta.SourceCollectionItem{}).Where("collection_id = ?", two.ID).Count(&staleCount).Error; err != nil {
		t.Fatal(err)
	}
	if staleCount != 0 {
		t.Fatalf("missing collection retained %d memberships", staleCount)
	}
}

func TestApplySnapshotRejectsUnknownMemberWithoutChangingExistingSnapshot(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "source_collections_atomic_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()

	u, _ := url.Parse(dsn)
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.Source{}, &meta.SourceItem{}, &meta.SyncRun{},
		&meta.SourceCollection{}, &meta.SourceCollectionItem{},
	); err != nil {
		t.Fatal(err)
	}

	user := meta.User{Username: "atomic-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: user.ID, Name: "Source", Kind: "test_connector",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusActive, Revision: 1,
		TargetNodeID: &root.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	run := meta.SyncRun{
		ID: uuid.NewString(), SourceID: source.ID, SourceRevision: 1, TargetNodeID: &root.ID,
		Mode: meta.SourceRunModeScan, Trigger: meta.SyncRunTriggerManual,
		Status: meta.SyncRunStatusRunning, StartedAt: time.Now().UTC(),
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := ApplySnapshot(context.Background(), db, source.ID, run.ID, []Snapshot{{
		ExternalID: "album:bad", Kind: "album", Name: "Bad",
		Members: []MemberSnapshot{{ItemExternalID: "missing-item", Position: 0}},
	}}); err == nil {
		t.Fatal("unknown member was accepted")
	}
	var count int64
	if err := db.Model(&meta.SourceCollection{}).Where("source_id = ?", source.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("failed snapshot persisted %d collections", count)
	}
}
