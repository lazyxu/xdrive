package api

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/storage"
)

type countingStagingStore struct {
	*storage.Local
	visits int
}

func (s *countingStagingStore) WalkStaging(ctx context.Context, visit func(storage.StagingFile) error) error {
	return s.Local.WalkStaging(ctx, func(file storage.StagingFile) error {
		s.visits++
		return visit(file)
	})
}

func TestListStagingOrphanPageStreamsOnlyRequestedPage(t *testing.T) {
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for i := 9; i >= 0; i-- {
		key := fmt.Sprintf("%s/%02d", storage.UploadStagingDir, i)
		if _, err := local.Put(context.Background(), key, strings.NewReader(key)); err != nil {
			t.Fatal(err)
		}
	}
	store := &countingStagingStore{Local: local}
	server := &Server{Store: store}
	inventory := uploadStagingInventory{
		Stats:        uploadStagingStatsDTO{Supported: true},
		Known:        map[string]uploadStagingPartRow{},
		OrphanCutoff: time.Now().Add(time.Hour),
	}

	page, hasMore, err := server.listStagingOrphanPage(context.Background(), inventory, "", 0, 3)
	if err != nil {
		t.Fatal(err)
	}
	if !hasMore || len(page) != 3 {
		t.Fatalf("first page len=%d hasMore=%v", len(page), hasMore)
	}
	for i, file := range page {
		want := fmt.Sprintf("%s/%02d", storage.UploadStagingDir, i)
		if file.Key != want {
			t.Fatalf("page[%d]=%q want=%q", i, file.Key, want)
		}
	}
	if store.visits != 4 {
		t.Fatalf("first page visited=%d staging files want=4", store.visits)
	}

	store.visits = 0
	page, hasMore, err = server.listStagingOrphanPage(context.Background(), inventory, page[len(page)-1].Key, 0, 3)
	if err != nil {
		t.Fatal(err)
	}
	if !hasMore || len(page) != 3 {
		t.Fatalf("second page len=%d hasMore=%v", len(page), hasMore)
	}
	for i, file := range page {
		want := fmt.Sprintf("%s/%02d", storage.UploadStagingDir, i+3)
		if file.Key != want {
			t.Fatalf("second page[%d]=%q want=%q", i, file.Key, want)
		}
	}
	if store.visits >= 10 {
		t.Fatalf("second page unexpectedly scanned the entire staging tree: visits=%d", store.visits)
	}
}
