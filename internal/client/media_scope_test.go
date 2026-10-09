package client

import (
	"net/url"
	"testing"
)

func TestMediaQueryDescendantsAreOptInAndParentBound(t *testing.T) {
	for _, tc := range []struct {
		name      string
		query     MediaQuery
		folder    string
		recursion string
	}{
		{name: "legacy direct only", query: MediaQuery{FolderID: 42}, folder: "42"},
		{name: "descendants", query: MediaQuery{FolderID: 42, IncludeDescendants: true}, folder: "42", recursion: "true"},
		{name: "no scope cannot request recursive", query: MediaQuery{IncludeDescendants: true}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			values := url.Values{}
			tc.query.add(values)
			if got := values.Get("folder_id"); got != tc.folder {
				t.Fatalf("folder=%q, want %q", got, tc.folder)
			}
			if got := values.Get("include_descendants"); got != tc.recursion {
				t.Fatalf("recursive=%q, want %q", got, tc.recursion)
			}
		})
	}
}
