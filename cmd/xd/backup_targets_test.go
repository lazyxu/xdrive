package main

import (
	"context"
	"errors"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
)

type fakeTargetPager struct {
	pages []client.ChildrenPage
	calls int
}

func (f *fakeTargetPager) ListPage(_ context.Context, _ uint64, _ client.ChildrenOptions) (client.ChildrenPage, error) {
	if f.calls >= len(f.pages) {
		return client.ChildrenPage{}, errors.New("unexpected extra page")
	}
	page := f.pages[f.calls]
	f.calls++
	return page, nil
}

func TestBackupTargetsReuseExistingPaginatedDirectoryReader(t *testing.T) {
	pager := &fakeTargetPager{pages: []client.ChildrenPage{
		{HasMore: true, NextCursor: "next", Items: []client.Node{
			{ID: 20, Name: "Photos", Type: meta.NodeTypeDir},
			{ID: 21, Name: "file.jpg", Type: "file"},
		}},
		{Items: []client.Node{{ID: 22, Name: "Projects", Type: meta.NodeTypeDir}}},
	}}
	var names []string
	if err := visitBackupTargetDirectories(context.Background(), pager, 1, func(n client.Node) {
		names = append(names, n.Name)
	}); err != nil {
		t.Fatal(err)
	}
	if pager.calls != 2 || len(names) != 2 || names[0] != "Photos" || names[1] != "Projects" {
		t.Fatalf("incorrect owner directory listing: calls=%d names=%v", pager.calls, names)
	}
}

func TestBackupTargetsRejectInvalidPaginationAndIDs(t *testing.T) {
	for _, page := range []client.ChildrenPage{
		{HasMore: true, NextCursor: ""},
		{HasMore: true, NextCursor: "stuck"},
	} {
		pager := &fakeTargetPager{pages: []client.ChildrenPage{page,
			{HasMore: true, NextCursor: "stuck"}}}
		if err := visitBackupTargetDirectories(context.Background(), pager, 1, func(client.Node) {}); err == nil {
			t.Fatal("invalid cursor accepted")
		}
	}
	if err := visitBackupTargetDirectories(context.Background(), &fakeTargetPager{}, 0, func(client.Node) {}); err == nil {
		t.Fatal("invalid cloud directory ID accepted")
	}
}
