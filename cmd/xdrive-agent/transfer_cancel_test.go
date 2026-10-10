package main

import (
	"context"
	"testing"

	"github.com/lazyxu/xdrive/internal/transfer"
)

func TestFinishAgentCloudTransferMapsAcknowledgedContextCancel(t *testing.T) {
	m := transfer.NewManager(8)
	h := m.Start(transfer.Spec{FileName: "partial", Kind: transfer.KindDownload, Direction: "download"})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if !h.BindCancel(cancel) {
		t.Fatal("failed to bind cancellable I/O")
	}
	if err := m.Cancel(h.ID()); err != nil {
		t.Fatal(err)
	}
	finishAgentCloudTransfer(h, ctx.Err())
	_, tasks := m.Snapshot()
	if len(tasks) != 1 || tasks[0].State != transfer.StateCancelled || tasks[0].Cancelable {
		t.Fatalf("context.Canceled must become a terminal cancelled record, got %+v", tasks)
	}
}
