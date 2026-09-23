package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/conflictstate"
)

type fakeConflictClient struct {
	remote        map[string]client.Node
	deleted       []uint64
	overwritten   uint64
	overwriteRev  uint64
	overwritePath string
}

func (f *fakeConflictClient) Walk(context.Context) (map[string]client.Node, error) {
	return f.remote, nil
}

func (f *fakeConflictClient) Delete(_ context.Context, id, _ uint64) error {
	f.deleted = append(f.deleted, id)
	return nil
}

func (f *fakeConflictClient) OverwriteFileResumable(
	_ context.Context,
	id, revision uint64,
	path string,
	_ client.UploadProgress,
) (client.Node, error) {
	f.overwritten = id
	f.overwriteRev = revision
	f.overwritePath = path
	return f.remote["docs/a.txt"], nil
}

func TestApplyConflictChoiceKeepServer(t *testing.T) {
	f := &fakeConflictClient{remote: map[string]client.Node{
		"docs/a.txt":          {ID: 10, Revision: 3},
		"docs/a conflict.txt": {ID: 20, Revision: 1},
	}}
	record := conflictstate.Record{
		OriginalPath: "docs/a.txt", ConflictPath: "docs/a conflict.txt",
		OriginalNodeID: 10, ConflictNodeID: 20,
	}
	if err := applyConflictChoice(context.Background(), f, t.TempDir(), record, "server"); err != nil {
		t.Fatal(err)
	}
	if f.overwritten != 0 {
		t.Fatalf("server choice overwrote original node %d", f.overwritten)
	}
	if len(f.deleted) != 1 || f.deleted[0] != 20 {
		t.Fatalf("server choice deleted=%v, want conflict node 20", f.deleted)
	}
}

func TestApplyConflictChoiceKeepLocal(t *testing.T) {
	root := t.TempDir()
	conflictPath := filepath.Join(root, "docs", "a conflict.txt")
	if err := os.MkdirAll(filepath.Dir(conflictPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(conflictPath, []byte("local"), 0o600); err != nil {
		t.Fatal(err)
	}
	f := &fakeConflictClient{remote: map[string]client.Node{
		"docs/a.txt":          {ID: 10, Revision: 3},
		"docs/a conflict.txt": {ID: 20, Revision: 1},
	}}
	record := conflictstate.Record{
		OriginalPath: "docs/a.txt", ConflictPath: "docs/a conflict.txt",
		OriginalNodeID: 10, ConflictNodeID: 20,
	}
	if err := applyConflictChoice(context.Background(), f, root, record, "local"); err != nil {
		t.Fatal(err)
	}
	if f.overwritten != 10 || f.overwriteRev != 3 || f.overwritePath != conflictPath {
		t.Fatalf("overwrite id=%d rev=%d path=%q", f.overwritten, f.overwriteRev, f.overwritePath)
	}
	if len(f.deleted) != 1 || f.deleted[0] != 20 {
		t.Fatalf("local choice deleted=%v, want conflict node 20", f.deleted)
	}
}
