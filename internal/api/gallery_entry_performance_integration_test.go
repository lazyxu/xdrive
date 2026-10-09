package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

const (
	galleryEntryPerfLogicalAssets = 100_000
	galleryEntryPerfBurstGroups   = 2_000
	galleryEntryPerfChildFolders  = 256
	galleryEntryPerfSamples       = 3
)

type galleryEntryPerfSample struct {
	Phase      string  `json:"phase"`
	Sample     int     `json:"sample"`
	ElapsedMS  float64 `json:"elapsed_ms"`
	ResultRows int64   `json:"result_rows"`
	Bytes      int64   `json:"bytes,omitempty"`
	Error      string  `json:"error,omitempty"`
}

func TestGalleryEntryEndpointsPerformance100K(t *testing.T) {
	if os.Getenv("XD_GALLERY_ENTRY_PERF") != "1" {
		t.Skip("set XD_GALLERY_ENTRY_PERF=1 to measure Gallery Memories, sync folders and cleanup")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{},
		&meta.ContentBlob{}, &meta.AuditEvent{}, &meta.Source{},
		&meta.SourceItem{}, &meta.SourceCollection{}, &meta.SourceCollectionItem{},
		&meta.MediaMetadata{}, &meta.MediaDerivedResource{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{}, &meta.PhotoPlaceLabel{},
		&meta.PhotoAsset{}, &meta.PhotoMetadata{}, &meta.PhotoResource{},
		&meta.PhotoEditRecipe{}, &meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: db, Store: store, Auth: auth.New("gallery-entry-perf-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
		MaxUploadBytes: 16 << 20,
	}
	router := server.Router()
	token := createTestUser(t, db, router, "gallery-entry-perf", "password-entry-perf")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	folder := requestNode(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), token,
		strings.NewReader(`{"name":"100k gallery entries"}`), http.StatusCreated)
	var ownerRoot meta.Node
	if err := db.First(&ownerRoot, root.ID).Error; err != nil {
		t.Fatal(err)
	}
	seedStarted := time.Now()
	mediaGallerySeedFirstOpen100K(t, db, ownerRoot.OwnerID, folder.ID)
	galleryEntryPerfSeed(t, db, ownerRoot.OwnerID, folder.ID)
	seedMS := float64(time.Since(seedStarted).Microseconds()) / 1000

	source := meta.Source{
		OwnerID: ownerRoot.OwnerID, Name: "100k Synology", Kind: "synology_files",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusPaused,
		Revision: 1, TargetNodeID: &folder.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{
		"xd_nodes", "xd_files", "xd_media_metadata", "xd_media_groups",
		"xd_media_group_items", "xd_photo_assets", "xd_photo_metadata",
		"xd_photo_resources", "xd_sources",
	} {
		if err := db.Exec("ANALYZE " + table).Error; err != nil {
			t.Fatal(err)
		}
	}

	ctx := context.Background()
	var samples []galleryEntryPerfSample
	add := func(phase string, sample int, load func() (int64, int64, error)) {
		t.Helper()
		started := time.Now()
		rows, bytes, err := load()
		elapsed := float64(time.Since(started).Microseconds()) / 1000
		result := galleryEntryPerfSample{
			Phase: phase, Sample: sample, ElapsedMS: elapsed,
			ResultRows: rows, Bytes: bytes,
		}
		if err != nil {
			result.Error = err.Error()
		}
		samples = append(samples, result)
		if result.Error != "" {
			t.Logf("GALLERY_ENTRY_PHASE_100K %s sample=%d elapsed_ms=%.3f ERROR=%s",
				phase, sample, elapsed, result.Error)
		} else {
			t.Logf("GALLERY_ENTRY_PHASE_100K %s sample=%d elapsed_ms=%.3f rows=%d bytes=%d",
				phase, sample, elapsed, rows, bytes)
		}
	}
	anchor := time.Now().UTC()
	for sample := 1; sample <= galleryEntryPerfSamples; sample++ {
		add("gallery-index-probe", sample, func() (int64, int64, error) {
			err := server.refreshMediaIndexForGalleryRead(ctx, ownerRoot.OwnerID, mediaRequestIndexBatch)
			return 0, 0, err
		})
		add("memories-trip-days", sample, func() (int64, int64, error) {
			days, err := queryMediaTripDays(ctx, db, ownerRoot.OwnerID, "UTC")
			return int64(len(days)), 0, err
		})
		add("memories-index", sample, func() (int64, int64, error) {
			items, err := queryMediaMemories(ctx, db, ownerRoot.OwnerID, anchor, 48, "UTC")
			return int64(len(items)), 0, err
		})
		add("sync-folders-index", sample, func() (int64, int64, error) {
			items, err := server.queryMediaSyncFolders(ctx, ownerRoot.OwnerID)
			return int64(len(items)), 0, err
		})
		add("sync-folder-open", sample, func() (int64, int64, error) {
			view, err := server.queryMediaFolderView(ctx, ownerRoot.OwnerID, source.ID, folder.ID)
			return int64(len(view.Children)), 0, err
		})
		add("cleanup-duplicates", sample, func() (int64, int64, error) {
			value, err := server.queryDuplicateGroups(ctx, ownerRoot.OwnerID, 48)
			return value.TotalGroups, 0, err
		})
		add("cleanup-bursts", sample, func() (int64, int64, error) {
			value, err := server.queryBurstReviews(ctx, ownerRoot.OwnerID, 48)
			return value.TotalGroups, 0, err
		})
	}

	httpServer := httptest.NewServer(router)
	defer httpServer.Close()
	client := &http.Client{Timeout: 90 * time.Second}
	paths := []struct {
		Name string
		Path string
	}{
		{"http-sync-folders", "/api/v1/media/sync-folders"},
		{"http-sync-folder-open", fmt.Sprintf("/api/v1/media/sync-folders/%d/folders/%d", source.ID, folder.ID)},
		{"http-memories", "/api/v1/media/memories?limit=48&time_zone=UTC"},
		{"http-cleanup-duplicates", "/api/v1/media/duplicates?limit=48"},
		{"http-cleanup-bursts", "/api/v1/media/bursts?limit=48"},
	}
	for sample := 1; sample <= galleryEntryPerfSamples; sample++ {
		for _, item := range paths {
			item := item
			add(item.Name, sample, func() (int64, int64, error) {
				req, err := http.NewRequest(http.MethodGet, httpServer.URL+item.Path, nil)
				if err != nil {
					return 0, 0, err
				}
				req.Header.Set("Authorization", "Bearer "+token)
				resp, err := client.Do(req)
				if err != nil {
					return 0, 0, err
				}
				defer resp.Body.Close()
				body, err := io.ReadAll(resp.Body)
				if err != nil {
					return 0, 0, err
				}
				if resp.StatusCode != http.StatusOK {
					return 0, 0, fmt.Errorf("HTTP %d, response=%s", resp.StatusCode, string(body)[:min(160, len(body))])
				}
				switch item.Name {
				case "http-memories":
					var values []mediaMemoryDTO
					if err := json.Unmarshal(body, &values); err != nil {
						return 0, 0, err
					}
					if len(values) == 0 {
						return 0, 0, fmt.Errorf("memories endpoint returned no memories")
					}
				case "http-cleanup-duplicates":
					var values mediaDuplicateGroupListDTO
					if err := json.Unmarshal(body, &values); err != nil {
						return 0, 0, err
					}
					if values.TotalGroups != 2_000 || len(values.Groups) != 48 {
						return 0, 0, fmt.Errorf("duplicate groups=%d visible=%d want=2000/48", values.TotalGroups, len(values.Groups))
					}
				case "http-cleanup-bursts":
					var values mediaBurstReviewListDTO
					if err := json.Unmarshal(body, &values); err != nil {
						return 0, 0, err
					}
					if values.TotalGroups != galleryEntryPerfBurstGroups || len(values.Groups) != 48 {
						return 0, 0, fmt.Errorf("burst groups=%d visible=%d want=%d/48", values.TotalGroups, len(values.Groups), galleryEntryPerfBurstGroups)
					}
				}
				return 1, int64(len(body)), nil
			})
		}
	}
	// Keep reconciliation out of the three repeated read-only samples:
	// the legacy full-owner path mutates synthetic Burst grouping even before
	// its 100k PostgreSQL parameter-limit error is returned.
	add("owner-index-refresh", 1, func() (int64, int64, error) {
		err := server.refreshMediaIndexForOwner(ctx, ownerRoot.OwnerID, mediaRequestIndexBatch)
		return 0, 0, err
	})
	// The direct read stages must remain semantically stable in all samples.
	requiredCounts := map[string]int64{
		"memories-index":     1,
		"sync-folders-index": 1,
		"sync-folder-open":   galleryEntryPerfChildFolders,
		"cleanup-duplicates": 1,
		"cleanup-bursts":     1,
	}
	seenPhases := make(map[string]int)
	for _, result := range samples {
		minimum, checked := requiredCounts[result.Phase]
		if !checked {
			continue
		}
		if result.Error != "" || result.ResultRows < minimum {
			t.Fatalf("invalid baseline fixture phase=%s sample=%d count=%d error=%s",
				result.Phase, result.Sample, result.ResultRows, result.Error)
		}
		seenPhases[result.Phase]++
	}
	for phase := range requiredCounts {
		if seenPhases[phase] != galleryEntryPerfSamples {
			t.Fatalf("phase=%s samples=%d want=%d", phase, seenPhases[phase], galleryEntryPerfSamples)
		}
	}
	if os.Getenv("XD_GALLERY_ENTRY_LEGACY_BEFORE") != "1" {
		for _, result := range samples {
			if strings.HasPrefix(result.Phase, "http-") && (result.Error != "" || result.Bytes == 0) {
				t.Fatalf("gallery endpoint failed phase=%s sample=%d error=%s bytes=%d",
					result.Phase, result.Sample, result.Error, result.Bytes)
			}
		}
	}
	medians := make(map[string]float64)
	grouped := make(map[string][]float64)
	for _, value := range samples {
		grouped[value.Phase] = append(grouped[value.Phase], value.ElapsedMS)
	}
	for key, values := range grouped {
		sort.Float64s(values)
		medians[key] = values[len(values)/2]
	}
	record, err := json.Marshal(map[string]any{
		"workload":                "gallery-entry-native-postgres-100k",
		"logical_media_assets":    galleryEntryPerfLogicalAssets,
		"physical_media_nodes":    115_000,
		"synthetic_burst_groups":  galleryEntryPerfBurstGroups,
		"synthetic_child_folders": galleryEntryPerfChildFolders,
		"samples_per_phase":       galleryEntryPerfSamples,
		"owner_refresh_samples":   1,
		"seed_ms":                 seedMS,
		"medians_ms":              medians,
		"samples":                 samples,
		"scope":                   "real PostgreSQL plus Gin/loopback; no thumbnails, codec, remote network or browser paint",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("GALLERY_ENTRY_NATIVE_100K %s", string(record))
}

func galleryEntryPerfSeed(t *testing.T, db *gorm.DB, ownerID, folderID uint64) {
	t.Helper()
	query := func(sql string, args ...any) {
		t.Helper()
		if err := db.Exec(sql, args...).Error; err != nil {
			t.Fatal(err)
		}
	}
	query(`INSERT INTO xd_nodes (parent_id, name, type, owner_id, revision, created_at, updated_at) SELECT ?, 'Child-' || lpad(gs::text, 5, '0'), 'dir', ?, 1, NOW(), NOW() FROM generate_series(1, ?) gs`,
		folderID, ownerID, galleryEntryPerfChildFolders)
	query(`UPDATE xd_media_metadata AS mm SET
		latitude = CASE WHEN (substring(n.name from 7 for 6)::integer % 36) < 18 THEN 1.23 ELSE 35.61 END,
		longitude = CASE WHEN (substring(n.name from 7 for 6)::integer % 36) < 18 THEN 103.81 ELSE 139.72 END,
		captured_at = NOW() - ((substring(n.name from 7 for 6)::integer % 180) * INTERVAL '1 day')
		FROM xd_nodes n
		WHERE mm.node_id = n.id AND n.owner_id = ? AND n.parent_id = ?
			AND n.name LIKE 'photo-%' AND substring(n.name from 7 for 6)::integer <= 8000`, ownerID, folderID)
	query(`UPDATE xd_photo_metadata AS pm SET captured_at = mm.captured_at
		FROM xd_photo_assets AS a JOIN xd_media_metadata AS mm ON mm.node_id = a.primary_node_id
		WHERE pm.asset_id = a.id AND a.owner_id = ?
			AND mm.latitude IS NOT NULL`, ownerID)
	query(`UPDATE xd_files AS f SET sha256 = lpad(to_hex((substring(n.name from 7 for 6)::integer % 2000) + 500000), 64, '0')
		FROM xd_nodes n WHERE f.node_id = n.id AND n.owner_id = ? AND n.parent_id = ?
			AND n.name LIKE 'photo-%' AND substring(n.name from 7 for 6)::integer <= 10000`, ownerID, folderID)
	query(`UPDATE xd_media_metadata AS mm SET sha256 = f.sha256
		FROM xd_files AS f JOIN xd_nodes AS n ON n.id = f.node_id
		WHERE mm.node_id = f.node_id AND n.owner_id = ? AND n.parent_id = ?
			AND n.name LIKE 'photo-%' AND substring(n.name from 7 for 6)::integer <= 10000`, ownerID, folderID)
	query(`UPDATE xd_photo_resources AS pr SET sha256 = f.sha256
		FROM xd_files AS f JOIN xd_nodes AS n ON n.id = f.node_id
		WHERE pr.node_id = f.node_id AND n.owner_id = ? AND n.parent_id = ?
			AND n.name LIKE 'photo-%' AND substring(n.name from 7 for 6)::integer <= 10000`, ownerID, folderID)
	query(`INSERT INTO xd_media_groups (owner_id, kind, evidence_key, created_at, updated_at)
		SELECT ?, ?, 'perf-burst-' || gs::text, NOW(), NOW()
		FROM generate_series(1, ?) gs`,
		ownerID, meta.MediaGroupKindBurst, galleryEntryPerfBurstGroups)
	query(`INSERT INTO xd_media_group_items (group_id, node_id, role, ordinal, created_at, updated_at)
		SELECT g.id, n.id, ?, frame.n, NOW(), NOW()
		FROM xd_media_groups AS g
		CROSS JOIN generate_series(0,2) AS frame(n)
		JOIN xd_nodes AS n ON n.owner_id = g.owner_id AND n.name =
			'photo-' || lpad((((substring(g.evidence_key from 12)::integer - 1) * 3) + frame.n + 1)::text, 6, '0') || '.jpg'
		WHERE g.owner_id = ? AND g.kind = ? AND g.evidence_key LIKE 'perf-burst-%'`,
		meta.MediaGroupRoleAuxiliary, ownerID, meta.MediaGroupKindBurst)
}
