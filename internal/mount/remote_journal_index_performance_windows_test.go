//go:build windows

package mount

import (
	"fmt"
	"os"
	"strings"
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

func TestWindowsRemoteJournalSamePathUpsertSkipsFullBaselineIndex(t *testing.T) {
	const baselineItems = 100_000
	parentID := uint64(1)
	baseline := make(map[string]winState, baselineItems+1)
	baseline[""] = winState{node: client.Node{ID: 1, Type: "dir", Revision: 1}}
	for index := 0; index < baselineItems; index++ {
		rel := fmt.Sprintf("file-%06d", index)
		baseline[rel] = winState{node: client.Node{
			ID: uint64(index + 2), ParentID: &parentID, Name: rel, Type: "file", Revision: 1,
		}}
	}

	nodeID := uint64(baselineItems + 1)
	rel, state, ok, nextIndex := findBaselineChangePath(
		baseline, nil, nodeID, "file-099999",
	)
	if !ok || rel != "file-099999" || state.node.ID != nodeID {
		t.Fatalf("same-path lookup rel=%q state=%+v ok=%t", rel, state, ok)
	}
	if nextIndex != nil {
		t.Fatalf("same-path upsert built full baseline index with %d entries", len(nextIndex))
	}
}

func TestWindowsRemoteJournalRenameStillBuildsLazyBaselineIndex(t *testing.T) {
	parentID := uint64(1)
	baseline := map[string]winState{
		"": {node: client.Node{ID: 1, Type: "dir", Revision: 1}},
		"old.txt": {node: client.Node{
			ID: 9, ParentID: &parentID, Name: "old.txt", Type: "file", Revision: 3,
		}},
	}

	rel, state, ok, index := findBaselineChangePath(baseline, nil, 9, "new.txt")
	if !ok || rel != "old.txt" || state.node.ID != 9 {
		t.Fatalf("rename lookup rel=%q state=%+v ok=%t", rel, state, ok)
	}
	if len(index) != 1 || index[9] != "old.txt" {
		t.Fatalf("rename fallback index=%v", index)
	}
}

func TestWindowsRemoteJournalSamePathFastPathSourceShape(t *testing.T) {
	source, err := os.ReadFile("reconcile_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	start := strings.Index(text, "func (p *winProvider) applyRemoteChangePage(")
	relEnd := strings.Index(text[start:], "func deleteRemoteFullLocalMissingBaseline(")
	if start < 0 || relEnd <= 0 {
		t.Fatal("cannot isolate applyRemoteChangePage source")
	}
	fn := text[start : start+relEnd]
	if !strings.Contains(fn, "var baselineByNodeID winBaselineNodeIndex") {
		t.Fatal("remote journal must start without eagerly building the baseline node index")
	}
	if strings.Contains(fn, "baselineByNodeID := indexBaselinePathsByNodeID(baseline)") {
		t.Fatal("remote journal regressed to eager full baseline node indexing")
	}
	if strings.Count(fn, "findBaselineChangePath(") < 2 {
		t.Fatal("directory/file upserts must use same-path lookup before lazy full indexing")
	}
}
