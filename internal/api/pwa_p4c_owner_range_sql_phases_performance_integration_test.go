package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

// P4C is BEFORE-only: measure the original Owner Range without altering its
// implementation. All output fields are numeric or fixed labels; no Node IDs,
// URL, token, SQL binds, media paths or private response bodies are persisted.
type pwaP4CServerRangeSample struct {
	Round           int     `json:"round"`
	Viewport        string  `json:"viewport"`
	Offset          int     `json:"offset"`
	Total           int64   `json:"total"`
	Items           int     `json:"items"`
	HTTPBytes       int     `json:"http_bytes"`
	IndexProbeMS    float64 `json:"index_probe_ms"`
	PrepareFoldMS   float64 `json:"prepare_fold_ms"`
	BaseQueryMS     float64 `json:"base_query_ms"`
	CountDistinctMS float64 `json:"count_distinct_ms"`
	PageSQLMS       float64 `json:"page_sql_replay_ms"`
	TimelineMS      float64 `json:"timeline_ms"`
	MaterializeMS   float64 `json:"materialize_ms"`
	JSONEncodeMS    float64 `json:"json_encode_ms"`
	RangeWholeMS    float64 `json:"range_whole_ms"`
	HTTPWholeMS     float64 `json:"http_whole_ms"`
}

func pwaP4CMilliseconds(started time.Time) float64 {
	return float64(time.Since(started).Microseconds()) / 1000
}

