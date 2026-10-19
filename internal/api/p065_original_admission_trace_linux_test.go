//go:build linux

package api

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// P065 isolates the ORIGINAL folder-Copy HTTP enqueue, not the Copy Worker.
// The opt-in, test-only Trace never saves SQL text, bind parameters,
// Bearer credentials, share tokens or source identifiers.
type p065AdmissionSQLTrace struct {
	logger.Interface
	mu         sync.Mutex
	statements map[string]*p065SQLBucket
}
type p065SQLBucket struct {
	Count   int64   `json:"count"`
	TotalMS float64 `json:"trace_wall_ms"`
	WorstMS float64 `json:"worst_trace_wall_ms"`
}

func p065AdmissionSQLClass(sql string) string {
	if len(sql) > 4096 {
		sql = sql[:4096]
	}
	sql = strings.ToLower(strings.TrimSpace(sql))
	switch {
	case strings.Contains(sql, "with recursive tree as") && strings.Contains(sql, "sum(f.size)"):
		return "recursive_size_CTE"
	case strings.Contains(sql, "with recursive") && strings.Contains(sql, "xd_nodes"):
		return "ancestor_scope_CTE"
	case strings.Contains(sql, "xd_file_operations") && strings.HasPrefix(sql, "insert"):
		return "queued_operation_insert"
	case strings.Contains(sql, "xd_nodes") && strings.Contains(sql, "for update"):
		return "node_lock"
	case strings.Contains(sql, "xd_nodes"):
		return "node_validation"
	case strings.Contains(sql, "xd_files"):
		return "file_metadata"
	case strings.Contains(sql, "xd_users"):
		return "owner_auth"
	default:
		return "other"
	}
}
func (p *p065AdmissionSQLTrace) Trace(_ context.Context, begin time.Time, fc func() (string, int64), _ error) {
	sql, _ := fc()
	label := p065AdmissionSQLClass(sql)
	ms := float64(time.Since(begin).Microseconds()) / 1000
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.statements == nil {
		p.statements = make(map[string]*p065SQLBucket, 8)
	}
	row := p.statements[label]
	if row == nil {
		row = &p065SQLBucket{}
		p.statements[label] = row
	}
	row.Count++
	row.TotalMS += ms
	if ms > row.WorstMS {
		row.WorstMS = ms
	}
}
func (p *p065AdmissionSQLTrace) snapshot() map[string]p065SQLBucket {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make(map[string]p065SQLBucket, len(p.statements))
	for name, row := range p.statements {
		out[name] = *row
	}
	return out
}

type p065AdmissionPGActivity struct {
	DB         *gorm.DB
	stop       chan struct{}
	done       chan struct{}
	once       sync.Once
	mu         sync.Mutex
	polls      int
	peakActive int
	waits      map[string]int
	failures   int
}

func p065StartAdmissionPGActivity(db *gorm.DB) *p065AdmissionPGActivity {
	p := &p065AdmissionPGActivity{DB: db, stop: make(chan struct{}), done: make(chan struct{}), waits: map[string]int{}}
	go func() {
		defer close(p.done)
		ticker := time.NewTicker(250 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-p.stop:
				return
			case <-ticker.C:
			}
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			var rows []struct {
				WaitType string `gorm:"column:wait_type"`
			}
			err := db.WithContext(ctx).Raw(`
SELECT COALESCE(wait_event_type, 'on_cpu_or_running') AS wait_type
FROM pg_stat_activity
WHERE datname = current_database() AND backend_type = 'client backend'
  AND state = 'active' AND pid <> pg_backend_pid()
  AND query NOT LIKE '%pg_stat_activity%'`).Scan(&rows).Error
			cancel()
			p.mu.Lock()
			p.polls++
			if err != nil {
				p.failures++
			} else {
				if len(rows) > p.peakActive {
					p.peakActive = len(rows)
				}
				for _, row := range rows {
					label := "other"
					switch row.WaitType {
					case "on_cpu_or_running", "Lock", "LWLock", "IO", "Client", "IPC", "Timeout":
						label = row.WaitType
					}
					p.waits[label]++
				}
			}
			p.mu.Unlock()
		}
	}()
	return p
}
func (p *p065AdmissionPGActivity) snapshotAndStop() map[string]any {
	p.once.Do(func() { close(p.stop) })
	<-p.done
	p.mu.Lock()
	defer p.mu.Unlock()
	counts := make(map[string]int, len(p.waits))
	for k, v := range p.waits {
		counts[k] = v
	}
	return map[string]any{"sample_polls": p.polls, "poll_query_errors": p.failures,
		"peak_active_client_backends": p.peakActive, "active_wait_type_observations": counts,
		"scope": "250ms bounded test-only pg_stat_activity wait-type counts, not a PID-exact SQL trace; no raw query/credentials captured"}
}

