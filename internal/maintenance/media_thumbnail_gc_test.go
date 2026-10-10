package maintenance

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestGarbageCollectMediaThumbnailsIsReferenceAndAgeSafe(t *testing.T) {
	db := openThumbnailGCTestDB(t)
	storageRoot := t.TempDir()

	user := meta.User{
		Username: "thumbnail-gc-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}

	nodes := make([]meta.Node, 3)
	for index := range nodes {
		nodes[index] = meta.Node{
			ParentID: &root.ID,
			Name:     fmt.Sprintf("media-%d", index),
			Type:     meta.NodeTypeFile,
			OwnerID:  user.ID,
			Revision: uint64(index + 1),
		}
		if err := db.Create(&nodes[index]).Error; err != nil {
			t.Fatal(err)
		}
	}
	shaA := strings.Repeat("a", 64)
	shaB := strings.Repeat("b", 64)
	shaC := strings.Repeat("c", 64)
	referencedKey := mediapkg.ThumbnailStorageKey(
		nodes[0].ID, nodes[0].Revision, shaA, mediapkg.DefaultThumbnailEdge,
	)
	// A potential transparent derivative is protected even before its
	// thumbnail_key presentation field is committed.
	potentialKey := mediapkg.ThumbnailStorageKeyForSource(
		nodes[1].ID, nodes[1].Revision, shaB, mediapkg.DefaultThumbnailEdge, "image/png",
	)
	analysisKey := mediapkg.AnalysisPreviewStorageKey(
		nodes[1].ID, nodes[1].Revision, shaB,
	)
	videoKey := mediapkg.ThumbnailStorageKey(
		nodes[2].ID, nodes[2].Revision, shaC, mediapkg.DefaultThumbnailEdge,
	)
	rows := []meta.MediaMetadata{
		{
			NodeID: nodes[0].ID, OwnerID: user.ID, NodeRevision: nodes[0].Revision,
			SHA256: shaA, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			ThumbnailKey: referencedKey, ThumbnailMIMEType: "image/jpeg",
			ThumbnailWidth: 512, ThumbnailHeight: 384,
			IndexState: meta.MediaIndexStateReady,
		},
		{
			NodeID: nodes[1].ID, OwnerID: user.ID, NodeRevision: nodes[1].Revision,
			SHA256: shaB, MediaKind: meta.MediaKindImage, MIMEType: "image/png",
			IndexState: meta.MediaIndexStateReady,
		},
		{
			NodeID: nodes[2].ID, OwnerID: user.ID, NodeRevision: nodes[2].Revision,
			SHA256: shaC, MediaKind: meta.MediaKindVideo, MIMEType: "video/mp4",
			IndexState: meta.MediaIndexStateReady,
		},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}

	old := time.Now().UTC().Add(-MediaThumbnailGCMinAge - time.Hour)
	young := time.Now().UTC().Add(-time.Hour)
	orphanKey := mediapkg.ThumbnailStoragePrefix + "dd/" + strings.Repeat("d", 64) + "-v4-512.thumb"
	youngKey := mediapkg.ThumbnailStoragePrefix + "ee/" + strings.Repeat("e", 64) + "-512.jpg"
	for _, file := range []struct {
		key      string
		modified time.Time
	}{
		{key: referencedKey, modified: old},
		{key: potentialKey, modified: old},
		{key: analysisKey, modified: old},
		{key: videoKey, modified: old},
		{key: orphanKey, modified: old},
		{key: youngKey, modified: young},
	} {
		writeThumbnailGCTestFile(t, storageRoot, file.key, file.modified)
	}

	dry, err := GarbageCollectMediaThumbnails(
		context.Background(), db, storageRoot, true,
	)
	if err != nil {
		t.Fatal(err)
	}
	if dry.ScannedFiles != 6 ||
		dry.CandidateFiles != 2 ||
		dry.DeletedFiles != 0 ||
		len(dry.Actions) != 2 {
		t.Fatalf("dry-run report=%+v", dry)
	}
	candidateKeys := map[string]bool{}
	for _, action := range dry.Actions {
		candidateKeys[action.StorageKey] = true
	}
	if !candidateKeys[videoKey] || !candidateKeys[orphanKey] {
		t.Fatalf("unexpected dry-run candidates=%v", candidateKeys)
	}
	for _, key := range []string{referencedKey, potentialKey, analysisKey, youngKey} {
		if candidateKeys[key] {
			t.Fatalf("protected thumbnail %q became a GC candidate", key)
		}
	}

	applied, err := GarbageCollectMediaThumbnails(
		context.Background(), db, storageRoot, false,
	)
	if err != nil {
		t.Fatal(err)
	}
	if applied.CandidateFiles != 2 ||
		applied.DeletedFiles != 2 ||
		applied.DeletedBytes <= 0 {
		t.Fatalf("applied report=%+v", applied)
	}
	for _, key := range []string{videoKey, orphanKey} {
		if _, err := os.Stat(thumbnailGCTestPath(storageRoot, key)); !os.IsNotExist(err) {
			t.Fatalf("orphan thumbnail %q still exists: %v", key, err)
		}
	}
	for _, key := range []string{referencedKey, potentialKey, analysisKey, youngKey} {
		if _, err := os.Stat(thumbnailGCTestPath(storageRoot, key)); err != nil {
			t.Fatalf("protected thumbnail %q missing: %v", key, err)
		}
	}

	second, err := GarbageCollectMediaThumbnails(
		context.Background(), db, storageRoot, false,
	)
	if err != nil {
		t.Fatal(err)
	}
	if second.CandidateFiles != 0 || second.DeletedFiles != 0 {
		t.Fatalf("second GC should be idempotent: %+v", second)
	}
}

func TestMediaThumbnailGCRechecksDatabaseReferenceBeforeDelete(t *testing.T) {
	db := openThumbnailGCTestDB(t)
	storageRoot := t.TempDir()
	key := mediapkg.ThumbnailStoragePrefix + "ff/" + strings.Repeat("f", 64) + "-512.jpg"
	modified := time.Now().UTC().Add(-MediaThumbnailGCMinAge - time.Hour)
	writeThumbnailGCTestFile(t, storageRoot, key, modified)

	storageAbs, thumbnailRoot, thumbnailReal, exists, err := thumbnailGCRoot(storageRoot)
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatal("thumbnail GC root is missing")
	}
	info, err := os.Stat(thumbnailGCTestPath(storageRoot, key))
	if err != nil {
		t.Fatal(err)
	}
	action := MediaThumbnailGCAction{
		StorageKey: key,
		Size:       info.Size(),
		ModifiedAt: info.ModTime().UTC(),
	}

	user := meta.User{
		Username: "thumbnail-gc-reference-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	node := meta.Node{
		ParentID: &root.ID, Name: "photo.jpg", Type: meta.NodeTypeFile,
		OwnerID: user.ID, Revision: 1,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.MediaMetadata{
		NodeID: node.ID, OwnerID: user.ID, NodeRevision: node.Revision,
		SHA256: strings.Repeat("f", 64), MediaKind: meta.MediaKindImage,
		MIMEType: "image/jpeg", ThumbnailKey: key,
		ThumbnailMIMEType: "image/jpeg", ThumbnailWidth: 512, ThumbnailHeight: 512,
		IndexState: meta.MediaIndexStateReady,
	}).Error; err != nil {
		t.Fatal(err)
	}

	if err := applyMediaThumbnailGCAction(
		context.Background(),
		db,
		storageAbs,
		thumbnailRoot,
		thumbnailReal,
		time.Now().UTC().Add(-MediaThumbnailGCMinAge),
		&action,
	); err != nil {
		t.Fatal(err)
	}
	if action.Applied || action.SkippedReason != "referenced_during_gc" {
		t.Fatalf("reference recheck did not protect candidate: %+v", action)
	}
	if _, err := os.Stat(thumbnailGCTestPath(storageRoot, key)); err != nil {
		t.Fatalf("referenced thumbnail was deleted: %v", err)
	}
}

func openThumbnailGCTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("XD_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	base, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "media_thumbnail_gc_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := base.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = base.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	})

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
		&meta.User{},
		&meta.Node{},
		&meta.MediaMetadata{},
	); err != nil {
		t.Fatal(err)
	}
	return db
}

func writeThumbnailGCTestFile(
	t *testing.T,
	storageRoot, key string,
	modified time.Time,
) {
	t.Helper()
	full := thumbnailGCTestPath(storageRoot, key)
	if err := os.MkdirAll(filepath.Dir(full), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte{0xff, 0xd8, 0xff, 0xd9}, 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(full, modified, modified); err != nil {
		t.Fatal(err)
	}
}

func thumbnailGCTestPath(storageRoot, key string) string {
	return filepath.Join(storageRoot, filepath.FromSlash(key))
}
