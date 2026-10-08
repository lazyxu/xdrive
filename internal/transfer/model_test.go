package transfer

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

func TestManagerProgressAndCompletion(t *testing.T) {
	m := NewManager(10)
	h := m.Start(Spec{FileName: "demo.bin", Path: "docs/demo.bin", Kind: KindUpload, Direction: "upload", TotalBytes: 100})
	h.Progress(25, 100)
	_, tasks := m.Snapshot()
	if len(tasks) != 1 || tasks[0].BytesDone != 25 || tasks[0].Percent != 25 || tasks[0].State != StateRunning {
		t.Fatalf("unexpected progress task: %+v", tasks)
	}
	time.Sleep(time.Millisecond)
	h.Progress(75, 100)
	_, tasks = m.Snapshot()
	if tasks[0].InstantBytesPerSecond <= 0 || tasks[0].AverageBytesPerSecond <= 0 {
		t.Fatalf("speeds were not populated: %+v", tasks[0])
	}
	h.Complete()
	_, tasks = m.Snapshot()
	if tasks[0].State != StateCompleted || tasks[0].BytesDone != 100 || tasks[0].Percent != 100 || tasks[0].CompletedAt == nil {
		t.Fatalf("unexpected completed task: %+v", tasks[0])
	}
}

func TestManagerWaitAndFailure(t *testing.T) {
	m := NewManager(10)
	revision, _ := m.Snapshot()
	type result struct {
		revision uint64
		changed  bool
	}
	done := make(chan result, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		next, _, changed := m.Wait(ctx, revision)
		done <- result{revision: next, changed: changed}
	}()
	h := m.Start(Spec{FileName: "bad.bin", Kind: KindDownload, Direction: "download", TotalBytes: 20})
	h.Progress(5, 20)
	h.Fail(errors.New("network down"))
	got := <-done
	if !got.changed || got.revision <= revision {
		t.Fatalf("wait did not observe a revision change: %+v", got)
	}
	_, tasks := m.Snapshot()
	if tasks[0].State != StateFailed || tasks[0].Error != "network down" || tasks[0].BytesDone != 5 {
		t.Fatalf("unexpected failed task: %+v", tasks[0])
	}
}

func TestManagerBaselineExcludesResumedBytesFromRate(t *testing.T) {
	m := NewManager(10)
	h := m.Start(Spec{FileName: "resume.bin", Kind: KindUpload, Direction: "upload", TotalBytes: 100})
	h.Baseline(80, 100)
	_, tasks := m.Snapshot()
	if len(tasks) != 1 || tasks[0].BytesDone != 80 || tasks[0].Percent != 80 {
		t.Fatalf("unexpected baseline task: %+v", tasks)
	}
	if tasks[0].InstantBytesPerSecond != 0 || tasks[0].AverageBytesPerSecond != 0 {
		t.Fatalf("resumed bytes inflated transfer rate: %+v", tasks[0])
	}
	time.Sleep(time.Millisecond)
	h.Progress(90, 100)
	_, tasks = m.Snapshot()
	if tasks[0].InstantBytesPerSecond <= 0 || tasks[0].AverageBytesPerSecond <= 0 {
		t.Fatalf("new bytes did not contribute to rate: %+v", tasks[0])
	}
}

func TestManagerRetry(t *testing.T) {
	m := NewManager(10)
	attempts := 0
	h := m.Start(Spec{
		FileName:   "retry.bin",
		Kind:       KindUpload,
		Direction:  "upload",
		TotalBytes: 10,
		Retry: func(context.Context) error {
			attempts++
			return nil
		},
	})
	h.Fail(errors.New("first failure"))
	if err := m.Retry(context.Background(), h.ID()); err != nil {
		t.Fatal(err)
	}
	_, tasks := m.Snapshot()
	if attempts != 1 || tasks[0].State != StateCompleted || tasks[0].RetryCount != 1 || tasks[0].Percent != 100 {
		t.Fatalf("unexpected retry result: attempts=%d task=%+v", attempts, tasks[0])
	}
}

