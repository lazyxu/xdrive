package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func backupSnapshotPageFixture(t *testing.T, total int) (*Server, string, backupAdminSnapshotIndex) {
	t.Helper()
	server, dir := readyBackupAdminTestServer(t)
	ids := make([]string, 0, total)
	snapshots := make([]backupAdminSnapshot, 0, 100)
	start := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := total - 1; i >= 0; i-- {
		stamp := start.Add(time.Duration(i) * time.Minute)
		name := "xdrive-backup-" + stamp.Format("20060102T150405Z")
		id := "v1:" + name
		ids = append(ids, id)
		if len(snapshots) < 100 {
			snapshots = append(snapshots, backupAdminSnapshot{
				ID: id, Name: name, Format: "v1", State: "complete",
				FileDataIncluded: true, CreatedAt: stamp.Format(time.RFC3339),
			})
		}
	}
	created := time.Now().UTC().Format(time.RFC3339)
	truncated := total > len(snapshots)
	inventory := backupAdminInventory{
		Protocol: backupAdminProtocol, GeneratedAt: created,
		Policy: backupAdminPolicy{
			ScheduleFormat: "v1", RetentionDays: 7, Revision: testPolicyRevision,
		},
		Snapshots: snapshots, TotalSnapshots: &total, Truncated: &truncated,
	}
	writeBackupTestJSON(t, dir, "backup-admin-inventory.json", inventory)
	limit := total
	if limit > 1000 {
		limit = 1000
	}
	index := backupAdminSnapshotIndex{
		Protocol: "xdrive-backup-snapshot-index-v1",
		GeneratedAt: created, PolicyRevision: testPolicyRevision,
		TotalSnapshots: total, IndexedSnapshots: limit, Truncated: total > limit,
		SnapshotIDs: ids[:limit],
	}
	writeBackupTestJSON(t, dir, "backup-admin-snapshot-index.json", index)
	return server, dir, index
}

func callBackupSnapshotPage(t *testing.T, server *Server, query string) (int, backupAdminSnapshotPageResponse, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	out := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(out)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/backups/snapshots"+query, nil)
	server.adminBackupSnapshotPage(ctx)
	var result backupAdminSnapshotPageResponse
	_ = json.Unmarshal(out.Body.Bytes(), &result)
	return out.Code, result, out.Header().Get("Cache-Control")
}

func TestBackupSnapshotPageReadsActualHostIndexBeyondFirstHundred(t *testing.T) {
	server, dir, index := backupSnapshotPageFixture(t, 105)
	for _, tc := range []struct {
		query string
		start int
		count int
		next  bool
	}{
		{"?offset=0&limit=20", 0, 20, true},
		{"?offset=100&limit=10", 100, 5, false},
		{"?offset=105&limit=20", 105, 0, false},
	} {
		status, page, cache := callBackupSnapshotPage(t, server, tc.query)
		if status != http.StatusOK || cache != "no-store" ||
			page.Scope != "unverified_identity_only" ||
			page.TotalSnapshots != 105 || page.IndexedSnapshots != 105 ||
			page.Truncated || page.Offset != tc.start ||
			len(page.SnapshotIDs) != tc.count {
			t.Fatalf("%s: code=%d cache=%q page=%+v", tc.query, status, cache, page)
		}
		for i, id := range page.SnapshotIDs {
			if id != index.SnapshotIDs[tc.start+i] {
				t.Fatalf("paged identity mismatch: %s != %s", id, index.SnapshotIDs[tc.start+i])
			}
		}
		if (page.NextOffset != nil) != tc.next {
			t.Fatalf("next page state incorrect for %s", tc.query)
		}
	}
	for _, query := range []string{
		"?offset=-1", "?offset=1001", "?offset=2&offset=3",
		"?limit=0", "?limit=101", "?limit=1.2",
		"?path=/etc", "?snapshot_id=v1:../../etc",
	} {
		status, _, _ := callBackupSnapshotPage(t, server, query)
		if status != http.StatusBadRequest {
			t.Fatalf("unsafe query accepted %q: %d", query, status)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "backup-admin-request.json")); !os.IsNotExist(err) {
		t.Fatalf("read-only pages queued Host action: %v", err)
	}
}

func TestBackupSnapshotPageBoundedIndexReportsTruncation(t *testing.T) {
	server, _, _ := backupSnapshotPageFixture(t, 1005)
	status, page, _ := callBackupSnapshotPage(t, server, "?offset=950&limit=100")
	if status != http.StatusOK || len(page.SnapshotIDs) != 50 ||
		page.TotalSnapshots != 1005 || page.IndexedSnapshots != 1000 ||
		!page.Truncated || page.NextOffset != nil {
		t.Fatalf("truncated window mismatch code=%d page=%+v", status, page)
	}
	status, _, _ = callBackupSnapshotPage(t, server, "?offset=1000&limit=50")
	if status != http.StatusConflict {
		t.Fatalf("truncated index falsely implied end of inventory: %d", status)
	}
}

func TestBackupSnapshotPageRejectsStaleForgedAndSymlinkedIndex(t *testing.T) {
	for _, scenario := range []string{
		"revision", "count", "wrong_newest", "duplicate", "unsorted",
		"foreign_id", "stale", "bad_protocol", "symlink",
	} {
		t.Run(scenario, func(t *testing.T) {
			server, dir, index := backupSnapshotPageFixture(t, 105)
			switch scenario {
			case "revision":
				index.PolicyRevision = fmt.Sprintf("%064d", 1)
			case "count":
				index.TotalSnapshots++
			case "wrong_newest":
				index.SnapshotIDs[0] = "v2-default:xdrive-backup-20261231T000000Z"
			case "duplicate":
				index.SnapshotIDs[50] = index.SnapshotIDs[49]
			case "unsorted":
				index.SnapshotIDs[0], index.SnapshotIDs[1] = index.SnapshotIDs[1], index.SnapshotIDs[0]
			case "foreign_id":
				index.SnapshotIDs[101] = "v1:../../etc"
			case "stale":
				index.GeneratedAt = time.Now().UTC().Add(-10*time.Minute).Format(time.RFC3339)
			case "bad_protocol":
				index.Protocol = "untrusted"
			case "symlink":
				target := filepath.Join(dir, "external-index.json")
				writeBackupTestJSON(t, dir, "external-index.json", index)
				if err := os.Remove(filepath.Join(dir, "backup-admin-snapshot-index.json")); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, filepath.Join(dir, "backup-admin-snapshot-index.json")); err != nil {
					t.Skipf("symlink unsupported on this host: %v", err)
				}
			}
			if scenario != "symlink" {
				writeBackupTestJSON(t, dir, "backup-admin-snapshot-index.json", index)
			}
			status, _, _ := callBackupSnapshotPage(t, server, "?offset=100&limit=10")
			if status != http.StatusServiceUnavailable {
				t.Fatalf("untrusted index %s returned %d", scenario, status)
			}
		})
	}
}