type p065TableStat struct {
	Table         string     `gorm:"column:relname" json:"table"`
	LiveEstimate  int64      `gorm:"column:n_live_tup" json:"live_estimate"`
	DeadEstimate  int64      `gorm:"column:n_dead_tup" json:"dead_estimate"`
	AnalyzeAt     *time.Time `gorm:"column:last_analyze" json:"last_analyze,omitempty"`
	AutoAnalyzeAt *time.Time `gorm:"column:last_autoanalyze" json:"last_autoanalyze,omitempty"`
}

func p065PostseedStats(ctx context.Context, db *gorm.DB) ([]p065TableStat, error) {
	var rows []p065TableStat
	err := db.WithContext(ctx).Raw(`
SELECT relname,n_live_tup,n_dead_tup,last_analyze,last_autoanalyze
FROM pg_stat_user_tables
WHERE schemaname=current_schema()
AND relname IN ('xd_nodes','xd_files','xd_file_operations')
ORDER BY relname`).Scan(&rows).Error
	return rows, err
}

// This exact recursive size query is the ORIGINAL admission SQL and is run
// only AFTER the authentic owner HTTP POST, separately marked "postflight".
// Running EXPLAIN before POST could warm the cache and hide a cold-seed stall.
func p065PostflightExplain(ctx context.Context, db *gorm.DB, rootID, ownerID uint64) map[string]any {
	c, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var raw string
	err := db.WithContext(c).Raw(`
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
WITH RECURSIVE tree AS (
 SELECT id FROM xd_nodes
 WHERE id IN (?) AND owner_id = ? AND deleted_at IS NULL
 UNION
 SELECT n.id FROM xd_nodes n JOIN tree t ON n.parent_id = t.id
 WHERE n.owner_id = ? AND n.deleted_at IS NULL
),
total AS (
 SELECT COALESCE(SUM(f.size), 0)::numeric AS bytes
 FROM tree LEFT JOIN xd_files f ON f.node_id=tree.id
)
SELECT CASE WHEN bytes > 9223372036854775807 THEN 9223372036854775807
 WHEN bytes < -9223372036854775808 THEN -9223372036854775808
 ELSE bytes END::bigint AS bytes,
 (bytes > 9223372036854775807 OR bytes < -9223372036854775808) AS overflow
FROM total`, []uint64{rootID}, ownerID, ownerID).Row().Scan(&raw)
	if err != nil {
		return map[string]any{"error_class": "postflight_explain_unavailable", "timed_out": errors.Is(err, context.DeadlineExceeded)}
	}
	var row []struct {
		PlanningTime  float64        `json:"Planning Time"`
		ExecutionTime float64        `json:"Execution Time"`
		Plan          map[string]any `json:"Plan"`
	}
	if err = json.Unmarshal([]byte(raw), &row); err != nil || len(row) != 1 {
		return map[string]any{"error_class": "postflight_plan_decode_error"}
	}
	plan := row[0].Plan
	out := map[string]any{
		"planning_ms": row[0].PlanningTime, "execution_ms": row[0].ExecutionTime,
		"root_plan_type": plan["Node Type"], "estimated_root_rows": plan["Plan Rows"],
		"actual_root_rows":    plan["Actual Rows"],
		"shared_hit_blocks":   plan["Shared Hit Blocks"],
		"shared_read_blocks":  plan["Shared Read Blocks"],
		"temp_read_blocks":    plan["Temp Read Blocks"],
		"temp_written_blocks": plan["Temp Written Blocks"],
		"scope":               "same original recursive size SQL, EXPLAIN after HTTP response; no raw plan or bind values persisted",
	}
	return out
}
