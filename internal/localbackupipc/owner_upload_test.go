package localbackupipc

import (
	"testing"
	"time"
)

func TestOwnerUploadedFileMustBeExactCurrentOwnerAcknowledgement(t *testing.T) {
	parent := uint64(17)
	now := time.Now().UTC()
	valid := OwnerFileNode{
		ID: 42, ParentID: &parent, Name: "photo.jpg", Type: "file",
		Size: 3, Revision: 2, CreatedAt: now, UpdatedAt: now,
	}
	if !ValidateOwnerUploadedFile(valid, parent, "photo.jpg", 3) {
		t.Fatal("exact uploaded Server file rejected")
	}
	for name, mutate := range map[string]func(*OwnerFileNode){
		"wrong name": func(n *OwnerFileNode) { n.Name = "other.jpg" },
		"wrong parent": func(n *OwnerFileNode) { x := uint64(99); n.ParentID = &x },
		"missing parent": func(n *OwnerFileNode) { n.ParentID = nil },
		"directory": func(n *OwnerFileNode) { n.Type = "dir" },
		"wrong bytes": func(n *OwnerFileNode) { n.Size = 2 },
		"missing revision": func(n *OwnerFileNode) { n.Revision = 0 },
		"missing timestamp": func(n *OwnerFileNode) { n.CreatedAt = time.Time{} },
	} {
		t.Run(name, func(t *testing.T) {
			got := valid
			mutate(&got)
			if ValidateOwnerUploadedFile(got, parent, "photo.jpg", 3) {
				t.Fatal("incorrect Server acknowledgement passed as completed upload")
			}
		})
	}
	if ValidateOwnerUploadedFile(valid, parent, "photo.jpg", OwnerSmallUploadMaxBytes+1) ||
		ValidateOwnerUploadedFile(valid, parent, "../photo.jpg", 3) {
		t.Fatal("oversized or invalid Browser selectors admitted")
	}
}
