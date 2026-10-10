package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// This is a test-only native PostgreSQL diagnostic. The original production
// Worker SQL, 100-item checkpoint cadence, authorization, and cancellation
// remain unchanged. It measures plans separately from Worker wall-clock time.
type galleryWorkerExplainRecord struct {
	Scale int `json:"scale"`

	Offset int `json:"offset"`

	Repeat int `json:"repeat"`

	Category string `json:"category"`

	StatsPhase string `json:"stats_phase"`

	SourceRows int `json:"source_rows"`

	PlanningMS float64 `json:"planning_ms"`

	ExecutionMS float64 `json:"execution_ms"`

	PlanNodes []string `json:"plan_nodes"`

	SharedHitBlocks float64 `json:"shared_hit_blocks"`

	SharedReadBlocks float64 `json:"shared_read_blocks"`

	TempReadBlocks float64 `json:"temp_read_blocks"`

	TempWrittenBlocks float64 `json:"temp_written_blocks"`

	PlanJSON json.RawMessage `json:"plan_json"`
}

func galleryExplainNumber(value any) float64 {
	n, _ := value.(float64)
	return n
}

func galleryExplainNodes(node map[string]any, names *[]string) {
	kind, _ := node["Node Type"].(string)
	index, _ := node["Index Name"].(string)
	if index != "" {
		*names = append(*names, kind+" ["+index+"]")
	} else if kind != "" {
		*names = append(*names, kind)
	}
	for _, child := range galleryExplainChildren(node["Plans"]) {
		galleryExplainNodes(child, names)
	}
}

func galleryExplainChildren(raw any) []map[string]any {
	list, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(list))
	for _, child := range list {
		if plan, ok := child.(map[string]any); ok {
			out = append(out, plan)
		}
	}
	return out
}

func galleryRunWorkerExplain(ctx context.Context, sqlDB *sql.DB, statement *gorm.Statement,
	scale, offset, repeat int, category, statsPhase string) (galleryWorkerExplainRecord, error) {
	record := galleryWorkerExplainRecord{
		Scale: scale, Offset: offset, Repeat: repeat,
		Category: category, StatsPhase: statsPhase, SourceRows: 100,
	}
	if statement == nil || statement.SQL.Len() == 0 {
		return record, fmt.Errorf("empty production-equivalent %s statement", category)
	}
	sqlText := "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + statement.SQL.String()
	var payload []byte
	if err := sqlDB.QueryRowContext(ctx, sqlText, statement.Vars...).Scan(&payload); err != nil {
		return record, fmt.Errorf("postgres explain %s: %w", category, err)
	}
	var reports []map[string]any
	if err := json.Unmarshal(payload, &reports); err != nil || len(reports) != 1 {
		return record, fmt.Errorf("decode postgres explain %s: %v", category, err)
	}
	plan, ok := reports[0]["Plan"].(map[string]any)
	if !ok {
		return record, fmt.Errorf("postgres explain %s missing plan", category)
	}
	if actualRows := galleryExplainNumber(plan["Actual Rows"]); actualRows != 100 {
		return record, fmt.Errorf("%s offset %d expected 100 plan rows, got %v",
			category, offset, actualRows)
	}
	record.PlanningMS = galleryExplainNumber(reports[0]["Planning Time"])
	record.ExecutionMS = galleryExplainNumber(reports[0]["Execution Time"])
	record.SharedHitBlocks = galleryExplainNumber(plan["Shared Hit Blocks"])
	record.SharedReadBlocks = galleryExplainNumber(plan["Shared Read Blocks"])
	record.TempReadBlocks = galleryExplainNumber(plan["Temp Read Blocks"])
	record.TempWrittenBlocks = galleryExplainNumber(plan["Temp Written Blocks"])
	galleryExplainNodes(plan, &record.PlanNodes)
	record.PlanJSON = append([]byte(nil), payload...)
	return record, nil
}

