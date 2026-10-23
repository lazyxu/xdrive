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
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

// P4E compares the production narrow Owner media range to the original SQL.
// Only anonymous numeric timings and fixed viewport names may be persisted.
type pwaP4EPair struct {
	Round      int     `json:"round"`
	Viewport   string  `json:"viewport"`
	Offset     int     `json:"offset"`
	FullA1MS   float64 `json:"full_a1_ms"`
	NarrowB1MS float64 `json:"narrow_b1_ms"`
	NarrowB2MS float64 `json:"narrow_b2_ms"`
	FullA2MS   float64 `json:"full_a2_ms"`
	Rows       int     `json:"rows"`
}

type pwaP4EProbePair struct {
	Round             int     `json:"round"`
	OrderedProbeMS    float64 `json:"ordered_probe_ms"`
	UnorderedProbeMS  float64 `json:"unordered_probe_ms"`
	BothReportNoStale bool    `json:"both_report_no_stale"`
}

func TestPwaP4EOwner100kReadOnlyQueryCandidates(t *testing.T) {
	if os.Getenv("XD_PWA_P4E_OWNER_100K") != "1" {
		t.Skip("P4E Owner 100k query comparison is opt-in")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("XD_TEST_DATABASE_URL required")
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
		DB: db, Store: store,
		Auth:       auth.New("pwa-p4e-query-candidate-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
		MaxUploadBytes: 16 << 20,
	}
	router := server.Router()
	token := createTestUser(t, db, router, "pwa-p4e-owner", "pwa-p4e-test-password")
	root := requestNode(t, router, "GET", "/api/v1/nodes/root", token, nil, 200)
	folder := requestNode(t, router, "POST",
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), token,
		strings.NewReader(`{"name":"P4E synthetic"}`), 201)
	var ownerRoot meta.Node
	if err := db.First(&ownerRoot, root.ID).Error; err != nil {
		t.Fatal(err)
	}
	mediaGallerySeedFirstOpen100K(t, db, ownerRoot.OwnerID, folder.ID)
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
	uid := ownerRoot.OwnerID
	opts := mediaQueryOptions{}
	base, err := server.mediaItemsBaseQuery(ctx, uid, opts, "")
	if err != nil {
		t.Fatal(err)
	}
	pageQuery := func() *gorm.DB {
		q := base.Session(&gorm.Session{})
		for _, clause := range mediaGallerySortClauses(opts) {
			q = q.Order(clause)
		}
		return q
	}
	full := func(offset int) ([]meta.MediaMetadata, error) {
		var rows []meta.MediaMetadata
		err := pageQuery().Limit(48).Offset(offset).Find(&rows).Error
		return rows, err
	}
	// Candidate B: select only the original sorted 48 Node IDs under the
	// same Owner join and filters, rehydrate by Owner, restore SQL order.
	// No production query, index, state, or cache is changed.
	narrow := func(offset int) ([]meta.MediaMetadata, error) {
		return server.loadNarrowMediaMetadataPage(ctx, uid, base, opts, 48, offset)
	}
	measure := func(fn func(int) ([]meta.MediaMetadata, error), offset int) ([]meta.MediaMetadata, float64) {
		t.Helper()
		start := time.Now()
		rows, err := fn(offset)
		ms := float64(time.Since(start).Microseconds()) / 1000
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 48 {
			t.Fatalf("offset=%d selected rows=%d expected=48", offset, len(rows))
		}
		return rows, ms
	}
	viewports := []struct {
		name   string
		offset int
	}{{"top", 0}, {"middle", 50_000}, {"tail", 95_000}}
	var pairs []pwaP4EPair
	for round := 1; round <= 3; round++ {
		for k := range viewports {
			v := viewports[(k+round-1)%len(viewports)]
			fullA1, a1 := measure(full, v.offset)
			narrowB1, b1 := measure(narrow, v.offset)
			narrowB2, b2 := measure(narrow, v.offset)
			fullA2, a2 := measure(full, v.offset)
			if !reflect.DeepEqual(fullA1, narrowB1) ||
				!reflect.DeepEqual(fullA1, narrowB2) ||
				!reflect.DeepEqual(fullA1, fullA2) {
				t.Fatalf("Owner metadata content/order mismatch: %s", v.name)
			}
			// Current production Range must return exactly the legacy metadata
			// order and metadata content, not merely matching selected IDs.
			page, err := server.queryMediaItemRange(ctx, uid, opts, "", 48, v.offset)
			if err != nil || page.TotalCount != 100_000 || len(page.Items) != 48 {
				t.Fatalf("product Range at %s: err=%v count=%d rows=%d",
					v.name, err, page.TotalCount, len(page.Items))
			}
			for n, item := range page.Items {
				if item.Node.ID != fullA1[n].NodeID ||
					!reflect.DeepEqual(item.Metadata, toMediaMetadataDTO(fullA1[n])) {
					t.Fatalf("product Owner Range differs at %s row %d", v.name, n)
				}
			}
			p := pwaP4EPair{Round: round, Viewport: v.name, Offset: v.offset,
				FullA1MS: a1, NarrowB1MS: b1, NarrowB2MS: b2, FullA2MS: a2, Rows: len(fullA1)}
			pairs = append(pairs, p)
			t.Logf("PWA_P4E_ABBA round=%d viewport=%s full_a1_ms=%.3f narrow_b1_ms=%.3f narrow_b2_ms=%.3f full_a2_ms=%.3f rows=%d",
				p.Round, p.Viewport, p.FullA1MS, p.NarrowB1MS, p.NarrowB2MS, p.FullA2MS, p.Rows)
		}
	}
	if len(pairs) != 9 {
		t.Fatalf("expected nine paired page samples, got %d", len(pairs))
	}

	// Non-default captured/added sort directions and media kinds must preserve
	// the whole metadata row, not just the first and last Node IDs.
	for _, tc := range []struct {
		options mediaQueryOptions
		offset  int
	}{
		{mediaQueryOptions{SortBy: "added", SortDir: "asc"}, 2000},
		{mediaQueryOptions{SortBy: "captured", SortDir: "asc", UnknownFirst: true}, 10000},
		{mediaQueryOptions{SortBy: "added", SortDir: "desc", MediaKind: meta.MediaKindImage}, 3000},
		{mediaQueryOptions{SortBy: "captured", SortDir: "desc", MediaKind: meta.MediaKindVideo}, 500},
	} {
		q, err := server.mediaItemsBaseQuery(ctx, uid, tc.options, "")
		if err != nil {
			t.Fatal(err)
		}
		oldQ := q.Session(&gorm.Session{})
		for _, clause := range mediaGallerySortClauses(tc.options) {
			oldQ = oldQ.Order(clause)
		}
		var old []meta.MediaMetadata
		if err := oldQ.Limit(48).Offset(tc.offset).Find(&old).Error; err != nil {
			t.Fatal(err)
		}
		newRows, err := server.loadNarrowMediaMetadataPage(ctx, uid, q, tc.options, 48, tc.offset)
		if err != nil || !reflect.DeepEqual(old, newRows) {
			t.Fatalf("alternative sort/filter mismatch: %v", err)
		}
	}

	// Read-only alternate existence probe vs original ordered stale search;
	// both must immediately detect a newly unindexed Owner file.
	probeOrdered := func() (bool, float64, error) {
		started := time.Now()
		rows, err := server.staleMediaNodes(ctx, &uid, 1)
		return len(rows) > 0, float64(time.Since(started).Microseconds()) / 1000, err
	}
	probeUnordered := func() (bool, float64, error) {
		started := time.Now()
		rows, err := server.staleMediaQuery(ctx).Where("n.owner_id = ?", uid).
			Select("1").Limit(1).Rows()
		if err != nil {
			return false, 0, err
		}
		found := rows.Next()
		if readErr := rows.Err(); readErr != nil {
			_ = rows.Close()
			return false, 0, readErr
		}
		if closeErr := rows.Close(); closeErr != nil {
			return false, 0, closeErr
		}
		return found, float64(time.Since(started).Microseconds()) / 1000, nil
	}
	var probes []pwaP4EProbePair
	for round := 1; round <= 3; round++ {
		a, aMS, err := probeOrdered()
		if err != nil {
			t.Fatal(err)
		}
		b, bMS, err := probeUnordered()
		if err != nil {
			t.Fatal(err)
		}
		if a || b {
			t.Fatal("warm 100k fixture unexpectedly has stale media")
		}
		probes = append(probes, pwaP4EProbePair{Round: round, OrderedProbeMS: aMS, UnorderedProbeMS: bMS, BothReportNoStale: true})
		t.Logf("PWA_P4E_PROBE round=%d ordered_ms=%.3f unordered_ms=%.3f", round, aMS, bMS)
	}
	fresh := meta.Node{Name: "p4d-unindexed.jpg", Type: meta.NodeTypeFile,
		OwnerID: uid, ParentID: &folder.ID, Revision: 1}
	if err := db.Create(&fresh).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{NodeID: fresh.ID, Size: 8,
		StorageKey: "pwa-p4e/unindexed", SHA256: strings.Repeat("a", 64)}).Error; err != nil {
		t.Fatal(err)
	}
	a, _, err := probeOrdered()
	if err != nil {
		t.Fatal(err)
	}
	b, _, err := probeUnordered()
	if err != nil {
		t.Fatal(err)
	}
	if !a || !b {
		t.Fatal("both stale probes must detect a newly unindexed Owner file")
	}
	// A different Owner is never allowed to see the unindexed Node.
	otherToken := createTestUser(t, db, router, "pwa-p4e-other-owner", "pwa-p4e-other-password")
	otherRoot := requestNode(t, router, "GET", "/api/v1/nodes/root", otherToken, nil, 200)
	var other meta.Node
	if err := db.First(&other, otherRoot.ID).Error; err != nil {
		t.Fatal(err)
	}
	otherStale, err := server.staleMediaNodes(ctx, &other.OwnerID, 1)
	if err != nil || len(otherStale) != 0 {
		t.Fatalf("cross-Owner stale leak: err=%v rows=%d", err, len(otherStale))
	}

	// Genuine loopback Gin HTTP validates the authenticated route and private
	// cache header at all three depths; no private response is archived.
	httpServer := httptest.NewServer(router)
	defer httpServer.Close()
	client := &http.Client{Timeout: 120 * time.Second}
	readHTTP := func(bearer string, offset int) (mediaItemRangeDTO, error) {
		var page mediaItemRangeDTO
		req, err := http.NewRequest(http.MethodGet,
			fmt.Sprintf("%s/api/v1/media/items?range=true&limit=48&offset=%d", httpServer.URL, offset), nil)
		if err != nil {
			return page, err
		}
		req.Header.Set("Authorization", "Bearer "+bearer)
		resp, err := client.Do(req)
		if err != nil {
			return page, err
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(io.LimitReader(resp.Body, (16<<20)+1))
		if err != nil {
			return page, err
		}
		if resp.StatusCode != http.StatusOK ||
			resp.Header.Get("Cache-Control") != "no-store" || len(body) > (16<<20) {
			return page, fmt.Errorf("unexpected HTTP status=%d cache=%q bytes=%d",
				resp.StatusCode, resp.Header.Get("Cache-Control"), len(body))
		}
		err = json.Unmarshal(body, &page)
		return page, err
	}
	for _, viewport := range viewports {
		page, err := readHTTP(token, viewport.offset)
		if err != nil || page.TotalCount != 100_000 || len(page.Items) != 48 {
			t.Fatalf("authenticated HTTP Range %s invalid: err=%v count=%d rows=%d",
				viewport.name, err, page.TotalCount, len(page.Items))
		}
	}
	otherPage, err := readHTTP(otherToken, 0)
	if err != nil || otherPage.TotalCount != 0 || len(otherPage.Items) != 0 {
		t.Fatalf("cross-Owner HTTP Range leak: err=%v count=%d rows=%d",
			err, otherPage.TotalCount, len(otherPage.Items))
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := server.loadNarrowMediaMetadataPage(canceled, uid, base, opts, 48, 0); err == nil {
		t.Fatal("canceled Owner Range query must fail")
	}

	if output := os.Getenv("XD_PWA_P4E_RESULTS"); output != "" {
		result := struct {
			Schema       string            `json:"schema"`
			Pairs        []pwaP4EPair      `json:"pairs"`
			Probes       []pwaP4EProbePair `json:"probes"`
			Optimization bool              `json:"optimization_implemented"`
			After        any               `json:"after"`
			Conclusion   string            `json:"causal_conclusion"`
		}{Schema: "xdrive-pwa-p4e-owner-narrow-page-v1",
			Pairs: pairs, Probes: probes, Optimization: true, After: nil,
			Conclusion: "NOT_ESTABLISHED"}
		body, err := json.MarshalIndent(result, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Dir(output), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(output, append(body, byte(10)), 0600); err != nil {
			t.Fatal(err)
		}
	}
}
