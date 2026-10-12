package storage

import (
	"context"
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

type blockedAtomicTempReader struct {
	started chan struct{}
	release chan struct{}
	step    int
}

func (r *blockedAtomicTempReader) Read(p []byte) (int, error) {
	if r.step != 0 {
		return 0, io.EOF
	}
	r.step++
	close(r.started)
	<-r.release
	return copy(p, []byte("safe-data")), nil
}

func TestLocalTempCleanupLeaseAcrossStoreInstances(t *testing.T) {
	root := t.TempDir()
	writer, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	cleaner, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	reader := &blockedAtomicTempReader{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	var once sync.Once
	unblock := func() { once.Do(func() { close(reader.release) }) }
	defer unblock()
	putDone := make(chan error, 1)
	go func() {
		_, err := writer.Put(ctx, "dir/real.bin", reader)
		putDone <- err
	}()
	select {
	case <-reader.started:
	case <-time.After(5 * time.Second):
		t.Fatal("real writer never acquired its active shared lifetime")
	}
	release, acquired, err := cleaner.TryExclusiveTempCleanup(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if acquired {
		release()
		t.Fatal("admin exclusive temp cleanup acquired while another Store was writing")
	}
	unblock()
	select {
	case err := <-putDone:
		if err != nil {
			t.Fatalf("real physical write failed: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("writer never completed")
	}
	release, acquired, err = cleaner.TryExclusiveTempCleanup(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !acquired {
		t.Fatal("idle admin cleanup could not obtain exclusive temp lease")
	}
	release()
	f, err := cleaner.Open(ctx, "dir/real.bin")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	got, err := io.ReadAll(f)
	if err != nil || string(got) != "safe-data" {
		t.Fatalf("write=%q err=%v", got, err)
	}
	if _, err := writer.Put(ctx, "dir/second.bin", strings.NewReader("ok")); err != nil {
		t.Fatalf("released cleanup lease prevented another write: %v", err)
	}
}
