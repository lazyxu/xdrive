package api

import (
	"context"
	"encoding/json"
	"fmt"
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

// P4D is a read-only query experiment, NOT a production optimization.
// Only anonymous numeric timings and fixed viewport names may be persisted.
type pwaP4DPair struct {
	Round      int     `json:"round"`
	Viewport   string  `json:"viewport"`
	Offset     int     `json:"offset"`
	FullA1MS   float64 `json:"full_a1_ms"`
	NarrowB1MS float64 `json:"narrow_b1_ms"`
	NarrowB2MS float64 `json:"narrow_b2_ms"`
	FullA2MS   float64 `json:"full_a2_ms"`
	Rows       int     `json:"rows"`
}

type pwaP4DProbePair struct {
	Round             int     `json:"round"`
	OrderedProbeMS    float64 `json:"ordered_probe_ms"`
	UnorderedProbeMS  float64 `json:"unordered_probe_ms"`
	BothReportNoStale bool    `json:"both_report_no_stale"`
}

func TestPwaP4DOwner100kReadOnlyQueryCandidates(t *testing.T) {
	if os.Getenv("XD_PWA_P4D_QUERY_CANDIDATES") != "1" {
		t.Skip("P4D Owner 100k query comparison is opt-in")
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
		Auth:       auth.New("pwa-p4d-query-candidate-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
		MaxUploadBytes: 16 << 20,
	}
	router := server.Router()
	token := createTestUser(t, db, router, "pwa-p4d-owner", "pwa-p4d-test-password")
	root := requestNode(t, router, "GET", "/api/v1/nodes/root", token, nil, 200)
	folder := requestNode(t, router, "POST",
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), token,
		strings.NewReader(`{"name":"P4D synthetic"}`), 201)
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
		var ids []uint64
		if err := pageQuery().Limit(48).Offset(offset).
			Pluck("xd_media_metadata.node_id", &ids).Error; err != nil {
			return nil, err
		}
		if len(ids) == 0 {
			return []meta.MediaMetadata{}, nil
		}
		var metadata []meta.MediaMetadata
		if err := db.WithContext(ctx).Where("owner_id = ? AND node_id IN ?", uid, ids).
			Find(&metadata).Error; err != nil {
			return nil, err
		}
		byID := make(map[uint64]meta.MediaMetadata, len(metadata))
		for _, row := range metadata {
			byID[row.NodeID] = row
		}
		ordered := make([]meta.MediaMetadata, 0, len(ids))
		for _, id := range ids {
			row, ok := byID[id]
			if !ok {
				return nil, fmt.Errorf("missing Owner-scoped projected metadata")
			}
			ordered = append(ordered, row)
		}
		return ordered, nil
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
	var pairs []pwaP4DPair
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
			p := pwaP4DPair{Round: round, Viewport: v.name, Offset: v.offset,
				FullA1MS: a1, NarrowB1MS: b1, NarrowB2MS: b2, FullA2MS: a2, Rows: len(fullA1)}
			pairs = append(pairs, p)
			t.Logf("PWA_P4D_ABBA round=%d viewport=%s full_a1_ms=%.3f narrow_b1_ms=%.3f narrow_b2_ms=%.3f full_a2_ms=%.3f rows=%d",
				p.Round, p.Viewport, p.FullA1MS, p.NarrowB1MS, p.NarrowB2MS, p.FullA2MS, p.Rows)
		}
	}
	if len(pairs) != 9 {
		t.Fatalf("expected nine paired page samples, got %d", len(pairs))
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
	var probes []pwaP4DProbePair
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
		probes = append(probes, pwaP4DProbePair{Round: round, OrderedProbeMS: aMS, UnorderedProbeMS: bMS, BothReportNoStale: true})
		t.Logf("PWA_P4D_PROBE round=%d ordered_ms=%.3f unordered_ms=%.3f", round, aMS, bMS)
	}
	fresh := meta.Node{Name: "p4d-unindexed.jpg", Type: meta.NodeTypeFile,
		OwnerID: uid, ParentID: &folder.ID, Revision: 1}
	if err := db.Create(&fresh).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{NodeID: fresh.ID, Size: 8,
		StorageKey: "pwa-p4d/unindexed", SHA256: strings.Repeat("a", 64)}).Error; err != nil {
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
	otherToken := createTestUser(t, db, router, "pwa-p4d-other-owner", "pwa-p4d-other-password")
	otherRoot := requestNode(t, router, "GET", "/api/v1/nodes/root", otherToken, nil, 200)
	var other meta.Node
	if err := db.First(&other, otherRoot.ID).Error; err != nil {
		t.Fatal(err)
	}
	otherStale, err := server.staleMediaNodes(ctx, &other.OwnerID, 1)
	if err != nil || len(otherStale) != 0 {
		t.Fatalf("cross-Owner stale leak: err=%v rows=%d", err, len(otherStale))
	}

	if output := os.Getenv("XD_PWA_P4D_QUERY_RESULTS"); output != "" {
		result := struct {
			Schema       string            `json:"schema"`
			Pairs        []pwaP4DPair      `json:"pairs"`
			Probes       []pwaP4DProbePair `json:"probes"`
			Optimization bool              `json:"optimization_implemented"`
			After        any               `json:"after"`
			Conclusion   string            `json:"causal_conclusion"`
		}{Schema: "xdrive-pwa-p4d-owner-sql-candidate-abba-v1",
			Pairs: pairs, Probes: probes, Optimization: false, After: nil,
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
