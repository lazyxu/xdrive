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

func TestPhotoEditRecipePresentationFollowsSourceFingerprint(t *testing.T) {
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

	schema := "photo_edit_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		&meta.PhotoAsset{}, &meta.PhotoMetadata{},
		&meta.PhotoResource{}, &meta.PhotoEditRecipe{},
	); err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username:       "edit-" + uuid.NewString(),
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	node := meta.Node{
		ParentID: &root.ID,
		Name:     "photo.jpg",
		Type:     meta.NodeTypeFile,
		OwnerID:  user.ID,
		Revision: 3,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	sha := strings.Repeat("a", 64)
	if err := db.Create(&meta.File{
		NodeID:     node.ID,
		Size:       123,
		StorageKey: "edit-photo",
		SHA256:     sha,
	}).Error; err != nil {
		t.Fatal(err)
	}
	asset := meta.PhotoAsset{
		OwnerID:       user.ID,
		PrimaryNodeID: node.ID,
		Kind:          meta.PhotoAssetKindImage,
		EvidenceKey:   "node:" + fmt.Sprint(node.ID),
	}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoMetadata{
		AssetID:   asset.ID,
		MediaKind: meta.MediaKindImage,
		MIMEType:  "image/jpeg",
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoResource{
		AssetID:      asset.ID,
		ResourceKind: meta.PhotoResourceKindNode,
		NodeID:       node.ID,
		Role:         meta.PhotoResourceRolePrimary,
		Name:         node.Name,
		MediaKind:    meta.MediaKindImage,
		MIMEType:     "image/jpeg",
		Size:         123,
		SHA256:       sha,
	}).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	recipe := meta.PhotoEditRecipe{
		AssetID:            asset.ID,
		OwnerID:            user.ID,
		Revision:           1,
		SourceNodeID:       node.ID,
		SourceNodeRevision: node.Revision,
		SourceSHA256:       sha,
		RotationDegrees:    90,
		CropWidth:          1,
		CropHeight:         1,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	if err := db.Create(&recipe).Error; err != nil {
		t.Fatal(err)
	}

	server := &Server{DB: db}
	presentation, err := server.photoAssetPresentation(
		context.Background(),
		user.ID,
		node.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if presentation.EditRecipe == nil ||
		presentation.EditRecipe.Revision != 1 ||
		presentation.EditRecipe.RotationDegrees != 90 ||
		!presentation.EditRecipe.SourceCurrent {
		t.Fatalf("presentation=%+v", presentation)
	}

	if err := db.Model(&meta.Node{}).
		Where("id = ?", node.ID).
		Update("revision", node.Revision+1).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.File{}).
		Where("node_id = ?", node.ID).
		Update("sha256", strings.Repeat("b", 64)).Error; err != nil {
		t.Fatal(err)
	}
	presentation, err = server.photoAssetPresentation(
		context.Background(),
		user.ID,
		node.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if presentation.EditRecipe != nil {
		t.Fatalf("stale recipe leaked into presentation: %+v", presentation.EditRecipe)
	}
}
