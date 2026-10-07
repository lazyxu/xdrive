package main

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/mount"
)

func TestAvailabilitySearchFiltersBeforeLogicalPagination(t *testing.T) {
	const total = 420
	items := make([]client.SearchResult, total)
	classes := make(map[string]string, total)
	root := t.TempDir()
	for index := 0; index < total; index++ {
		path := fmt.Sprintf("folder/item-%03d.bin", index)
		items[index] = client.SearchResult{
			Node: client.Node{ID: uint64(index + 1), Name: fmt.Sprintf("item-%03d.bin", index), Type: "file"},
			Path: path,
		}
		absolute, err := agentAvailabilityAbsolutePath(root, path)
		if err != nil {
			t.Fatal(err)
		}
		if index%3 == 0 {
			classes[filepath.Clean(absolute)] = "cloud"
		} else {
			classes[filepath.Clean(absolute)] = "local"
		}
	}
	groups := []client.FileExplorerGroupIndex{
		{Key: "group:a", ItemCount: 210, StartIndex: 0},
		{Key: "group:b", ItemCount: 210, StartIndex: 210},
	}
	loadPage := func(_ context.Context, offset, limit int) (client.SearchRange, error) {
		if offset < 0 || offset > len(items) {
			return client.SearchRange{}, fmt.Errorf("bad offset")
		}
		end := offset + limit
		if end > len(items) {
			end = len(items)
		}
		pageGroups := []client.FileExplorerGroupIndex(nil)
		totalCountIncluded := (*bool)(nil)
		totalCount := int64(total)
		if offset == 0 {
			pageGroups = groups
		} else {
			included := false
			totalCountIncluded = &included
			totalCount = 0
		}
		return client.SearchRange{
			Items: items[offset:end], TotalCount: totalCount, TotalCountIncluded: totalCountIncluded,
			Offset: offset, Limit: limit, Sort: "name", Order: "asc", Groups: pageGroups,
		}, nil
	}
	resolve := func(path string) (string, error) {
		class, ok := classes[filepath.Clean(path)]
		if !ok {
			return "", fmt.Errorf("missing class for %s", path)
		}
		return class, nil
	}

	snapshot, err := buildAgentAvailabilitySearchSnapshot(
		context.Background(),
		root,
		"cloud",
		loadPage,
		resolve,
	)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := len(snapshot.Matches), 140; got != want {
		t.Fatalf("matched=%d want=%d", got, want)
	}
	if len(snapshot.Groups) != 2 ||
		snapshot.Groups[0].ItemCount != 70 ||
		snapshot.Groups[0].StartIndex != 0 ||
		snapshot.Groups[1].ItemCount != 70 ||
		snapshot.Groups[1].StartIndex != 70 {
		t.Fatalf("groups=%+v", snapshot.Groups)
	}

	page, err := materializeAgentAvailabilitySearchRange(
		context.Background(),
		snapshot,
		68,
		5,
		loadPage,
	)
	if err != nil {
		t.Fatal(err)
	}
	got := make([]uint64, 0, len(page))
	for _, item := range page {
		got = append(got, item.Node.ID)
	}
	want := []uint64{205, 208, 211, 214, 217}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("materialized ids=%v want=%v", got, want)
	}
}

func TestAvailabilitySearchCacheReusesAndInvalidatesSnapshots(t *testing.T) {
	cache := newAgentAvailabilitySearchCache()
	var builds atomic.Int32
	build := func(context.Context) (*agentAvailabilitySearchSnapshot, error) {
		builds.Add(1)
		return &agentAvailabilitySearchSnapshot{
			CreatedAt: time.Now(),
			Matches: []agentAvailabilitySearchMatch{
				{SourceOffset: 1, NodeID: 2},
				{SourceOffset: 3, NodeID: 4},
				{SourceOffset: 5, NodeID: 6},
			},
		}, nil
	}
	first, err := cache.GetOrBuild(context.Background(), "same", build)
	if err != nil {
		t.Fatal(err)
	}
	second, err := cache.GetOrBuild(context.Background(), "same", build)
	if err != nil {
		t.Fatal(err)
	}
	if first != second || builds.Load() != 1 {
		t.Fatalf("cache did not reuse snapshot: first=%p second=%p builds=%d", first, second, builds.Load())
	}
	cache.Invalidate()
	if _, err := cache.GetOrBuild(context.Background(), "same", build); err != nil {
		t.Fatal(err)
	}
	if builds.Load() != 2 {
		t.Fatalf("builds after invalidate=%d want=2", builds.Load())
	}
}

func TestAgentAvailabilityClassMatchesDesktopLabels(t *testing.T) {
	tests := []struct {
		name             string
		stateMode        string
		pinned           bool
		onlineOnly       bool
		availableOffline bool
		syncing          bool
		want             string
	}{
		{name: "syncing", stateMode: "syncing", syncing: true, want: "syncing"},
		{name: "always-local", stateMode: "always-local", pinned: true, availableOffline: true, want: "always-local"},
		{name: "online-only", stateMode: "online-only", onlineOnly: true, want: "online-only"},
		{name: "cloud", stateMode: "cloud", want: "cloud"},
		{name: "local", stateMode: "local", availableOffline: true, want: "local"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := agentAvailabilityClass(structToAvailability(test.stateMode, test.pinned, test.onlineOnly, test.availableOffline, test.syncing))
			if got != test.want {
				t.Fatalf("class=%q want=%q", got, test.want)
			}
		})
	}
}

func structToAvailability(mode string, pinned, onlineOnly, availableOffline, syncing bool) mount.FileAvailability {
	return mount.FileAvailability{
		Mode:             mode,
		Pinned:           pinned,
		OnlineOnly:       onlineOnly,
		AvailableOffline: availableOffline,
		Syncing:          syncing,
	}
}

func TestAvailabilitySearchInvalidationFencesInFlightBuild(t *testing.T) {
	cache := newAgentAvailabilitySearchCache()
	started := make(chan struct{})
	release := make(chan struct{})
	result := make(chan error, 1)
	go func() {
		_, err := cache.GetOrBuild(context.Background(), "race", func(context.Context) (*agentAvailabilitySearchSnapshot, error) {
			close(started)
			<-release
			return &agentAvailabilitySearchSnapshot{
				CreatedAt: time.Now(),
				Matches:   []agentAvailabilitySearchMatch{{SourceOffset: 0, NodeID: 1}},
			}, nil
		})
		result <- err
	}()
	<-started
	cache.Invalidate()
	close(release)
	if err := <-result; !errors.Is(err, errAgentAvailabilitySearchInvalidated) {
		t.Fatalf("in-flight invalidation err=%v", err)
	}
}

func TestAvailabilitySearchMaterializationRejectsReorderedSource(t *testing.T) {
	snapshot := &agentAvailabilitySearchSnapshot{
		CreatedAt:   time.Now(),
		Matches:     []agentAvailabilitySearchMatch{{SourceOffset: 1, NodeID: 2}},
		SourceTotal: 2,
	}
	loadPage := func(_ context.Context, offset, limit int) (client.SearchRange, error) {
		return client.SearchRange{
			Items: []client.SearchResult{
				{Node: client.Node{ID: 2}},
				{Node: client.Node{ID: 1}},
			},
			TotalCount: 2,
			Offset:     0,
			Limit:      limit,
		}, nil
	}
	_, err := materializeAgentAvailabilitySearchRange(
		context.Background(),
		snapshot,
		0,
		1,
		loadPage,
	)
	if !errors.Is(err, errAgentAvailabilitySearchSourceChanged) {
		t.Fatalf("reordered source err=%v", err)
	}
}