func TestManagerRejectsNonRetryable(t *testing.T) {
	m := NewManager(10)
	h := m.Start(Spec{FileName: "nope", Kind: KindHydration, Direction: "download"})
	h.Fail(errors.New("failed"))
	if err := m.Retry(context.Background(), h.ID()); err == nil {
		t.Fatal("expected non-retryable transfer to be rejected")
	}
}

func TestManagerTrimsCompletedHistory(t *testing.T) {
	m := NewManager(2)
	for _, name := range []string{"a", "b", "c"} {
		h := m.Start(Spec{FileName: name, Kind: KindUpload, Direction: "upload", TotalBytes: 1})
		h.Complete()
	}
	_, tasks := m.Snapshot()
	if len(tasks) != 2 || tasks[0].FileName != "c" || tasks[1].FileName != "b" {
		t.Fatalf("unexpected retained history: %+v", tasks)
	}
}

func TestManagerClearHistoryPreservesActiveTransfers(t *testing.T) {
	m := NewManager(10)
	running := m.Start(Spec{FileName: "running.bin", Kind: KindDownload, Direction: "download", TotalBytes: 100})
	running.Progress(25, 100)
	completed := m.Start(Spec{FileName: "completed.bin", Kind: KindUpload, Direction: "upload", TotalBytes: 1})
	completed.Complete()
	failed := m.Start(Spec{FileName: "failed.bin", Kind: KindUpload, Direction: "upload", TotalBytes: 1})
	failed.Fail(errors.New("failed"))

	before, _ := m.Snapshot()
	m.ClearHistory()
	after, tasks := m.Snapshot()

	if after <= before {
		t.Fatalf("clear history did not advance revision: before=%d after=%d", before, after)
	}
	if len(tasks) != 1 || tasks[0].ID != running.ID() || tasks[0].State != StateRunning {
		t.Fatalf("clear history should keep only active transfer: %+v", tasks)
	}
}

func TestManagerCompleteSkippedKeepsZeroTransferredBytes(t *testing.T) {
	m := NewManager(10)
	h := m.Start(Spec{FileName: "skip.bin", Kind: KindUpload, Direction: "upload", TotalBytes: 100})
	h.CompleteSkipped()
	_, tasks := m.Snapshot()
	if len(tasks) != 1 {
		t.Fatalf("tasks=%+v", tasks)
	}
	task := tasks[0]
	if task.State != StateCompleted || task.BytesDone != 0 || task.BytesTotal != 100 || task.Percent != 100 {
		t.Fatalf("unexpected skipped completion: %+v", task)
	}
	if task.InstantBytesPerSecond != 0 || task.AverageBytesPerSecond != 0 || task.CompletedAt == nil {
		t.Fatalf("skipped transfer must have zero rate and completed timestamp: %+v", task)
	}
}

