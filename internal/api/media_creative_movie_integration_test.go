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

func TestValidateMediaCreativeSourcesTxFencesEveryMultiImageSource(t *testing.T) {
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

	schema := "media_creative_movie_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}); err != nil {
		t.Fatal(err)
	}
	user := meta.User{
		Username:       "movie-" + uuid.NewString(),
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{
		Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1,
	}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}

	add := func(name, hash string) meta.Node {
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
		if err := db.Create(&meta.File{
			NodeID:     node.ID,
			Size:       100,
			StorageKey: "cas/" + hash,
			SHA256:     hash,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Preload("File").First(&node, node.ID).Error; err != nil {
			t.Fatal(err)
		}
		return node
	}

	first := add("first.jpg", strings.Repeat("a", 64))
	second := add("second.jpg", strings.Repeat("b", 64))
	music := add("track.mp3", strings.Repeat("d", 64))
	server := &Server{DB: db}
	resolvedMusic, err := server.resolveMediaCreativeMusicSource(
		context.Background(),
		user.ID,
		music.ID,
	)
	if err != nil ||
		resolvedMusic == nil ||
		resolvedMusic.NodeID != music.ID ||
		resolvedMusic.NodeRevision != music.Revision ||
		resolvedMusic.SHA256 != music.File.SHA256 {
		t.Fatalf("resolved movie music=%+v err=%v", resolvedMusic, err)
	}
	if _, err := server.resolveMediaCreativeMusicSource(
		context.Background(),
		user.ID,
		second.ID,
	); err == nil {
		t.Fatal("image file was accepted as movie music")
	}
	generation := meta.PhotoCreativeGeneration{
		ID:                 "movie-test",
		Kind:               meta.PhotoCreativeKindMovie,
		OwnerID:            user.ID,
		SourceAssetID:      101,
		SourceNodeID:       first.ID,
		SourceNodeRevision: first.Revision,
		SourceSHA256:       first.File.SHA256,
		State:              meta.PhotoCreativeStateRunning,
		CreatedAt:          time.Now().UTC(),
		UpdatedAt:          time.Now().UTC(),
	}
	recipe := mediaCreativeRecipe{
		MovieSources: []mediaCreativeMovieSource{
			{
				AssetID:      101,
				NodeID:       first.ID,
				NodeRevision: first.Revision,
				SHA256:       first.File.SHA256,
			},
			{
				AssetID:      102,
				NodeID:       second.ID,
				NodeRevision: second.Revision,
				SHA256:       second.File.SHA256,
			},
		},
		MusicSource: &mediaCreativeMusicSource{
			NodeID:       music.ID,
			NodeRevision: music.Revision,
			SHA256:       music.File.SHA256,
		},
		FrameDurationMS: 2000,
		TransitionMS:    350,
	}

	if err := db.Transaction(func(tx *gorm.DB) error {
		return validateMediaCreativeSourcesTx(tx, generation, recipe)
	}); err != nil {
		t.Fatalf("current movie sources were rejected: %v", err)
	}

	if err := db.Model(&meta.Node{}).
		Where("id = ?", music.ID).
		Update("revision", music.Revision+1).Error; err != nil {
		t.Fatal(err)
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		return validateMediaCreativeSourcesTx(tx, generation, recipe)
	})
	if !errors.Is(err, errMediaCreativeSourceChanged) {
		t.Fatalf("changed movie music error=%v", err)
	}
	if err := db.Model(&meta.Node{}).
		Where("id = ?", music.ID).
		Update("revision", music.Revision).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.File{}).
		Where("node_id = ?", music.ID).
		Update("sha256", strings.Repeat("e", 64)).Error; err != nil {
		t.Fatal(err)
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		return validateMediaCreativeSourcesTx(tx, generation, recipe)
	})
	if !errors.Is(err, errMediaCreativeSourceChanged) {
		t.Fatalf("changed movie music fingerprint error=%v", err)
	}
	if err := db.Model(&meta.File{}).
		Where("node_id = ?", music.ID).
		Update("sha256", music.File.SHA256).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.Model(&meta.Node{}).
		Where("id = ?", second.ID).
		Update("revision", second.Revision+1).Error; err != nil {
		t.Fatal(err)
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		return validateMediaCreativeSourcesTx(tx, generation, recipe)
	})
	if !errors.Is(err, errMediaCreativeSourceChanged) {
		t.Fatalf("changed second movie frame error=%v", err)
	}

	if err := db.Model(&meta.Node{}).
		Where("id = ?", second.ID).
		Update("revision", second.Revision).Error; err != nil {
		t.Fatal(err)
	}
	generation.Kind = meta.PhotoCreativeKindCollage
	recipe = mediaCreativeRecipe{
		CollageSources: []mediaCreativeMovieSource{
			{
				AssetID:      101,
				NodeID:       first.ID,
				NodeRevision: first.Revision,
				SHA256:       first.File.SHA256,
			},
			{
				AssetID:      102,
				NodeID:       second.ID,
				NodeRevision: second.Revision,
				SHA256:       second.File.SHA256,
			},
		},
		CollageTemplate: "grid",
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		return validateMediaCreativeSourcesTx(tx, generation, recipe)
	}); err != nil {
		t.Fatalf("current collage sources were rejected: %v", err)
	}

	if err := db.Model(&meta.File{}).
		Where("node_id = ?", second.ID).
		Update("sha256", strings.Repeat("c", 64)).Error; err != nil {
		t.Fatal(err)
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		return validateMediaCreativeSourcesTx(tx, generation, recipe)
	})
	if !errors.Is(err, errMediaCreativeSourceChanged) {
		t.Fatalf("changed second collage image error=%v", err)
	}
}
