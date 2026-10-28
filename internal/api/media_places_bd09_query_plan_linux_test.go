package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Opt-in, disposable PG17 query-plan evidence on the EXISTING #2851 100k
// fixture. Only this independent test consumes the SQL; it never logs or
// persists Owner values, bound predicates or original SQL text.
type placesBD09PlanCapture struct {
	logger.Interface
	mu         sync.Mutex
	statements []string
}

func (c *placesBD09PlanCapture) Trace(
	_ context.Context, _ time.Time, fc func() (string, int64), err error,
) {
	if err != nil {
		return
	}
	statement, _ := fc()
	lower := strings.ToLower(strings.TrimSpace(statement))
	if !strings.HasPrefix(lower, "select ") &&
		!strings.HasPrefix(lower, "with ") {
		return
	}
	if !strings.Contains(lower, "xd_baidu_photo_map_positions") {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.statements = append(c.statements, statement)
}

// The PostgreSQL server supplies this raw plan only in memory. No SQL,
// bound Owner/node/photo IDs, filter strings or raw EXPLAIN JSON are saved.
type placesBD09ExplainNode struct {
	NodeType          string                  `json:"Node Type"`
	RelationName      string                  `json:"Relation Name"`
	IndexName         string                  `json:"Index Name"`
	JoinType          string                  `json:"Join Type"`
	ActualRows        float64                 `json:"Actual Rows"`
	ActualLoops       float64                 `json:"Actual Loops"`
	ActualTotalTimeMS float64                 `json:"Actual Total Time"`
	SharedHitBlocks   int64                   `json:"Shared Hit Blocks"`
	SharedReadBlocks  int64                   `json:"Shared Read Blocks"`
	TempReadBlocks    int64                   `json:"Temp Read Blocks"`
	TempWrittenBlocks int64                   `json:"Temp Written Blocks"`
	SortMethod        string                  `json:"Sort Method"`
	SortSpaceUsed     int64                   `json:"Sort Space Used"`
	Plans             []placesBD09ExplainNode `json:"Plans"`
}

type placesBD09ExplainRoot struct {
	Plan          placesBD09ExplainNode `json:"Plan"`
	PlanningTime  float64               `json:"Planning Time"`
	ExecutionTime float64               `json:"Execution Time"`
}

type placesBD09ExplainEvidenceNode struct {
	Depth             int     `json:"depth"`
	NodeType          string  `json:"node_type"`
	RelationName      string  `json:"relation_name,omitempty"`
	IndexName         string  `json:"index_name,omitempty"`
	JoinType          string  `json:"join_type,omitempty"`
	ActualRows        float64 `json:"actual_rows"`
	ActualLoops       float64 `json:"actual_loops"`
	ActualTotalTimeMS float64 `json:"actual_total_time_ms"`
	SharedHitBlocks   int64   `json:"shared_hit_blocks"`
	SharedReadBlocks  int64   `json:"shared_read_blocks"`
	TempReadBlocks    int64   `json:"temp_read_blocks"`
	TempWrittenBlocks int64   `json:"temp_written_blocks"`
	SortMethod        string  `json:"sort_method,omitempty"`
	SortSpaceUsed     int64   `json:"sort_space_used,omitempty"`
}

func placesBD09RedactedPlanNodes(
	node placesBD09ExplainNode, depth int, out *[]placesBD09ExplainEvidenceNode,
) {
	if depth > 20 || len(*out) >= 128 {
		return
	}
	*out = append(*out, placesBD09ExplainEvidenceNode{
		Depth: depth, NodeType: node.NodeType,
		RelationName: node.RelationName, IndexName: node.IndexName,
		JoinType: node.JoinType, ActualRows: node.ActualRows,
		ActualLoops: node.ActualLoops, ActualTotalTimeMS: node.ActualTotalTimeMS,
		SharedHitBlocks:   node.SharedHitBlocks,
		SharedReadBlocks:  node.SharedReadBlocks,
		TempReadBlocks:    node.TempReadBlocks,
		TempWrittenBlocks: node.TempWrittenBlocks,
		SortMethod:        node.SortMethod, SortSpaceUsed: node.SortSpaceUsed,
	})
	for _, child := range node.Plans {
		placesBD09RedactedPlanNodes(child, depth+1, out)
	}
}

type placesBD09ExplainEvidence struct {
	Sequence        int                             `json:"sequence"`
	HasCount        bool                            `json:"has_count"`
	HasOrderBy      bool                            `json:"has_order_by"`
	HasLimit        bool                            `json:"has_limit"`
	PlanningTimeMS  float64                         `json:"planning_time_ms"`
	ExecutionTimeMS float64                         `json:"execution_time_ms"`
	Nodes           []placesBD09ExplainEvidenceNode `json:"nodes"`
}

func placesBD09ExplainProductionSelect(
	t *testing.T, pool *sql.DB, ordinal int, statement string,
) placesBD09ExplainEvidence {
	t.Helper()
	trimmed := strings.TrimSpace(statement)
	lower := strings.ToLower(trimmed)
	if len(trimmed) > 250000 || strings.Contains(trimmed, ";") ||
		(!strings.HasPrefix(lower, "select ") &&
			!strings.HasPrefix(lower, "with ")) ||
		!strings.Contains(lower, "xd_baidu_photo_map_positions") {
		t.Fatalf("source query %d was not a bounded, read-only BD09 SELECT", ordinal)
	}
	// This is the source-produced, bound-value-expanded SQL from a GORM
	// Trace callback in disposable CI, NOT a handwritten approximation.
	// EXPLAIN ANALYZE genuinely runs the original SELECT on PostgreSQL.
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	var rawJSON string
	if err := pool.QueryRowContext(ctx,
		"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "+trimmed).Scan(&rawJSON); err != nil {
		// Never include the DB driver's raw SQL error or bound parameters in
		// the CI transcript or artifact.
		t.Fatalf("PostgreSQL EXPLAIN failed for captured statement %d", ordinal)
	}
	var explained []placesBD09ExplainRoot
	if err := json.Unmarshal([]byte(rawJSON), &explained); err != nil ||
		len(explained) != 1 || explained[0].Plan.NodeType == "" ||
		explained[0].ExecutionTime <= 0 {
		t.Fatalf("PostgreSQL returned invalid JSON plan for statement %d", ordinal)
	}
	nodes := make([]placesBD09ExplainEvidenceNode, 0, 32)
	placesBD09RedactedPlanNodes(explained[0].Plan, 0, &nodes)
	if len(nodes) == 0 {
		t.Fatalf("no execution plan nodes for statement %d", ordinal)
	}
	return placesBD09ExplainEvidence{
		Sequence:        ordinal,
		HasCount:        strings.Contains(lower, "count("),
		HasOrderBy:      strings.Contains(lower, "order by"),
		HasLimit:        strings.Contains(lower, "limit "),
		PlanningTimeMS:  explained[0].PlanningTime,
		ExecutionTimeMS: explained[0].ExecutionTime,
		Nodes:           nodes,
	}
}

func TestPlacesBD09Owner95kCameraExplain(t *testing.T) {
	if os.Getenv("XD_PLACES_BD09_QUERY_EXPLAIN") != "1" {
		t.Skip("opt-in: disposable PostgreSQL17 95k Owner camera SQL plan")
	}
	if os.Getenv("XD_PLACES_100K_DISPOSABLE_CI") != "1" {
		t.Fatal("requires explicit isolated, disposable CI fixture")
	}
	head := os.Getenv("XD_PLACES_BD09_HEAD")
	if !regexp.MustCompile(`^[a-f0-9]{40}$`).MatchString(head) {
		t.Fatal("source-exact Git HEAD is required")
	}
	db := placesOverview100KDatabase(t, false)
	var owner meta.User
	if err := db.Where("username = ?", "places-perf-owner").
		First(&owner).Error; err != nil || owner.ID == 0 {
		t.Fatal("seeded 100k Owner fixture is unavailable")
	}
	bounds := baiduPhotoMapBounds{
		CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
		West:            118, South: 28, East: 123, North: 33,
	}
	capture := &placesBD09PlanCapture{
		Interface: logger.Default.LogMode(logger.Silent),
	}
	scoped := db.Session(&gorm.Session{Logger: capture})
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	start := time.Now()
	page, err := (&Server{DB: scoped}).queryMediaItemRange(
		ctx, owner.ID, mediaQueryOptions{BaiduViewport: &bounds}, "", 48, 0)
	elapsed := float64(time.Since(start).Microseconds()) / 1000
	cancel()
	if err != nil || page.TotalCount != 95000 || len(page.Items) != 48 {
		t.Fatalf("original 95k Owner Camera Range failed: count=%d items=%d",
			page.TotalCount, len(page.Items))
	}
	capture.mu.Lock()
	statements := append([]string(nil), capture.statements...)
	capture.mu.Unlock()
	if len(statements) < 2 || len(statements) > 8 {
		t.Fatalf("expected bounded original Camera Count and Page queries; observed=%d",
			len(statements))
	}
	sqlPool, err := db.DB()
	if err != nil {
		t.Fatal("disposable PostgreSQL pool unavailable")
	}
	plans := make([]placesBD09ExplainEvidence, 0, len(statements))
	var sawCount, sawOrderedPage bool
	for i, query := range statements {
		proof := placesBD09ExplainProductionSelect(t, sqlPool, i+1, query)
		sawCount = sawCount || proof.HasCount
		sawOrderedPage = sawOrderedPage || (proof.HasOrderBy && proof.HasLimit)
		plans = append(plans, proof)
	}
	if !sawCount || !sawOrderedPage {
		t.Fatal("did not capture both actual Owner Camera Count and ordered Page SQL")
	}
	output := os.Getenv("XD_PLACES_BD09_EXPLAIN_OUTPUT")
	if output == "" {
		t.Fatal("redacted PostgreSQL plan artifact output is required")
	}
	report := struct {
		Head              string                      `json:"ci_git_head"`
		Workload          string                      `json:"workload"`
		OwnerAssets       int                         `json:"owner_assets"`
		DerivedBD09       string                      `json:"derived_bd09"`
		ProviderVerified  bool                        `json:"provider_conversion_verified"`
		CameraCount       int64                       `json:"camera_count"`
		PageItems         int                         `json:"page_items"`
		ProductionRangeMS float64                     `json:"production_range_ms"`
		Plans             []placesBD09ExplainEvidence `json:"plans"`
	}{
		Head: head, Workload: "owner100k_two_cities_95k_camera_gallery_range",
		OwnerAssets: 100000, DerivedBD09: "deterministic_synthetic_offsets",
		ProviderVerified: false, CameraCount: page.TotalCount,
		PageItems: len(page.Items), ProductionRangeMS: elapsed, Plans: plans,
	}
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatal("redacted plan encoding failed")
	}
	if err := os.MkdirAll(filepath.Dir(output), 0755); err != nil {
		t.Fatal("redacted plan artifact directory unavailable")
	}
	if err := os.WriteFile(output, append(data, '\n'), 0644); err != nil {
		t.Fatal("redacted plan artifact writing failed")
	}
	t.Logf("PLACES_BD09_95K_EXPLAIN source=%s count=%d items=%d statements=%d nodes=%d original_ms=%.3f",
		head, page.TotalCount, len(page.Items), len(plans), len(plans[0].Nodes), elapsed)
}