func TestManagerChildProgressAndGroupPublishesOneRevision(t *testing.T) {
	m := NewManager(20)
	group := m.StartGroup(Spec{
		FileName:   "Folder",
		Kind:       KindDownload,
		Direction:  "download",
		TotalBytes: 100,
	})
	child := m.StartChild(group, Spec{
		FileName:     "file.bin",
		RelativePath: "Folder/file.bin",
		Kind:         KindDownload,
		Direction:    "download",
		TotalBytes:   100,
	})
	if child == nil {
		t.Fatal("child handle is nil")
	}

	before, _ := m.Snapshot()
	child.BaselineAndUpdateGroup(group, 20, 100, GroupProgress{
		Phase:          PhaseTransferring,
		ScanComplete:   true,
		BytesDone:      20,
		BytesTotal:     100,
		TotalItems:     1,
		CompletedItems: 0,
		RunningItems:   1,
	})
	afterBaseline, tasks := m.Snapshot()
	if afterBaseline != before+1 {
		t.Fatalf("baseline+group revision=%d want=%d", afterBaseline, before+1)
	}
	var childTask, groupTask *Task
	for index := range tasks {
		switch tasks[index].ID {
		case child.ID():
			childTask = &tasks[index]
		case group.ID():
			groupTask = &tasks[index]
		}
	}
	if childTask == nil || groupTask == nil {
		t.Fatalf("missing child/group tasks: %+v", tasks)
	}
	if childTask.BytesDone != 20 || childTask.BytesTotal != 100 || childTask.Percent != 20 {
		t.Fatalf("unexpected child baseline: %+v", *childTask)
	}
	if groupTask.BytesDone != 20 || groupTask.BytesTotal != 100 ||
		groupTask.ItemsRunning != 1 || groupTask.ItemsTotal != 1 {
		t.Fatalf("unexpected group baseline: %+v", *groupTask)
	}

	time.Sleep(time.Millisecond)
	child.ProgressAndUpdateGroup(group, 60, 100, GroupProgress{
		Phase:          PhaseTransferring,
		ScanComplete:   true,
		BytesDone:      60,
		BytesTotal:     100,
		TotalItems:     1,
		CompletedItems: 0,
		RunningItems:   1,
	})
	afterProgress, tasks := m.Snapshot()
	if afterProgress != afterBaseline+1 {
		t.Fatalf("progress+group revision=%d want=%d", afterProgress, afterBaseline+1)
	}
	childTask = nil
	groupTask = nil
	for index := range tasks {
		switch tasks[index].ID {
		case child.ID():
			childTask = &tasks[index]
		case group.ID():
			groupTask = &tasks[index]
		}
	}
	if childTask == nil || groupTask == nil {
		t.Fatalf("missing child/group tasks after progress: %+v", tasks)
	}
	if childTask.BytesDone != 60 || childTask.InstantBytesPerSecond <= 0 ||
		childTask.AverageBytesPerSecond <= 0 {
		t.Fatalf("unexpected child progress: %+v", *childTask)
	}
	if groupTask.BytesDone != 60 || groupTask.Percent != 60 {
		t.Fatalf("unexpected group progress: %+v", *groupTask)
	}

	beforeStandalone, _ := m.Snapshot()
	child.Progress(70, 100)
	afterChild, _ := m.Snapshot()
	if afterChild != beforeStandalone+1 {
		t.Fatalf("standalone child revision=%d want=%d", afterChild, beforeStandalone+1)
	}
	group.UpdateGroup(GroupProgress{
		Phase:          PhaseTransferring,
		ScanComplete:   true,
		BytesDone:      70,
		BytesTotal:     100,
		TotalItems:     1,
		CompletedItems: 0,
		RunningItems:   1,
	})
	afterGroup, _ := m.Snapshot()
	if afterGroup != afterChild+1 {
		t.Fatalf("standalone group revision=%d want=%d", afterGroup, afterChild+1)
	}
}

func TestManagerStartChildrenBatchPublishesOneRevision(t *testing.T) {
	const childCount = 1000
	m := NewManager(20)
	group := m.StartGroup(Spec{
		FileName:  "Folder",
		Kind:      KindUpload,
		Direction: "upload",
	})
	before, _ := m.Snapshot()
	specs := make([]Spec, childCount)
	for index := range specs {
		specs[index] = Spec{
			FileName:     fmt.Sprintf("file-%04d.bin", index),
			RelativePath: fmt.Sprintf("Folder/file-%04d.bin", index),
			Kind:         KindUpload,
			Direction:    "upload",
			Phase:        PhaseQueued,
			TotalBytes:   int64(index + 1),
		}
	}
	handles := m.StartChildrenByID(group.ID(), specs)
	if len(handles) != childCount {
		t.Fatalf("batch handles=%d want=%d", len(handles), childCount)
	}
	after, tasks := m.Snapshot()
	if after != before+1 {
		t.Fatalf("batch revision=%d want=%d", after, before+1)
	}
	if len(tasks) != childCount+1 {
		t.Fatalf("snapshot tasks=%d want=%d", len(tasks), childCount+1)
	}
	for _, task := range tasks {
		if task.ID == group.ID() {
			continue
		}
		if task.ParentID != group.ID() || task.RootID != group.ID() ||
			task.Scope != ScopeItem || task.State != StateQueued || task.Phase != PhaseQueued {
			t.Fatalf("unexpected child task: %+v", task)
		}
	}
}

