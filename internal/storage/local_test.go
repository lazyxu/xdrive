package storage

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
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
	info, err := os.Stat(filepath.Join(s.root, UploadStagingDir))
	if err != nil {
		t.Fatalf("stat upload staging directory: %v", err)
	}
	if !info.IsDir() {
		t.Fatal("upload staging path is not a directory")
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := s.Ready(ctx); err == nil {
		t.Fatal("expected cancelled readiness check to fail")
	}
}

func TestLocalReportsFilesystemCapacity(t *testing.T) {
	s, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	capacity, err := s.Capacity(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if capacity.TotalBytes <= 0 {
		t.Fatalf("total capacity=%d", capacity.TotalBytes)
	}
	if capacity.AvailableBytes < 0 || capacity.AvailableBytes > capacity.TotalBytes {
		t.Fatalf("invalid available capacity: %+v", capacity)
	}
}

func TestLocalPromoteMovesContentIntoTarget(t *testing.T) {
	s, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Put(context.Background(), "tmp/source", strings.NewReader("hello")); err != nil {
		t.Fatal(err)
	}
	if err := s.Promote(context.Background(), "tmp/source", ".xdrive-blobs/sha256/aa/target", 5); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Open(context.Background(), "tmp/source"); err == nil {
		t.Fatal("promoted source still exists")
	}
	target, err := s.Open(context.Background(), ".xdrive-blobs/sha256/aa/target")
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	got, err := io.ReadAll(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "hello" {
		t.Fatalf("promoted content=%q", got)
	}
}

func TestLocalStagingInspectionAndCleanup(t *testing.T) {
	s, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Put(context.Background(), UploadStagingDir+"/1/run/part", strings.NewReader("part")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Put(context.Background(), "normal/blob", strings.NewReader("normal")); err != nil {
		t.Fatal(err)
	}
	files, err := s.ListStaging(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 || files[0].Key != UploadStagingDir+"/1/run/part" || files[0].Size != 4 {
		t.Fatalf("unexpected staging files: %+v", files)
	}
	if err := s.DeleteStaging(context.Background(), "normal/blob"); err == nil {
		t.Fatal("DeleteStaging accepted non-staging key")
	}
	if err := s.DeleteStaging(context.Background(), files[0].Key); err != nil {
		t.Fatal(err)
	}
	files, err = s.ListStaging(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 0 {
		t.Fatalf("staging files remain after cleanup: %+v", files)
	}
	normal, err := s.Open(context.Background(), "normal/blob")
	if err != nil {
		t.Fatalf("normal storage was affected by staging cleanup: %v", err)
	}
	if err := normal.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestLocalWalkStagingIsLexicalAndStopsEarly(t *testing.T) {
	s, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{
		UploadStagingDir + "/c/part",
		UploadStagingDir + "/a/part",
		UploadStagingDir + "/b/part",
	} {
		if _, err := s.Put(context.Background(), key, strings.NewReader(key)); err != nil {
			t.Fatal(err)
		}
	}

	stop := errors.New("stop")
	var keys []string
	err = s.WalkStaging(context.Background(), func(file StagingFile) error {
		keys = append(keys, file.Key)
		if len(keys) == 2 {
			return stop
		}
		return nil
	})
	if !errors.Is(err, stop) {
		t.Fatalf("walk error=%v want stop sentinel", err)
	}
	want := []string{
		UploadStagingDir + "/a/part",
		UploadStagingDir + "/b/part",
	}
	if len(keys) != len(want) {
		t.Fatalf("walk keys=%v want=%v", keys, want)
	}
	for i := range want {
		if keys[i] != want[i] {
			t.Fatalf("walk keys=%v want=%v", keys, want)
		}
	}
}
