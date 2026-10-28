package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

const testBackupID = "v2-default:xdrive-backup-20261027T030000Z"
const testPolicyRevision = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func writeBackupTestJSON(t *testing.T, dir, name string, object any) {
	t.Helper()
	data, err := json.Marshal(object)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), append(data, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
}

func readyBackupAdminTestServer(t *testing.T) (*Server, string) {
	t.Helper()
	dir := t.TempDir()
	writeBackupTestJSON(t, dir, "backup-admin-inventory.json", backupAdminInventory{
		Protocol: backupAdminProtocol, GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Policy: backupAdminPolicy{ScheduleFormat: "v2", RetentionDays: 7, Repository: "/backups/incremental", Revision: testPolicyRevision},
		Snapshots: []backupAdminSnapshot{
			{ID: testBackupID, Name: "xdrive-backup-20261027T030000Z", Format: "v2", CreatedAt: "2026-10-27T03:00:00Z", State: "complete", Bytes: 4096, FileDataIncluded: true},
			{ID: "v1:xdrive-backup-20261026T030000Z", Name: "xdrive-backup-20261026T030000Z", Format: "v1", CreatedAt: "2026-10-26T03:00:00Z", State: "complete", Bytes: 8192, FileDataIncluded: true},
		},
	})
	writeBackupTestJSON(t, dir, "backup-admin-status.json", backupAdminStatus{Protocol: backupAdminProtocol, State: "idle"})
	if err := os.WriteFile(filepath.Join(dir, "heartbeat"), []byte("ok"), 0600); err != nil {
		t.Fatal(err)
	}
	return &Server{HostControlDir: dir}, dir
}

func runBackupAdminAction(t *testing.T, server *Server, body string) (int, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	res := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(res)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/v1/admin/backups/actions", strings.NewReader(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Set("user", meta.User{Username: "admin", Role: meta.UserRoleAdmin})
	server.adminSubmitBackupManagement(ctx)
	return res.Code, res.Body.String()
}

func TestBackupAdminRejectsUnboundedActionsAndUntrustedPaths(t *testing.T) {
	server, dir := readyBackupAdminTestServer(t)
	for _, body := range []string{
		`{"action":"restore","snapshot_id":"v2-default:../../etc/shadow","confirmation":"RESTORE v2-default:../../etc/shadow"}`,
		`{"action":"restore","snapshot_id":"` + testBackupID + `","confirmation":"RESTORE different"}`,
		`{"action":"drill","snapshot_id":"` + testBackupID + `","confirmation":"DRILL different"}`,
		`{"action":"drill","snapshot_id":"v1:xdrive-backup-20261026T030000Z","confirmation":"DRILL v1:xdrive-backup-20261026T030000Z"}`,
		`{"action":"drill","snapshot_id":"` + testBackupID + `","confirmation":"DRILL ` + testBackupID + `","max_mib":8192}`,
		`{"action":"delete","snapshot_id":"` + testBackupID + `","confirmation":"DELETE ` + testBackupID + `"}`,
		`{"action":"prune","keep_last":0,"confirmation":"PRUNE 0"}`,
		`{"action":"prune","keep_last":2,"confirmation":"PRUNE 3"}`,
		`{"action":"create","format":"v2","repository_dir":"/etc"}`,
		`{"action":"create","format":"v2","command":"rm -rf /"}`,
		`{"action":"plan","keep_last":2,"mode":"invalid"}`,
		`{"action":"verify_all","mode":"invalid"}`,
		`{"action":"verify_all","mode":"deep","snapshot_id":"` + testBackupID + `"}`,
		`{"action":"verify_all","mode":"fast","limit":1000000}`,
		`{"action":"verify_all","mode":"fast","command":"id"}`,
		`{"action":"policy","format":"v2","retention_days":7,"revision":"bbbb"}`,
		`{"action":"exec","command":"id"}`,
		`{"action":"verify","snapshot_id":"` + testBackupID + `","mode":"fast","path":"/tmp"}`,
		`{"action":"verify","snapshot_id":"` + testBackupID + `","mode":"fast"}{"action":"prune","keep_last":1}`,
	} {
		status, message := runBackupAdminAction(t, server, body)
		if status != http.StatusBadRequest {
			t.Fatalf("malformed action %q: status=%d body=%s", body, status, message)
		}
		if _, err := os.Stat(filepath.Join(dir, "backup-admin-request.json")); !os.IsNotExist(err) {
			t.Fatalf("invalid action wrote host request: %v", err)
		}
	}
}

