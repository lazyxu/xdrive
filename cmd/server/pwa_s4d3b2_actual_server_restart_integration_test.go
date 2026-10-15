//go:build linux

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/api"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// This test launches the unmodified cmd/server production binary twice. It
// kills the first OS process while the genuine DELETE transaction is blocked
// on a PostgreSQL row lock, then verifies fresh-process startup recovery.
// All mutations are confined to an ephemeral PostgreSQL schema and fake nodes.
func TestPWAS4D3B2ActualServerRestartDuringDelete(t *testing.T) {
	if os.Getenv("XD_PWA_S4D3B2_REAL_BINARY") != "1" {
		t.Skip("explicit real Server binary/PostgreSQL crash test only")
	}
	binary := strings.TrimSpace(os.Getenv("XD_PWA_S4D3B2_BINARY_PATH"))
	dsn := strings.TrimSpace(os.Getenv("XD_TEST_DATABASE_URL"))
	if binary == "" || dsn == "" {
		t.Fatal("S4D3B2 needs compiled production binary and isolated PostgreSQL")
	}
	binary, err := filepath.Abs(binary)
	if err != nil {
		t.Fatal("S4D3B2 binary path is invalid")
	}
	if st, err := os.Stat(binary); err != nil || st.IsDir() || st.Mode()&0111 == 0 {
		t.Fatal("S4D3B2 requires an executable production Server")
	}
	rootDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal("S4D3B2 cannot connect to isolated PostgreSQL")
	}
	rootSQL, err := rootDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	schema := "pwa_s4d3b2_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := rootDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal("S4D3B2 could not create isolated schema")
	}
	t.Cleanup(func() {
		_ = rootDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
		_ = rootSQL.Close()
	})
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal("S4D3B2 invalid PostgreSQL DSN")
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	query.Set("application_name", "pwa-s4d3b2-main-test")
	parsed.RawQuery = query.Encode()
	scopedDB, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal("S4D3B2 scoped PostgreSQL connection failed")
	}
	scopedSQL, err := scopedDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer scopedSQL.Close()
	// Use the production migration exactly as a real binary will on restart.
	if err := migrate(scopedDB); err != nil {
		t.Fatal("S4D3B2 production schema migration failed")
	}
	appName := "pwa-s4d3b2-" + uuid.NewString()[:8]
	serverURL := *parsed
	serverQ := serverURL.Query()
	serverQ.Set("application_name", appName)
	serverURL.RawQuery = serverQ.Encode()
	jwtSecret := "pwa-s4d3b2-synthetic-" + uuid.NewString()
	client := &http.Client{Timeout: 2 * time.Second}
	storageDir := t.TempDir()

	type liveServer struct {
		cmd  *exec.Cmd
		done chan error
		url  string
	}
	launch := func() liveServer {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal("S4D3B2 cannot allocate a local port")
		}
		addr := listener.Addr().String()
		listener.Close()
		cmd := exec.Command(binary)
		cmd.Env = append(os.Environ(),
			"XD_DATABASE_URL="+serverURL.String(),
			"XD_JWT_SECRET="+jwtSecret,
			"XD_STORAGE_ROOT="+storageDir,
			"XD_LISTEN_ADDR="+addr,
			"XD_ALLOWED_ORIGIN=http://localhost",
		)
		// Never archive private Server output or JWTs from the isolated fixture.
		cmd.Stdout, cmd.Stderr = io.Discard, io.Discard
		if err := cmd.Start(); err != nil {
			t.Fatal("S4D3B2 production Server binary failed to start")
		}
		t.Cleanup(func() { _ = cmd.Process.Kill() })
		done := make(chan error, 1)
		go func() { done <- cmd.Wait() }()
		base := "http://" + addr
		deadline := time.Now().Add(90 * time.Second)
		for time.Now().Before(deadline) {
			select {
			case <-done:
				t.Fatal("S4D3B2 production Server exited before readiness")
			default:
			}
			res, err := client.Get(base + "/api/v1/readyz")
			if err == nil {
				io.Copy(io.Discard, io.LimitReader(res.Body, 2048))
				res.Body.Close()
				if res.StatusCode == http.StatusOK {
					return liveServer{cmd: cmd, done: done, url: base}
				}
			}
			time.Sleep(100 * time.Millisecond)
		}
		t.Fatal("S4D3B2 real production Server never became ready")
		return liveServer{}
	}
	kill := func(s liveServer) {
		if err := s.cmd.Process.Kill(); err != nil {
			t.Fatal("S4D3B2 failed to SIGKILL real Server")
		}
		var exitErr *exec.ExitError
		select {
		case err := <-s.done:
			if !errors.As(err, &exitErr) {
				t.Fatal("S4D3B2 real Server did not terminate by signal")
			}
		case <-time.After(5 * time.Second):
			t.Fatal("S4D3B2 SIGKILL process was not reaped")
		}
		status, ok := exitErr.Sys().(syscall.WaitStatus)
		if !ok || !status.Signaled() || status.Signal() != syscall.SIGKILL {
			t.Fatal("S4D3B2 real Server did not receive SIGKILL")
		}
	}
	// S4D3-B1 validated Worker-only subprocesses. Both launched processes
	// here run the actual full cmd/server binary with production main().
	owner := meta.User{Username: "pwa-s4d3b2-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	foreign := meta.User{Username: "pwa-s4d3b2-foreign", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := scopedDB.Create(&owner).Error; err != nil {
		t.Fatal("owner insert failed")
	}
	if err := scopedDB.Create(&foreign).Error; err != nil {
		t.Fatal("foreign insert failed")
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := scopedDB.Create(&root).Error; err != nil {
		t.Fatal("root insert failed")
	}
	var nodes [3]meta.Node
	for i := range nodes {
		nodes[i] = meta.Node{ParentID: &root.ID, Name: fmt.Sprintf("s4d3b2-dir-%d", i), Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
		if err := scopedDB.Create(&nodes[i]).Error; err != nil {
			t.Fatal("node insert failed")
		}
	}
	ownerToken, err := auth.New(jwtSecret, time.Hour).Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal("S4D3B2 could not issue production JWT")
	}
	foreignToken, err := auth.New(jwtSecret, time.Hour).Issue(foreign.ID, foreign.SessionVersion)
	if err != nil {
		t.Fatal("S4D3B2 could not issue foreign JWT")
	}
	// Start the full cmd/server executable and complete all normal migrations
	// before creating fault-injected work. SIGSTOP freezes the *whole* Linux
	// process while a separate production Router enqueues real authenticated
	// tasks and the test obtains the row lock. No product-only gate is added.
	old := launch()
	if err := old.cmd.Process.Signal(syscall.SIGSTOP); err != nil {
		t.Fatal("S4D3B2 cannot pause real production Server for deterministic setup")
	}
	paused := true
	t.Cleanup(func() {
		if paused {
			_ = old.cmd.Process.Signal(syscall.SIGCONT)
		}
	})
	stopped := false
	for attempt := 0; attempt < 100; attempt++ {
		data, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", old.cmd.Process.Pid))
		if err == nil && bytes.Contains(data, []byte("State:\tT")) {
			stopped = true
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !stopped {
		t.Fatal("S4D3B2 production Server was not genuinely SIGSTOPed")
	}
	seedStore, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal("S4D3B2 isolated seed CAS unavailable")
	}
	seedAPI := &api.Server{DB: scopedDB, Store: seedStore, Auth: auth.New(jwtSecret, time.Hour)}
	seedHTTP := httptest.NewServer(seedAPI.Router())
	defer seedHTTP.Close()
	enqueue := func(selected ...meta.Node) string {
		items := make([]string, 0, len(selected))
		for _, node := range selected {
			items = append(items, fmt.Sprintf(`{"id":%d,"revision":%d}`, node.ID, node.Revision))
		}
		payload := fmt.Sprintf(`{"type":"delete","items":[%s],"parent_id":0}`, strings.Join(items, ","))
		req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, seedHTTP.URL+"/api/v1/file-operations", bytes.NewBufferString(payload))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+ownerToken)
		req.Header.Set("Content-Type", "application/json")
		res, err := client.Do(req)
		if err != nil {
			t.Fatal("S4D3B2 authenticated production enqueue failed")
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusAccepted {
			t.Fatalf("S4D3B2 production enqueue HTTP status %d", res.StatusCode)
		}
		var out struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		}
		if err := json.NewDecoder(io.LimitReader(res.Body, 4096)).Decode(&out); err != nil || out.ID == "" || out.Status != "queued" {
			t.Fatal("S4D3B2 production API did not persist queued operation")
		}
		return out.ID
	}
	firstID := enqueue(nodes[0], nodes[1])
	secondID := enqueue(nodes[2])
	ids := [2]string{firstID, secondID}
	// A direct FOR UPDATE lock on the real Node would block production
	// batchLoadNodesTx/activeSubtreeSummariesDB *before* the first delete.
	// Instead, install a fixture-only AFTER UPDATE trigger in the isolated
	// schema, gated exclusively on the second selected root. It waits on an
	// unrelated synthetic row only after the second DELETE mutation starts.
	// No production table, trigger, worker or request handler is changed.
	if err := scopedDB.Exec("CREATE TABLE pwa_s4d3b2_second_delete_gate (id BIGINT PRIMARY KEY)").Error; err != nil {
		t.Fatal("S4D3B2 could not create isolated transactional gate")
	}
	if err := scopedDB.Exec("INSERT INTO pwa_s4d3b2_second_delete_gate(id) VALUES (1)").Error; err != nil {
		t.Fatal("S4D3B2 could not seed isolated transactional gate")
	}
	if err := scopedDB.Exec(`CREATE FUNCTION pwa_s4d3b2_block_second_delete()
RETURNS trigger LANGUAGE plpgsql AS '
BEGIN
	PERFORM 1 FROM pwa_s4d3b2_second_delete_gate WHERE id = 1 FOR UPDATE;
	RETURN NEW;
END;
'`).Error; err != nil {
		t.Fatal("S4D3B2 could not install isolated blocking function")
	}
	if err := scopedDB.Exec(fmt.Sprintf(`CREATE TRIGGER pwa_s4d3b2_second_delete_gate_trigger
AFTER UPDATE OF deleted_at ON xd_nodes
FOR EACH ROW
WHEN (NEW.id = %d AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
EXECUTE FUNCTION pwa_s4d3b2_block_second_delete()`, nodes[1].ID)).Error; err != nil {
		t.Fatal("S4D3B2 could not install second-root-only delete trigger")
	}
	locker := scopedDB.Begin()
	if locker.Error != nil {
		t.Fatal("S4D3B2 failed to begin PostgreSQL test-gate lock")
	}
	defer locker.Rollback()
	var lockedID uint64
	if err := locker.Raw("SELECT id FROM pwa_s4d3b2_second_delete_gate WHERE id = 1 FOR UPDATE").Scan(&lockedID).Error; err != nil || lockedID != 1 {
		t.Fatal("S4D3B2 could not acquire the isolated test-gate lock")
	}
	// Attribute a blocked Server query to THIS held PostgreSQL session, not
	// merely to a generic Lock event elsewhere in the database.
	var lockHolderPID int
	if err := locker.Raw("SELECT pg_backend_pid()").Scan(&lockHolderPID).Error; err != nil || lockHolderPID <= 0 {
		t.Fatal("S4D3B2 could not verify the active lock-holder SQL session")
	}
	if err := old.cmd.Process.Signal(syscall.SIGCONT); err != nil {
		t.Fatal("S4D3B2 cannot resume the real Server")
	}
	paused = false
	// The second root is locked; the first root must have been updated inside
	// the uncommitted real PostgreSQL transaction before the Worker stalls.
	// Unlike a direct Node lock, the fixture gate runs only in the second
	// update's AFTER trigger, so blocked Server SQL proves genuine execution.
	// Require direct evidence of an actual Server postgres backend blocked
	// in the node mutation, rather than a synthetic sleeping test goroutine.
	deadline := time.Now().Add(25 * time.Second)
	lockedBackend := false
	type lockEvidence struct {
		ServerSessions    int64 `gorm:"column:server_sessions"`
		ServerLockWaiters int64 `gorm:"column:server_lock_waiters"`
		BlockedByFixture  int64 `gorm:"column:blocked_by_fixture"`
		ServerNodeBlocked int64 `gorm:"column:server_node_blocked"`
	}
	var observed lockEvidence
	var firstStatus, secondStatus, currentItem string
	for time.Now().Before(deadline) {
		var first, second meta.FileOperation
		if err := scopedDB.First(&first, "id = ?", firstID).Error; err != nil {
			t.Fatal(err)
		}
		if err := scopedDB.First(&second, "id = ?", secondID).Error; err != nil {
			t.Fatal(err)
		}
		firstStatus, secondStatus, currentItem = first.Status, second.Status, first.CurrentItem
		// PostgreSQL's pg_blocking_pids is an independently held-lock proof:
		// an arbitrary Lock wait or only a task state is never sufficient.
		if err := rootDB.Raw(`SELECT
			COUNT(*) FILTER (WHERE application_name = ?) AS server_sessions,
			COUNT(*) FILTER (WHERE application_name = ? AND wait_event_type = 'Lock') AS server_lock_waiters,
			COUNT(*) FILTER (WHERE wait_event_type = 'Lock' AND ? = ANY(pg_blocking_pids(pid))) AS blocked_by_fixture,
			COUNT(*) FILTER (WHERE application_name = ? AND wait_event_type = 'Lock'
				AND ? = ANY(pg_blocking_pids(pid)) AND query ILIKE '%xd_nodes%') AS server_node_blocked
		FROM pg_stat_activity
		WHERE datname = current_database() AND backend_type = 'client backend'`,
			appName, appName, lockHolderPID, appName, lockHolderPID).Scan(&observed).Error; err != nil {
			t.Fatal("S4D3B2 cannot observe PostgreSQL activity")
		}
		if first.Status == meta.FileOperationStatusRunning && first.CurrentItem == nodes[1].Name &&
			second.Status == meta.FileOperationStatusQueued && observed.ServerNodeBlocked > 0 {
			lockedBackend = true
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !lockedBackend {
		// Only fixed states / aggregate counts are logged, never SQL query text,
		// tokens, node paths or connection credentials.
		t.Fatalf("S4D3B2 real Worker lock evidence missing: first_running=%t current_first=%t current_second=%t second_queued=%t server_sessions=%d server_lock_waiters=%d blocked_by_fixture=%d tagged_node_blocked=%d",
			firstStatus == meta.FileOperationStatusRunning,
			currentItem == nodes[0].Name, currentItem == nodes[1].Name,
			secondStatus == meta.FileOperationStatusQueued,
			observed.ServerSessions, observed.ServerLockWaiters,
			observed.BlockedByFixture, observed.ServerNodeBlocked)
	}
	for _, target := range nodes[:2] {
		var before meta.Node
		if err := scopedDB.First(&before, target.ID).Error; err != nil || before.DeletedAt != nil || before.Revision != 1 {
			t.Fatal("S4D3B2 partial transaction committed before Server process kill")
		}
	}
	kill(old)
	for i, id := range ids {
		var op meta.FileOperation
		if err := scopedDB.First(&op, "id = ?", id).Error; err != nil {
			t.Fatal("S4D3B2 committed task disappeared after process crash")
		}
		expect := meta.FileOperationStatusQueued
		if i == 0 {
			expect = meta.FileOperationStatusRunning
		}
		if op.Status != expect || op.FinishedAt != nil {
			t.Fatal("S4D3B2 task changed after real Server crash")
		}
	}
	// The first root was updated inside the aborted transaction, but its
	// preexisting committed revision must still be 1 after SIGKILL.
	for _, target := range nodes[:2] {
		var afterCrash meta.Node
		if err := scopedDB.First(&afterCrash, target.ID).Error; err != nil ||
			afterCrash.DeletedAt != nil || afterCrash.Revision != 1 {
			t.Fatal("S4D3B2 transaction mutation leaked after Server SIGKILL")
		}
	}
	if err := locker.Rollback().Error; err != nil {
		t.Fatal("S4D3B2 releasing test-only node lock failed")
	}
	fresh := launch()
	if fresh.cmd.Process.Pid == old.cmd.Process.Pid {
		t.Fatal("S4D3B2 restart reused old Server PID")
	}
	deadline = time.Now().Add(30 * time.Second)
	completed := false
	for time.Now().Before(deadline) {
		completed = true
		for i, id := range ids {
			var op meta.FileOperation
			if err := scopedDB.First(&op, "id = ?", id).Error; err != nil {
				t.Fatal("S4D3B2 task lost across Server restart")
			}
			if op.Status == meta.FileOperationStatusFailed || op.Status == meta.FileOperationStatusCancelled {
				t.Fatal("S4D3B2 production restart produced incorrect terminal task")
			}
			if op.Status != meta.FileOperationStatusCompleted {
				completed = false
				break
			}
			expectedItems := int64(1)
			if i == 0 {
				expectedItems = 2
			}
			if op.ProcessedItems != expectedItems || op.TotalItems != expectedItems ||
				op.StartedAt == nil || op.FinishedAt == nil || op.Error != "" || op.OwnerID != owner.ID {
				t.Fatal("S4D3B2 production task completion metadata is inconsistent")
			}
		}
		if completed {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !completed {
		t.Fatal("S4D3B2 restarted production Server did not finish both tasks")
	}
	for _, target := range nodes {
		var node meta.Node
		if err := scopedDB.First(&node, target.ID).Error; err != nil ||
			node.DeletedAt == nil || node.TrashRootID == nil || *node.TrashRootID != target.ID ||
			node.Revision != 2 || node.OwnerID != owner.ID {
			t.Fatal("S4D3B2 production deletion was not committed exactly once")
		}
	}
	var count int64
	if err := scopedDB.Model(&meta.FileOperation{}).Where("owner_id = ?", owner.ID).Count(&count).Error; err != nil || count != 2 {
		t.Fatal("S4D3B2 task count indicates loss or duplicate records")
	}
	getTask := func(token, id string) int {
		req, err := http.NewRequest(http.MethodGet, fresh.url+"/api/v1/file-operations/"+id, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		res, err := client.Do(req)
		if err != nil {
			t.Fatal("S4D3B2 owner-scoped task query failed")
		}
		io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
		res.Body.Close()
		return res.StatusCode
	}
	for _, id := range ids {
		if getTask(ownerToken, id) != http.StatusOK || getTask(foreignToken, id) != http.StatusNotFound {
			t.Fatal("S4D3B2 owner task authorization failed after restart")
		}
	}
	kill(fresh)
	t.Log("PWA_S4D3B2_BINARY_VERIFIED binary_restart=true old_process_sigkill=true postgres_lock_blocked=true partial_transaction_rolled_back=true running_and_queued_recovered=true completed_tasks=2 deleted_nodes=3 revisions_exact=true owner_isolation=true")
}
