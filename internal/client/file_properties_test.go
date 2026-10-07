package client

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestFilePropertiesStatsPostsSelection(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/nodes/properties/stats" || r.Method != http.MethodPost {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		var body struct {
			Items []BatchNodeRef `json:"items"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if len(body.Items) != 2 ||
			body.Items[0].ID != 3 ||
			body.Items[0].Revision != 4 ||
			body.Items[1].ID != 5 ||
			body.Items[1].Revision != 6 {
			t.Fatalf("unexpected properties refs: %+v", body.Items)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"selected_count":2,"effective_root_count":1,"total_bytes":12,"file_count":3,"folder_count":1,"sources":[{"id":9,"name":"相机备份","kind":"filesystem"}]}`))
	}))
	defer server.Close()

	cli := New(server.URL, "")
	cli.HTTP = server.Client()
	stats, err := cli.FilePropertiesStats(
		context.Background(),
		[]BatchNodeRef{{ID: 3, Revision: 4}, {ID: 5, Revision: 6}},
	)
	if err != nil {
		t.Fatal(err)
	}
	if stats.TotalBytes != 12 || stats.FileCount != 3 || stats.FolderCount != 1 {
		t.Fatalf("unexpected properties stats: %+v", stats)
	}
	if len(stats.Sources) != 1 ||
		stats.Sources[0].ID != 9 ||
		stats.Sources[0].Name != "相机备份" ||
		stats.Sources[0].Kind != "filesystem" {
		t.Fatalf("unexpected properties sources: %+v", stats.Sources)
	}
}

func TestFilePropertiesStatsCancelsHTTPWithContext(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
	}))
	defer server.Close()

	cli := New(server.URL, "")
	cli.HTTP = server.Client()
	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() {
		_, err := cli.FilePropertiesStats(
			ctx,
			[]BatchNodeRef{{ID: 3, Revision: 4}},
		)
		errCh <- err
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		close(release)
		t.Fatal("properties request did not start")
	}
	cancel()

	select {
	case err := <-errCh:
		close(release)
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("properties request error=%v want context.Canceled", err)
		}
	case <-time.After(time.Second):
		close(release)
		t.Fatal("properties client did not return after cancellation")
	}
}
