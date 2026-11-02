package localbackupipc

import "testing"

func TestOwnerDeleteNodeRequiresExactCurrentRevisionAndParent(t *testing.T) {
	if !ValidOwnerDeleteNode(12, 4, 17, "file", "a.txt") ||
		!ValidOwnerDeleteNode(13, 7, 17, "dir", "folder") {
		t.Fatal("valid Owner trash selectors rejected")
	}
	for _, item := range []struct {
		id, revision, parent uint64
		kind, name string
	}{
		{0, 1, 2, "file", "a.txt"},
		{1, 0, 2, "file", "a.txt"},
		{1, 1, 0, "dir", "folder"},
		{1, 1, 2, "link", "file"},
		{1, 1, 2, "file", "../escape"},
		{1, 1, 2, "file", "bad/name"},
		{1, 1, 2, "dir", ""},
	} {
		if ValidOwnerDeleteNode(item.id, item.revision, item.parent, item.kind, item.name) {
			t.Fatalf("invalid Owner trash selector accepted: %+v", item)
		}
	}
}
