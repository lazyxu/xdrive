package main

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

func TestBuildStorageTreeModesAndAggregates(t *testing.T) {
	remote := map[string]client.Node{
		"":                       {ID: 1, Type: "dir", Name: "xDrive"},
		"Projects":               {ID: 2, Type: "dir", Name: "Projects"},
		"Projects/Archive":       {ID: 3, Type: "dir", Name: "Archive"},
		"Projects/current.txt":   {ID: 4, Type: "file", Name: "current.txt", Size: 10},
		"Projects/Archive/a.zip": {ID: 5, Type: "file", Name: "a.zip", Size: 20},
		"Media":                  {ID: 6, Type: "dir", Name: "Media"},
		"Media/movie.mp4":        {ID: 7, Type: "file", Name: "movie.mp4", Size: 30},
	}
	rules := []userconfig.SyncRule{
		{Path: "Projects", Mode: userconfig.SyncModeAlwaysLocal},
		{Path: "Projects/Archive", Mode: userconfig.SyncModeExclude},
	}
	tree := buildStorageTree(remote, rules)
	if tree.FileCount != 3 || tree.TotalBytes != 60 {
		t.Fatalf("root aggregate=%+v", tree)
	}
	if len(tree.Children) != 2 || tree.Children[1].Name != "Projects" {
		t.Fatalf("children=%+v", tree.Children)
	}
	projects := tree.Children[1]
	if projects.Mode != "always-local" || projects.EffectiveMode != "always-local" || projects.FileCount != 2 || projects.TotalBytes != 30 {
		t.Fatalf("Projects=%+v", projects)
	}
	if len(projects.Children) != 1 {
		t.Fatalf("Projects children=%+v", projects.Children)
	}
	archive := projects.Children[0]
	if archive.Mode != "exclude" || archive.EffectiveMode != "exclude" || archive.FileCount != 1 || archive.TotalBytes != 20 {
		t.Fatalf("Archive=%+v", archive)
	}
}

func TestEffectiveStorageModeIsInherited(t *testing.T) {
	rules := []userconfig.SyncRule{{Path: "Projects", Mode: userconfig.SyncModeExclude}}
	if got := explicitStorageMode("Projects/Sub", rules); got != "default" {
		t.Fatalf("explicit=%q", got)
	}
	if got := effectiveStorageMode("Projects/Sub", rules); got != "exclude" {
		t.Fatalf("effective=%q", got)
	}
}
