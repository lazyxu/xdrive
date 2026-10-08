//go:build windows

package mount

import (
	"fmt"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestWindowsLocalMovedPlaceholderBaselineIndexLargeBatch(t *testing.T) {
	const (
		baselineItems = 100_000
		movedItems    = 500
	)

	parentID := uint64(1)
	baseline := make(map[string]winState, baselineItems+1)
	baseline[""] = winState{node: client.Node{ID: 1, Type: "dir", Revision: 1}}
	for item := 0; item < baselineItems; item++ {
		rel := fmt.Sprintf("file-%06d", item)
		baseline[rel] = winState{node: client.Node{
			ID:       uint64(item + 2),
			ParentID: &parentID,
			Name:     rel,
			Type:     "file",
			Revision: 1,
		}}
	}

	var index winBaselineNodeIndex
	for item := 0; item < movedItems; item++ {
		nodeID := uint64(baselineItems + 1 - item)
		rel, state, ok, nextIndex := findBaselinePathByNodeIDLazyIndexed(
			baseline,
			index,
			nodeID,
		)
		index = nextIndex
		if !ok || state.node.ID != nodeID || rel == "" {
			t.Fatalf("lookup %d rel=%q state=%+v ok=%t", item, rel, state, ok)
		}
		if item == 0 {
			if len(index) != baselineItems {
				t.Fatalf("lazy index size=%d want=%d", len(index), baselineItems)
			}
			// If a later lookup rebuilt the map instead of reusing it, this
			// sentinel would disappear.
			index[9_999_999] = "sentinel"
		}
	}
	if got := index[9_999_999]; got != "sentinel" {
		t.Fatalf("local moved-placeholder index was rebuilt; sentinel=%q", got)
	}
}

func TestWindowsLocalMovedPlaceholderIndexCachesPostBuildAddition(t *testing.T) {
	parentID := uint64(1)
	baseline := map[string]winState{
		"": {
			node: client.Node{ID: 1, Type: "dir", Revision: 1},
		},
		"old.txt": {
			node: client.Node{
				ID: 2, ParentID: &parentID, Name: "old.txt", Type: "file", Revision: 1,
			},
		},
	}

	_, _, ok, index := findBaselinePathByNodeIDLazyIndexed(baseline, nil, 2)
	if !ok {
		t.Fatal("initial indexed lookup failed")
	}

	baseline["added.txt"] = winState{node: client.Node{
		ID: 3, ParentID: &parentID, Name: "added.txt", Type: "file", Revision: 1,
	}}
	rel, state, ok, index := findBaselinePathByNodeIDLazyIndexed(baseline, index, 3)
	if !ok || rel != "added.txt" || state.node.ID != 3 {
		t.Fatalf("post-build addition rel=%q state=%+v ok=%t", rel, state, ok)
	}
	if got := index[3]; got != "added.txt" {
		t.Fatalf("post-build addition was not cached: %q", got)
	}

	delete(baseline, "added.txt")
	if _, _, ok := findBaselinePathByNodeIDIndexed(baseline, index, 3); ok {
		t.Fatal("stale cached addition remained valid after baseline deletion")
	}
}

func TestMoveBaselinePrefixIndexedTracksMovedSubtree(t *testing.T) {
	rootID := uint64(10)
	childID := uint64(11)
	baseline := map[string]winState{
		"old": {
			node: client.Node{ID: rootID, Name: "old", Type: "dir", Revision: 1},
		},
		"old/child.txt": {
			node: client.Node{ID: childID, Name: "child.txt", Type: "file", Revision: 1},
		},
	}
	index := indexBaselinePathsByNodeID(baseline)

	moveBaselinePrefixIndexed(baseline, index, "old", "new")

	if _, ok := baseline["old"]; ok {
		t.Fatal("old prefix remained after indexed move")
	}
	if got := baseline["new"].node.ID; got != rootID {
		t.Fatalf("moved root id=%d want=%d", got, rootID)
	}
	if got := baseline["new/child.txt"].node.ID; got != childID {
		t.Fatalf("moved child id=%d want=%d", got, childID)
	}
	if got := index[rootID]; got != "new" {
		t.Fatalf("root index path=%q want=new", got)
	}
	if got := index[childID]; got != "new/child.txt" {
		t.Fatalf("child index path=%q want=new/child.txt", got)
	}
}
