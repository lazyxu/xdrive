package main

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestFindConflictNodePrefersPathThenID(t *testing.T) {
	remote := map[string]client.Node{
		"docs/a.txt":    {ID: 10, Name: "a.txt"},
		"docs/copy.txt": {ID: 20, Name: "copy.txt"},
	}
	if got, ok := findConflictNode(remote, "docs/a.txt", 10); !ok || got.ID != 10 {
		t.Fatalf("path lookup got=%+v ok=%v", got, ok)
	}
	if got, ok := findConflictNode(remote, "missing.txt", 20); !ok || got.ID != 20 {
		t.Fatalf("id fallback got=%+v ok=%v", got, ok)
	}
	if _, ok := findConflictNode(remote, "docs/a.txt", 99); ok {
		t.Fatal("path with mismatched explicit id should not resolve")
	}
}
