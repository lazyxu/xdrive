//go:build linux

package api

import (
	"net/http"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// The sole explicitly enabled cancellation fixture paces the FIRST genuine
// ServeContent HTTP response. The subsequent signed download is unmodified.
type pwaS4C3PacedWriter struct {
	http.ResponseWriter
}

func (w *pwaS4C3PacedWriter) Write(data []byte) (int, error) {
	n, err := w.ResponseWriter.Write(data)
	if n > 0 {
		time.Sleep(80 * time.Millisecond)
	}
	return n, err
}

func (w *pwaS4C3PacedWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *pwaS4C3PacedWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

// Independent postflight: neither Playwright's cancellation event nor a later
// successful retry may overwrite the first signed ticket's cancellation proof.
func pwaS4C3VerifyNativeCancelRetry(t *testing.T, db *gorm.DB, ownerID uint64, expectedSize int64) {
	t.Helper()
	var rows []meta.DownloadProgress
	if err := db.Where("owner_id = ? AND resource_kind = ? AND bytes_total = ?",
		ownerID, "file", expectedSize).Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("S4C3 native cancel/retry requires two distinct signed tickets, got=%d", len(rows))
	}
	cancelled, completed := 0, 0
	for _, row := range rows {
		if row.ActiveRequests != 0 {
			t.Fatalf("S4C3 download still active after finish: %d", row.ActiveRequests)
		}
		switch row.State {
		case "cancelled":
			if row.FailureState != "cancelled" || row.BytesSent <= 0 || row.BytesSent >= expectedSize {
				t.Fatalf("S4C3 expected partially sent, cancelled response: bytes=%d state=%s", row.BytesSent, row.State)
			}
			cancelled++
		case "completed":
			if row.FailureState != "" || row.BytesSent != expectedSize {
				t.Fatalf("S4C3 completed retry must send full bytes: bytes=%d state=%s", row.BytesSent, row.State)
			}
			completed++
		default:
			t.Fatalf("S4C3 unexpected signed download state=%s", row.State)
		}
	}
	if cancelled != 1 || completed != 1 {
		t.Fatalf("S4C3 expected one cancelled and one completed ticket, got=%d/%d", cancelled, completed)
	}
	t.Logf("PWA_S4C3_NATIVE_CANCEL_RETRY_VERIFIED cancelled=1 completed=1 bytes=%d", expectedSize)
}
