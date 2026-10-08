//go:build windows

package mount

import (
	"fmt"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestPruneRemoteDeletedBaselineAvoidsRepeatedPrefixScans(t *testing.T) {
	const missingFiles = 1200

	baseline := map[string]winState{
		"": {node: client.Node{ID: 1, Type: "dir"}},
	}
	remote := map[string]client.Node{
		"": {ID: 1, Type: "dir"},
	}
	for index := 0; index < missingFiles; index++ {
		rel := fmt.Sprintf("missing-%04d.bin", index)
		baseline[rel] = winState{node: client.Node{
			ID:   uint64(index + 2),
			Name: rel,
			Type: "file",
		}}
	}

	removed := make([]string, 0, missingFiles)
	pruneRemoteDeletedBaselineWithRemove(
		baseline,
		remote,
		func(rel string) {
			removed = append(removed, rel)
		},
	)
	if len(removed) != missingFiles {
		t.Fatalf("physical removal roots=%d want=%d", len(removed), missingFiles)
	}
	if len(baseline) != 1 {
		t.Fatalf("baseline entries=%d want=1", len(baseline))
	}
	if _, ok := baseline[""]; !ok {
		t.Fatal("root baseline entry was removed")
	}
}

func TestPruneRemoteDeletedBaselineCollapsesMissingSubtreeRemoval(t *testing.T) {
	baseline := map[string]winState{
		"":                {node: client.Node{ID: 1, Type: "dir"}},
		"gone":            {node: client.Node{ID: 2, Type: "dir"}},
		"gone/child":      {node: client.Node{ID: 3, Type: "dir"}},
		"gone/child/a":    {node: client.Node{ID: 4, Type: "file"}},
		"gone/child/b":    {node: client.Node{ID: 5, Type: "file"}},
		"kept":            {node: client.Node{ID: 6, Type: "dir"}},
		"kept/remote.bin": {node: client.Node{ID: 7, Type: "file"}},
	}
	remote := map[string]client.Node{
		"":                {ID: 1, Type: "dir"},
		"kept":            {ID: 6, Type: "dir"},
		"kept/remote.bin": {ID: 7, Type: "file"},
	}

	removed := []string{}
	pruneRemoteDeletedBaselineWithRemove(
		baseline,
		remote,
		func(rel string) {
			removed = append(removed, rel)
		},
	)
	if len(removed) != 1 || removed[0] != "gone" {
		t.Fatalf("physical removal roots=%v want=[gone]", removed)
	}
	for _, rel := range []string{"gone", "gone/child", "gone/child/a", "gone/child/b"} {
		if _, ok := baseline[rel]; ok {
			t.Fatalf("missing subtree entry %q remains in baseline", rel)
		}
	}
	for _, rel := range []string{"", "kept", "kept/remote.bin"} {
		if _, ok := baseline[rel]; !ok {
			t.Fatalf("remote entry %q was removed from baseline", rel)
		}
	}
}
