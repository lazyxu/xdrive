package main

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestAgentCloudCrumbsLocalizesRoot(t *testing.T) {
	got := agentCloudCrumbs([]client.SearchBreadcrumb{
		{ID: 1, Name: ""},
		{ID: 2, Name: "Projects"},
		{ID: 3, Name: "Archive"},
	})
	if len(got) != 3 ||
		got[0].ID != 1 ||
		got[0].Name != "My files" ||
		got[1].ID != 2 ||
		got[1].Name != "Projects" ||
		got[2].ID != 3 ||
		got[2].Name != "Archive" {
		t.Fatalf("crumbs=%+v", got)
	}
}