func TestPwaP4CServerRangeSQLPhases100K(t *testing.T) {
	if os.Getenv("XD_PWA_P4C_SERVER_PHASE") != "1" {
		t.Skip("opt-in genuine 100k PostgreSQL Owner Range phase attribution")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("XD_TEST_DATABASE_URL is required for the opt-in PostgreSQL test")
	}
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{},
		&meta.AuditEvent{}, &meta.Source{}, &meta.SourceItem{},
		&meta.SourceCollection{}, &meta.SourceCollectionItem{},
		&meta.MediaMetadata{}, &meta.MediaDerivedResource{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoEditRecipe{}, &meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: db, Store: store, Auth: auth.New("pwa-p4c-synthetic-owner-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
		MaxUploadBytes: 16 << 20,
	}
	router := server.Router()
	token := createTestUser(t, db, router, "pwa-p4c-synthetic-owner", "pwa-p4c-test-password")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	folder := requestNode(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), token,
		strings.NewReader(`{"name":"PWA 100k synthetic range"}`), http.StatusCreated)
	var node meta.Node
	if err := db.First(&node, root.ID).Error; err != nil {
		t.Fatal(err)
	}
	mediaGallerySeedFirstOpen100K(t, db, node.OwnerID, folder.ID)
	for _, table := range []string{
		"xd_nodes", "xd_files", "xd_media_metadata", "xd_media_groups",
		"xd_media_group_items", "xd_photo_assets", "xd_photo_metadata",
		"xd_photo_resources", "xd_photo_collections", "xd_photo_collection_assets",
	} {
		if err := db.Exec("ANALYZE " + table).Error; err != nil {
			t.Fatal(err)
		}
	}
	ctx := context.Background()
	httpServer := httptest.NewServer(router)
	defer httpServer.Close()
	client := &http.Client{Timeout: 120 * time.Second}
	readPage := func(bearer string, offset int) (mediaItemRangeDTO, int, error) {
		var page mediaItemRangeDTO
		req, err := http.NewRequest(http.MethodGet, fmt.Sprintf(
			"%s/api/v1/media/items?range=true&limit=48&offset=%d", httpServer.URL, offset), nil)
		if err != nil {
			return page, 0, err
		}
		req.Header.Set("Authorization", "Bearer "+bearer)
		res, err := client.Do(req)
		if err != nil {
			return page, 0, err
		}
		defer res.Body.Close()
		body, err := io.ReadAll(io.LimitReader(res.Body, 16<<20+1))
		if err != nil {
			return page, 0, err
		}
		if res.StatusCode != http.StatusOK || len(body) > 16<<20 || res.Header.Get("Cache-Control") != "no-store" {
			return page, 0, fmt.Errorf("Owner Range HTTP contract rejected: status=%d size=%d", res.StatusCode, len(body))
		}
		if err := json.Unmarshal(body, &page); err != nil {
			return page, 0, err
		}
		return page, len(body), nil
	}

	viewports := []struct {
		name   string
		offset int
	}{{"top", 0}, {"middle", 50_000}, {"tail", 95_000}}
	var samples []pwaP4CServerRangeSample
	for round := 1; round <= 3; round++ {
		// Rotate the order so deep pages do not always inherit the same warm
		// PostgreSQL buffer/cache state. These are descriptive, not A/B trials.
		for k := range viewports {
			v := viewports[(k+round-1)%len(viewports)]
			s := pwaP4CServerRangeSample{Round: round, Viewport: v.name, Offset: v.offset}
			started := time.Now()
			if err := server.refreshMediaIndexForGalleryRead(ctx, node.OwnerID, mediaRequestIndexBatch); err != nil {
				t.Fatal(err)
			}
			s.IndexProbeMS = pwaP4CMilliseconds(started)

			started = time.Now()
			options, err := server.prepareVerifiedMediaFolding(ctx, node.OwnerID, mediaQueryOptions{})
			if err != nil {
				t.Fatal(err)
			}
			s.PrepareFoldMS = pwaP4CMilliseconds(started)

			started = time.Now()
			query, err := server.mediaItemsBaseQuery(ctx, node.OwnerID, options, "")
			if err != nil {
				t.Fatal(err)
			}
			s.BaseQueryMS = pwaP4CMilliseconds(started)

			started = time.Now()
			var total int64
			if err := query.Session(&gorm.Session{}).
				Distinct("xd_media_metadata.node_id").Count(&total).Error; err != nil {
				t.Fatal(err)
			}
			s.CountDistinctMS = pwaP4CMilliseconds(started)
			if total <= int64(v.offset) || total < 90_000 {
				t.Fatalf("100k fixture is not a usable Owner Range (count=%d, offset=%d)", total, v.offset)
			}

			if v.offset == 0 {
				started = time.Now()
				if _, err := mediaItemAnchorIndex(query.Session(&gorm.Session{}), options); err != nil {
					t.Fatal(err)
				}
				if _, err := queryMediaTimelineGroupSets(query.Session(&gorm.Session{}), options); err != nil {
					t.Fatal(err)
				}
				s.TimelineMS = pwaP4CMilliseconds(started)
			}

			// Independent SQL-only replay of the exact production page sort.
			// Materialize below will execute the page SELECT again: these
			// overlapping measurements must NOT be added or subtracted.
			started = time.Now()
			pageQuery := query.Session(&gorm.Session{})
			for _, clause := range mediaGallerySortClauses(options) {
				pageQuery = pageQuery.Order(clause)
			}
			var pageRows []meta.MediaMetadata
			if err := pageQuery.Limit(48).Offset(v.offset).Find(&pageRows).Error; err != nil {
				t.Fatal(err)
			}
			s.PageSQLMS = pwaP4CMilliseconds(started)
			if len(pageRows) != 48 {
				t.Fatalf("page-only SQL returned %d items, want 48", len(pageRows))
			}

			started = time.Now()
			items, err := server.materializeMediaItems(ctx, node.OwnerID,
				query.Session(&gorm.Session{}), 48, v.offset, options)
			if err != nil {
				t.Fatal(err)
			}
			s.MaterializeMS = pwaP4CMilliseconds(started)
			s.Total, s.Items = total, len(items)
			if len(items) != 48 {
				t.Fatalf("Owner Range page offset=%d items=%d, want=48", v.offset, len(items))
			}

			for i, item := range items {
				if item.Node.ID != pageRows[i].NodeID {
					t.Fatal("page-only SQL and materialized item order disagree")
				}
			}

			started = time.Now()
			if _, err := json.Marshal(mediaItemRangeDTO{
				Items: items, TotalCount: total, Limit: 48, Offset: v.offset,
			}); err != nil {
				t.Fatal(err)
			}
			s.JSONEncodeMS = pwaP4CMilliseconds(started)

			started = time.Now()
			whole, err := server.queryMediaItemRange(ctx, node.OwnerID, mediaQueryOptions{}, "", 48, v.offset)
			if err != nil {
				t.Fatal(err)
			}
			s.RangeWholeMS = pwaP4CMilliseconds(started)
			if whole.TotalCount != total || len(whole.Items) != len(items) ||
				whole.Items[0].Node.ID != items[0].Node.ID ||
				whole.Items[len(items)-1].Node.ID != items[len(items)-1].Node.ID {
				t.Fatal("split-phase and original Owner Range must agree on total and item order")
			}

			started = time.Now()
			fromHTTP, bytes, err := readPage(token, v.offset)
			if err != nil {
				t.Fatal(err)
			}
			s.HTTPWholeMS = pwaP4CMilliseconds(started)
			s.HTTPBytes = bytes
			if fromHTTP.TotalCount != total || len(fromHTTP.Items) != len(items) ||
				fromHTTP.Items[0].Node.ID != items[0].Node.ID ||
				fromHTTP.Items[len(items)-1].Node.ID != items[len(items)-1].Node.ID {
				t.Fatal("authenticated HTTP and direct Owner Range must agree")
			}
			samples = append(samples, s)
			t.Logf("PWA_P4C_SERVER_100K round=%d viewport=%s count=%d rows=%d probe_ms=%.3f fold_ms=%.3f base_ms=%.3f count_ms=%.3f page_sql_replay_ms=%.3f timeline_ms=%.3f materialize_ms=%.3f json_ms=%.3f range_ms=%.3f http_ms=%.3f http_bytes=%d",
				s.Round, s.Viewport, s.Total, s.Items, s.IndexProbeMS, s.PrepareFoldMS,
				s.BaseQueryMS, s.CountDistinctMS, s.PageSQLMS, s.TimelineMS, s.MaterializeMS,
				s.JSONEncodeMS, s.RangeWholeMS, s.HTTPWholeMS, s.HTTPBytes)
		}
	}

	// Different account: the original endpoint must return an empty Owner
	// range even after the other Owner has populated the full 100k fixture.
	otherToken := createTestUser(t, db, router, "pwa-p4c-other-owner", "pwa-p4c-test-password")
	other, _, err := readPage(otherToken, 0)
	if err != nil || other.TotalCount != 0 || len(other.Items) != 0 {
		t.Fatalf("cross-Owner Range fail-closed: error=%v, count=%d, items=%d",
			err, other.TotalCount, len(other.Items))
	}

	if len(samples) != 9 {
		t.Fatalf("samples=%d want 9", len(samples))
	}
	if output := os.Getenv("XD_PWA_P4C_SERVER_PHASE_RESULTS"); output != "" {
		result := struct {
			Schema                  string                    `json:"schema"`
			Samples                 []pwaP4CServerRangeSample `json:"samples"`
			SameFixtureRepeated     bool                      `json:"same_fixture_repeated"`
			PhysicalMediaFrameTest  bool                      `json:"physical_media_frame_test"`
			OptimizationImplemented bool                      `json:"optimization_implemented"`
			After                   any                       `json:"after"`
			CausalConclusion        string                    `json:"causal_conclusion"`
		}{
			Schema: "xdrive-pwa-p4c-owner-server-sql-phases-v1", Samples: samples,
			SameFixtureRepeated: true, PhysicalMediaFrameTest: false,
			OptimizationImplemented: false, After: nil,
			CausalConclusion: "NOT_ESTABLISHED",
		}
		data, err := json.MarshalIndent(result, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Dir(output), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(output, append(data, '\n'), 0600); err != nil {
			t.Fatal(err)
		}
	}
}
