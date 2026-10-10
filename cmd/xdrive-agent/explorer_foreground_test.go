package main

import "testing"

func TestChooseExplorerWindowToActivate(t *testing.T) {
	tests := []struct {
		name          string
		before, after []explorerWindowState
		folder        string
		want          uintptr
	}{
		{"new Explorer window", []explorerWindowState{{1, "Other"}}, []explorerWindowState{{1, "Other"}, {2, "Files"}}, "Files", 2},
		{"reused Explorer window", []explorerWindowState{{1, "Other"}}, []explorerWindowState{{1, "Files"}}, "Files", 1},
		{"only unique matching Explorer", []explorerWindowState{{1, "Photos"}, {2, "Other"}}, []explorerWindowState{{1, "Photos"}, {2, "Other"}}, "Photos", 1},
		{"ambiguous titles must not activate", []explorerWindowState{{1, "Photos"}, {2, "Photos"}}, []explorerWindowState{{1, "Photos"}, {2, "Photos"}}, "Photos", 0},
		{"unknown directory must not activate", []explorerWindowState{{1, "Other"}}, []explorerWindowState{{1, "Other"}}, "Photos", 0},
		{"new takes precedence over existing caption", []explorerWindowState{{1, "Photos"}}, []explorerWindowState{{1, "Photos"}, {2, "Somewhere"}}, "Photos", 2},
		{"multiple new windows ambiguous", nil, []explorerWindowState{{1, "Elsewhere"}, {2, "Unrelated"}}, "Photos", 0},
		{"multiple new unique title", nil, []explorerWindowState{{1, "Elsewhere"}, {2, "Photos"}}, "Photos", 2},
		{"ignore similar prefix", []explorerWindowState{{1, "Photos Backup"}}, []explorerWindowState{{1, "Photos Backup"}}, "Photos", 0},
		{"localized caption suffix", []explorerWindowState{{1, "照片 - 文件资源管理器"}}, []explorerWindowState{{1, "照片 - 文件资源管理器"}}, "照片", 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := chooseExplorerWindowToActivate(test.before, test.after, test.folder)
			if got != test.want {
				t.Fatalf("got %d, want %d", got, test.want)
			}
		})
	}
}
