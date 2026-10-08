//go:build linux

package mount

import (
	"bytes"
	"context"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/transfer"
)

func TestLinuxSyncUploadReportsNetworkBeforeFirstChunkCompletes(t *testing.T) {
	api := newLinuxSyncAPI()
	read := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut && strings.Contains(r.URL.Path, "/chunks/") {
			prefix := make([]byte, 1024)
			if _, err := io.ReadFull(r.Body, prefix); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			close(read)
			<-release
			r.Body = io.NopCloser(io.MultiReader(bytes.NewReader(prefix), r.Body))
		}
		api.ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	t.Cleanup(unblock)
	file, err := os.CreateTemp(t.TempDir(), "sync-upload-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = file.Close() })
	data := bytes.Repeat([]byte("s"), 64<<10)
	if _, err := file.Write(data); err != nil {
		t.Fatal(err)
	}
	node, _, _ := api.node(3)
	manager := transfer.NewManager(10)
	handle := &linuxHandle{cli: client.New(server.URL, "token"), node: node, file: file, path: file.Name(), dirty: true, transfers: manager}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	finished := make(chan struct{})
	var uploadErr error
	go func() {
		defer close(finished)
		uploadErr = handle.sync(ctx)
	}()
	t.Cleanup(func() { unblock(); <-finished })
	select {
	case <-read:
	case <-finished:
		t.Fatalf("sync ended before body was read: %v", uploadErr)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	sampleCtx, cancelSample := context.WithTimeout(ctx, 2*time.Second)
	defer cancelSample()
	for {
		revision, tasks := manager.Snapshot()
		// Socket buffering can consume the body within one clock tick. A
		// positive byte sample is required; its finite rate may still be zero.
		if len(tasks) == 1 && tasks[0].SpeedSource == "client" && tasks[0].SpeedUpdatedAt != nil {
			assertLinuxUploadNetworkRates(t, tasks[0])
			if tasks[0].BytesDone != 0 || tasks[0].State != transfer.StateRunning {
				t.Fatalf("network observation changed logical sync progress: %+v", tasks)
			}
			break
		}
		if _, _, changed := manager.Wait(sampleCtx, revision); !changed {
			t.Fatalf("automatic sync has no network sample before its first chunk completes: %+v", tasks)
		}
	}
	unblock()
	<-finished
	if uploadErr != nil {
		t.Fatal(uploadErr)
	}
	_, tasks := manager.Snapshot()
	if len(tasks) != 1 || tasks[0].State != transfer.StateCompleted || tasks[0].InstantBytesPerSecond != 0 {
		t.Fatalf("automatic upload completion=%+v", tasks)
	}
	assertLinuxUploadNetworkRates(t, tasks[0])
	updated, content, ok := api.node(3)
	if !ok || !bytes.Equal(content, data) || updated.Revision <= node.Revision {
		t.Fatalf("network observation changed the uploaded file: node=%+v bytes=%d", updated, len(content))
	}
}

func assertLinuxUploadNetworkRates(t *testing.T, task transfer.Task) {
	t.Helper()
	if rate := task.InstantBytesPerSecond; math.IsNaN(rate) || math.IsInf(rate, 0) || rate < 0 {
		t.Fatalf("instant network rate must be finite and nonnegative: %+v", task)
	}
	if rate := task.AverageBytesPerSecond; math.IsNaN(rate) || math.IsInf(rate, 0) || rate < 0 {
		t.Fatalf("average network rate must be finite and nonnegative: %+v", task)
	}
}