func TestBackupAdminQueuesExactReadActionAndFencesConcurrentRequests(t *testing.T) {
	server, dir := readyBackupAdminTestServer(t)
	body := `{"action":"verify","snapshot_id":"` + testBackupID + `","mode":"deep"}`
	status, response := runBackupAdminAction(t, server, body)
	if status != http.StatusAccepted {
		t.Fatalf("status=%d response=%s", status, response)
	}
	var receipt backupAdminStatus
	if err := json.Unmarshal([]byte(response), &receipt); err != nil {
		t.Fatal(err)
	}
	if receipt.State != "queued" || receipt.RequestID == "" || receipt.SnapshotID != testBackupID {
		t.Fatalf("receipt=%+v", receipt)
	}
	path := filepath.Join(dir, "backup-admin-request.json")
	st, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && st.Mode().Perm() != 0660 {
		t.Fatalf("request file mode=%#o", st.Mode().Perm())
	}
	var request backupAdminRequest
	if err := readSafeBackupAdminJSON(dir, "backup-admin-request.json", 2048, &request); err != nil {
		t.Fatal(err)
	}
	if request.Protocol != backupAdminProtocol || request.Action != "verify" || request.SnapshotID != testBackupID ||
		request.Mode != "deep" || request.RequestedBy != "admin" || request.RequestID != receipt.RequestID {
		t.Fatalf("host request=%+v", request)
	}
	if state := server.backupAdminState(); !state.Supported || state.Operation.State != "queued" {
		t.Fatalf("not queued in UI state: %+v", state)
	}
	if status, _ := runBackupAdminAction(t, server, `{"action":"create","format":"v2"}`); status != http.StatusConflict {
		t.Fatalf("concurrent action accepted: %d", status)
	}
}

func TestBackupAdminDatabaseOnlyCannotFullRestore(t *testing.T) {
	server, dir := readyBackupAdminTestServer(t)
	writeBackupTestJSON(t, dir, "backup-admin-inventory.json", backupAdminInventory{
		Protocol: backupAdminProtocol, GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Policy: backupAdminPolicy{ScheduleFormat: "v1", RetentionDays: 7, Revision: testPolicyRevision},
		Snapshots: []backupAdminSnapshot{{
			ID: "v1:xdrive-backup-20261026T030000Z", Name: "xdrive-backup-20261026T030000Z",
			Format: "v1", State: "complete", FileDataIncluded: false, CreatedAt: "2026-10-26T03:00:00Z",
		}},
	})
	body := `{"action":"restore","snapshot_id":"v1:xdrive-backup-20261026T030000Z","confirmation":"RESTORE v1:xdrive-backup-20261026T030000Z"}`
	status, _ := runBackupAdminAction(t, server, body)
	if status != http.StatusConflict {
		t.Fatalf("accepted full restore from database-only archive: %d", status)
	}
	if _, err := os.Stat(filepath.Join(dir, "backup-admin-request.json")); !os.IsNotExist(err) {
		t.Fatalf("unsafe restore queued: %v", err)
	}
}

func TestBackupAdminCanVerifyInconsistentButCannotRestoreIt(t *testing.T) {
	server, dir := readyBackupAdminTestServer(t)
	writeBackupTestJSON(t, dir, "backup-admin-inventory.json", backupAdminInventory{
		Protocol: backupAdminProtocol, GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Policy: backupAdminPolicy{ScheduleFormat: "v2", RetentionDays: 7, Revision: testPolicyRevision},
		Snapshots: []backupAdminSnapshot{{
			ID: testBackupID, Name: "xdrive-backup-20261027T030000Z",
			Format: "v2", State: "inconsistent", FileDataIncluded: true, CreatedAt: "2026-10-27T03:00:00Z",
		}},
	})
	verify := `{"action":"verify","snapshot_id":"` + testBackupID + `","mode":"deep"}`
	if code, body := runBackupAdminAction(t, server, verify); code != http.StatusAccepted {
		t.Fatalf("inconsistent snapshot cannot be diagnosed: %d %s", code, body)
	}
	if err := os.Remove(filepath.Join(dir, "backup-admin-request.json")); err != nil {
		t.Fatal(err)
	}
	restore := `{"action":"restore","snapshot_id":"` + testBackupID + `","confirmation":"RESTORE ` + testBackupID + `"}`
	if code, _ := runBackupAdminAction(t, server, restore); code != http.StatusConflict {
		t.Fatalf("inconsistent snapshot was accepted for destructive restore: %d", code)
	}
}

func TestBackupAdminPolicyRequiresCurrentRevision(t *testing.T) {
	server, dir := readyBackupAdminTestServer(t)
	old := `{"action":"policy","format":"v1","retention_days":30,"revision":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}`
	if status, _ := runBackupAdminAction(t, server, old); status != http.StatusConflict {
		t.Fatalf("accepted stale policy version: %d", status)
	}
	if _, err := os.Stat(filepath.Join(dir, "backup-admin-request.json")); !os.IsNotExist(err) {
		t.Fatalf("stale policy mutated host queue: %v", err)
	}
	good := `{"action":"policy","format":"v1","retention_days":30,"revision":"` + testPolicyRevision + `"}`
	if status, msg := runBackupAdminAction(t, server, good); status != http.StatusAccepted {
		t.Fatalf("policy submit=%d %s", status, msg)
	}
}