func TestGalleryWorkerNodeAssetQueryPlan100K(t *testing.T) {
	if os.Getenv("XD_GALLERY_WORKER_QUERY_PLAN_PERF") != "1" {
		t.Skip("native PostgreSQL query-plan performance opt-in only")
	}
	for _, scale := range []int{10000, 100000} {
		t.Run(fmt.Sprintf("%d", scale), func(t *testing.T) {
			db := newDurableSelectionJobDB(t)
			owner := meta.User{
				Username:     fmt.Sprintf("gallery-plan-%d", scale),
				PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1,
			}
			if err := db.Create(&owner).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Exec(`INSERT INTO xd_nodes(owner_id,name,type,revision,created_at,updated_at)
				SELECT ?, 'plan-'||s::text||'.jpg','file',1,NOW(),NOW()
				FROM generate_series(1,?) AS s`, owner.ID, scale).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Exec(`INSERT INTO xd_photo_assets(owner_id,primary_node_id,kind,evidence_key,created_at,updated_at)
				SELECT owner_id,id,'image','plan:'||id::text,NOW(),NOW()
				FROM xd_nodes WHERE owner_id=?`, owner.ID).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Exec(`INSERT INTO xd_photo_metadata(asset_id,media_kind,mime_type,created_at,updated_at)
				SELECT id,'image','image/jpeg',NOW(),NOW()
				FROM xd_photo_assets WHERE owner_id=?`, owner.ID).Error; err != nil {
				t.Fatal(err)
			}
			sqlDB, err := db.DB()
			if err != nil {
				t.Fatal(err)
			}
			// The first arm intentionally replays the original just-seeded PostgreSQL
			// fixture without ANALYZE. The second arm updates only PostgreSQL
			// statistics, not indexes, production SQL, Worker code or business data.
			for _, statsPhase := range []string{"before_analyze", "after_analyze"} {
				if statsPhase == "after_analyze" {
					for _, table := range []string{"xd_nodes", "xd_photo_assets"} {
						if err := db.Exec("ANALYZE " + table).Error; err != nil {
							t.Fatal(err)
						}
					}
				}
				for _, offset := range []int{0, scale / 2, scale - 100} {
					var ids []uint64
					if err := db.Model(&meta.Node{}).
						Where("owner_id = ?", owner.ID).
						Order("id ASC").Offset(offset).Limit(100).
						Pluck("id", &ids).Error; err != nil {
						t.Fatal(err)
					}
					if len(ids) != 100 {
						t.Fatalf("scale=%d offset=%d selected %d nodes", scale, offset, len(ids))
					}
					nodeDry := db.Session(&gorm.Session{DryRun: true}).
						Clauses(clause.Locking{Strength: "UPDATE"}).
						Where("id IN ? AND owner_id = ? AND deleted_at IS NULL", ids, owner.ID).
						Order("id ASC").Find(&[]meta.Node{})
					if nodeDry.Error != nil {
						t.Fatal(nodeDry.Error)
					}
					assetDry := db.Session(&gorm.Session{DryRun: true}).
						Where("owner_id = ? AND primary_node_id IN ?", owner.ID, ids).
						Find(&[]meta.PhotoAsset{})
					if assetDry.Error != nil {
						t.Fatal(assetDry.Error)
					}
					for repeat := 1; repeat <= 2; repeat++ {
						for _, query := range []struct {
							category string
							stmt     *gorm.Statement
						}{
							{"nodes", nodeDry.Statement},
							{"assets", assetDry.Statement},
						} {
							ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
							r, err := galleryRunWorkerExplain(ctx, sqlDB, query.stmt,
								scale, offset, repeat, query.category, statsPhase)
							cancel()
							if err != nil {
								t.Fatal(err)
							}
							b, _ := json.Marshal(r)
							t.Logf("G07_WORKER_QUERY_EXPLAIN %s", strings.TrimSpace(string(b)))
						}
					}
				}
			}
		})
	}
}