func TestHierarchicalTransferContract(t *testing.T) {
	m := NewManager(20)
	group := m.StartGroup(Spec{
		FileName:  "Photos",
		Path:      "Photos",
		Kind:      KindUpload,
		Direction: "upload",
	})
	if group == nil {
		t.Fatal("group handle is nil")
	}

	_, tasks := m.Snapshot()
	if len(tasks) != 1 {
		t.Fatalf("tasks=%+v", tasks)
	}
	root := tasks[0]
	if root.Scope != ScopeGroup || root.RootID != root.ID || root.ParentID != "" {
		t.Fatalf("unexpected root identity: %+v", root)
	}
	if root.Phase != PhaseScanning || root.ScanComplete {
		t.Fatalf("new group must start scanning: %+v", root)
	}
	if root.ItemsTotal != 0 || root.BytesTotal != 0 {
		t.Fatalf("new group should not invent totals before scan: %+v", root)
	}

	group.UpdateGroup(GroupProgress{
		Phase:          PhaseTransferring,
		ScanComplete:   true,
		BytesDone:      25,
		BytesTotal:     300,
		TotalItems:     3,
		CompletedItems: 1,
		FailedItems:    0,
		RunningItems:   1,
		QueuedItems:    1,
	})

	childA := m.StartChild(group, Spec{
		FileName:     "a.jpg",
		Path:         "Photos/a.jpg",
		RelativePath: "a.jpg",
		Kind:         KindUpload,
		Direction:    "upload",
		TotalBytes:   100,
	})
	childB := m.StartChild(group, Spec{
		FileName:     "nested.mov",
		Path:         "Photos/sub/nested.mov",
		RelativePath: "sub/nested.mov",
		Kind:         KindUpload,
		Direction:    "upload",
		TotalBytes:   200,
	})
	if childA == nil || childB == nil {
		t.Fatal("child handle is nil")
	}

	_, tasks = m.Snapshot()
	byID := map[string]Task{}
	for _, task := range tasks {
		byID[task.ID] = task
	}
	root = byID[group.ID()]
	if root.State != StateRunning || root.Phase != PhaseTransferring || !root.ScanComplete {
		t.Fatalf("unexpected group execution state: %+v", root)
	}
	if root.BytesDone != 25 || root.BytesTotal != 300 || root.ItemsTotal != 3 ||
		root.ItemsCompleted != 1 || root.ItemsRunning != 1 || root.ItemsQueued != 1 {
		t.Fatalf("unexpected group counters: %+v", root)
	}

	for _, childID := range []string{childA.ID(), childB.ID()} {
		child := byID[childID]
		if child.Scope != ScopeItem || child.ParentID != group.ID() || child.RootID != group.ID() {
			t.Fatalf("unexpected child hierarchy: %+v", child)
		}
		if !child.ScanComplete || child.ItemsTotal != 1 || child.ItemsRunning != 1 {
			t.Fatalf("unexpected child counters: %+v", child)
		}
	}
	if byID[childB.ID()].RelativePath != "sub/nested.mov" {
		t.Fatalf("relative path lost: %+v", byID[childB.ID()])
	}

	childA.Complete()
	childB.Fail(errors.New("network down"))
	_, tasks = m.Snapshot()
	byID = map[string]Task{}
	for _, task := range tasks {
		byID[task.ID] = task
	}
	if byID[childA.ID()].ItemsCompleted != 1 || byID[childA.ID()].ItemsRunning != 0 {
		t.Fatalf("completed child counters wrong: %+v", byID[childA.ID()])
	}
	if byID[childB.ID()].ItemsFailed != 1 || byID[childB.ID()].ItemsRunning != 0 {
		t.Fatalf("failed child counters wrong: %+v", byID[childB.ID()])
	}
}

