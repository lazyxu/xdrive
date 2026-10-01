package main

import (
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