func TestBackupAdminFailsClosedOnStaleOrMalformedHostEvidence(t *testing.T) {
	server, dir := readyBackupAdminTestServer(t)
	if state := server.backupAdminState(); !state.Supported || len(state.Inventory.Snapshots) != 2 {
		t.Fatalf("fresh inventory missing: %+v", state)
	}
	heart := filepath.Join(dir, "heartbeat")
	ago := time.Now().Add(-3 * time.Minute)
	if err := os.Chtimes(heart, ago, ago); err != nil {
		t.Fatal(err)
	}
	if state := server.backupAdminState(); state.Supported {
		t.Fatalf("stale host heartbeat accepted: %+v", state)
	}
	if status, _ := runBackupAdminAction(t, server, `{"action":"create","format":"v2"}`); status != http.StatusServiceUnavailable {
		t.Fatalf("stale host accepted create: %d", status)
	}
	if err := os.Chtimes(heart, time.Now(), time.Now()); err != nil {
		t.Fatal(err)
	}
	writeBackupTestJSON(t, dir, "backup-admin-inventory.json", backupAdminInventory{
		Protocol: backupAdminProtocol, GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Policy:    backupAdminPolicy{ScheduleFormat: "v2", RetentionDays: 7, Revision: testPolicyRevision},
		Snapshots: []backupAdminSnapshot{{ID: "v1:../../secret", Name: "../../secret", Format: "v1", State: "complete"}},
	})
	if state := server.backupAdminState(); state.Supported {
		t.Fatalf("unsafe host snapshot accepted: %+v", state)
	}
	if status, _ := runBackupAdminAction(t, server, `{"action":"prune","keep_last":2,"confirmation":"PRUNE 2"}`); status != http.StatusServiceUnavailable {
		t.Fatalf("unsafe snapshot inventory accepted delete: %d", status)
	}
}

func TestBackupAdminRejectsMislabelledSnapshotFormatOrDate(t *testing.T) {
	for _, malformed := range []backupAdminSnapshot{
		{ID: testBackupID, Name: "xdrive-backup-20261027T030000Z", Format: "v1",
			State: "complete", FileDataIncluded: true, CreatedAt: "2026-10-27T03:00:00Z"},
		{ID: testBackupID, Name: "xdrive-backup-20261027T030000Z", Format: "v2",
			State: "complete", FileDataIncluded: true, CreatedAt: "2026-10-27T03:00:01Z"},
	} {
		server, dir := readyBackupAdminTestServer(t)
		writeBackupTestJSON(t, dir, "backup-admin-inventory.json", backupAdminInventory{
			Protocol:    backupAdminProtocol,
			GeneratedAt: time.Now().UTC().Format(time.RFC3339),
			Policy:      backupAdminPolicy{ScheduleFormat: "v2", RetentionDays: 7, Revision: testPolicyRevision},
			Snapshots:   []backupAdminSnapshot{malformed},
		})
		if got := server.backupAdminState(); got.Supported {
			t.Fatalf("accepted inconsistent host snapshot metadata: %+v", got)
		}
	}
}

func TestBackupAdminAcceptsOnlyExplicitNonMutatingAndDestructiveContracts(t *testing.T) {
	valid := []backupAdminRequest{
		{Action: "create", Format: "v2"},
		{Action: "create", Format: "v1"},
		{Action: "verify", SnapshotID: testBackupID, Mode: "deep"},
		{Action: "verify_all", Mode: "fast"},
		{Action: "verify_all", Mode: "deep"},
		{Action: "plan", KeepLast: 3, Mode: "fast"},
		{Action: "restore", SnapshotID: testBackupID, Confirmation: "RESTORE " + testBackupID},
		{Action: "drill", SnapshotID: testBackupID, Confirmation: "DRILL " + testBackupID},
		{Action: "delete", SnapshotID: "v1:xdrive-backup-20261026T030000Z", Confirmation: "DELETE v1:xdrive-backup-20261026T030000Z"},
		{Action: "prune", KeepLast: 2, Confirmation: "PRUNE 2"},
		{Action: "policy", Format: "v1", RetentionDays: 7, Revision: testPolicyRevision},
	}
	for _, req := range valid {
		if err := validateBackupAdminRequest(req); err != nil {
			t.Errorf("%s rejected: %v", req.Action, err)
		}
	}
}

