package conflictstate

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestStoreRoundTripAndRemove(t *testing.T) {
	dir := t.TempDir()
	a := Record{ID: "a", OriginalPath: "docs/a.txt", ConflictPath: "docs/a (conflict pc 1).txt", CreatedAt: time.Unix(10, 0)}
	b := Record{ID: "b", OriginalPath: "docs/b.txt", ConflictPath: "docs/b (conflict pc 2).txt", CreatedAt: time.Unix(20, 0)}
	if err := Upsert(dir, a); err != nil {
		t.Fatal(err)
	}
	if err := Upsert(dir, b); err != nil {
		t.Fatal(err)
	}
	items, err := List(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].ID != "b" || items[1].ID != "a" {
		t.Fatalf("items=%+v", items)
	}
	if err := Remove(dir, "b"); err != nil {
		t.Fatal(err)
	}
	items, err = List(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != "a" {
		t.Fatalf("after remove=%+v", items)
	}
	st, err := os.Stat(filepath.Join(dir, "conflicts.json"))
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && st.Mode().Perm()&0o077 != 0 {
		t.Fatalf("conflict file permissions=%o", st.Mode().Perm())
	}
}

func TestClearMissing(t *testing.T) {
	dir := t.TempDir()
	if err := Upsert(dir, Record{ID: "keep", ConflictPath: "keep.txt"}); err != nil {
		t.Fatal(err)
	}
	if err := Upsert(dir, Record{ID: "drop", ConflictPath: "drop.txt"}); err != nil {
		t.Fatal(err)
	}
	if err := ClearMissing(dir, func(r Record) bool { return r.ID == "keep" }); err != nil {
		t.Fatal(err)
	}
	items, err := List(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != "keep" {
		t.Fatalf("items=%+v", items)
	}
}