func TestHierarchicalTransferHistoryTreatsQueuedAndCancellingAsActive(t *testing.T) {
	m := NewManager(2)
	queued := m.StartGroup(Spec{
		FileName:  "queued-folder",
		Kind:      KindDownload,
		Direction: "download",
		Phase:     PhaseQueued,
	})
	if queued == nil {
		t.Fatal("queued group is nil")
	}

	running := m.Start(Spec{FileName: "running", Kind: KindUpload, Direction: "upload"})
	completed := m.Start(Spec{FileName: "completed", Kind: KindUpload, Direction: "upload"})
	completed.Complete()

	_, tasks := m.Snapshot()
	ids := map[string]bool{}
	for _, task := range tasks {
		ids[task.ID] = true
	}
	if !ids[queued.ID()] || !ids[running.ID()] {
		t.Fatalf("active queued/running transfers were trimmed: %+v", tasks)
	}

	m.ClearHistory()
	_, tasks = m.Snapshot()
	for _, task := range tasks {
		if terminalState(task.State) {
			t.Fatalf("terminal transfer survived history clear: %+v", task)
		}
	}
}

func TestManagerLifecycleByIDAndGroupTerminalStates(t *testing.T) {
	m := NewManager(20)
	group := m.StartGroup(Spec{
		FileName:   "Photos",
		Kind:       KindUpload,
		Direction:  "upload",
		TotalBytes: 300,
		TotalItems: 2,
	})
	if group == nil {
		t.Fatal("group handle is nil")
	}
	child := m.StartChildByID(group.ID(), Spec{
		FileName:     "a.jpg",
		RelativePath: "Photos/a.jpg",
		Kind:         KindUpload,
		Direction:    "upload",
		Phase:        PhaseQueued,
		TotalBytes:   100,
	})
	if child == nil {
		t.Fatal("child by id is nil")
	}
	recovered := m.Handle(child.ID())
	if recovered == nil || recovered.ID() != child.ID() {
		t.Fatalf("manager did not recover handle by id: %+v", recovered)
	}
	recovered.SetPhase(PhaseTransferring)
	recovered.Progress(40, 100)
	if err := recovered.Finish(StateCompleted, nil); err != nil {
		t.Fatal(err)
	}
	group.UpdateGroup(GroupProgress{
		Phase:          PhaseTransferring,
		ScanComplete:   true,
		BytesDone:      40,
		BytesTotal:     300,
		TotalItems:     2,
		CompletedItems: 1,
		FailedItems:    1,
	})
	if err := group.Finish(StatePartial, errors.New("one child failed")); err != nil {
		t.Fatal(err)
	}
	_, tasks := m.Snapshot()
	byID := map[string]Task{}
	for _, task := range tasks {
		byID[task.ID] = task
	}
	if got := byID[group.ID()]; got.State != StatePartial || got.CompletedAt == nil || got.Error != "one child failed" {
		t.Fatalf("unexpected partial group: %+v", got)
	}
	if got := byID[child.ID()]; got.State != StateCompleted || got.BytesDone != 100 || got.ItemsCompleted != 1 {
		t.Fatalf("unexpected completed child: %+v", got)
	}

	cancelled := m.StartGroup(Spec{FileName: "Cancelled", Kind: KindUpload, Direction: "upload"})
	if err := cancelled.Finish(StateCancelled, nil); err != nil {
		t.Fatal(err)
	}
	_, tasks = m.Snapshot()
	byID = map[string]Task{}
	for _, task := range tasks {
		byID[task.ID] = task
	}
	if got := byID[cancelled.ID()]; got.State != StateCancelled || got.CompletedAt == nil {
		t.Fatalf("unexpected cancelled group: %+v", got)
	}
	if err := group.Finish(StateRunning, nil); err == nil {
		t.Fatal("expected invalid non-terminal finish state to fail")
	}
}

