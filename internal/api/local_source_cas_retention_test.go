package api

import (
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func TestLocalQuarantinedCASHashesAreBoundedAndCanonical(t *testing.T) {
	input := localEvidenceCloudMetadataRequest{
		PreviousSnapshotSHA256: strings.Repeat("1", 64),
		CurrentSnapshotSHA256:  strings.Repeat("2", 64),
		Items: []localEvidenceCloudMetadataItem{
			{EvidenceID: 1, SHA256: strings.Repeat("b", 64), Size: 1},
			{EvidenceID: 2, SHA256: strings.Repeat("a", 64), Size: 2},
			{EvidenceID: 3, SHA256: strings.Repeat("b", 64), Size: 3},
		},
	}
	hashes, err := localQuarantinedCASHashes(input)
	if err != nil || len(hashes) != 2 ||
		hashes[0] != strings.Repeat("a", 64) ||
		hashes[1] != strings.Repeat("b", 64) {
		t.Fatalf("hashes=%v err=%v; want sorted unique canonical digests", hashes, err)
	}
	for name, change := range map[string]func(*localEvidenceCloudMetadataRequest){
		"duplicate evidence": func(v *localEvidenceCloudMetadataRequest) {
			v.Items[1].EvidenceID = 1
		},
		"uppercase digest": func(v *localEvidenceCloudMetadataRequest) {
			v.Items[0].SHA256 = strings.Repeat("B", 64)
		},
		"oversized item": func(v *localEvidenceCloudMetadataRequest) {
			v.Items[0].Size = 64<<20 + 1
		},
		"duplicate generations": func(v *localEvidenceCloudMetadataRequest) {
			v.CurrentSnapshotSHA256 = v.PreviousSnapshotSHA256
		},
		"too many items": func(v *localEvidenceCloudMetadataRequest) {
			v.Items = append(v.Items, localEvidenceCloudMetadataItem{
				EvidenceID: 4, SHA256: strings.Repeat("c", 64), Size: 1,
			}, localEvidenceCloudMetadataItem{
				EvidenceID: 5, SHA256: strings.Repeat("d", 64), Size: 1,
			})
		},
	} {
		t.Run(name, func(t *testing.T) {
			bad := input
			bad.Items = append([]localEvidenceCloudMetadataItem(nil), input.Items...)
			change(&bad)
			hashes, err := localQuarantinedCASHashes(bad)
			if !errors.Is(err, errLocalEvidenceConflict) || len(hashes) != 0 {
				t.Fatalf("invalid hashes=%v err=%v", hashes, err)
			}
		})
	}
}

func TestLocalCASRetentionGuardRequiresTransactionAndMatchingNativeProof(t *testing.T) {
	var server Server
	input := localEvidenceCloudMetadataRequest{
		PreviousSnapshotSHA256: strings.Repeat("1", 64),
		CurrentSnapshotSHA256:  strings.Repeat("2", 64),
		Items: []localEvidenceCloudMetadataItem{
			{EvidenceID: 5, SHA256: strings.Repeat("a", 64), Size: 3},
		},
	}
	proof := localSourceExecutorProof{
		DeviceID: "own-device", RootID: "own-root", SourceRevision: 7,
	}
	_, err := server.checkLocalQuarantinedCASRetentionTx(
		nil, nil, 42, 7, proof, input)
	if !errors.Is(err, errLocalEvidenceConflict) {
		t.Fatalf("nil transaction authorized retention: %v", err)
	}
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/api/v1/sources/42/local-identity/commit-intents/content-preflight", nil)
	_, err = server.checkLocalQuarantinedCASRetentionTx(
		&gorm.DB{}, c, 42, 7, proof, input)
	if !errors.Is(err, errLocalSourceExecutorTransactionUnauthorized) {
		t.Fatalf("owner-only context admitted to CAS locks: %v", err)
	}
	c.Set(localSourceExecutorContextKey, localSourceExecutorProof{
		DeviceID: "foreign-device", RootID: proof.RootID, SourceRevision: 7,
	})
	_, err = server.checkLocalQuarantinedCASRetentionTx(
		&gorm.DB{}, c, 42, 7, proof, input)
	if !errors.Is(err, errLocalSourceExecutorTransactionUnauthorized) {
		t.Fatalf("foreign-device context admitted to CAS locks: %v", err)
	}
	bad := input
	bad.Items = []localEvidenceCloudMetadataItem{
		{EvidenceID: 5, SHA256: strings.Repeat("a", 64), Size: 64<<20 + 1},
	}
	_, err = server.checkLocalQuarantinedCASRetentionTx(
		&gorm.DB{}, c, 42, 7, proof, bad)
	if !errors.Is(err, errLocalEvidenceConflict) {
		t.Fatalf("overbudget claims admitted: %v", err)
	}
}
