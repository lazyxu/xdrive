//go:build windows

package mount

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestWindowsPathPrefixSet(t *testing.T) {
	prefixes := make(winPathPrefixSet)
	prefixes.add("gone")
	prefixes.add("other/nested")

	for _, path := range []string{"gone", "gone/a.txt", "gone/child/b.txt", "other/nested", "other/nested/c.txt"} {
		if !prefixes.covers(path) {
			t.Fatalf("expected prefix set to cover %q", path)
		}
	}
	for _, path := range []string{"", "gone-ish/a.txt", "other", "other/nested-ish/c.txt", "kept/a.txt"} {
		if prefixes.covers(path) {
			t.Fatalf("prefix set unexpectedly covers %q", path)
		}
	}
}

func TestWindowsDeleteBaselinePrefixes(t *testing.T) {
	const deletedFiles = 1200
	baseline := make(map[string]winState, deletedFiles+3)
	baseline[""] = winState{node: client.Node{ID: 1, Type: "dir"}}
	baseline["kept"] = winState{node: client.Node{ID: 2, Type: "dir"}}
	baseline["kept/file.bin"] = winState{node: client.Node{ID: 3, Type: "file"}}
	prefixes := make(winPathPrefixSet)
	for index := 0; index < deletedFiles; index++ {
		rel := fmt.Sprintf("gone-%04d.bin", index)
		baseline[rel] = winState{node: client.Node{ID: uint64(index + 10), Type: "file"}}
		prefixes.add(rel)
	}

	deleteBaselinePrefixes(baseline, prefixes)

	if len(baseline) != 3 {
		t.Fatalf("baseline entries=%d want=3", len(baseline))
	}
	for _, rel := range []string{"", "kept", "kept/file.bin"} {
		if _, ok := baseline[rel]; !ok {
			t.Fatalf("kept baseline entry %q was removed", rel)
		}
	}
}

func TestWindowsLocalDeletePruningSourceShape(t *testing.T) {
	mountSource, err := os.ReadFile("mount_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	reconcileSource, err := os.ReadFile("reconcile_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	mountText := string(mountSource)
	reconcileText := string(reconcileSource)

	if strings.Count(mountText, "underAny(") != 1 {
		t.Fatal("full reconcile must not call the legacy linear prefix-slice helper")
	}
	if strings.Contains(reconcileText, "underAny(") {
		t.Fatal("local-change reconcile must not call the legacy linear prefix-slice helper")
	}
	if !strings.Contains(mountText, "deletedPrefixes := make(winPathPrefixSet)") ||
		!strings.Contains(mountText, "deleteBaselinePrefixes(baseline, deletedPrefixes)") {
		t.Fatal("full reconcile local deletion must batch baseline prefix cleanup")
	}
	if !strings.Contains(reconcileText, "processedSubtrees := make(winPathPrefixSet)") {
		t.Fatal("local-change subtree suppression must use the prefix set")
	}
	if !strings.Contains(reconcileText, "deletedPrefixes := make(winPathPrefixSet)") ||
		!strings.Contains(reconcileText, "deleteBaselinePrefixes(baseline, deletedPrefixes)") {
		t.Fatal("local-change deletion must batch baseline prefix cleanup")
	}
	if strings.Count(mountText, "deleteBaselinePrefixes(baseline, deletedPrefixes)") < 2 {
		t.Fatal("full reconcile must prune successful deletes on both normal and fatal exits")
	}
	if strings.Count(reconcileText, "deleteBaselinePrefixes(baseline, deletedPrefixes)") < 2 {
		t.Fatal("local-change reconcile must prune successful deletes on both normal and fatal exits")
	}
}
