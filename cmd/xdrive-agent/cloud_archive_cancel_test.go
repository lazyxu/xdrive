package main

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
)

type cancelArchiveReader struct {
	cancel context.CancelFunc
}

func (r cancelArchiveReader) Read(p []byte) (int, error) {
	p[0] = 'x'
	r.cancel()
	return 1, nil
}

func TestArchiveCancellationReaderStopsDuringCopy(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, err := io.Copy(io.Discard, archiveCancellationReader{
		ctx: ctx,
		src: cancelArchiveReader{cancel: cancel},
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancelled archive stream to stop with context.Canceled, got %v", err)
	}
}

func TestExtractArchiveCancelledBeforeStageDoesNotChangeExistingFiles(t *testing.T) {
	archive := writeAgentArchive(t, map[string]struct {
		body string
		mode os.FileMode
	}{
		"Album/photo.jpg": {"data", 0o644},
	})
	target := t.TempDir()
	existing := filepath.Join(target, "Album", "keep.txt")
	if err := os.MkdirAll(filepath.Dir(existing), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(existing, []byte("original"), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := extractDownloadedArchiveContext(ctx, archive, target); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected real cancellation, got %v", err)
	}
	actual, err := os.ReadFile(existing)
	if err != nil || string(actual) != "original" {
		t.Fatalf("original file changed: data=%q err=%v", actual, err)
	}
	entries, err := os.ReadDir(target)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "Album" {
		t.Fatalf("cancelled ZIP left extra files: %+v", entries)
	}
}

func TestCopyArchiveCancelledBeforePromotionCreatesNothing(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "src.txt")
	dest := filepath.Join(dir, "dest.txt")
	if err := os.WriteFile(source, []byte("payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := copyDownloadedArchiveRootContext(ctx, source, dest); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected canceled copy, got %v", err)
	}
	if _, err := os.Stat(dest); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("cancelled promotion created a destination: %v", err)
	}
}

func TestCopyArchiveDestinationConflictPreservesPreexistingFile(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source.txt")
	target := filepath.Join(dir, "target.txt")
	if err := os.WriteFile(source, []byte("incoming"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("existing"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := copyDownloadedArchiveRootContext(context.Background(), source, target); !errors.Is(err, os.ErrExist) {
		t.Fatalf("expected exclusive-create conflict, got %v", err)
	}
	actual, err := os.ReadFile(target)
	if err != nil || string(actual) != "existing" {
		t.Fatalf("conflicting existing file must survive: data=%q err=%v", actual, err)
	}
}
