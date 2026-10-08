package api

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"testing"
	"time"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	mediaGalleryFirstOpenLogicalCount = 100_000
	mediaGalleryFirstOpenPhotos       = 70_000
	mediaGalleryFirstOpenVideos       = 15_000
	mediaGalleryFirstOpenLivePhotos   = 15_000
	mediaGalleryFirstOpenPhysical     = mediaGalleryFirstOpenPhotos +
		mediaGalleryFirstOpenVideos +
		mediaGalleryFirstOpenLivePhotos*2
)

func mediaGalleryFirstOpenPerfEnabled() bool {
	return os.Getenv("XD_GALLERY_FIRST_OPEN_PERF") == "1"
}

func TestMediaGalleryFirstOpenPerformance100K(t *testing.T) {
	if !mediaGalleryFirstOpenPerfEnabled() {
		t.Skip("100k Gallery first-open benchmark is branch-scoped; set XD_GALLERY_FIRST_OPEN_PERF=1 to run it explicitly")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}

	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{},
		&meta.RefreshToken{},
		&meta.Node{},
		&meta.File{},
		&meta.AuditEvent{},
		&meta.Source{},
		&meta.SourceItem{},
		&meta.SourceCollection{},
		&meta.SourceCollectionItem{},
		&meta.MediaMetadata{},
		&meta.MediaDerivedResource{},
		&meta.MediaGroup{},
		&meta.MediaGroupItem{},
		&meta.PhotoAsset{},
		&meta.PhotoResource{},
		&meta.PhotoMetadata{},
		&meta.PhotoEditRecipe{},
		&meta.PhotoCollection{},
		&meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username:     "gallery-first-open-perf",
		PasswordHash: "unused-performance-fixture",
		Role:         meta.UserRoleUser,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	folder := meta.Node{
		Name:     "100k Gallery",
		Type:     meta.NodeTypeDir,
		OwnerID:  user.ID,
		Revision: 1,
	}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatal(err)
	}

	seedStarted := time.Now()
	mediaGallerySeedFirstOpen100K(t, db, user.ID, folder.ID)
	seedElapsed := time.Since(seedStarted)

	server := &Server{DB: db}
	ctx := context.Background()

	staleStarted := time.Now()
	staleNodes, err := server.staleMediaNodes(ctx, &user.ID, mediaRequestIndexBatch)
	if err != nil {
		t.Fatal(err)
	}
	staleElapsed := time.Since(staleStarted)
	if len(staleNodes) != 0 {
		t.Fatalf("warm projected fixture unexpectedly has %d stale media nodes", len(staleNodes))
	}

	coldCtx, coldCancel := context.WithTimeout(ctx, 2*time.Minute)
	coldStarted := time.Now()
	coldRange, err := server.queryMediaItemRange(
		coldCtx,
		user.ID,
		mediaQueryOptions{},
		"",
		100,
		0,
	)
	coldRangeElapsed := time.Since(coldStarted)
	coldCancel()
	if err != nil {
		t.Fatalf("cold first range: %v", err)
	}
	mediaGalleryAssertFirstOpenRange(t, coldRange)

	warmSamples := make([]time.Duration, 0, 3)
	var warmRange mediaItemRangeDTO
	for range 3 {
		sampleCtx, sampleCancel := context.WithTimeout(ctx, 2*time.Minute)
		started := time.Now()
		warmRange, err = server.queryMediaItemRange(
			sampleCtx,
			user.ID,
			mediaQueryOptions{},
			"",
			100,
			0,
		)
		elapsed := time.Since(started)
		sampleCancel()
		if err != nil {
			t.Fatalf("warm first range: %v", err)
		}
		warmSamples = append(warmSamples, elapsed)
	}
	sort.Slice(warmSamples, func(i, j int) bool { return warmSamples[i] < warmSamples[j] })
	warmMedian := warmSamples[len(warmSamples)/2]
	mediaGalleryAssertFirstOpenRange(t, warmRange)

	t.Logf(
		"GALLERY_FIRST_OPEN_SERVER_100K_RANGE logical_items=%d physical_media_nodes=%d photos=%d videos=%d live_photos=%d seed_ms=%.3f stale_probe_ms=%.3f stale_nodes=%d first_range_cold_ms=%.3f first_range_warm_median_ms=%.3f first_range_warm_min_ms=%.3f first_range_warm_max_ms=%.3f timeline_year_groups=%d timeline_month_groups=%d timeline_day_groups=%d",
		mediaGalleryFirstOpenLogicalCount,
		mediaGalleryFirstOpenPhysical,
		mediaGalleryFirstOpenPhotos,
		mediaGalleryFirstOpenVideos,
		mediaGalleryFirstOpenLivePhotos,
		mediaGalleryPerfMilliseconds(seedElapsed),
		mediaGalleryPerfMilliseconds(staleElapsed),
		len(staleNodes),
		mediaGalleryPerfMilliseconds(coldRangeElapsed),
		mediaGalleryPerfMilliseconds(warmMedian),
		mediaGalleryPerfMilliseconds(warmSamples[0]),
		mediaGalleryPerfMilliseconds(warmSamples[len(warmSamples)-1]),
		len(coldRange.TimelineGroupSets.Year),
		len(coldRange.TimelineGroupSets.Month),
		len(coldRange.TimelineGroupSets.Day),
	)

	refreshCtx, refreshCancel := context.WithTimeout(ctx, 45*time.Second)
	refreshStarted := time.Now()
	refreshErr := server.refreshMediaIndexForGalleryRead(
		refreshCtx,
		user.ID,
		mediaRequestIndexBatch,
	)
	refreshElapsed := time.Since(refreshStarted)
	refreshTimedOut := refreshCtx.Err() != nil || errors.Is(refreshErr, context.DeadlineExceeded)
	refreshCancel()
	if refreshErr != nil {
		t.Fatalf("warm media refresh failed: %v", refreshErr)
	}

	t.Logf(
		"GALLERY_FIRST_OPEN_SERVER_100K_REFRESH warm_refresh_ms=%.3f warm_refresh_timed_out=%t refresh_timeout_ms=%d",
		mediaGalleryPerfMilliseconds(refreshElapsed),
		refreshTimedOut,
		45_000,
	)
}

