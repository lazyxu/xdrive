package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/conflictstate"
	"github.com/lazyxu/xdrive/internal/secretstore"
	"github.com/lazyxu/xdrive/internal/transfer"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

func blockedAgentUploadServer(t *testing.T, fail bool) (*httptest.Server, <-chan struct{}, func()) {
	t.Helper()
	read := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/v1/uploads":
			var init client.UploadInit
			if err := json.NewDecoder(r.Body).Decode(&init); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(client.UploadSession{ID: "live", Size: init.Size, ChunkSize: client.DefaultUploadChunkSize, ChunkCount: 1})
		case r.Method == http.MethodPut && strings.HasSuffix(r.URL.Path, "/chunks/0"):
			if _, err := io.CopyN(io.Discard, r.Body, 1024); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			close(read)
			<-release
			n, err := io.Copy(io.Discard, r.Body)
			if err != nil || fail {
				http.Error(w, "upload rejected", http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(client.UploadPart{Size: n + 1024})
		case strings.HasSuffix(r.URL.Path, "/finalize"):
			_ = json.NewEncoder(w).Encode(client.UploadSession{Status: "finalized", Result: &client.Node{ID: 10, Type: "file"}})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	t.Cleanup(unblock)
	return server, read, unblock
}

func waitAgentUploadNetworkSample(t *testing.T, manager *transfer.Manager) transfer.Task {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for {
		revision, tasks := manager.Snapshot()
		for _, task := range tasks {
			// Socket buffering can consume the body within one clock tick. A
			// positive byte sample is required; its finite rate may still be zero.
			if task.Kind == transfer.KindUpload && task.Scope == transfer.ScopeItem && task.SpeedSource == "client" && task.SpeedUpdatedAt != nil {
				assertAgentUploadNetworkRates(t, task)
				return task
			}
		}
		if _, _, changed := manager.Wait(ctx, revision); !changed {
			t.Fatalf("upload has no live network sample before its first chunk completes: %+v", tasks)
		}
	}
}

func assertAgentUploadNetworkRates(t *testing.T, task transfer.Task) {
	t.Helper()
	if rate := task.InstantBytesPerSecond; math.IsNaN(rate) || math.IsInf(rate, 0) || rate < 0 {
		t.Fatalf("instant network rate must be finite and nonnegative: %+v", task)
	}
	if rate := task.AverageBytesPerSecond; math.IsNaN(rate) || math.IsInf(rate, 0) || rate < 0 {
		t.Fatalf("average network rate must be finite and nonnegative: %+v", task)
	}
}

func configureAgentUploadClient(t *testing.T, url string) {
	t.Helper()
	configHome := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", configHome)
	t.Setenv("APPDATA", configHome)
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	cfg := userconfig.Config{Server: url, SessionID: "upload-network-test", MountPath: t.TempDir()}
	if err := userconfig.Save(cfg); err != nil {
		t.Fatal(err)
	}
	dir, err := userconfig.Dir()
	if err != nil {
		t.Fatal(err)
	}
	if err := secretstore.Save(dir, cfg.SessionID, "xDrive upload test", secretstore.Credentials{AccessToken: "token", AccessExpiresAt: time.Now().Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
}

func TestAgentCloudUploadReportsNetworkBeforeChunkCompletion(t *testing.T) {
	for _, mode := range []string{"manual", "conflict_policy", "folder_child"} {
		t.Run(mode, func(t *testing.T) {
			server, read, unblock := blockedAgentUploadServer(t, false)
			configureAgentUploadClient(t, server.URL)
			path := filepath.Join(t.TempDir(), "upload.bin")
			if err := os.WriteFile(path, bytes.Repeat([]byte("x"), 64<<10), 0o600); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			controller := newAgentController(ctx, cancel)
			var child *transfer.Handle
			if mode == "folder_child" {
				group := controller.transfers.StartGroup(transfer.Spec{Kind: transfer.KindUpload, Direction: "upload"})
				child = controller.transfers.StartChild(group, transfer.Spec{Kind: transfer.KindUpload, Direction: "upload", TotalBytes: 64 << 10})
			}
			finished := make(chan struct{})
			var uploadErr error
			go func() {
				defer close(finished)
				switch mode {
				case "manual":
					_, uploadErr = controller.CloudUpload(ctx, 1, path, "upload.bin")
				case "conflict_policy":
					_, uploadErr = controller.CloudUploadWithConflictPolicy(ctx, 1, path, "upload.bin", "overwrite")
				case "folder_child":
					_, uploadErr = controller.CloudUploadWithConflictPolicyTracked(ctx, 1, path, "upload.bin", "overwrite", child.ID())
				}
			}()
			t.Cleanup(func() { unblock(); <-finished })
			select {
			case <-read:
			case <-finished:
				t.Fatalf("upload ended before body was read: %v", uploadErr)
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			active := waitAgentUploadNetworkSample(t, controller.transfers)
			if active.BytesDone != 0 || active.State != transfer.StateRunning {
				t.Fatalf("network observation changed logical first-chunk progress: %+v", active)
			}
			unblock()
			<-finished
			if uploadErr != nil {
				t.Fatal(uploadErr)
			}
			_, tasks := controller.transfers.Snapshot()
			for _, task := range tasks {
				if task.Scope == transfer.ScopeGroup && task.SpeedSource != "" {
					t.Fatalf("group would double-count child network samples: %+v", task)
				}
				if task.ID == active.ID {
					assertAgentUploadNetworkRates(t, task)
				}
				if task.ID == active.ID && mode != "folder_child" && (task.State != transfer.StateCompleted || task.InstantBytesPerSecond != 0) {
					t.Fatalf("manual upload did not finish its transfer: %+v", task)
				}
				if task.ID == active.ID && mode == "folder_child" && task.State != transfer.StateRunning {
					t.Fatalf("externally managed child completion semantics changed: %+v", task)
				}
			}
		})
	}
}

type networkConflictClient struct {
	*client.Client
	deleted []uint64
}

func (c *networkConflictClient) Walk(context.Context) (map[string]client.Node, error) {
	return map[string]client.Node{"upload.bin": {ID: 10, Revision: 3}, "copy.bin": {ID: 20, Revision: 1}}, nil
}

func (c *networkConflictClient) Delete(_ context.Context, id, _ uint64) error {
	c.deleted = append(c.deleted, id)
	return nil
}

func TestAgentConflictOverwriteReportsNetworkAndFinishes(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "failure"}[fail], func(t *testing.T) {
			server, read, unblock := blockedAgentUploadServer(t, fail)
			root := t.TempDir()
			if err := os.WriteFile(filepath.Join(root, "copy.bin"), bytes.Repeat([]byte("c"), 64<<10), 0o600); err != nil {
				t.Fatal(err)
			}
			manager := transfer.NewManager(10)
			cli := &networkConflictClient{Client: client.New(server.URL, "token")}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			finished := make(chan struct{})
			var uploadErr error
			go func() {
				defer close(finished)
				uploadErr = applyConflictChoice(ctx, cli, root, conflictstate.Record{OriginalPath: "upload.bin", OriginalNodeID: 10, ConflictPath: "copy.bin", ConflictNodeID: 20}, "local", manager)
			}()
			t.Cleanup(func() { unblock(); <-finished })
			select {
			case <-read:
			case <-finished:
				t.Fatalf("conflict overwrite ended before body read: %v", uploadErr)
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			active := waitAgentUploadNetworkSample(t, manager)
			if active.BytesDone != 0 || active.Kind != transfer.KindUpload {
				t.Fatalf("unexpected live conflict transfer: %+v", active)
			}
			unblock()
			<-finished
			_, tasks := manager.Snapshot()
			wantState := transfer.StateCompleted
			if fail {
				wantState = transfer.StateFailed
			}
			if (uploadErr != nil) != fail || len(tasks) != 1 || tasks[0].State != wantState || tasks[0].InstantBytesPerSecond != 0 {
				t.Fatalf("conflict result err=%v tasks=%+v", uploadErr, tasks)
			}
			assertAgentUploadNetworkRates(t, tasks[0])
			if (len(cli.deleted) == 1) == fail || (!fail && cli.deleted[0] != 20) {
				t.Fatalf("conflict deletion semantics changed: %v", cli.deleted)
			}
		})
	}
}
