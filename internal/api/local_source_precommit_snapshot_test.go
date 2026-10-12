package api

import (
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// L03-E1b0 transaction helpers must NEVER treat a historical read result,
// missing caller context, or an arbitrary device proof as authorization.
func TestLocalQuarantinedMetadataTxScopeRequiresLiveOwningProof(t *testing.T) {
	var server Server
	proof := localSourceExecutorProof{
		DeviceID: "own-device", RootID: "own-root", SourceRevision: 7,
	}
	input := localEvidenceCloudMetadataRequest{
		PreviousSnapshotSHA256: strings.Repeat("1", 64),
		CurrentSnapshotSHA256:  strings.Repeat("2", 64),
		Items: []localEvidenceCloudMetadataItem{{
			EvidenceID: 5, SHA256: strings.Repeat("a", 64), Size: 3,
		}},
	}
	if err := server.checkLocalQuarantinedEvidenceScopeTx(
		nil, nil, 42, 7, proof, input); !errors.Is(err, errLocalEvidenceConflict) {
		t.Fatalf("missing transaction was not rejected: %v", err)
	}
	var out localEvidenceCloudTxSnapshot
	if err := server.checkLocalEvidenceCloudMetadataTx(
		nil, nil, 42, 7, proof, input, &out); !errors.Is(err, errLocalEvidenceConflict) {
		t.Fatalf("missing cloud metadata transaction was accepted: %v", err)
	}
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/api/v1/sources/42/local-identity/commit-intents/content-preflight", nil)
	unbound := &gorm.DB{}
	if err := server.checkLocalQuarantinedEvidenceScopeTx(
		unbound, c, 42, 7, proof, input); !errors.Is(err, errLocalSourceExecutorTransactionUnauthorized) {
		t.Fatalf("owner JWT without native device authority was accepted: %v", err)
	}
	if err := server.checkLocalEvidenceCloudMetadataTx(
		unbound, c, 42, 7, proof, input, &out); !errors.Is(err, errLocalSourceExecutorTransactionUnauthorized) {
		t.Fatalf("metadata precommit accepted missing owning device proof: %v", err)
	}
	c.Set(localSourceExecutorContextKey, localSourceExecutorProof{
		DeviceID: "foreign-device", RootID: "own-root", SourceRevision: 7,
	})
	if err := server.checkLocalQuarantinedEvidenceScopeTx(
		unbound, c, 42, 7, proof, input); !errors.Is(err, errLocalSourceExecutorTransactionUnauthorized) {
		t.Fatalf("foreign device proof accepted: %v", err)
	}
	if err := server.checkLocalEvidenceCloudMetadataTx(
		unbound, c, 42, 7, proof, input, &out); !errors.Is(err, errLocalSourceExecutorTransactionUnauthorized) {
		t.Fatalf("foreign device metadata proof accepted: %v", err)
	}
	if out.revision != 0 || len(out.objects) != 0 {
		t.Fatal("rejected transaction leaked a usable metadata snapshot")
	}
	// Even a supposedly verified Agent claim cannot override invalid
	// bounds; no transaction or network operation should follow.
	input.Items[0].Size = 64<<20 + 1
	if err := server.checkLocalQuarantinedEvidenceScopeTx(
		unbound, c, 42, 7, proof, input); !errors.Is(err, errLocalEvidenceConflict) {
		t.Fatalf("oversized content claim accepted: %v", err)
	}
}
