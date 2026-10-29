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
		Protocol:    "xdrive-backup-snapshot-index-v1",
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
		"?offset=-1", "?offset=", "?offset=1001", "?offset=2&offset=3",
		"?limit=0", "?limit=", "?limit=101", "?limit=1.2",
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


func TestBackupSnapshotPageV2IndexesTenThousandAndPreservesOlderVerifyOnly(t *testing.T) {
	const total = 10005
	server, dir, index := backupSnapshotPageFixture(t, total)
	index.Protocol = "xdrive-backup-snapshot-index-v2"
	index.IndexedSnapshots = 10000
	index.Truncated = true
	index.SnapshotIDs = make([]string, 0, index.IndexedSnapshots)
	start := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := total - 1; i >= total-index.IndexedSnapshots; i-- {
		name := "xdrive-backup-" + start.Add(time.Duration(i)*time.Minute).Format("20060102T150405Z")
		index.SnapshotIDs = append(index.SnapshotIDs, "v1:"+name)
	}
	writeBackupTestJSON(t, dir, "backup-admin-snapshot-index.json", index)
	for _, test := range []struct {
		query string
		count int
		first int
		next bool
	}{
		{"?offset=9950&limit=100", 50, 9950, false},
		{"?offset=1001&limit=50", 50, 1001, true},
		{"?offset=10000&limit=50", -1, 0, false},
	} {
		status, page, _ := callBackupSnapshotPage(t, server, test.query)
		if test.count == -1 {
			if status != http.StatusConflict {
				t.Fatalf("missing truncated boundary for %s: %d", test.query, status)
			}
			continue
		}
		if status != http.StatusOK || page.IndexedSnapshots != 10000 ||
			page.TotalSnapshots != total || !page.Truncated ||
			len(page.SnapshotIDs) != test.count ||
			(page.NextOffset != nil) != test.next ||
			page.SnapshotIDs[0] != index.SnapshotIDs[test.first] {
			t.Fatalf("v2 page %s: status=%d page=%+v", test.query, status, page)
		}
	}
	if status, _, _ := callBackupSnapshotPage(t, server, "?offset=10001&limit=50"); status != http.StatusBadRequest {
		t.Fatalf("out-of-range offset accepted: %d", status)
	}
	older := index.SnapshotIDs[9999]
	if code, body := runBackupAdminAction(t, server,
		fmt.Sprintf(`{"action":"verify","snapshot_id":%q,"mode":"deep"}`, older)); code != http.StatusAccepted {
		t.Fatalf("v2 index entry 10000 was not permitted for verify: %d %s", code, body)
	}
	if err := os.Remove(filepath.Join(dir, "backup-admin-request.json")); err != nil {
		t.Fatal(err)
	}
	if code, _ := runBackupAdminAction(t, server,
		fmt.Sprintf(`{"action":"restore","snapshot_id":%q,"confirmation":%q}`,
			older, "RESTORE "+older)); code != http.StatusConflict {
		t.Fatalf("old read-only v2 identity authorized destructive restore: %d", code)
	}
	if _, err := os.Stat(filepath.Join(dir, "backup-admin-request.json")); !os.IsNotExist(err) {
		t.Fatalf("rejected old restore enqueued a Host action: %v", err)
	}
	index.IndexedSnapshots = 10001
	index.SnapshotIDs = append(index.SnapshotIDs, "v1:xdrive-backup-20240101T000000Z")
	writeBackupTestJSON(t, dir, "backup-admin-snapshot-index.json", index)
	if status, _, _ := callBackupSnapshotPage(t, server, "?offset=100&limit=50"); status != http.StatusServiceUnavailable {
		t.Fatalf("unsafe oversized v2 index was accepted: %d", status)
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
				index.GeneratedAt = time.Now().UTC().Add(-10 * time.Minute).Format(time.RFC3339)
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

func TestBackupAdminOlderIndexVerifyOnly(t *testing.T) {
	server, dir, index := backupSnapshotPageFixture(t, 105)
	older := index.SnapshotIDs[104]
	verification := fmt.Sprintf(`{"action":"verify","snapshot_id":%q,"mode":"fast"}`, older)
	code, body := runBackupAdminAction(t, server, verification)
	if code != http.StatusAccepted {
		t.Fatalf("older read-only verification rejected: %d %s", code, body)
	}
	var request backupAdminRequest
	if err := readSafeBackupAdminJSON(dir, "backup-admin-request.json", 2048, &request); err != nil {
		t.Fatal(err)
	}
	if request.Action != "verify" || request.SnapshotID != older ||
		request.Mode != "fast" || request.RequestID == "" {
		t.Fatalf("untrusted older verification request: %+v", request)
	}
	if err := os.Remove(filepath.Join(dir, "backup-admin-request.json")); err != nil {
		t.Fatal(err)
	}
	for _, action := range []struct{ action, confirmation string }{
		{"restore", "RESTORE " + older},
		{"delete", "DELETE " + older},
		{"restore_database_only", "DATABASE ONLY RESTORE " + older},
	} {
		body := fmt.Sprintf(`{"action":%q,"snapshot_id":%q,"confirmation":%q}`,
			action.action, older, action.confirmation)
		if code, _ := runBackupAdminAction(t, server, body); code != http.StatusConflict {
			t.Fatalf("older identity authorized destructive %s: %d", action.action, code)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "backup-admin-request.json")); !os.IsNotExist(err) {
		t.Fatalf("rejected older destructive action enqueued: %v", err)
	}
}

func TestBackupAdminOlderIndexVerificationFailsClosed(t *testing.T) {
	for _, scenario := range []string{
		"missing", "stale", "revision", "wrong_newest", "duplicate",
		"unindexed", "symlink",
	} {
		t.Run(scenario, func(t *testing.T) {
			server, dir, index := backupSnapshotPageFixture(t, 105)
			id := index.SnapshotIDs[100]
			switch scenario {
			case "missing":
				if err := os.Remove(filepath.Join(dir, "backup-admin-snapshot-index.json")); err != nil {
					t.Fatal(err)
				}
			case "stale":
				index.GeneratedAt = time.Now().UTC().Add(-10 * time.Minute).Format(time.RFC3339)
			case "revision":
				index.PolicyRevision = fmt.Sprintf("%064d", 1)
			case "wrong_newest":
				index.SnapshotIDs[0] = "v2-default:xdrive-backup-20261231T000000Z"
			case "duplicate":
				index.SnapshotIDs[101] = index.SnapshotIDs[100]
			case "unindexed":
				id = "v1:xdrive-backup-20200101T000000Z"
			case "symlink":
				target := filepath.Join(dir, "not-host-index.json")
				writeBackupTestJSON(t, dir, "not-host-index.json", index)
				if err := os.Remove(filepath.Join(dir, "backup-admin-snapshot-index.json")); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, filepath.Join(dir, "backup-admin-snapshot-index.json")); err != nil {
					t.Skipf("symlink unavailable: %v", err)
				}
			}
			if scenario != "missing" && scenario != "symlink" {
				writeBackupTestJSON(t, dir, "backup-admin-snapshot-index.json", index)
			}
			body := fmt.Sprintf(`{"action":"verify","snapshot_id":%q,"mode":"deep"}`, id)
			if code, _ := runBackupAdminAction(t, server, body); code != http.StatusConflict {
				t.Fatalf("%s allowed untrusted older verify: %d", scenario, code)
			}
			if _, err := os.Stat(filepath.Join(dir, "backup-admin-request.json")); !os.IsNotExist(err) {
				t.Fatalf("%s wrote Host queue: %v", scenario, err)
			}
		})
	}
	server, dir, index := backupSnapshotPageFixture(t, 1005)
	id := index.SnapshotIDs[999]
	if code, body := runBackupAdminAction(t, server,
		fmt.Sprintf(`{"action":"verify","snapshot_id":%q,"mode":"deep"}`, id)); code != http.StatusAccepted {
		t.Fatalf("indexed entry 1000 incorrectly rejected: %d %s", code, body)
	}
	if err := os.Remove(filepath.Join(dir, "backup-admin-request.json")); err != nil {
		t.Fatal(err)
	}
	// A truncated Host index contains no proof of entry #1001.
	id = "v1:xdrive-backup-20240101T000000Z"
	if code, _ := runBackupAdminAction(t, server,
		fmt.Sprintf(`{"action":"verify","snapshot_id":%q,"mode":"fast"}`, id)); code != http.StatusConflict {
		t.Fatalf("unindexed older entry was authorized: %d", code)
	}
}
