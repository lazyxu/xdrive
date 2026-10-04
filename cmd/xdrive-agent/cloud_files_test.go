package main

import (
	"archive/zip"
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/transfer"
)

func TestAgentCloudCrumbsLocalizesRoot(t *testing.T) {
	got := agentCloudCrumbs([]client.SearchBreadcrumb{
		{ID: 1, Name: ""},
		{ID: 2, Name: "Projects"},
		{ID: 3, Name: "Archive"},
	})
	if len(got) != 3 ||
		got[0].ID != 1 ||
		got[0].Name != "My files" ||
		got[1].ID != 2 ||
		got[1].Name != "Projects" ||
		got[2].ID != 3 ||
		got[2].Name != "Archive" {
		t.Fatalf("crumbs=%+v", got)
	}
}

func TestReplaceDownloadedFileCreatesDestination(t *testing.T) {
	dir := t.TempDir()
	staged := filepath.Join(dir, "staged.tmp")
	destination := filepath.Join(dir, "report.pdf")
	if err := os.WriteFile(staged, []byte("new-content"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := replaceDownloadedFile(staged, destination); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "new-content" {
		t.Fatalf("destination=%q", got)
	}
	if _, err := os.Stat(staged); !os.IsNotExist(err) {
		t.Fatalf("staged path should be consumed, err=%v", err)
	}
}

func TestReplaceDownloadedFileReplacesExistingDestination(t *testing.T) {
	dir := t.TempDir()
	staged := filepath.Join(dir, "staged.tmp")
	destination := filepath.Join(dir, "report.pdf")
	if err := os.WriteFile(staged, []byte("new-content"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(destination, []byte("old-content"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := replaceDownloadedFile(staged, destination); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "new-content" {
		t.Fatalf("destination=%q", got)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".xdrive-download-backup-") {
			t.Fatalf("backup leaked: %s", entry.Name())
		}
	}
}

func TestReplaceDownloadedFileRejectsDirectoryDestination(t *testing.T) {
	dir := t.TempDir()
	staged := filepath.Join(dir, "staged.tmp")
	destination := filepath.Join(dir, "existing-dir")
	if err := os.WriteFile(staged, []byte("new-content"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(destination, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := replaceDownloadedFile(staged, destination); err == nil {
		t.Fatal("expected directory destination to be rejected")
	}
}

func TestAgentCloudTransferProgressAndCompletion(t *testing.T) {
	manager := transfer.NewManager(10)
	handle, progress := startAgentCloudTransfer(
		manager,
		transfer.KindUpload,
		"upload",
		"report.pdf",
		"/tmp/report.pdf",
		100,
	)
	if handle == nil || progress == nil {
		t.Fatal("expected transfer handle and progress callback")
	}

	progress(40, 100)
	_, items := manager.Snapshot()
	if len(items) != 1 {
		t.Fatalf("items=%d want 1", len(items))
	}
	if got := items[0]; got.State != transfer.StateRunning ||
		got.Kind != transfer.KindUpload ||
		got.Direction != "upload" ||
		got.FileName != "report.pdf" ||
		got.BytesDone != 40 ||
		got.BytesTotal != 100 {
		t.Fatalf("running transfer=%+v", got)
	}

	progress(75, 100)
	finishAgentCloudTransfer(handle, nil)
	_, items = manager.Snapshot()
	if len(items) != 1 {
		t.Fatalf("items=%d want 1", len(items))
	}
	if got := items[0]; got.State != transfer.StateCompleted ||
		got.BytesDone != 100 ||
		got.BytesTotal != 100 ||
		got.Percent != 100 ||
		got.CompletedAt == nil {
		t.Fatalf("completed transfer=%+v", got)
	}
}

func TestAgentCloudTransferFailureIsRetainedInHistory(t *testing.T) {
	manager := transfer.NewManager(10)
	handle, progress := startAgentCloudTransfer(
		manager,
		transfer.KindDownload,
		"download",
		"archive.zip",
		"/tmp/archive.zip",
		0,
	)
	progress(25, 200)
	wantErr := errors.New("network interrupted")
	finishAgentCloudTransfer(handle, wantErr)

	_, items := manager.Snapshot()
	if len(items) != 1 {
		t.Fatalf("items=%d want 1", len(items))
	}
	got := items[0]
	if got.State != transfer.StateFailed ||
		got.Kind != transfer.KindDownload ||
		got.Direction != "download" ||
		got.BytesDone != 25 ||
		got.BytesTotal != 200 ||
		got.Error != wantErr.Error() ||
		got.CompletedAt == nil {
		t.Fatalf("failed transfer=%+v", got)
	}
}

func writeAgentArchive(t *testing.T, entries map[string]struct {
	body string
	mode os.FileMode
}) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "archive.zip")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for name, entry := range entries {
		header := &zip.FileHeader{Name: name, Method: zip.Store}
		if entry.mode != 0 {
			header.SetMode(entry.mode)
		}
		out, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if entry.body != "" {
			if _, err := out.Write([]byte(entry.body)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestExtractDownloadedArchivePreservesTreeAndAvoidsLocalNameConflicts(t *testing.T) {
	destination := t.TempDir()
	if err := os.Mkdir(filepath.Join(destination, "Projects"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(destination, "Projects", "existing.txt"), []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	archive := writeAgentArchive(t, map[string]struct {
		body string
		mode os.FileMode
	}{
		"Projects/":           {"", os.ModeDir | 0o755},
		"Projects/report.txt": {"report", 0o644},
		"Empty/":              {"", os.ModeDir | 0o755},
	})

	downloaded, err := extractDownloadedArchive(archive, destination)
	if err != nil {
		t.Fatal(err)
	}
	if len(downloaded) != 2 {
		t.Fatalf("downloaded=%v", downloaded)
	}
	got, err := os.ReadFile(filepath.Join(destination, "Projects - 副本", "report.txt"))
	if err != nil || string(got) != "report" {
		t.Fatalf("report=%q err=%v", got, err)
	}
	kept, err := os.ReadFile(filepath.Join(destination, "Projects", "existing.txt"))
	if err != nil || string(kept) != "keep" {
		t.Fatalf("existing=%q err=%v", kept, err)
	}
	if info, err := os.Stat(filepath.Join(destination, "Empty")); err != nil || !info.IsDir() {
		t.Fatalf("empty dir missing: info=%v err=%v", info, err)
	}
}

func TestExtractDownloadedArchiveRejectsUnsafeEntries(t *testing.T) {
	for name, entry := range map[string]struct {
		path string
		mode os.FileMode
	}{
		"parent traversal": {"../evil.txt", 0o644},
		"backslash":        {"folder\\evil.txt", 0o644},
		"symlink":          {"link", os.ModeSymlink | 0o777},
	} {
		t.Run(name, func(t *testing.T) {
			destination := t.TempDir()
			archive := writeAgentArchive(t, map[string]struct {
				body string
				mode os.FileMode
			}{
				entry.path: {"payload", entry.mode},
			})
			if _, err := extractDownloadedArchive(archive, destination); err == nil {
				t.Fatal("expected unsafe archive to be rejected")
			}
			entries, err := os.ReadDir(destination)
			if err != nil {
				t.Fatal(err)
			}
			if len(entries) != 0 {
				t.Fatalf("unsafe archive polluted destination: %+v", entries)
			}
		})
	}
}

func TestValidateDownloadedArchiveRejectsDuplicateCaseFoldedPaths(t *testing.T) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, name := range []string{"Folder/a.txt", "folder/A.txt"} {
		out, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = out.Write([]byte("x"))
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "duplicates.zip")
	if err := os.WriteFile(path, buffer.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	reader, err := zip.OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	if _, _, err := validateDownloadedArchive(reader); err == nil {
		t.Fatal("expected case-folded duplicate archive path to be rejected")
	}
}
