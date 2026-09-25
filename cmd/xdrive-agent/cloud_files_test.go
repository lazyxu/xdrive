package main

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestAppendCloudCrumbs(t *testing.T) {
	remote := map[string]client.Node{
		"":                 {ID: 1, Name: "root", Type: "dir"},
		"Projects":         {ID: 2, Name: "Projects", Type: "dir"},
		"Projects/Archive": {ID: 3, Name: "Archive", Type: "dir"},
	}
	got := appendCloudCrumbs(
		[]agentCloudCrumb{{ID: 1, Name: "My files"}},
		remote,
		"Projects/Archive",
	)
	if len(got) != 3 ||
		got[0].ID != 1 ||
		got[1].ID != 2 ||
		got[2].ID != 3 ||
		got[2].Name != "Archive" {
		t.Fatalf("crumbs=%+v", got)
	}
}
