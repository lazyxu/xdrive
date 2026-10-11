package transfer

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Account logout/switch calls Manager.Clear. Bound Agent-owned direct transfers
// must not keep their previous account's network context alive after Clear.
func TestAccountClearCancelsBoundDirectUploadAndDownload(t *testing.T) {
	m := NewManager(16)
	upload := m.Start(Spec{FileName: "old-upload.bin", Kind: KindUpload, Direction: "upload"})
	download := m.Start(Spec{FileName: "old-download.bin", Kind: KindDownload, Direction: "download"})
	uploadCtx, cancelUpload := context.WithCancel(context.Background())
	defer cancelUpload()
	downloadCtx, cancelDownload := context.WithCancel(context.Background())
	defer cancelDownload()
	if !upload.BindCancel(cancelUpload) || !download.BindCancel(cancelDownload) {
		t.Fatal("direct Agent-owned transfers must accept their I/O cancel callbacks")
	}
	// This context represents a durable operation without an attached
	// transfer cancellation capability: account Clear must not cancel it.
	unboundCtx, cancelUnbound := context.WithCancel(context.Background())
	defer cancelUnbound()
	m.Start(Spec{FileName: "unbound sync", Direction: "upload"})

	m.Clear()

	if got := uploadCtx.Err(); !errors.Is(got, context.Canceled) {
		t.Errorf("account Clear left bound direct upload alive: context err=%v", got)
	}
	if got := downloadCtx.Err(); !errors.Is(got, context.Canceled) {
		t.Errorf("account Clear left bound direct download alive: context err=%v", got)
	}
	if err := unboundCtx.Err(); err != nil {
		t.Errorf("account Clear cancelled unrelated unbound durable context: %v", err)
	}
	if _, tasks := m.Snapshot(); len(tasks) != 0 {
		t.Errorf("old account transfer records remained visible: %+v", tasks)
	}
	// Late callbacks from the old account must not resurrect records.
	upload.Complete()
	download.Fail(context.Canceled)
	if _, tasks := m.Snapshot(); len(tasks) != 0 {
		t.Errorf("old account callback restored transfer records: %+v", tasks)
	}
}

// Use a real in-flight HTTP request to establish that clearing an old account
// actually interrupts transport, rather than just removing Task Center rows.
func TestAccountClearAbortsDirectHTTPTransport(t *testing.T) {
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
	}))
	defer server.Close()

	m := NewManager(8)
	h := m.Start(Spec{FileName: "active-download.bin", Kind: KindDownload, Direction: "download"})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if !h.BindCancel(cancel) {
		t.Fatal("failed to bind HTTP download context")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	finished := make(chan error, 1)
	go func() {
		resp, requestErr := server.Client().Do(req)
		if resp != nil {
			_ = resp.Body.Close()
		}
		finished <- requestErr
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("HTTP request was never in flight")
	}

	m.Clear()

	if !errors.Is(ctx.Err(), context.Canceled) {
		t.Errorf("account Clear did not cancel bound HTTP request context: %v", ctx.Err())
	}
	select {
	case err := <-finished:
		if !errors.Is(err, context.Canceled) {
			t.Errorf("old account HTTP request finished with %v, want context cancellation", err)
		}
	case <-time.After(time.Second):
		t.Error("old account HTTP request continued running after Clear")
		cancel() // Ensure test server closes on first-red, too.
		select {
		case <-finished:
		case <-time.After(3 * time.Second):
			t.Fatal("HTTP request failed to stop even after test cleanup cancellation")
		}
	}
}
