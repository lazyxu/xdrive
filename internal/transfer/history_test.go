package transfer

import (
	"context"
	"testing"
	"time"
)

func TestDurableHistoryKeepsTerminalRootAndAverageAcrossRestore(t *testing.T) {
	m := NewManager(200)
	group := m.StartGroup(Spec{FileName: "photos", Kind: KindDownload, Direction: "download"})
	child := m.StartChild(group, Spec{FileName: "photo.jpg", Kind: KindDownload, Direction: "download", TotalBytes: 2048})
	child.Progress(1024, 2048)
	time.Sleep(2 * time.Millisecond)
	child.Complete()
	group.Complete()
	select {
	case <-m.HistoryEvents():
	default:
		t.Fatal("terminal transfer must notify the history writer")
	}
	history := m.HistorySnapshot(100)
	if len(history) != 2 || history[0].ID != group.ID() || history[1].ID != child.ID() {
		t.Fatalf("expected parent + terminal child: %+v", history)
	}
	avg := history[1].AverageBytesPerSecond
	if avg <= 0 {
		t.Fatalf("terminal child average rate should be measured, got %v", avg)
	}

	loaded := NewManager(200)
	if err := loaded.RestoreHistory(history); err != nil {
		t.Fatal(err)
	}
	_, restored := loaded.Snapshot()
	if len(restored) != 2 {
		t.Fatalf("recovered history length: %d", len(restored))
	}
	for _, item := range restored {
		if item.State != StateCompleted || item.Cancelable || item.Retryable ||
			item.InstantBytesPerSecond != 0 || item.SpeedUpdatedAt != nil {
			t.Fatalf("history cannot restore a running or retryable request: %+v", item)
		}
		if item.ID == child.ID() && item.AverageBytesPerSecond != avg {
			t.Fatalf("average bytes/sec must survive restart: before=%v after=%v",
				avg, item.AverageBytesPerSecond)
		}
	}
	next := loaded.Start(Spec{FileName: "new", Kind: KindUpload, Direction: "upload"})
	if next.ID() == child.ID() || next.ID() == group.ID() {
		t.Fatalf("new transfer ID collided with restored history: %s", next.ID())
	}
}

func TestDurableHistoryExcludesActiveAndUnfinishedGroups(t *testing.T) {
	m := NewManager(20)
	active := m.Start(Spec{FileName: "active.bin", Kind: KindUpload, Direction: "upload"})
	group := m.StartGroup(Spec{FileName: "running", Kind: KindUpload, Direction: "upload"})
	child := m.StartChild(group, Spec{FileName: "finished-child", Kind: KindUpload, Direction: "upload"})
	child.Complete()
	if got := m.HistorySnapshot(100); len(got) != 0 {
		t.Fatalf("active roots, including their finished children, must not be persisted: %+v", got)
	}
	active.Complete()
	history := m.HistorySnapshot(100)
	if len(history) != 1 || history[0].ID != active.ID() {
		t.Fatalf("only terminal standalone upload should be persisted: %+v", history)
	}
	group.Complete()
	history = m.HistorySnapshot(100)
	if len(history) != 3 {
		t.Fatalf("group should be persisted after terminal acknowledgement: %+v", history)
	}
}

func TestDurableHistoryClearAndBoundedChildRecords(t *testing.T) {
	m := NewManager(200)
	group := m.StartGroup(Spec{FileName: "big-folder", Kind: KindDownload, Direction: "download"})
	for i := 0; i < DefaultPersistedHistoryRows+40; i++ {
		child := m.StartChild(group, Spec{FileName: "child", Kind: KindDownload, Direction: "download"})
		child.Complete()
	}
	group.Complete()
	items := m.HistorySnapshot(DefaultPersistedHistoryRows)
	if len(items) != DefaultPersistedHistoryRows || items[0].ID != group.ID() {
		t.Fatalf("bounded file must keep the root summary even with too many children")
	}
	for {
		select {
		case <-m.HistoryEvents():
		default:
			goto empty
		}
	}
empty:
	m.ClearHistory("network")
	select {
	case <-m.HistoryEvents():
	default:
		t.Fatal("clearing history must notify the disk writer")
	}
	if got := m.HistorySnapshot(100); len(got) != 0 {
		t.Fatalf("cleared network history reappeared: %+v", got)
	}
}

func TestRestoreRejectsActiveRecordsAndUntrustedCallbacks(t *testing.T) {
	m := NewManager(20)
	saved := []Task{
		{ID: "transfer-7", RootID: "transfer-7", State: StateRunning, Kind: KindUpload},
		{ID: "transfer-8", RootID: "transfer-8", State: StateCompleted, Kind: KindDownload,
			Cancelable: true, Retryable: true, InstantBytesPerSecond: 900, AverageBytesPerSecond: 400},
	}
	if err := m.RestoreHistory(saved); err != nil {
		t.Fatal(err)
	}
	_, tasks := m.Snapshot()
	if len(tasks) != 1 || tasks[0].ID != "transfer-8" ||
		tasks[0].InstantBytesPerSecond != 0 || tasks[0].AverageBytesPerSecond != 400 ||
		tasks[0].Cancelable || tasks[0].Retryable {
		t.Fatalf("unsafe historic task restoration: %+v", tasks)
	}
	if err := m.Retry(context.Background(), "transfer-8"); err == nil {
		t.Fatal("restored history must not retain old Go retry callbacks")
	}
}