// Zero is a supported setting and must survive normalization by the Server.
// Without an explicit field the Host interpreter cannot distinguish zero.
func TestBackupAdminZeroRetentionDaysReachHost(t *testing.T) {
	server, dir := readyBackupAdminTestServer(t)
	body := `{"action":"policy","format":"v2","retention_days":0,"revision":"` + testPolicyRevision + `"}`
	status, response := runBackupAdminAction(t, server, body)
	if status != http.StatusAccepted {
		t.Fatalf("zero-day policy rejected: %d %s", status, response)
	}
	contents, err := os.ReadFile(filepath.Join(dir, "backup-admin-request.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(contents), `"retention_days":0`) {
		t.Fatalf("zero-day policy silently omitted from Host request: %s", contents)
	}
}
func TestBackupAdminHistoryReceiptValidation(t *testing.T) {
	server, dir := readyBackupAdminTestServer(t)
	item := backupAdminHistoryEntry{backupAdminStatus: backupAdminStatus{
		Protocol: backupAdminProtocol, RequestID: "0123456789abcdef01234567", Action: "verify",
		SnapshotID: testBackupID, State: "success",
		StartedAt: "2026-10-27T03:00:00Z", FinishedAt: "2026-10-27T03:00:01Z",
	}, Mode: "deep"}
	writeBackupTestJSON(t, dir, "backup-admin-history.json", backupAdminHistory{
		Protocol:   "xdrive-backup-admin-history-v1",
		Operations: []backupAdminHistoryEntry{item},
	})
	if got := server.backupAdminState(); !got.Supported || len(got.History) != 1 {
		t.Fatalf("expected valid Host verification history: %+v", got)
	}
	item.SnapshotID = "v2-default:../../etc/passwd"
	writeBackupTestJSON(t, dir, "backup-admin-history.json", backupAdminHistory{
		Protocol:   "xdrive-backup-admin-history-v1",
		Operations: []backupAdminHistoryEntry{item},
	})
	if got := server.backupAdminState(); !got.Supported || len(got.History) != 0 {
		t.Fatalf("untrusted history should not disable safe backup reads: %+v", got)
	}
}

func TestBackupAdminHistoryRejectsDuplicatesAndOversizedCollections(t *testing.T) {
	server, dir := readyBackupAdminTestServer(t)
	entry := backupAdminHistoryEntry{backupAdminStatus: backupAdminStatus{
		Protocol: backupAdminProtocol, RequestID: "0123456789abcdef01234567",
		Action: "verify", SnapshotID: testBackupID, State: "failed",
		StartedAt: "2026-10-27T03:00:00Z", FinishedAt: "2026-10-27T03:00:01Z",
		ErrorCode: "operation_failed",
	}, Mode: "fast"}
	for _, entries := range [][]backupAdminHistoryEntry{
		{entry, entry},
		make([]backupAdminHistoryEntry, 31),
	} {
		writeBackupTestJSON(t, dir, "backup-admin-history.json", backupAdminHistory{
			Protocol:   "xdrive-backup-admin-history-v1",
			Operations: entries,
		})
		page := server.backupAdminState()
		if !page.Supported || len(page.History) > 0 {
			t.Fatalf("untrusted history should be ignored: %+v", page)
		}
	}
}

func TestBackupAdminHostProgressValidation(t *testing.T) {
	server, dir := readyBackupAdminTestServer(t)
	state := backupAdminStatus{}
	state.Protocol = backupAdminProtocol
	state.State = "running"
	state.Action = "create"
	state.RequestID = "0123456789abcdef01234567"
	state.Stage = "备份数据库"
	state.BytesDone = 4096
	state.BytesTotal = 8192
	writeBackupTestJSON(t, dir, "backup-admin-status.json", state)
	page := server.backupAdminState()
	if !page.Supported || page.Operation.Stage != "备份数据库" ||
		page.Operation.BytesDone != 4096 || page.Operation.BytesTotal != 8192 {
		t.Fatalf("Host live progress not reflected: %+v", page.Operation)
	}
	state.BytesDone = 9000
	writeBackupTestJSON(t, dir, "backup-admin-status.json", state)
	page = server.backupAdminState()
	if page.Operation.BytesDone != 0 || page.Operation.BytesTotal != 0 {
		t.Fatalf("invalid Host progress reached UI: %+v", page.Operation)
	}
	// The Host emits at most 15 decimal digits; values above that would be
	// imprecise when rendered by the shared TypeScript numeric contract.
	state.BytesDone = 1_000_000_000_000_000
	state.BytesTotal = 1_000_000_000_000_000
	writeBackupTestJSON(t, dir, "backup-admin-status.json", state)
	page = server.backupAdminState()
	if page.Operation.BytesDone != 0 || page.Operation.BytesTotal != 0 {
		t.Fatalf("oversized Host progress reached UI: %+v", page.Operation)
	}
}
