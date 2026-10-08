package api

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func TestNativeDownloadProgressRecoversRejectedSnapshot(t *testing.T) {
	server, peer, _, token, _, node := newNativeDownloadProgressFixture(t)
	content := nativeProgressRetryContent(t, server, node.ID)
	rejected := make(chan struct{}, 1)
	var injected atomic.Bool
	if err := server.DB.Callback().Update().Before("gorm:update").Register("reject_native_snapshot", func(tx *gorm.DB) {
		if tx.Statement.Table == "xd_download_progress" && injected.CompareAndSwap(false, true) {
			tx.AddError(errors.New("injected rejected progress snapshot"))
			rejected <- struct{}{}
		}
	}); err != nil {
		t.Fatal(err)
	}
	router, peerRouter := server.Router(), peer.Router()
	ticket := nativeProgressTicket(t, router, token, fmt.Sprintf("/api/v1/files/%d/download-ticket", node.ID))
	stream, accepted := startBlockedNativeDownload(t, peerRouter, ticket.URL, "")
	select {
	case <-rejected:
	case <-time.After(5 * time.Second):
		t.Fatal("the blocked response did not attempt its first progress snapshot")
	}
	stream.unblock()
	<-stream.done
	progress := nativeProgressSnapshot(t, router, token, ticket.TransferID)
	if progress.State != "completed" || progress.BytesSent != int64(len(content)) {
		t.Fatalf("rejected snapshot lost %d successful response bytes: progress=%+v, wanted bytes_sent=%d", accepted, progress, len(content))
	}
	if !bytes.Equal(stream.Body.Bytes(), content) {
		t.Fatal("a telemetry error changed the download payload")
	}
}

