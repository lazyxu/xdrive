package mediagroup

import (
	"strings"
	"testing"
)

func TestContentCopyRepresentativeRequiresIdenticalCurrentBytes(t *testing.T) {
	hashA := strings.Repeat("a", 64)
	hashB := strings.Repeat("b", 64)
	copies := []contentCopyCandidate{
		{NodeID: 3, SHA256: hashA, NodeRevision: 1, IndexedRevision: 1},
		{NodeID: 9, SHA256: hashA, NodeRevision: 2, IndexedRevision: 2},
	}
	if got, ok := contentCopyRepresentative(copies, 0); !ok || got != 3 {
		t.Fatalf("canonical=%d ok=%v", got, ok)
	}
	if got, ok := contentCopyRepresentative(copies, 9); !ok || got != 9 {
		t.Fatalf("preferred=%d ok=%v", got, ok)
	}
	if got, ok := contentCopyRepresentative(copies[:1], 0); !ok || got != 3 {
		t.Fatalf("singleton=%d ok=%v", got, ok)
	}
	copies[1].SHA256 = hashB
	if _, ok := contentCopyRepresentative(copies, 0); ok {
		t.Fatal("different content accepted as identical")
	}
	copies[1].SHA256 = ""
	if _, ok := contentCopyRepresentative(copies, 0); ok {
		t.Fatal("missing digest accepted")
	}
	copies[1].SHA256 = hashA
	copies[1].IndexedRevision = 1
	if _, ok := contentCopyRepresentative(copies, 0); ok {
		t.Fatal("stale media index accepted")
	}
}
