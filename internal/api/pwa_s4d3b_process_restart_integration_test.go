//go:build linux

package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// The child processes use the production FileOperation claim/recovery/worker
// methods against one isolated, real PostgreSQL schema. No fabricated task
// transition or test-only HTTP worker-start endpoint is involved.
type pwaS4D3BProof struct {
	OwnerID      uint64
	ForeignID    uint64
	NodeIDs      [2]uint64
	OperationIDs [2]string
}

func pwaS4D3BReadProof(t *testing.T, path string) pwaS4D3BProof {
	t.Helper()
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal("S4D3B private process handoff unavailable")
	}
	var proof pwaS4D3BProof
	if err := json.Unmarshal(payload, &proof); err != nil {
		t.Fatal("S4D3B malformed process handoff")
	}
	if proof.OwnerID == 0 || proof.ForeignID == 0 || proof.OwnerID == proof.ForeignID ||
		proof.NodeIDs[0] == 0 || proof.NodeIDs[1] == 0 || proof.NodeIDs[0] == proof.NodeIDs[1] ||
		proof.OperationIDs[0] == "" || proof.OperationIDs[1] == "" || proof.OperationIDs[0] == proof.OperationIDs[1] {
		t.Fatal("S4D3B incomplete or duplicate process identity")
	}
	return proof
}

func pwaS4D3BOpenChildDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("XD_PWA_S4D3B_CHILD_DSN")
	parsed, err := url.Parse(dsn)
	if err != nil || !strings.HasPrefix(parsed.Query().Get("search_path"), "media_perf_") {
		t.Fatal("S4D3B child requires isolated PostgreSQL schema")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal("S4D3B child could not open isolated PostgreSQL")
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal("S4D3B child SQL handle unavailable")
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db
}

