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
				if task.UploadSentBytes != nil {
					t.Fatalf("%s must not invent a verified byte receipt: %+v", label, task)
				}
			} else if task.UploadSentBytes == nil || *task.UploadSentBytes != *transferred {
				t.Fatalf("%s missing true byte receipt: %+v", label, task)
			}
			return
		}
		t.Fatalf("%s was not recorded", label)
	}
	total := int64(4096)
	zero, partial, full := int64(0), int64(1024), total

	instant := manager.Start(Spec{FileName: "instant", Kind: KindUpload, Direction: "upload", TotalBytes: total})
	instant.CompleteUploadReceipt(UploadContentReceipt{TransferredBytes: zero, CASReusedBytes: total})
	check("instant", &zero, false)
	_, initial := manager.Snapshot()
	if initial[0].UploadCASReusedBytes != total || initial[0].UploadResumeBytes != 0 {
		t.Fatalf("instant CAS provenance is wrong: %+v", initial[0])
	}
	partialUpload := manager.Start(Spec{FileName: "partial", Kind: KindUpload, Direction: "upload", TotalBytes: total})
	partialUpload.CompleteUploadReceipt(UploadContentReceipt{TransferredBytes: partial, CASReusedBytes: total - partial})
	check("partial", &partial, false)
	resume := manager.Start(Spec{FileName: "resume", Kind: KindUpload, Direction: "upload", TotalBytes: total})
	resume.CompleteUploadReceipt(UploadContentReceipt{ResumeReusedBytes: total})
	check("resume", &zero, false)
	regular := manager.Start(Spec{FileName: "regular", Kind: KindUpload, Direction: "upload", TotalBytes: total})
	regular.CompleteUploadReceipt(UploadContentReceipt{TransferredBytes: full})
	check("regular", &full, false)
	skip := manager.Start(Spec{FileName: "skipped", Kind: KindUpload, Direction: "upload", TotalBytes: total})
	skip.CompleteSkipped()
	check("skipped", nil, true)
	legacy := manager.Start(Spec{FileName: "legacy", Kind: KindUpload, Direction: "upload", TotalBytes: total})
	legacy.Complete()
	check("legacy", nil, false)
	invalid := manager.Start(Spec{FileName: "invalid", Kind: KindUpload, Direction: "upload", TotalBytes: total})
	invalid.CompleteUploadReceipt(UploadContentReceipt{TransferredBytes: total + 1})
	check("invalid", nil, false)
	download := manager.Start(Spec{FileName: "download", Kind: KindDownload, Direction: "download", TotalBytes: total})
	download.CompleteUploadReceipt(UploadContentReceipt{TransferredBytes: zero, CASReusedBytes: total})
	check("download", nil, false)

	history := manager.HistorySnapshot(30)
	restored := NewManager(30)
	if err := restored.RestoreHistory(history); err != nil {
		t.Fatal(err)
	}
	_, tasks := restored.Snapshot()
	for _, task := range tasks {
		if task.FileName == "instant" {
			if task.UploadSentBytes == nil || *task.UploadSentBytes != 0 {
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
			if decoded.UploadSentBytes == nil || *decoded.UploadSentBytes != 0 {
				t.Fatalf("wire serialization lost explicit zero: %+v", decoded)
			}
		}
	}
}

func TestManagedUploadReceiptHonorsFirstTerminalOutcomeAndCancellation(t *testing.T) {
	manager := NewManager(20)
	group := manager.StartGroup(Spec{FileName: "folder", Kind: KindUpload, Direction: "upload"})
	child := manager.StartChild(group, Spec{FileName: "child", Kind: KindUpload, Direction: "upload", TotalBytes: 4096})
	if err := child.FinishUploadReceipt(StateCompleted, nil, &UploadContentReceipt{CASReusedBytes: 4096}); err != nil {
		t.Fatal(err)
	}
	if err := child.FinishUploadReceipt(StateFailed, errors.New("late failure"), nil); err != nil {
		t.Fatal(err)
	}
	group.Complete()
	_, tasks := manager.Snapshot()
	for _, item := range tasks {
		if item.ID == child.ID() && (item.State != StateCompleted || item.UploadSentBytes == nil || *item.UploadSentBytes != 0) {
			t.Fatalf("late terminal callback overwrote verified receipt: %+v", item)
		}
		if item.ID == group.ID() && item.UploadSentBytes != nil {
			t.Fatalf("parent must not masquerade as a single instant upload: %+v", item)
		}
	}
	cancelled := manager.Start(Spec{FileName: "cancelled", Kind: KindUpload, Direction: "upload", TotalBytes: 100})
	if err := cancelled.Finish(StateCancelled, context.Canceled); err != nil {
		t.Fatal(err)
	}
	cancelled.CompleteUploadReceipt(UploadContentReceipt{CASReusedBytes: 100})
	_, tasks = manager.Snapshot()
	for _, item := range tasks {
		if item.ID == cancelled.ID() && (item.State != StateCancelled || item.UploadSentBytes != nil) {
			t.Fatalf("cancelled task acquired a false instant receipt: %+v", item)
		}
	}
}
