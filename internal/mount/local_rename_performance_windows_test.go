//go:build windows

package mount

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestWindowsLocalFileRenameBaselineFastPath(t *testing.T) {
	const baselineItems = 100_000
	baseline := make(map[string]winState, baselineItems+3)
	baseline[""] = winState{node: client.Node{ID: 1, Type: "dir"}}
	baseline["old.txt"] = winState{node: client.Node{ID: 2, Name: "old.txt", Type: "file", Revision: 7}}
	baseline["new.txt"] = winState{node: client.Node{ID: 3, Name: "new.txt", Type: "file", Revision: 2}}
	for index := 0; index < baselineItems; index++ {
		rel := fmt.Sprintf("kept-%06d.bin", index)
		baseline[rel] = winState{node: client.Node{ID: uint64(index + 10), Name: rel, Type: "file"}}
	}

	moveLocalRenameBaseline(baseline, "old.txt", "new.txt", "file")

	if _, ok := baseline["old.txt"]; ok {
		t.Fatal("old file baseline entry remained after rename")
	}
	got, ok := baseline["new.txt"]
	if !ok || got.node.ID != 2 || got.node.Revision != 7 {
		t.Fatalf("renamed baseline state=%+v ok=%t", got, ok)
	}
	if len(baseline) != baselineItems+2 {
		t.Fatalf("baseline entries=%d want=%d", len(baseline), baselineItems+2)
	}
	for _, rel := range []string{"kept-000000.bin", "kept-050000.bin", "kept-099999.bin"} {
		if _, ok := baseline[rel]; !ok {
			t.Fatalf("unrelated baseline entry %q was removed", rel)
		}
	}
}

func TestWindowsLocalFileRenameDirectoryTargetKeepsSubtreeFallback(t *testing.T) {
	baseline := map[string]winState{
		"":                 {node: client.Node{ID: 1, Type: "dir"}},
		"old.txt":          {node: client.Node{ID: 2, Type: "file", Revision: 1}},
		"target":           {node: client.Node{ID: 3, Type: "dir", Revision: 1}},
		"target/child.txt": {node: client.Node{ID: 4, Type: "file", Revision: 1}},
	}

	moveLocalRenameBaseline(baseline, "old.txt", "target", "file")

	if _, ok := baseline["target/child.txt"]; ok {
		t.Fatal("directory-target fallback must prune the old target subtree")
	}
	if got := baseline["target"].node.ID; got != 2 {
		t.Fatalf("target node id=%d want=2", got)
	}
	if _, ok := baseline["old.txt"]; ok {
		t.Fatal("old file baseline entry remained after directory-target fallback")
	}
}

func TestWindowsLocalFileRenameFastPathSourceShape(t *testing.T) {
	source, err := os.ReadFile("reconcile_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	start := strings.Index(text, "func moveLocalRenameBaseline(")
	if start < 0 {
		t.Fatal("cannot find moveLocalRenameBaseline source")
	}
	relEnd := strings.Index(text[start:], "func (p *winProvider) reconcileMovedPlaceholder(")
	if relEnd <= 0 {
		t.Fatal("cannot isolate moveLocalRenameBaseline source")
	}
	fn := text[start : start+relEnd]

	fastStart := strings.Index(fn, "if sourceType == \"file\"")
	prefixStart := strings.Index(fn, "deletePrefix(baseline, newRel)")
	if fastStart < 0 || prefixStart <= fastStart {
		t.Fatal("file fast path must precede subtree prefix helpers")
	}
	fast := fn[fastStart:prefixStart]
	for _, token := range []string{
		"delete(baseline, newRel)",
		"delete(baseline, oldRel)",
		"baseline[newRel] = state",
		"return",
	} {
		if !strings.Contains(fast, token) {
			t.Fatalf("file rename fast path missing %q", token)
		}
	}
	if strings.Contains(fast, "deletePrefix(") || strings.Contains(fast, "moveBaselinePrefix(") {
		t.Fatal("file rename fast path must not scan baseline prefixes")
	}
	if strings.Count(fn, "deletePrefix(") != 1 || strings.Count(fn, "moveBaselinePrefix(") != 1 {
		t.Fatal("directory/exception fallback must retain exactly one prefix-delete and one prefix-move path")
	}
}
