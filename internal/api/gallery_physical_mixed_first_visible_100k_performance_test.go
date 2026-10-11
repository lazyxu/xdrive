package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"image/jpeg"
	"io"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

// galleryPhysicalMixed100KReport is exclusively test-fixture setup evidence.
// Original bytes, CAS writes, PostgreSQL row updates and file-system seeding
// are excluded from the separately timed authenticated HTTP Gallery requests.
type galleryPhysicalMixed100KReport struct {
	Images           int
	Videos           int
	LiveStills       int
	LiveMotions      int
	PhysicalSources  int
	PhysicalBytes    int64
	VerifiedCASReads int
	SeedMs           float64
}

type galleryPhysicalMixedReadback struct {
	kind     string
	key      string
	expected []byte
}

func galleryPhysicalMixedOrdinal(name string) (string, int, error) {
	for _, entry := range []struct{ prefix, suffix, kind string }{
		{"photo-", ".jpg", "image"},
		{"video-", ".mp4", "video"},
		{"live-still-", ".jpg", "live_still"},
		{"live-motion-", ".mov", "live_motion"},
	} {
		if !strings.HasPrefix(name, entry.prefix) || !strings.HasSuffix(name, entry.suffix) {
			continue
		}
		digits := strings.TrimSuffix(strings.TrimPrefix(name, entry.prefix), entry.suffix)
		ordinal, err := strconv.Atoi(digits)
		if err != nil || ordinal < 1 {
			return "", 0, fmt.Errorf("invalid original source ordinal in %q", name)
		}
		return entry.kind, ordinal, nil
	}
	return "", 0, fmt.Errorf("not a Gallery 100k physical original: %q", name)
}