// Seed and recovery deliberately run in different OS processes. The seed
// process is SIGKILLed after one real claim and one queued operation are
// committed, before either deletion is executed.
func TestPWAS4D3BProcessChild(t *testing.T) {
	stage := os.Getenv("XD_PWA_S4D3B_CHILD_STAGE")
	if stage != "seed" && stage != "recover" {
		t.Skip("S4D3B private subprocess only")
	}
	handoff := os.Getenv("XD_PWA_S4D3B_HANDOFF")
	if handoff == "" {
		t.Fatal("S4D3B missing private process handoff")
	}
	db := pwaS4D3BOpenChildDB(t)
	srv := &Server{DB: db}
	ctx := context.Background()
	if stage == "seed" {
		owner := meta.User{Username: "pwa-s4d3b-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
		foreign := meta.User{Username: "pwa-s4d3b-foreign", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
		if err := db.Create(&owner).Error; err != nil {
			t.Fatal("S4D3B owner seed failed")
		}
		if err := db.Create(&foreign).Error; err != nil {
			t.Fatal("S4D3B foreign seed failed")
		}
		root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
		if err := db.Create(&root).Error; err != nil {
			t.Fatal("S4D3B root seed failed")
		}
		proof := pwaS4D3BProof{OwnerID: owner.ID, ForeignID: foreign.ID}
		for i := range proof.NodeIDs {
			node := meta.Node{ParentID: &root.ID, Name: fmt.Sprintf("s4d3b-restart-%d", i), Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
			if err := db.Create(&node).Error; err != nil {
				t.Fatal("S4D3B node seed failed")
			}
			op, err := srv.enqueueFileOperation(ctx, owner.ID, meta.FileOperationTypeDelete,
				[]batchNodeRef{{ID: node.ID, Revision: node.Revision}}, 0, nil)
			if err != nil || op.Status != meta.FileOperationStatusQueued {
				t.Fatal("S4D3B production enqueue did not persist queued work")
			}
			proof.NodeIDs[i], proof.OperationIDs[i] = node.ID, op.ID
		}
		claimed, ok, err := srv.claimNextFileOperation(ctx)
		if err != nil || !ok || claimed.Status != meta.FileOperationStatusRunning {
			t.Fatal("S4D3B production worker claim was not persisted")
		}
		// PostgreSQL ties are ordered by operation ID, not insertion order.
		// Store the genuinely claimed operation first in the handoff.
		if claimed.ID == proof.OperationIDs[1] {
			proof.OperationIDs[0], proof.OperationIDs[1] = proof.OperationIDs[1], proof.OperationIDs[0]
			proof.NodeIDs[0], proof.NodeIDs[1] = proof.NodeIDs[1], proof.NodeIDs[0]
		} else if claimed.ID != proof.OperationIDs[0] {
			t.Fatal("S4D3B claimed unexpected work")
		}
		payload, err := json.Marshal(proof)
		if err != nil || os.WriteFile(handoff, payload, 0600) != nil {
			t.Fatal("S4D3B secure handoff write failed")
		}
		// The parent must kill this process. A normal exit is not crash proof.
		<-time.After(80 * time.Second)
		t.Fatal("S4D3B seed server was not force-terminated")
		return
	}

	proof := pwaS4D3BReadProof(t, handoff)
	bootCtx, stop := context.WithCancel(context.Background())
	defer stop()
	// This is the normal Server startup path, not a browser/test HTTP command.
	// It runs recoverFileOperations before the Worker claims persisted jobs.
	srv.StartFileOperationWorker(bootCtx)
	deadline := time.NewTimer(25 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(50 * time.Millisecond)
	defer tick.Stop()
	for {
		complete := true
		for i, id := range proof.OperationIDs {
			op, err := srv.loadOwnedFileOperation(ctx, proof.OwnerID, id)
			if err != nil {
				t.Fatal("S4D3B owner operation disappeared across restart")
			}
			if op.Status == meta.FileOperationStatusFailed || op.Status == meta.FileOperationStatusCancelled {
				t.Fatal("S4D3B restart produced incorrect terminal status")
			}
			if op.Status != meta.FileOperationStatusCompleted {
				complete = false
				continue
			}
			if op.ProcessedItems != 1 || op.StartedAt == nil || op.FinishedAt == nil || op.Error != "" || op.OwnerID != proof.OwnerID {
				t.Fatal("S4D3B completed work has incorrect durable metadata")
			}
			var node meta.Node
			if err := db.First(&node, proof.NodeIDs[i]).Error; err != nil || node.DeletedAt == nil || node.OwnerID != proof.OwnerID {
				t.Fatal("S4D3B real Worker did not commit the trash operation")
			}
			if _, err := srv.loadOwnedFileOperation(ctx, proof.ForeignID, id); !errors.Is(err, gorm.ErrRecordNotFound) {
				t.Fatal("S4D3B foreign account observed another owner's task")
			}
		}
		if complete {
			t.Log("PWA_S4D3B_RESTART_VERIFIED real_server_process_restart=true running_requeued=true queued_processed=true owner_isolated=true")
			return
		}
		select {
		case <-deadline.C:
			t.Fatal("S4D3B restarted Server did not finish its persisted work")
		case <-tick.C:
		}
	}
}

func TestPWAS4D3BServerRestartProcess(t *testing.T) {
	if os.Getenv("XD_PWA_S4D3B_REAL_RESTART") != "1" {
		t.Skip("explicit real PostgreSQL Server OS-process restart gate only")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("S4D3B requires isolated PostgreSQL service")
	}
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}, &meta.Share{}, &meta.FileOperation{}); err != nil {
		t.Fatal("S4D3B PostgreSQL migration failed")
	}
	for _, statement := range []string{
		"CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL",
		"CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL",
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatal("S4D3B PostgreSQL index installation failed")
		}
	}
	var schema string
	if err := db.Raw("SELECT current_schema()").Scan(&schema).Error; err != nil || !strings.HasPrefix(schema, "media_perf_") {
		t.Fatal("S4D3B cannot prove private test schema")
	}
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal("S4D3B invalid isolated DSN")
	}
	params := parsed.Query()
	params.Set("search_path", schema)
	parsed.RawQuery = params.Encode()
	handoff := filepath.Join(t.TempDir(), "s4d3b-private-process-handoff.json")
	baseEnv := make([]string, 0, len(os.Environ())+2)
	for _, item := range os.Environ() {
		if !strings.HasPrefix(item, "XD_PWA_S4D3B_CHILD_") && !strings.HasPrefix(item, "XD_PWA_S4D3B_HANDOFF=") {
			baseEnv = append(baseEnv, item)
		}
	}
	baseEnv = append(baseEnv, "XD_PWA_S4D3B_CHILD_DSN="+parsed.String(), "XD_PWA_S4D3B_HANDOFF="+handoff)
	seed := exec.Command(os.Args[0], "-test.run=^TestPWAS4D3BProcessChild$", "-test.timeout=95s")
	seed.Env = append(append([]string{}, baseEnv...), "XD_PWA_S4D3B_CHILD_STAGE=seed")
	seed.Stdout, seed.Stderr = os.Stdout, os.Stderr
	if err := seed.Start(); err != nil {
		t.Fatal("S4D3B seed Server process could not start")
	}
	defer func() { _ = seed.Process.Kill() }()
	exited := make(chan error, 1)
	go func() { exited <- seed.Wait() }()
	deadline := time.NewTimer(20 * time.Second)
	defer deadline.Stop()
	poll := time.NewTicker(40 * time.Millisecond)
	defer poll.Stop()
	var proof pwaS4D3BProof
	for {
		if payload, err := os.ReadFile(handoff); err == nil && len(payload) > 0 {
			proof = pwaS4D3BReadProof(t, handoff)
			break
		}
		select {
		case <-exited:
			t.Fatal("S4D3B seed Server process exited before handoff")
		case <-deadline.C:
			t.Fatal("S4D3B seed Server never persisted both operations")
		case <-poll.C:
		}
	}
	pre := [2]string{meta.FileOperationStatusRunning, meta.FileOperationStatusQueued}
	for i, id := range proof.OperationIDs {
		var op meta.FileOperation
		if err := db.First(&op, "id = ?", id).Error; err != nil || op.Status != pre[i] || op.FinishedAt != nil {
			t.Fatal("S4D3B pre-crash PostgreSQL state is not genuine running/queued")
		}
	}
	if err := seed.Process.Kill(); err != nil {
		t.Fatal("S4D3B failed to SIGKILL first Server process")
	}
	waitErr := <-exited
	var exitErr *exec.ExitError
	if !errors.As(waitErr, &exitErr) {
		t.Fatal("S4D3B first Server exited without actual SIGKILL")
	}
	status, ok := exitErr.Sys().(syscall.WaitStatus)
	if !ok || !status.Signaled() || status.Signal() != syscall.SIGKILL {
		t.Fatal("S4D3B did not force-kill the Server OS process")
	}
	for i, id := range proof.OperationIDs {
		var op meta.FileOperation
		if err := db.First(&op, "id = ?", id).Error; err != nil || op.Status != pre[i] {
			t.Fatal("S4D3B task was not durable after SIGKILL")
		}
	}
	restart := exec.Command(os.Args[0], "-test.run=^TestPWAS4D3BProcessChild$", "-test.timeout=95s")
	restart.Env = append(append([]string{}, baseEnv...), "XD_PWA_S4D3B_CHILD_STAGE=recover")
	restart.Stdout, restart.Stderr = os.Stdout, os.Stderr
	if err := restart.Run(); err != nil {
		t.Fatal("S4D3B fresh Server process could not recover durable work")
	}
	if seed.Process.Pid == restart.Process.Pid {
		t.Fatal("S4D3B recovery did not start a different Server OS process")
	}
	var completed int64
	if err := db.Model(&meta.FileOperation{}).
		Where("owner_id = ? AND status = ?", proof.OwnerID, meta.FileOperationStatusCompleted).
		Count(&completed).Error; err != nil || completed != 2 {
		t.Fatal("S4D3B final owner task count was not exactly two completed operations")
	}
	t.Log("PWA_S4D3B_REAL_PROCESS_VERIFIED old_server_sigkill=true different_server_pid=true recovered_running=1 recovered_queued=1 completed=2")
}
