package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
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
