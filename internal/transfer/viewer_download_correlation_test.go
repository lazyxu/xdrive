package transfer

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestViewerDownloadCorrelationKeepsConcurrentSameNameTasksDistinct(t *testing.T) {
	manager := NewManager(20)
	firstID := strings.Repeat("a", 32)
	secondID := strings.Repeat("b", 32)
	first := manager.Start(Spec{
		FileName: "same-image.jpg", CloudNodeID: 42, ClientRequestID: firstID,
		Kind: KindDownload, Direction: "download", TotalBytes: 400,
	})
	second := manager.Start(Spec{
		FileName: "same-image.jpg", CloudNodeID: 42, ClientRequestID: secondID,
		Kind: KindDownload, Direction: "download", TotalBytes: 400,
	})
	if first == nil || second == nil || first.ID() == second.ID() {
		t.Fatal("concurrent same-name downloads must own independent Agent handles")
	}
	first.Progress(120, 400)
	second.Progress(350, 400)
	_, tasks := manager.Snapshot()
	if len(tasks) != 2 {
		t.Fatalf("expected two independent download tasks, got %+v", tasks)
	}
	observed := make(map[string]Task)
	for _, task := range tasks {
		observed[task.ClientRequestID] = task
		if task.CloudNodeID != 42 || task.FileName != "same-image.jpg" || task.Kind != KindDownload {
			t.Fatalf("correlation escaped the exact download task: %+v", task)
		}
	}
	if observed[firstID].ID != first.ID() || observed[firstID].BytesDone != 120 ||
		observed[secondID].ID != second.ID() || observed[secondID].BytesDone != 350 {
		t.Fatalf("same file name or Node ID confused Viewer receipts: %+v", observed)
	}
	encoded, err := json.Marshal(tasks)
	if err != nil {
		t.Fatal(err)
	}
	var roundtrip []Task
	if err := json.Unmarshal(encoded, &roundtrip); err != nil {
		t.Fatal(err)
	}
	if len(roundtrip) != 2 || roundtrip[0].ClientRequestID == "" || roundtrip[1].ClientRequestID == "" {
		t.Fatal("client request IDs were not preserved on authenticated Agent transfer snapshots")
	}
	manager.Clear()
	_, cleared := manager.Snapshot()
	if len(cleared) != 0 {
		t.Fatalf("Owner clear must revoke old Viewer receipt visibility: %+v", cleared)
	}
	fresh := manager.Start(Spec{FileName: "same-image.jpg", Kind: KindDownload, Direction: "download"})
	_, renewed := manager.Snapshot()
	if fresh == nil || len(renewed) != 1 || renewed[0].ClientRequestID != "" {
		t.Fatalf("new account inherited an old Viewer nonce: %+v", renewed)
	}
}

func TestLegacyDownloadTransferHasNoClientRequestID(t *testing.T) {
	manager := NewManager(5)
	legacy := manager.Start(Spec{FileName: "legacy.zip", Kind: KindDownload, Direction: "download"})
	_, tasks := manager.Snapshot()
	if legacy == nil || len(tasks) != 1 || tasks[0].ClientRequestID != "" {
		t.Fatalf("legacy download unexpectedly required a Viewer nonce: %+v", tasks)
	}
	encoded, err := json.Marshal(tasks[0])
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "client_request_id") {
		t.Fatal("legacy transfer snapshots must omit an absent correlation field")
	}
}
