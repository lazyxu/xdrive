package api

import (
	"context"
	"errors"
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

func TestNodeLocationOwnerPathAndSourceEvidence(t *testing.T) {
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
	schema := "node_location_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := base.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = base.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
	address, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	values := address.Query()
	values.Set("search_path", schema)
	address.RawQuery = values.Encode()
	db, err := gorm.Open(postgres.Open(address.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	dbSQL, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer dbSQL.Close()
	dbSQL.SetMaxOpenConns(2)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.Source{},
		&meta.SourceItem{}, &meta.SourceItemMetadata{},
	); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{Username: "location-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	other := meta.User{Username: "location-other", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	for _, user := range []*meta.User{&owner, &other} {
		if err := db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
	}
	root := meta.Node{OwnerID: owner.ID, Name: "", Type: meta.NodeTypeDir, Revision: 1}
	syncRoot := meta.Node{OwnerID: owner.ID, Name: "Synology", Type: meta.NodeTypeDir, Revision: 1}
	albumFolder := meta.Node{OwnerID: owner.ID, Name: "2026", Type: meta.NodeTypeDir, Revision: 1}
	photo := meta.Node{OwnerID: owner.ID, Name: "sample.HEIC", Type: meta.NodeTypeFile, Revision: 2}
	for _, node := range []*meta.Node{&root, &syncRoot, &albumFolder, &photo} {
		if node == &syncRoot {
			node.ParentID = &root.ID
		}
		if node == &albumFolder {
			node.ParentID = &syncRoot.ID
		}
		if node == &photo {
			node.ParentID = &albumFolder.ID
		}
		if err := db.Create(node).Error; err != nil {
			t.Fatal(err)
		}
	}
	otherFile := meta.Node{OwnerID: other.ID, Name: "secret.jpg", Type: meta.NodeTypeFile, Revision: 1}
	if err := db.Create(&otherFile).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "NAS Backup", Kind: "synology_files",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &syncRoot.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	sourceItem := meta.SourceItem{
		SourceID: source.ID, ExternalID: "photos:42", NodeID: &photo.ID,
		Kind: meta.SourceItemKindFile, Path: "DCIM/2026/sample.HEIC",
		State: meta.SourceItemStateSynced, NodeRevision: 2,
	}
	if err := db.Create(&sourceItem).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.SourceItemMetadata{
		SourceItemID: sourceItem.ID, SourceID: source.ID, OriginalPath: "/volume1/photos/sample.HEIC",
	}).Error; err != nil {
		t.Fatal(err)
	}
	server := &Server{DB: db}
	result, err := server.queryNodeLocation(context.Background(), owner.ID, photo.ID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Path != "Synology/2026/sample.HEIC" ||
		result.ParentPath != "Synology/2026" ||
		result.ParentID == nil || *result.ParentID != albumFolder.ID ||
		result.NodeID != photo.ID || result.Revision != photo.Revision ||
		len(result.Breadcrumbs) != 3 || result.Breadcrumbs[2].ID != albumFolder.ID {
		t.Fatalf("incorrect authoritative xDrive tree path: %+v", result)
	}
	if len(result.SyncFolders) != 1 || result.SyncFolders[0].SourceID != source.ID ||
		result.SyncFolders[0].TargetNodeID != syncRoot.ID {
		t.Fatalf("synced folder membership: %+v", result.SyncFolders)
	}
	if len(result.Sources) != 1 || result.Sources[0].SourceID != source.ID ||
		result.Sources[0].SourceItemPath != "DCIM/2026/sample.HEIC" ||
		result.Sources[0].OriginalPath != "/volume1/photos/sample.HEIC" {
		t.Fatalf("connector evidence: %+v", result.Sources)
	}
	if _, err := server.queryNodeLocation(context.Background(), other.ID, photo.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("cross-user file unexpectedly visible: %v", err)
	}
	if _, err := server.queryNodeLocation(context.Background(), owner.ID, otherFile.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("cross-user file unexpectedly visible: %v", err)
	}
	if err := db.Model(&meta.Node{}).Where("id = ?", photo.ID).Update("parent_id", root.ID).Error; err != nil {
		t.Fatal(err)
	}
	moved, err := server.queryNodeLocation(context.Background(), owner.ID, photo.ID)
	if err != nil {
		t.Fatal(err)
	}
	if moved.Path != "sample.HEIC" || len(moved.SyncFolders) != 0 ||
		len(moved.Sources) != 1 || moved.Sources[0].SourceItemPath != "DCIM/2026/sample.HEIC" {
		t.Fatalf("move must change current path, not falsify historical provenance: %+v", moved)
	}
	if err := db.Model(&meta.Node{}).Where("id = ?", photo.ID).Update("deleted_at", time.Now()).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := server.queryNodeLocation(context.Background(), owner.ID, photo.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("deleted file remains locatable: %v", err)
	}
}
