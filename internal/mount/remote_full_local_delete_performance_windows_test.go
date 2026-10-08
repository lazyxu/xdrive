//go:build windows

package mount

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestWindowsRemoteFullLocalFileDeleteBaselineFastPath(t *testing.T) {
	const baselineItems = 100_000
	baseline := make(map[string]winState, baselineItems+2)
	baseline[""] = winState{node: client.Node{ID: 1, Type: "dir"}}
	baseline["gone.txt"] = winState{node: client.Node{ID: 2, Name: "gone.txt", Type: "file", Revision: 3}}
	for index := 0; index < baselineItems; index++ {
		rel := fmt.Sprintf("kept-%06d.bin", index)
		baseline[rel] = winState{node: client.Node{ID: uint64(index + 10), Name: rel, Type: "file"}}
	}

	deleteRemoteFullLocalMissingBaseline(baseline, "gone.txt", "file", "file")

	if _, ok := baseline["gone.txt"]; ok {
		t.Fatal("deleted file baseline entry remained")
	}
	if len(baseline) != baselineItems+1 {
		t.Fatalf("baseline entries=%d want=%d", len(baseline), baselineItems+1)
	}
	for _, rel := range []string{"kept-000000.bin", "kept-050000.bin", "kept-099999.bin"} {
		if _, ok := baseline[rel]; !ok {
			t.Fatalf("unrelated baseline entry %q was removed", rel)
		}
	}
}

func TestWindowsRemoteFullLocalDirectoryDeleteKeepsSubtreeFallback(t *testing.T) {
	baseline := make(map[string]winState)
	baseline[""] = winState{node: client.Node{ID: 1, Type: "dir"}}
	baseline["gone"] = winState{node: client.Node{ID: 2, Type: "dir", Revision: 1}}
	baseline["gone/child.txt"] = winState{node: client.Node{ID: 3, Type: "file", Revision: 1}}
	baseline["kept.txt"] = winState{node: client.Node{ID: 4, Type: "file", Revision: 1}}

	deleteRemoteFullLocalMissingBaseline(baseline, "gone", "dir", "dir")

	for _, rel := range []string{"gone", "gone/child.txt"} {
		if _, ok := baseline[rel]; ok {
			t.Fatalf("directory fallback left baseline entry %q", rel)
		}
	}
	if _, ok := baseline["kept.txt"]; !ok {
		t.Fatal("directory fallback removed unrelated file")
	}
}

func TestWindowsRemoteFullLocalFileDeleteTypeMismatchKeepsSubtreeFallback(t *testing.T) {
	baseline := make(map[string]winState)
	baseline["item"] = winState{node: client.Node{ID: 2, Type: "file", Revision: 1}}
	baseline["item/legacy-child.txt"] = winState{node: client.Node{ID: 3, Type: "file", Revision: 1}}

	deleteRemoteFullLocalMissingBaseline(baseline, "item", "file", "dir")

	if len(baseline) != 0 {
		t.Fatalf("type-mismatch fallback left %d baseline entries", len(baseline))
	}
}

func TestWindowsRemoteFullLocalFileDeleteFastPathSourceShape(t *testing.T) {
	source, err := os.ReadFile("reconcile_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	start := strings.Index(text, "func deleteRemoteFullLocalMissingBaseline(")
	if start < 0 {
		t.Fatal("cannot find deleteRemoteFullLocalMissingBaseline source")
	}
	relEnd := strings.Index(text[start:], "func (p *winProvider) reconcileRemoteFull(")
	if relEnd <= 0 {
		t.Fatal("cannot isolate deleteRemoteFullLocalMissingBaseline source")
	}
	fn := text[start : start+relEnd]

	fastStart := strings.Index(fn, "if baselineType == \"file\" && remoteType == \"file\"")
	prefixStart := strings.Index(fn, "deletePrefix(baseline, rel)")
	if fastStart < 0 || prefixStart <= fastStart {
		t.Fatal("file exact-delete path must precede subtree fallback")
	}
	fast := fn[fastStart:prefixStart]
	if !strings.Contains(fast, "delete(baseline, rel)") || !strings.Contains(fast, "return") {
		t.Fatal("file exact-delete path must use direct map delete and return")
	}
	if strings.Contains(fast, "deletePrefix(") {
		t.Fatal("file exact-delete path must not scan baseline prefixes")
	}
	if strings.Count(fn, "deletePrefix(") != 1 {
		t.Fatal("directory/type-mismatch fallback must retain exactly one prefix-delete path")
	}
}