func mediaGalleryAssertFirstOpenRange(t *testing.T, page mediaItemRangeDTO) {
	t.Helper()
	if page.TotalCount != mediaGalleryFirstOpenLogicalCount {
		t.Fatalf("total_count=%d want=%d", page.TotalCount, mediaGalleryFirstOpenLogicalCount)
	}
	if len(page.Items) != 100 {
		t.Fatalf("first range items=%d want=100", len(page.Items))
	}
	if page.TimelineGroupSets == nil {
		t.Fatal("first range is missing timeline_group_sets")
	}
	if len(page.TimelineGroupSets.Day) == 0 {
		t.Fatal("first range is missing day timeline groups")
	}
}

func mediaGallerySeedFirstOpen100K(
	t *testing.T,
	db *gorm.DB,
	ownerID, folderID uint64,
) {
	t.Helper()

	insertNodes := func(prefix, suffix string, count int) {
		t.Helper()
		if err := db.Exec(
			`INSERT INTO xd_nodes (
				parent_id, name, type, owner_id, revision, created_at, updated_at
			)
			SELECT
				?,
				? || lpad(gs::text, 6, '0') || ?,
				'file',
				?,
				1,
				NOW(),
				NOW()
			FROM generate_series(1, ?) AS gs`,
			folderID,
			prefix,
			suffix,
			ownerID,
			count,
		).Error; err != nil {
			t.Fatal(err)
		}
	}
	insertNodes("photo-", ".jpg", mediaGalleryFirstOpenPhotos)
	insertNodes("video-", ".mp4", mediaGalleryFirstOpenVideos)
	insertNodes("live-still-", ".jpg", mediaGalleryFirstOpenLivePhotos)
	insertNodes("live-motion-", ".mov", mediaGalleryFirstOpenLivePhotos)

	// Fixture-only index: keep synthetic Live Photo pairing setup out of the
	// product first-open timings measured below.
	if err := db.Exec("CREATE INDEX idx_gallery_first_open_owner_name ON xd_nodes(owner_id, name)").Error; err != nil {
		t.Fatal(err)
	}

	if err := db.Exec(
		`INSERT INTO xd_files (
			node_id, size, storage_key, sha256, created_at, updated_at
		)
		SELECT
			n.id,
			CASE
				WHEN n.name LIKE 'video-%' OR n.name LIKE 'live-motion-%' THEN 20971520
				ELSE 5242880
			END,
			'gallery-first-open/' || n.id::text,
			lpad(to_hex(n.id), 64, '0'),
			NOW(),
			NOW()
		FROM xd_nodes AS n
		WHERE n.owner_id = ? AND n.parent_id = ? AND n.type = 'file'`,
		ownerID,
		folderID,
	).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.Exec(
		`INSERT INTO xd_media_metadata (
			node_id, owner_id, node_revision, sha256, media_kind, mime_type,
			live_photo_asset_identifier, relation_evidence_version,
			width, height, orientation, duration_ms, captured_at,
			index_state, created_at, updated_at
		)
		SELECT
			n.id,
			n.owner_id,
			n.revision,
			f.sha256,
			CASE
				WHEN n.name LIKE 'video-%' OR n.name LIKE 'live-motion-%' THEN ?
				ELSE ?
			END,
			CASE
				WHEN n.name LIKE 'video-%' THEN 'video/mp4'
				WHEN n.name LIKE 'live-motion-%' THEN 'video/quicktime'
				ELSE 'image/jpeg'
			END,
			CASE
				WHEN n.name LIKE 'live-still-%' OR n.name LIKE 'live-motion-%'
					THEN 'perf-live-' || substring(n.name from '([0-9]{6})')
				ELSE ''
			END,
			?,
			4032,
			3024,
			1,
			CASE
				WHEN n.name LIKE 'video-%' OR n.name LIKE 'live-motion-%' THEN 120000
				ELSE 0
			END,
			NOW() - ((substring(n.name from '([0-9]{6})')::integer % 3650) * INTERVAL '1 day'),
			?,
			NOW(),
			NOW()
		FROM xd_nodes AS n
		JOIN xd_files AS f ON f.node_id = n.id
		WHERE n.owner_id = ? AND n.parent_id = ? AND n.type = 'file'`,
		meta.MediaKindVideo,
		meta.MediaKindImage,
		mediapkg.RelationEvidenceVersion,
		meta.MediaIndexStateReady,
		ownerID,
		folderID,
	).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.Exec(
		`INSERT INTO xd_media_groups (
			owner_id, kind, evidence_key, created_at, updated_at
		)
		SELECT
			?,
			?,
			'apple-asset:perf-live-' || lpad(gs::text, 6, '0'),
			NOW(),
			NOW()
		FROM generate_series(1, ?) AS gs`,
		ownerID,
		meta.MediaGroupKindLivePhoto,
		mediaGalleryFirstOpenLivePhotos,
	).Error; err != nil {
		t.Fatal(err)
	}

	for _, role := range []struct {
		prefix  string
		suffix  string
		role    string
		ordinal int
	}{
		{prefix: "live-still-", suffix: ".jpg", role: meta.MediaGroupRoleStill, ordinal: 0},
		{prefix: "live-motion-", suffix: ".mov", role: meta.MediaGroupRoleMotion, ordinal: 1},
	} {
		if err := db.Exec(
			`INSERT INTO xd_media_group_items (
				group_id, node_id, role, ordinal, created_at, updated_at
			)
			SELECT
				g.id,
				n.id,
				?,
				?,
				NOW(),
				NOW()
			FROM xd_media_groups AS g
			JOIN xd_nodes AS n
				ON n.owner_id = g.owner_id
				AND n.name = ? ||
					replace(g.evidence_key, 'apple-asset:perf-live-', '') || ?
			WHERE g.owner_id = ? AND g.kind = ?`,
			role.role,
			role.ordinal,
			role.prefix,
			role.suffix,
			ownerID,
			meta.MediaGroupKindLivePhoto,
		).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := db.Exec(
		`INSERT INTO xd_photo_assets (
			owner_id, primary_node_id, kind, evidence_key, created_at, updated_at
		)
		SELECT
			?,
			n.id,
			CASE WHEN n.name LIKE 'video-%' THEN ? ELSE ? END,
			'node:' || n.id::text,
			NOW(),
			NOW()
		FROM xd_nodes AS n
		WHERE n.owner_id = ? AND n.parent_id = ?
			AND (n.name LIKE 'photo-%' OR n.name LIKE 'video-%')`,
		ownerID,
		meta.PhotoAssetKindVideo,
		meta.PhotoAssetKindImage,
		ownerID,
		folderID,
	).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.Exec(
		`INSERT INTO xd_photo_assets (
			owner_id, primary_node_id, kind, evidence_key, created_at, updated_at
		)
		SELECT
			?,
			still_item.node_id,
			?,
			'group:' || g.id::text,
			NOW(),
			NOW()
		FROM xd_media_groups AS g
		JOIN xd_media_group_items AS still_item
			ON still_item.group_id = g.id AND still_item.role = ?
		WHERE g.owner_id = ? AND g.kind = ?`,
		ownerID,
		meta.PhotoAssetKindLivePhoto,
		meta.MediaGroupRoleStill,
		ownerID,
		meta.MediaGroupKindLivePhoto,
	).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.Exec(
		`INSERT INTO xd_photo_metadata (
			asset_id, media_kind, mime_type, width, height, duration_ms,
			captured_at, tags_json, people_json, created_at, updated_at
		)
		SELECT
			a.id,
			mm.media_kind,
			mm.mime_type,
			mm.width,
			mm.height,
			mm.duration_ms,
			mm.captured_at,
			'',
			'',
			NOW(),
			NOW()
		FROM xd_photo_assets AS a
		JOIN xd_media_metadata AS mm ON mm.node_id = a.primary_node_id
		WHERE a.owner_id = ?`,
		ownerID,
	).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.Exec(
		`INSERT INTO xd_photo_resources (
			asset_id, resource_kind, node_id, role, ordinal,
			name, media_kind, mime_type, size, sha256, byte_offset,
			created_at, updated_at
		)
		SELECT
			a.id,
			?,
			n.id,
			?,
			0,
			n.name,
			mm.media_kind,
			mm.mime_type,
			f.size,
			f.sha256,
			0,
			NOW(),
			NOW()
		FROM xd_photo_assets AS a
		JOIN xd_nodes AS n ON n.id = a.primary_node_id
		JOIN xd_files AS f ON f.node_id = n.id
		JOIN xd_media_metadata AS mm ON mm.node_id = n.id
		WHERE a.owner_id = ? AND a.kind IN (?, ?)`,
		meta.PhotoResourceKindNode,
		meta.PhotoResourceRolePrimary,
		ownerID,
		meta.PhotoAssetKindImage,
		meta.PhotoAssetKindVideo,
	).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.Exec(
		`INSERT INTO xd_photo_resources (
			asset_id, resource_kind, node_id, role, ordinal,
			name, media_kind, mime_type, size, sha256, byte_offset,
			created_at, updated_at
		)
		SELECT
			a.id,
			?,
			n.id,
			?,
			0,
			n.name,
			mm.media_kind,
			mm.mime_type,
			f.size,
			f.sha256,
			0,
			NOW(),
			NOW()
		FROM xd_photo_assets AS a
		JOIN xd_nodes AS n ON n.id = a.primary_node_id
		JOIN xd_files AS f ON f.node_id = n.id
		JOIN xd_media_metadata AS mm ON mm.node_id = n.id
		WHERE a.owner_id = ? AND a.kind = ?`,
		meta.PhotoResourceKindNode,
		meta.MediaGroupRoleStill,
		ownerID,
		meta.PhotoAssetKindLivePhoto,
	).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.Exec(
		`INSERT INTO xd_photo_resources (
			asset_id, resource_kind, node_id, role, ordinal,
			name, media_kind, mime_type, size, sha256, byte_offset,
			created_at, updated_at
		)
		SELECT
			a.id,
			?,
			motion_item.node_id,
			?,
			1,
			n.name,
			mm.media_kind,
			mm.mime_type,
			f.size,
			f.sha256,
			0,
			NOW(),
			NOW()
		FROM xd_photo_assets AS a
		JOIN xd_media_groups AS g ON a.evidence_key = 'group:' || g.id::text
		JOIN xd_media_group_items AS motion_item
			ON motion_item.group_id = g.id AND motion_item.role = ?
		JOIN xd_nodes AS n ON n.id = motion_item.node_id
		JOIN xd_files AS f ON f.node_id = n.id
		JOIN xd_media_metadata AS mm ON mm.node_id = n.id
		WHERE a.owner_id = ? AND a.kind = ?`,
		meta.PhotoResourceKindNode,
		meta.MediaGroupRoleMotion,
		meta.MediaGroupRoleMotion,
		ownerID,
		meta.PhotoAssetKindLivePhoto,
	).Error; err != nil {
		t.Fatal(err)
	}

	collection := meta.PhotoCollection{
		OwnerID:     ownerID,
		ExternalKey: fmt.Sprintf("%s:%d", meta.PhotoCollectionKindFolder, folderID),
		Kind:        meta.PhotoCollectionKindFolder,
		Name:        "100k Gallery",
		State:       meta.PhotoCollectionStateActive,
		Revision:    1,
	}
	if err := db.Create(&collection).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(
		`INSERT INTO xd_photo_collection_assets (
			collection_id, asset_id, position, created_at, updated_at
		)
		SELECT
			?,
			a.id,
			ROW_NUMBER() OVER (ORDER BY a.primary_node_id ASC) - 1,
			NOW(),
			NOW()
		FROM xd_photo_assets AS a
		WHERE a.owner_id = ?`,
		collection.ID,
		ownerID,
	).Error; err != nil {
		t.Fatal(err)
	}

	for _, table := range []string{
		"xd_nodes",
		"xd_files",
		"xd_media_metadata",
		"xd_media_groups",
		"xd_media_group_items",
		"xd_photo_assets",
		"xd_photo_resources",
		"xd_photo_metadata",
		"xd_photo_collections",
		"xd_photo_collection_assets",
	} {
		if err := db.Exec("ANALYZE " + table).Error; err != nil {
			t.Fatal(err)
		}
	}

	var physicalCount int64
	if err := db.Model(&meta.MediaMetadata{}).
		Where("owner_id = ?", ownerID).
		Count(&physicalCount).Error; err != nil {
		t.Fatal(err)
	}
	if physicalCount != mediaGalleryFirstOpenPhysical {
		t.Fatalf("physical media rows=%d want=%d", physicalCount, mediaGalleryFirstOpenPhysical)
	}
	var assetCount int64
	if err := db.Model(&meta.PhotoAsset{}).
		Where("owner_id = ?", ownerID).
		Count(&assetCount).Error; err != nil {
		t.Fatal(err)
	}
	if assetCount != mediaGalleryFirstOpenLogicalCount {
		t.Fatalf("photo assets=%d want=%d", assetCount, mediaGalleryFirstOpenLogicalCount)
	}
}

func mediaGalleryPerfMilliseconds(value time.Duration) float64 {
	return float64(value.Microseconds()) / 1000
}
