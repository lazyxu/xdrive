package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

// pwaP1SeedLiveMotionForTail adds only real physical motion bytes to existing
// Owner-verified Live pairs in the 100k synthetic tail. No production changes.
func pwaP1SeedLiveMotionForTail(
	t *testing.T, db *gorm.DB, store *fileExplorerMediaPerfStore,
	ownerID, folderID uint64, viewport []mediaItemDTO,
) int {
	t.Helper()
	bytesMP4, err := base64.StdEncoding.DecodeString(galleryFirstVisibleVideoMP4Base64)
	if err != nil || len(bytesMP4) < 1000 {
		t.Fatalf("P1-C real H264 Live motion sample invalid: bytes=%d err=%v", len(bytesMP4), err)
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(bytesMP4))
	key, err := storage.ContentAddressedKey(hash)
	if err != nil {
		t.Fatal(err)
	}
	if written, err := store.Put(t.Context(), key, bytes.NewReader(bytesMP4)); err != nil || written != int64(len(bytesMP4)) {
		t.Fatalf("P1-C actual motion CAS Put mismatch: written=%d err=%v", written, err)
	}
	seeded := 0
	for _, item := range viewport {
		if item.AssetKind != meta.PhotoAssetKindLivePhoto {
			continue
		}
		still := item.Node.Name
		if !strings.HasPrefix(still, "live-still-") || !strings.HasSuffix(still, ".jpg") {
			t.Fatalf("P1-C unexpected native Live still: %q", still)
		}
		suffix := strings.TrimSuffix(strings.TrimPrefix(still, "live-still-"), ".jpg")
		if len(suffix) != 6 {
			t.Fatalf("P1-C invalid Live index: %q", suffix)
		}
		for _, ch := range suffix {
			if ch < '0' || ch > '9' {
				t.Fatalf("P1-C non-numeric Live index")
			}
		}
		motionName := "live-motion-" + suffix + ".mov"
		var motion struct{ ID uint64 }
		if err := db.Table("xd_nodes").Select("id").Where(
			"owner_id=? AND parent_id=? AND name=? AND deleted_at IS NULL",
			ownerID, folderID, motionName,
		).Take(&motion).Error; err != nil || motion.ID == 0 {
			t.Fatalf("P1-C original standalone Live motion absent: %s err=%v", motionName, err)
		}
		file := db.Model(&meta.File{}).Where("node_id=?", motion.ID).
			Updates(map[string]any{"storage_key": key, "sha256": hash, "size": int64(len(bytesMP4))})
		if file.Error != nil || file.RowsAffected != 1 {
			t.Fatalf("P1-C motion File CAS bind: rows=%d err=%v", file.RowsAffected, file.Error)
		}
		metadata := db.Model(&meta.MediaMetadata{}).Where("node_id=? AND owner_id=?", motion.ID, ownerID).
			Updates(map[string]any{
				"sha256": hash, "mime_type": "video/mp4", "width": 96, "height": 64,
			})
		if metadata.Error != nil || metadata.RowsAffected != 1 {
			t.Fatalf("P1-C motion media projection: rows=%d err=%v", metadata.RowsAffected, metadata.Error)
		}
		resource := db.Model(&meta.PhotoResource{}).Where("node_id=?", motion.ID).
			Updates(map[string]any{"sha256": hash, "size": int64(len(bytesMP4)), "mime_type": "video/mp4"})
		if resource.Error != nil || resource.RowsAffected != 1 {
			t.Fatalf("P1-C original PhotoResource link: rows=%d err=%v", resource.RowsAffected, resource.Error)
		}
		seeded++
	}
	if seeded < 3 || seeded > len(viewport) {
		t.Fatalf("P1-C bounded actual Live motions missing: %d of %d", seeded, len(viewport))
	}
	return seeded
}