// Exactly the same 70k image + 15k video + 15k Live logical assets and 115k
// Node/File/MediaMetadata + PhotoResource rows as mediaGallerySeedFirstOpen100K.
// Unlike the metadata-only fixture, ALL 115k originals get distinct physical CAS
// bytes. JPEG originals are independently encoded 80x64 20-bit tile patterns;
// videos and Live motion files are unique ISO BMFF MP4 *containers* with the
// same validated 96x64 H264 bitstream, NOT 30k separately encoded movies.
// Live links originate in the existing deterministic 15k MediaGroup projection.
func gallerySeedRealPhysicalMixed100K(
	t *testing.T, db *gorm.DB, store *fileExplorerMediaPerfStore,
	ownerID, folderID uint64,
) galleryPhysicalMixed100KReport {
	t.Helper()
	started := time.Now()
	movie, err := base64.StdEncoding.DecodeString(fileExplorerH264Real100KVideo)
	if err != nil || len(movie) < 1000 || !bytes.Contains(movie[:min(len(movie), 128)], []byte("ftyp")) {
		t.Fatalf("validated H264 fixture missing: bytes=%d err=%v", len(movie), err)
	}
	if err := db.Exec(`CREATE TABLE gallery_physical_mixed_sources (
		node_id BIGINT PRIMARY KEY, sha256 TEXT NOT NULL,
		storage_key TEXT NOT NULL, size BIGINT NOT NULL
	)`).Error; err != nil {
		t.Fatal(err)
	}
	report := galleryPhysicalMixed100KReport{}
	seen := make(map[string]struct{}, mediaGalleryFirstOpenPhysical)
	readback := make([]galleryPhysicalMixedReadback, 0, 12)
	const batchSize = 256
	values := make([]any, 0, batchSize*4)
	placeholders := make([]string, 0, batchSize)
	flush := func() {
		if len(placeholders) == 0 {
			return
		}
		sql := "INSERT INTO gallery_physical_mixed_sources (node_id,sha256,storage_key,size) VALUES " +
			strings.Join(placeholders, ",")
		if err := db.Exec(sql, values...).Error; err != nil {
			t.Fatalf("fixture physical source mapping failed: %v", err)
		}
		values, placeholders = values[:0], placeholders[:0]
	}
	for offset := 0; offset < mediaGalleryFirstOpenPhysical; offset += 512 {
		var nodes []struct {
			ID   uint64
			Name string
		}
		if err := db.Table("xd_nodes").Select("id,name").
			Where("owner_id=? AND parent_id=? AND deleted_at IS NULL", ownerID, folderID).
			Order("id").Offset(offset).Limit(512).Scan(&nodes).Error; err != nil {
			t.Fatal(err)
		}
		if len(nodes) == 0 {
			t.Fatalf("physical original rows ended prematurely at %d", offset)
		}
		for _, node := range nodes {
			kind, serial, err := galleryPhysicalMixedOrdinal(node.Name)
			if err != nil {
				t.Fatal(err)
			}
			var source []byte
			ordinal, ceiling := serial, 0
			switch kind {
			case "image":
				report.Images++
				ceiling = mediaGalleryFirstOpenPhotos
			case "video":
				report.Videos++
				ceiling = mediaGalleryFirstOpenVideos
			case "live_still":
				report.LiveStills++
				ceiling = mediaGalleryFirstOpenLivePhotos
				ordinal = mediaGalleryFirstOpenPhotos + serial
			case "live_motion":
				report.LiveMotions++
				ceiling = mediaGalleryFirstOpenLivePhotos
				ordinal = mediaGalleryFirstOpenVideos + serial
			}
			if serial > ceiling {
				t.Fatalf("invalid %s original ordinal %d > %d", kind, serial, ceiling)
			}
			switch kind {
			case "image", "live_still":
				source, err = fileExplorerPhysicalJPEG(ordinal - 1)
			case "video", "live_motion":
				source = fileExplorerH264PhysicalContainer(movie, uint32(ordinal))
			}
			if err != nil || len(source) < 500 {
				t.Fatalf("original %d %s encoding failed: bytes=%d err=%v", serial, kind, len(source), err)
			}
			hash := fmt.Sprintf("%x", sha256.Sum256(source))
			if _, already := seen[hash]; already {
				t.Fatalf("duplicate canonical physical source hash %s for %s/%d", hash, kind, serial)
			}
			seen[hash] = struct{}{}
			key, keyErr := storage.ContentAddressedKey(hash)
			if keyErr != nil {
				t.Fatal(keyErr)
			}
			written, putErr := store.Put(t.Context(), key, bytes.NewReader(source))
			if putErr != nil || written != int64(len(source)) {
				t.Fatalf("real physical CAS Put %s %d: %d/%d, %v",
					kind, serial, written, len(source), putErr)
			}
			report.PhysicalSources++
			report.PhysicalBytes += written
			values = append(values, node.ID, hash, key, len(source))
			placeholders = append(placeholders, "(?,?,?,?)")
			if len(placeholders) == batchSize {
				flush()
			}
			if serial == 1 || serial == ceiling/2 || serial == ceiling {
				readback = append(readback, galleryPhysicalMixedReadback{
					kind: kind, key: key, expected: source,
				})
			}
		}
	}
	flush()
	if report.Images != mediaGalleryFirstOpenPhotos || report.Videos != mediaGalleryFirstOpenVideos ||
		report.LiveStills != mediaGalleryFirstOpenLivePhotos ||
		report.LiveMotions != mediaGalleryFirstOpenLivePhotos ||
		report.PhysicalSources != mediaGalleryFirstOpenPhysical ||
		len(seen) != mediaGalleryFirstOpenPhysical || len(readback) != 12 {
		t.Fatalf("100k physical Gallery cardinality invalid: %+v unique=%d sample=%d",
			report, len(seen), len(readback))
	}
	// A single fixture-only set update preserves all user/revision/Live evidence,
	// avoiding 115k individual GORM mutations and not changing production SQL.
	result := db.Exec(`UPDATE xd_files AS f
		SET sha256=p.sha256,storage_key=p.storage_key,size=p.size
		FROM gallery_physical_mixed_sources AS p
		WHERE f.node_id=p.node_id`)
	if result.Error != nil || result.RowsAffected != mediaGalleryFirstOpenPhysical {
		t.Fatalf("physical File source mapping: rows=%d error=%v", result.RowsAffected, result.Error)
	}
	result = db.Exec(`UPDATE xd_media_metadata AS m
		SET sha256=f.sha256,
			width=CASE WHEN n.name LIKE 'video-%' OR n.name LIKE 'live-motion-%' THEN 96 ELSE 80 END,
			height=64
		FROM xd_files AS f JOIN xd_nodes AS n ON n.id=f.node_id
		WHERE m.node_id=f.node_id AND n.owner_id=? AND n.parent_id=?`, ownerID, folderID)
	if result.Error != nil || result.RowsAffected != mediaGalleryFirstOpenPhysical {
		t.Fatalf("physical MediaMetadata source mapping: rows=%d error=%v", result.RowsAffected, result.Error)
	}
	result = db.Exec(`UPDATE xd_photo_resources AS r
		SET sha256=f.sha256,size=f.size
		FROM xd_files AS f JOIN xd_nodes AS n ON n.id=f.node_id
		WHERE r.node_id=f.node_id AND n.owner_id=? AND n.parent_id=?`, ownerID, folderID)
	if result.Error != nil || result.RowsAffected != mediaGalleryFirstOpenPhysical {
		t.Fatalf("physical PhotoResource source mapping: rows=%d error=%v", result.RowsAffected, result.Error)
	}
	if err := db.Exec(`UPDATE xd_photo_metadata AS m
		SET width=CASE WHEN a.kind=? THEN 96 ELSE 80 END,height=64
		FROM xd_photo_assets AS a WHERE a.id=m.asset_id AND a.owner_id=?`,
		meta.PhotoAssetKindVideo, ownerID).Error; err != nil {
		t.Fatal(err)
	}
	var counts struct {
		FileCount     int64
		UniqueSHAs    int64
		MetadataMatch int64
		ResourceMatch int64
		MotionPairs   int64
	}
	if err := db.Raw(`SELECT COUNT(*) FROM xd_files AS f
		JOIN xd_nodes AS n ON n.id=f.node_id
		WHERE n.owner_id=? AND n.parent_id=?`, ownerID, folderID).Scan(&counts.FileCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Raw(`SELECT COUNT(DISTINCT f.sha256) FROM xd_files AS f
		JOIN xd_nodes AS n ON n.id=f.node_id
		WHERE n.owner_id=? AND n.parent_id=?`, ownerID, folderID).Scan(&counts.UniqueSHAs).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Raw(`SELECT COUNT(*) FROM xd_media_metadata AS m
		JOIN xd_files AS f ON f.node_id=m.node_id
		JOIN xd_nodes AS n ON n.id=m.node_id
		WHERE n.owner_id=? AND n.parent_id=? AND m.sha256=f.sha256`,
		ownerID, folderID).Scan(&counts.MetadataMatch).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Raw(`SELECT COUNT(*) FROM xd_photo_resources AS r
		JOIN xd_files AS f ON f.node_id=r.node_id
		JOIN xd_nodes AS n ON n.id=r.node_id
		WHERE n.owner_id=? AND n.parent_id=? AND r.sha256=f.sha256 AND r.size=f.size`,
		ownerID, folderID).Scan(&counts.ResourceMatch).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Raw(`SELECT COUNT(*) FROM xd_media_group_items AS i
		JOIN xd_nodes AS n ON n.id=i.node_id
		WHERE n.owner_id=? AND n.parent_id=? AND i.role=?`,
		ownerID, folderID, meta.MediaGroupRoleMotion).Scan(&counts.MotionPairs).Error; err != nil {
		t.Fatal(err)
	}
	if counts.FileCount != mediaGalleryFirstOpenPhysical ||
		counts.UniqueSHAs != mediaGalleryFirstOpenPhysical ||
		counts.MetadataMatch != mediaGalleryFirstOpenPhysical ||
		counts.ResourceMatch != mediaGalleryFirstOpenPhysical ||
		counts.MotionPairs != mediaGalleryFirstOpenLivePhotos {
		t.Fatalf("physical source metadata or Live relationships mismatch: %+v", counts)
	}
	for _, sample := range readback {
		reader, err := store.inner.Open(t.Context(), sample.key)
		if err != nil {
			t.Fatalf("sample %s original missing: %v", sample.kind, err)
		}
		body, readErr := io.ReadAll(reader)
		closeErr := reader.Close()
		if readErr != nil || closeErr != nil || !bytes.Equal(body, sample.expected) {
			t.Fatalf("sample %s physical CAS mismatch: read=%v close=%v",
				sample.kind, readErr, closeErr)
		}
		if sample.kind == "image" || sample.kind == "live_still" {
			image, err := jpeg.Decode(bytes.NewReader(body))
			if err != nil || image.Bounds().Dx() != 80 || image.Bounds().Dy() != 64 {
				t.Fatalf("source JPEG sample %s not decoded: %v", sample.kind, err)
			}
		} else if !bytes.Contains(body[:min(len(body), 128)], []byte("ftyp")) {
			t.Fatalf("physical %s video sample is not an MP4 container", sample.kind)
		}
		report.VerifiedCASReads++
	}
	for _, table := range []string{"xd_files", "xd_media_metadata", "xd_photo_resources", "xd_photo_metadata"} {
		if err := db.Exec("ANALYZE " + table).Error; err != nil {
			t.Fatal(err)
		}
	}
	report.SeedMs = float64(time.Since(started).Microseconds()) / 1000
	store.Reset()
	return report
}

func galleryPhysicalMixedViewportIDs(t *testing.T, viewport []mediaItemDTO) ([]uint64, []uint64, int) {
	t.Helper()
	imageIDs := make([]uint64, 0, len(viewport))
	videoIDs := make([]uint64, 0, len(viewport))
	liveCount := 0
	for _, item := range viewport {
		if item.Metadata.MediaKind == meta.MediaKindVideo {
			videoIDs = append(videoIDs, item.Node.ID)
		} else {
			imageIDs = append(imageIDs, item.Node.ID)
			if item.AssetKind == meta.PhotoAssetKindLivePhoto {
				liveCount++
			}
		}
	}
	if len(imageIDs) < 12 || len(videoIDs) == 0 || liveCount == 0 {
		t.Fatalf("missing genuinely mixed 100k first viewport: images=%d videos=%d live=%d",
			len(imageIDs), len(videoIDs), liveCount)
	}
	return imageIDs, videoIDs, liveCount
}
