package transfer

import (
	"context"
	"encoding/json"
	"testing"
)

func TestBoundTransferCancellationAbortsOnlyItsOwnContext(t *testing.T) {
	m := NewManager(10)
	a := m.Start(Spec{FileName: "file-a", Kind: KindUpload, Direction: "upload", TotalBytes: 1024})
	b := m.Start(Spec{FileName: "file-b", Kind: KindDownload, Direction: "download", TotalBytes: 2048})
	ctxA, cancelA := context.WithCancel(context.Background())
	defer cancelA()
	ctxB, cancelB := context.WithCancel(context.Background())
	defer cancelB()

	if !a.BindCancel(cancelA) || !b.BindCancel(cancelB) {
		t.Fatal("owned transfers must bind their cancel functions")
	}
	if err := m.Cancel(a.ID()); err != nil {
		t.Fatalf("cancel a: %v", err)
	}
	select {
	case <-ctxA.Done():
	default:
		t.Fatal("the owned upload context was not cancelled")
	}
	select {
	case <-ctxB.Done():
		t.Fatal("unrelated concurrent download must keep running")
	default:
	}
	if err := m.Cancel(a.ID()); err == nil {
		t.Fatal("duplicate cancel should not execute twice")
	}
	_, tasks := m.Snapshot()
	for _, task := range tasks {
		switch task.ID {
		case a.ID():
			if task.State != StateCancelling || task.Cancelable || task.InstantBytesPerSecond != 0 {
				t.Fatalf("cancel must be pending and nonrepeatable until I/O stops: %+v", task)
			}
		case b.ID():
			if task.State != StateRunning || !task.Cancelable {
				t.Fatalf("unrelated task changed state: %+v", task)
			}
		}
	}
	if err := a.Finish(StateCancelled, ctxA.Err()); err != nil {
		t.Fatal(err)
	}
	_, tasks = m.Snapshot()
	for _, task := range tasks {
		if task.ID == a.ID() {
			if task.State != StateCancelled || task.Cancelable || task.CompletedAt == nil {
				t.Fatalf("the I/O owner must commit the final cancellation state: %+v", task)
			}
		}
	}
}

func TestUnboundAndTerminalTasksDoNotAdvertiseCancellation(t *testing.T) {
	m := NewManager(10)
	background := m.StartGroup(Spec{FileName: "durable-sync", Direction: "upload"})
	if err := m.Cancel(background.ID()); err == nil {
		t.Fatal("unbound background/sync task must not be cancelled")
	}
	handled := m.Start(Spec{FileName: "instant", Direction: "download"})
	handled.Complete()
	_, cancel := context.WithCancel(context.Background())
	defer cancel()
	if handled.BindCancel(cancel) {
		t.Fatal("terminal tasks cannot bind a cancellation action")
	}
	if err := m.Cancel(handled.ID()); err == nil {
		t.Fatal("terminal task cannot be cancelled")
	}
	if err := m.Cancel("no-such-task"); err == nil {
		t.Fatal("unknown transfer ids must be rejected")
	}
}

func TestAgentTransferCancellationCapabilityIsTransient(t *testing.T) {
	m := NewManager(10)
	handled := m.Start(Spec{FileName: "download", Kind: KindDownload, Direction: "download"})
	_, cancel := context.WithCancel(context.Background())
	if !handled.BindCancel(cancel) {
		t.Fatal("cancel binding failed")
	}
	_, items := m.Snapshot()
	encoded, err := json.Marshal(items[0])
	if err != nil {
		t.Fatal(err)
	}
	var record map[string]any
	if err := json.Unmarshal(encoded, &record); err != nil {
		t.Fatal(err)
	}
	if record["cancelable"] != true {
		t.Fatalf("active owned task should advertise cancellation: %s", encoded)
	}
	handled.Complete()
	record = make(map[string]any)
	_, items = m.Snapshot()
	encoded, err = json.Marshal(items[0])
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(encoded, &record); err != nil {
		t.Fatal(err)
	}
	if record["cancelable"] != nil {
		t.Fatalf("completed task must not retain callable cancellation: %s", encoded)
	}
}
