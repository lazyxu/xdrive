//go:build windows

package mount

import (
	"fmt"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestWindowsRemoteJournalBaselineIndexLargeMissingPage(t *testing.T) {
	const (
		baselineItems = 100_000
		pageSize      = 500
	)

	parentID := uint64(1)
	baseline := make(map[string]winState, baselineItems+1)
	baseline[""] = winState{node: client.Node{ID: 1, Type: "dir", Revision: 1}}
	for index := 0; index < baselineItems; index++ {
		rel := fmt.Sprintf("file-%06d", index)
		baseline[rel] = winState{node: client.Node{
			ID:       uint64(index + 2),
			ParentID: &parentID,
			Name:     rel,
			Type:     "file",
			Revision: 1,
		}}
	}

	index := indexBaselinePathsByNodeID(baseline)
	if len(index) != baselineItems {
		t.Fatalf("baseline node index size=%d want=%d", len(index), baselineItems)
	}

	for pass := 0; pass < 2; pass++ {
		for offset := 0; offset < pageSize; offset++ {
			nodeID := uint64(1_000_000 + offset)
			if _, _, ok := findBaselinePathByNodeIDIndexed(baseline, index, nodeID); ok {
				t.Fatalf("missing node %d unexpectedly resolved on pass %d", nodeID, pass)
			}
		}
	}

	lastID := uint64(baselineItems + 1)
	rel, state, ok := findBaselinePathByNodeIDIndexed(baseline, index, lastID)
	if !ok || rel != "file-099999" || state.node.ID != lastID {
		t.Fatalf("indexed existing lookup rel=%q state=%+v ok=%t", rel, state, ok)
	}
}

func TestWindowsRemoteJournalBaselineIndexTracksFileMoveDelete(t *testing.T) {
	parentID := uint64(1)
	state := winState{node: client.Node{
		ID:       9,
		ParentID: &parentID,
		Name:     "old.txt",
		Type:     "file",
		Revision: 3,
	}}
	baseline := map[string]winState{
		"":        {node: client.Node{ID: 1, Type: "dir", Revision: 1}},
		"old.txt": state,
	}
	index := indexBaselinePathsByNodeID(baseline)

	moveBaselineFileIndexed(baseline, index, "old.txt", "new.txt")
	if _, ok := baseline["old.txt"]; ok {
		t.Fatal("old file path remained after indexed move")
	}
	if got := baseline["new.txt"].node.ID; got != 9 {
		t.Fatalf("moved node id=%d want=9", got)
	}
	if rel, _, ok := findBaselinePathByNodeIDIndexed(baseline, index, 9); !ok || rel != "new.txt" {
		t.Fatalf("moved index rel=%q ok=%t want=new.txt,true", rel, ok)
	}

	delete(baseline, "new.txt")
	delete(index, 9)
	if _, _, ok := findBaselinePathByNodeIDIndexed(baseline, index, 9); ok {
		t.Fatal("deleted file remained in node index")
	}
}
