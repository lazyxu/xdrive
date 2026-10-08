package main

import (
	"net/http"
	"testing"

	"github.com/lazyxu/xdrive/internal/transfer"
)

func TestDesktopIPCTransferHistoryScope(t *testing.T) {
	manager := transfer.NewManager(10)
	network := manager.Start(transfer.Spec{FileName: "download", Kind: transfer.KindDownload, Direction: "download", TotalBytes: 10})
	network.Complete()
	local := manager.Start(transfer.Spec{FileName: "release", Kind: transfer.KindDehydration, Direction: "local", TotalBytes: 10})
	local.Complete()
	handler := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1, transfers: manager}, "secret", func() {})
	invalid := desktopIPCRequest(t, handler, http.MethodDelete, "/v1/transfers?scope=unexpected", "")
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid scope: %d", invalid.Code)
	}
	_, items := manager.Snapshot()
	if len(items) != 2 {
		t.Fatal("invalid history scope removed records")
	}
	result := desktopIPCRequest(t, handler, http.MethodDelete, "/v1/transfers?scope=network", "")
	if result.Code != http.StatusOK {
		t.Fatalf("clear network history: %d %s", result.Code, result.Body.String())
	}
	_, items = manager.Snapshot()
	if len(items) != 1 || items[0].ID != local.ID() {
		t.Fatalf("network clear removed local history: %+v", items)
	}
	result = desktopIPCRequest(t, handler, http.MethodDelete, "/v1/transfers?scope=local", "")
	_, items = manager.Snapshot()
	if result.Code != http.StatusOK || len(items) != 0 {
		t.Fatalf("local clear failed: %+v", items)
	}
}
