package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestLocalQuarantinedCurrentPathKeysBindCanonicalPrivatePaths(t *testing.T) {
	input := localEvidenceCloudMetadataRequest{
		PreviousSnapshotSHA256: strings.Repeat("1", 64),
		CurrentSnapshotSHA256:  strings.Repeat("2", 64),
		Items: []localEvidenceCloudMetadataItem{
			{EvidenceID: 11, SHA256: strings.Repeat("a", 64), Size: 3},
			{EvidenceID: 12, SHA256: strings.Repeat("b", 64), Size: 4},
		},
	}
	claims := []localQuarantinedCurrentPathClaim{
		{EvidenceID: 11, CurrentRelativePath: "photos/one.jpg"},
		{EvidenceID: 12, CurrentRelativePath: "photos/two.jpg"},
	}
	keys, err := localQuarantinedCurrentPathKeys("own-root", input, claims)
	if err != nil || len(keys) != 2 || keys[0] == keys[1] {
		t.Fatalf("valid private CURRENT paths rejected: %v %v", keys, err)
	}
	for i, claim := range claims {
		want := sha256.Sum256([]byte("xdrive-local-path-v1\x00own-root\x00file\x00" + claim.CurrentRelativePath))
		if keys[i] != hex.EncodeToString(want[:]) {
			t.Fatalf("Root-scoped path key differs from inventory contract")
		}
	}
	encoded, err := json.Marshal(claims)
	if err != nil || strings.Contains(string(encoded), "photos/") {
		t.Fatalf("private path leaked through JSON: %q %v", encoded, err)
	}
	for _, bad := range []struct {
		name string
		edit func([]localQuarantinedCurrentPathClaim)
	}{
		{"unknown evidence", func(v []localQuarantinedCurrentPathClaim) { v[0].EvidenceID++ }},
		{"duplicate evidence", func(v []localQuarantinedCurrentPathClaim) { v[1].EvidenceID = v[0].EvidenceID }},
		{"duplicate path", func(v []localQuarantinedCurrentPathClaim) { v[1].CurrentRelativePath = v[0].CurrentRelativePath }},
		{"empty path", func(v []localQuarantinedCurrentPathClaim) { v[0].CurrentRelativePath = "" }},
		{"absolute path", func(v []localQuarantinedCurrentPathClaim) { v[0].CurrentRelativePath = "/private/file" }},
		{"parent traversal", func(v []localQuarantinedCurrentPathClaim) { v[0].CurrentRelativePath = "../outside" }},
		{"redundant path", func(v []localQuarantinedCurrentPathClaim) { v[0].CurrentRelativePath = "photos/../one.jpg" }},
		{"leading dot", func(v []localQuarantinedCurrentPathClaim) { v[0].CurrentRelativePath = "./photos/one.jpg" }},
		{"slash fold", func(v []localQuarantinedCurrentPathClaim) { v[0].CurrentRelativePath = "photos//one.jpg" }},
		{"backslashes", func(v []localQuarantinedCurrentPathClaim) { v[0].CurrentRelativePath = "photos\\one.jpg" }},
		{"drive path", func(v []localQuarantinedCurrentPathClaim) { v[0].CurrentRelativePath = "C:/private/file" }},
		{"alternate stream", func(v []localQuarantinedCurrentPathClaim) { v[0].CurrentRelativePath = "photos/file:stream" }},
		{"control byte", func(v []localQuarantinedCurrentPathClaim) { v[0].CurrentRelativePath = "photos/a\x00b" }},
		{"newline", func(v []localQuarantinedCurrentPathClaim) { v[0].CurrentRelativePath = "photos/one\n.jpg" }},
	} {
		t.Run(bad.name, func(t *testing.T) {
			invalid := append([]localQuarantinedCurrentPathClaim(nil), claims...)
			bad.edit(invalid)
			keys, err := localQuarantinedCurrentPathKeys("own-root", input, invalid)
			if !errors.Is(err, errLocalEvidenceConflict) || len(keys) != 0 {
				t.Fatalf("unsafe path/ID admitted: %v %v", keys, err)
			}
		})
	}
	if keys, err := localQuarantinedCurrentPathKeys("", input, claims); !errors.Is(err, errLocalEvidenceConflict) || len(keys) != 0 {
		t.Fatalf("missing owning Root admitted: %v %v", keys, err)
	}
	if keys, err := localQuarantinedCurrentPathKeys("own-root", input, nil); !errors.Is(err, errLocalEvidenceConflict) || len(keys) != 0 {
		t.Fatalf("empty candidate batch admitted: %v %v", keys, err)
	}
}
