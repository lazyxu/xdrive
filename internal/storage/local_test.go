package storage

import (
	"context"
	"io"
	"strings"
	"testing"
)

func TestLocalPutOpenDelete(t *testing.T) {
	s, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if n, err := s.Put(context.Background(), "7/docs/blob", strings.NewReader("hello")); err != nil || n != 5 {
		t.Fatalf("put n=%d err=%v", n, err)
	}
	f, err := s.Open(context.Background(), "7/docs/blob")
	if err != nil {
		t.Fatal(err)
	}
	b, err := io.ReadAll(f)
	_ = f.Close()
	if err != nil || string(b) != "hello" {
		t.Fatalf("read %q err=%v", b, err)
	}
	if err := s.Delete(context.Background(), "7/docs/blob"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Open(context.Background(), "7/docs/blob"); err == nil {
		t.Fatal("expected missing file")
	}
}

func TestLocalRejectsTraversal(t *testing.T) {
	s, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"../escape", "../../x"} {
		if _, err := s.Put(context.Background(), key, strings.NewReader("x")); err == nil {
			t.Fatalf("expected traversal rejection for %q", key)
		}
	}
}

func TestLocalReady(t *testing.T) {
	s, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Ready(context.Background()); err != nil {
		t.Fatalf("ready: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := s.Ready(ctx); err == nil {
		t.Fatal("expected cancelled readiness check to fail")
	}
}
