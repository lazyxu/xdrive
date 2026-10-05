package maintenance

import (
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

func TestVerifySourcesLoadsAliasCollectionAndMetadataRelations(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "source_verify_rel_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()

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
		&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.Source{}, &meta.SourceItem{}, &meta.SyncRun{}, &meta.SourceItemAlias{},
		&meta.SourceCollection{}, &meta.SourceCollectionItem{},
		&meta.SourceItemMetadata{},
	); err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username: "source-verify-rel-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	sources := []meta.Source{
		{
			OwnerID: user.ID, Name: "Source A", Kind: "test_a",
			Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
			RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused, Revision: 1,
		},
		{
			OwnerID: user.ID, Name: "Source B", Kind: "test_b",
			Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
			RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused, Revision: 1,
		},
	}
	if err := db.Create(&sources).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	items := []meta.SourceItem{
		{
			SourceID: sources[0].ID, ExternalID: "a", Kind: meta.SourceItemKindFile,
			State: meta.SourceItemStatePending, LastSeenAt: now,
		},
		{
			SourceID: sources[1].ID, ExternalID: "b", Kind: meta.SourceItemKindFile,
			State: meta.SourceItemStatePending, LastSeenAt: now,
		},
	}
	if err := db.Create(&items).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.SourceItemAlias{
		SourceID: sources[0].ID, SourceItemID: items[1].ID,
		AliasExternalID: "cross", AliasKind: meta.SourceItemAliasKindExternalID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	collection := meta.SourceCollection{
		SourceID: sources[0].ID, ExternalID: "album", Kind: "album", Name: "Album",
		State: meta.SourceCollectionStateActive, LastSeenAt: now,
	}
	if err := db.Create(&collection).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.SourceCollectionItem{
		CollectionID: collection.ID, SourceItemID: items[1].ID,
		Position: 0, LastSeenRunID: uuid.NewString(), LastSeenAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.SourceItemMetadata{
		SourceItemID: items[1].ID, SourceID: sources[0].ID,
		ContentMD5: "bad-md5",
	}).Error; err != nil {
		t.Fatal(err)
	}

	report, err := VerifySources(db)
	if err != nil {
		t.Fatal(err)
	}
	reasons := map[string]bool{}
	for _, issue := range report.Issues {
		reasons[issue.Reason] = true
	}
	for _, want := range []string{
		"alias_item_source_mismatch",
		"collection_item_source_mismatch",
		"metadata_source_mismatch",
		"metadata_md5_invalid",
	} {
		if !reasons[want] {
			t.Fatalf("missing issue reason %q: %+v", want, report.Issues)
		}
	}
}