func TestManagerHistoryTrimFastPathUsesRootCardinality(t *testing.T) {
	m := NewManager(200)
	group := m.StartGroup(Spec{FileName: "folder", Kind: KindUpload, Direction: "upload"})
	if group == nil {
		t.Fatal("group is nil")
	}
	for i := 0; i < 1000; i++ {
		child := m.StartChildByID(group.ID(), Spec{
			FileName:     fmt.Sprintf("file-%04d.bin", i),
			RelativePath: fmt.Sprintf("folder/file-%04d.bin", i),
			Kind:         KindUpload,
			Direction:    "upload",
			Phase:        PhaseQueued,
			TotalBytes:   1,
		})
		if child == nil {
			t.Fatalf("child %d is nil", i)
		}
		child.Complete()
	}
	if len(m.roots) != 1 {
		t.Fatalf("root cardinality=%d want=1", len(m.roots))
	}
	_, tasks := m.Snapshot()
	if len(tasks) != 1001 {
		t.Fatalf("task count=%d want=1001", len(tasks))
	}

	source, err := os.ReadFile("model.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	start := strings.Index(text, "func (m *Manager) trimLocked()")
	if start < 0 {
		t.Fatal("trimLocked source not found")
	}
	relativeEnd := strings.Index(text[start:], "func transferRootID")
	if relativeEnd < 0 {
		t.Fatal("trimLocked source end not found")
	}
	fn := text[start : start+relativeEnd]
	guard := strings.Index(fn, "len(m.roots) <= m.limit")
	scan := strings.Index(fn, "rootOrder :=")
	if guard < 0 || scan < 0 || guard > scan {
		t.Fatal("root-cardinality guard must run before history scan")
	}
}

func TestManagerHistoryLimitCountsRootTransfersNotChildren(t *testing.T) {
	m := NewManager(2)
	group := m.StartGroup(Spec{FileName: "folder", Kind: KindUpload, Direction: "upload"})
	for i := 0; i < 250; i++ {
		child := m.StartChildByID(group.ID(), Spec{
			FileName:     fmt.Sprintf("file-%03d.bin", i),
			RelativePath: fmt.Sprintf("folder/file-%03d.bin", i),
			Kind:         KindUpload,
			Direction:    "upload",
			Phase:        PhaseQueued,
			TotalBytes:   1,
		})
		if child == nil {
			t.Fatalf("child %d is nil", i)
		}
		child.SetPhase(PhaseTransferring)
		child.Complete()
	}
	other := m.Start(Spec{FileName: "other", Kind: KindUpload, Direction: "upload"})
	other.Complete()

	_, tasks := m.Snapshot()
	if len(tasks) != 252 {
		t.Fatalf("active group children must not be trimmed by flat task count: got=%d", len(tasks))
	}

	group.UpdateGroup(GroupProgress{
		Phase:          PhaseTransferring,
		ScanComplete:   true,
		BytesDone:      250,
		BytesTotal:     250,
		TotalItems:     250,
		CompletedItems: 250,
	})
	if err := group.Finish(StateCompleted, nil); err != nil {
		t.Fatal(err)
	}

	third := m.Start(Spec{FileName: "third", Kind: KindUpload, Direction: "upload"})
	third.Complete()
	_, tasks = m.Snapshot()
	rootIDs := map[string]bool{}
	for _, task := range tasks {
		rootIDs[transferRootID(task)] = true
	}
	if len(rootIDs) != 2 || !rootIDs[other.ID()] || !rootIDs[third.ID()] {
		t.Fatalf("history limit must evict one whole oldest root tree: roots=%v tasks=%d", rootIDs, len(tasks))
	}
}

func TestManagerClearHistoryKeepsCompletedChildrenOfActiveGroup(t *testing.T) {
	m := NewManager(10)
	group := m.StartGroup(Spec{FileName: "folder", Kind: KindUpload, Direction: "upload"})
	child := m.StartChildByID(group.ID(), Spec{
		FileName: "done.bin", Kind: KindUpload, Direction: "upload", Phase: PhaseQueued,
	})
	child.SetPhase(PhaseTransferring)
	child.Complete()

	m.ClearHistory()
	_, tasks := m.Snapshot()
	byID := map[string]Task{}
	for _, task := range tasks {
		byID[task.ID] = task
	}
	if byID[group.ID()].ID == "" || byID[child.ID()].ID == "" {
		t.Fatalf("active group tree was fragmented by clear history: %+v", tasks)
	}

	if err := group.Finish(StateCompleted, nil); err != nil {
		t.Fatal(err)
	}
	m.ClearHistory()
	_, tasks = m.Snapshot()
	if len(tasks) != 0 {
		t.Fatalf("completed group tree survived history clear: %+v", tasks)
	}
}
