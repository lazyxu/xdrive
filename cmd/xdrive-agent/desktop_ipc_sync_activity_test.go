package main

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/syncactivity"
)

type fakeSyncActivityReader struct {
	*fakeDesktopIPCController
	runs      []syncactivity.Run
	items     []syncactivity.Item
	run       syncactivity.Run
	readCount int
}

func (f *fakeSyncActivityReader) SyncActivityRuns(_ context.Context, limit int, _ *syncactivity.RunCursor) ([]syncactivity.Run, error) {
	f.readCount++
	if limit < len(f.runs) {
		return f.runs[:limit], nil
	}
	return f.runs, nil
}
func (f *fakeSyncActivityReader) SyncActivityRun(_ context.Context, id string) (syncactivity.Run, error) {
	f.readCount++
	if id != f.run.ID {
		return syncactivity.Run{}, syncactivity.ErrNotFound
	}
	return f.run, nil
}
func (f *fakeSyncActivityReader) SyncActivityItems(_ context.Context, id string, limit int, _ *syncactivity.ItemCursor) ([]syncactivity.Item, error) {
	f.readCount++
	if id != f.run.ID {
		return nil, syncactivity.ErrNotFound
	}
	if limit < len(f.items) {
		return f.items[:limit], nil
	}
	return f.items, nil
}

func TestDesktopSyncActivityAPIReadAndInputFencing(t *testing.T) {
	now := time.Now().UTC()
	ctrl := &fakeSyncActivityReader{
		fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1},
		run:                      syncactivity.Run{ID: "run-1", Engine: "mount", Trigger: "manual", StartedAt: now, Status: syncactivity.StatusCompleted},
		runs:                     []syncactivity.Run{{ID: "run-1", StartedAt: now, Status: syncactivity.StatusCompleted}},
		items:                    []syncactivity.Item{{RunID: "run-1", ID: "file-1", Action: "create", Direction: "upload", Status: "completed"}},
	}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})
	for _, tc := range []struct {
		path string
		code int
	}{
		{"/v1/sync/runs?limit=1", http.StatusOK},
		{"/v1/sync/runs/run-1", http.StatusOK},
		{"/v1/sync/runs/run-1/items?limit=1", http.StatusOK},
		{"/v1/sync/runs/missing", http.StatusNotFound},
		{"/v1/sync/runs?limit=10000", http.StatusBadRequest},
		{"/v1/sync/runs?before_run_id=run-1", http.StatusBadRequest},
		{"/v1/sync/runs/run-1/items?before_applied_at=12", http.StatusBadRequest},
		{"/v1/sync/runs/run-1/items?limit=0", http.StatusBadRequest},
	} {
		res := desktopIPCRequest(t, handler, http.MethodGet, tc.path, "")
		if res.Code != tc.code {
			t.Fatalf("%s status=%d want=%d body=%s", tc.path, res.Code, tc.code, res.Body.String())
		}
	}
	res := desktopIPCRequest(t, handler, http.MethodGet, "/v1/sync/runs?limit=1", "")
	var result struct {
		Items      []syncactivity.Run `json:"items"`
		NextCursor map[string]any     `json:"next_cursor"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 1 || result.Items[0].ID != "run-1" || result.NextCursor["before_run_id"] != "run-1" {
		t.Fatalf("wrong bounded page: %+v", result)
	}
	if ctrl.readCount == 0 {
		t.Fatal("reader was never called")
	}
}

func TestDesktopSyncActivityUnsupportedFakeIsNotAvailable(t *testing.T) {
	handler := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1}, "secret", func() {})
	res := desktopIPCRequest(t, handler, http.MethodGet, "/v1/sync/runs?limit=1", "")
	if res.Code != http.StatusNotImplemented {
		t.Fatalf("unexpected unsupported reader status=%d body=%s", res.Code, res.Body.String())
	}
}

// The cursor timestamp must remain a JSON string. UnixNano is well beyond
// JavaScript Number.MAX_SAFE_INTEGER even for contemporary run dates.
