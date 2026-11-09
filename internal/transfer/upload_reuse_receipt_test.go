package transfer

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func TestUploadReceiptDistinguishesCASReuseFromOrdinaryAndLegacy(t *testing.T) {
	manager := NewManager(30)
	check := func(label string, transferred *int64, skipped bool) {
		t.Helper()
		_, tasks := manager.Snapshot()
		for _, task := range tasks {
			if task.FileName != label {
				continue
			}
			if task.State != StateCompleted || task.UploadSkipped != skipped {
				t.Fatalf("%s has wrong terminal status: %+v", label, task)
			}
			if transferred == nil {
				if task.UploadTransferredBytes != nil {
					t.Fatalf("%s must not invent a verified byte receipt: %+v", label, task)
				}
			} else if task.UploadTransferredBytes == nil || *task.UploadTransferredBytes != *transferred {
				t.Fatalf("%s missing true byte receipt: %+v", label, task)
			}
			return
		}
		t.Fatalf("%s was not recorded", label)
	}
	total := int64(4096)
	zero, partial, full := int64(0), int64(1024), total

	instant := manager.Start(Spec{FileName: "instant", Kind: KindUpload, Direction: "upload", TotalBytes: total})
	instant.CompleteUploadBytes(zero)
	check("instant", &zero, false)
	partialUpload := manager.Start(Spec{FileName: "partial", Kind: KindUpload, Direction: "upload", TotalBytes: total})
	partialUpload.CompleteUploadBytes(partial)
	check("partial", &partial, false)
	regular := manager.Start(Spec{FileName: "regular", Kind: KindUpload, Direction: "upload", TotalBytes: total})
	regular.CompleteUploadBytes(full)
	check("regular", &full, false)
	skip := manager.Start(Spec{FileName: "skipped", Kind: KindUpload, Direction: "upload", TotalBytes: total})
	skip.CompleteSkipped()
	check("skipped", nil, true)
	legacy := manager.Start(Spec{FileName: "legacy", Kind: KindUpload, Direction: "upload", TotalBytes: total})
	legacy.Complete()
	check("legacy", nil, false)
	invalid := manager.Start(Spec{FileName: "invalid", Kind: KindUpload, Direction: "upload", TotalBytes: total})
	invalid.CompleteUploadBytes(total + 1)
	check("invalid", nil, false)
	download := manager.Start(Spec{FileName: "download", Kind: KindDownload, Direction: "download", TotalBytes: total})
	download.CompleteUploadBytes(zero)
	check("download", nil, false)

	history := manager.HistorySnapshot(30)
	restored := NewManager(30)
	if err := restored.RestoreHistory(history); err != nil {
		t.Fatal(err)
	}
	_, tasks := restored.Snapshot()
	for _, task := range tasks {
		if task.FileName == "instant" {
			if task.UploadTransferredBytes == nil || *task.UploadTransferredBytes != 0 {
				t.Fatalf("restored history lost CAS receipt: %+v", task)
			}
			encoded, err := json.Marshal(task)
			if err != nil {
				t.Fatal(err)
			}
			var decoded Task
			if err := json.Unmarshal(encoded, &decoded); err != nil {
				t.Fatal(err)
			}
			if decoded.UploadTransferredBytes == nil || *decoded.UploadTransferredBytes != 0 {
				t.Fatalf("wire serialization lost explicit zero: %+v", decoded)
			}
		}
	}
}

func TestManagedUploadReceiptHonorsFirstTerminalOutcomeAndCancellation(t *testing.T) {
	manager := NewManager(20)
	group := manager.StartGroup(Spec{FileName: "folder", Kind: KindUpload, Direction: "upload"})
	child := manager.StartChild(group, Spec{FileName: "child", Kind: KindUpload, Direction: "upload", TotalBytes: 4096})
	zero := int64(0)
	if err := child.FinishUploadBytes(StateCompleted, nil, &zero); err != nil {
		t.Fatal(err)
	}
	if err := child.FinishUploadBytes(StateFailed, errors.New("late failure"), nil); err != nil {
		t.Fatal(err)
	}
	group.Complete()
	_, tasks := manager.Snapshot()
	for _, item := range tasks {
		if item.ID == child.ID() && (item.State != StateCompleted || item.UploadTransferredBytes == nil || *item.UploadTransferredBytes != 0) {
			t.Fatalf("late terminal callback overwrote verified receipt: %+v", item)
		}
		if item.ID == group.ID() && item.UploadTransferredBytes != nil {
			t.Fatalf("parent must not masquerade as a single instant upload: %+v", item)
		}
	}
	cancelled := manager.Start(Spec{FileName: "cancelled", Kind: KindUpload, Direction: "upload", TotalBytes: 100})
	if err := cancelled.Finish(StateCancelled, context.Canceled); err != nil {
		t.Fatal(err)
	}
	cancelled.CompleteUploadBytes(0)
	_, tasks = manager.Snapshot()
	for _, item := range tasks {
		if item.ID == cancelled.ID() && (item.State != StateCancelled || item.UploadTransferredBytes != nil) {
			t.Fatalf("cancelled task acquired a false instant receipt: %+v", item)
		}
	}
}