func TestNativeDownloadProgressReplaysUncertainTerminalReport(t *testing.T) {
	server, peer, _, token, _, node := newNativeDownloadProgressFixture(t)
	content := nativeProgressRetryContent(t, server, node.ID)
	var terminalReports atomic.Int64
	var injected atomic.Bool
	// Inject the error after the real PostgreSQL transaction commits. The
	// reporter cannot distinguish this lost acknowledgment from a rollback.
	if err := server.DB.Callback().Update().After("gorm:commit_or_rollback_transaction").Register("lose_native_commit_ack", func(tx *gorm.DB) {
		if tx.Statement.Table != "xd_download_progress" || tx.Error != nil || !nativeProgressTerminalUpdate(tx) {
			return
		}
		terminalReports.Add(1)
		if injected.CompareAndSwap(false, true) {
			tx.AddError(errors.New("injected lost progress commit acknowledgment"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	router, peerRouter := server.Router(), peer.Router()
	ticket := nativeProgressTicket(t, router, token, fmt.Sprintf("/api/v1/files/%d/download-ticket", node.ID))
	first, _ := startBlockedNativeDownload(t, router, ticket.URL, "bytes=0-65535")
	second, _ := startBlockedNativeDownload(t, peerRouter, ticket.URL, "bytes=65536-131071")
	first.unblock()
	<-first.done
	if terminalReports.Load() < 2 {
		t.Fatal("uncertain terminal report was not retried")
	}
	var row meta.DownloadProgress
	if err := server.DB.First(&row, "id = ?", ticket.TransferID).Error; err != nil {
		t.Fatal(err)
	}
	if row.State != "running" || row.ActiveRequests != 1 {
		t.Fatalf("replayed terminal report finished the other active Range request: %+v", row)
	}
	second.unblock()
	<-second.done
	progress := nativeProgressSnapshot(t, router, token, ticket.TransferID)
	if progress.State != "completed" || progress.BytesSent != int64(len(content)) {
		t.Fatalf("replayed commit counted Range response bytes more than once: %+v", progress)
	}
}

func TestNativeDownloadProgressRetriesRejectedFinalReport(t *testing.T) {
	server, peer, _, token, _, node := newNativeDownloadProgressFixture(t)
	var attempts atomic.Int64
	if err := server.DB.Callback().Update().Before("gorm:update").Register("reject_native_final_report", func(tx *gorm.DB) {
		if tx.Statement.Table == "xd_download_progress" && nativeProgressTerminalUpdate(tx) && attempts.Add(1) == 1 {
			tx.AddError(errors.New("injected rejected final progress report"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	router, peerRouter := server.Router(), peer.Router()
	ticket := nativeProgressTicket(t, router, token, fmt.Sprintf("/api/v1/files/%d/download-ticket", node.ID))
	response := request(t, peerRouter, http.MethodGet, ticket.URL, "", nil, http.StatusOK)
	progress := nativeProgressSnapshot(t, router, token, ticket.TransferID)
	if progress.State != "completed" || progress.BytesSent != 10 {
		t.Fatalf("a transient final report failure left the successful download unfinished: %+v", progress)
	}
	if response.Body.String() != "0123456789" {
		t.Fatalf("a final telemetry error changed the download payload: %q", response.Body.String())
	}
}

func TestNativeDownloadProgressReplaysUncertainSnapshotWithoutDoubleCounting(t *testing.T) {
	server, peer, _, token, _, node := newNativeDownloadProgressFixture(t)
	content := nativeProgressRetryContent(t, server, node.ID)
	reports := make(chan struct{}, 2)
	var snapshots atomic.Int64
	if err := server.DB.Callback().Update().After("gorm:commit_or_rollback_transaction").Register("lose_native_snapshot_ack", func(tx *gorm.DB) {
		if tx.Statement.Table != "xd_download_progress" || tx.Error != nil || nativeProgressTerminalUpdate(tx) {
			return
		}
		attempt := snapshots.Add(1)
		if attempt == 1 {
			tx.AddError(errors.New("injected lost snapshot commit acknowledgment"))
		}
		if attempt <= 2 {
			reports <- struct{}{}
		}
	}); err != nil {
		t.Fatal(err)
	}
	router, peerRouter := server.Router(), peer.Router()
	ticket := nativeProgressTicket(t, router, token, fmt.Sprintf("/api/v1/files/%d/download-ticket", node.ID))
	stream, accepted := startBlockedNativeDownload(t, peerRouter, ticket.URL, "")
	for range 2 {
		select {
		case <-reports:
		case <-time.After(5 * time.Second):
			t.Fatal("the quiet response did not replay its cumulative snapshot")
		}
	}
	progress := nativeProgressSnapshot(t, router, token, ticket.TransferID)
	if progress.State != "running" || progress.BytesSent != accepted {
		t.Fatalf("an uncertain snapshot replay counted the same response bytes twice: %+v, wanted %d", progress, accepted)
	}
	stream.unblock()
	<-stream.done
	progress = nativeProgressSnapshot(t, router, token, ticket.TransferID)
	if progress.State != "completed" || progress.BytesSent != int64(len(content)) {
		t.Fatalf("final snapshot did not reconcile the replayed response count: %+v", progress)
	}
}

func TestNativeDownloadProgressBoundsFinalReportRetries(t *testing.T) {
	server, peer, _, token, _, node := newNativeDownloadProgressFixture(t)
	var attempts atomic.Int64
	if err := server.DB.Callback().Update().Before("gorm:update").Register("block_native_final_reports", func(tx *gorm.DB) {
		if tx.Statement.Table != "xd_download_progress" || !nativeProgressTerminalUpdate(tx) {
			return
		}
		attempts.Add(1)
		<-tx.Statement.Context.Done()
		tx.AddError(tx.Statement.Context.Err())
	}); err != nil {
		t.Fatal(err)
	}
	router, peerRouter := server.Router(), peer.Router()
	ticket := nativeProgressTicket(t, router, token, fmt.Sprintf("/api/v1/files/%d/download-ticket", node.ID))
	started := time.Now()
	response := request(t, peerRouter, http.MethodGet, ticket.URL, "", nil, http.StatusOK)
	if elapsed := time.Since(started); elapsed > 3*time.Second {
		t.Fatalf("optional final telemetry held a finished payload for %v", elapsed)
	}
	if got := attempts.Load(); got < 2 || got > 3 {
		t.Fatalf("persistent telemetry failure attempted %d reports; wanted bounded retries", got)
	}
	if response.Body.String() != "0123456789" {
		t.Fatalf("unavailable final telemetry changed the payload: %q", response.Body.String())
	}
}

func nativeProgressRetryContent(t *testing.T, server *Server, nodeID uint64) []byte {
	t.Helper()
	content := bytes.Repeat([]byte("0123456789abcdef"), 8192)
	if _, err := server.Store.Put(t.Context(), "progress/data.txt", bytes.NewReader(content)); err != nil {
		t.Fatal(err)
	}
	if err := server.DB.Model(&meta.File{}).Where("node_id = ?", nodeID).Update("size", len(content)).Error; err != nil {
		t.Fatal(err)
	}
	return content
}

func nativeProgressTerminalUpdate(tx *gorm.DB) bool {
	updates, ok := tx.Statement.Dest.(map[string]any)
	if !ok {
		return false
	}
	_, terminal := updates["state"]
	return terminal
}
