package api

import (
	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/storage"
)

// localPushPhysicalTerminalCandidate is a PRIVATE advisory observation only.
// It has no public JSON fields and MUST NOT be reused across transactions as
// a COMMIT/CANCEL ticket: the original SQL locks and physical CAS pin have
// been released when this function returns. Native file evidence is absent.
type localPushPhysicalTerminalCandidate struct {
	operationID         string
	generation          uint64
	stageID             string
	nodeID              uint64
	sourceItemID        uint64
	physicalCASObserved bool
}

// observeBoundLocalPushHistoricalPhysicalTerminalCandidate is intentionally
// UNROUTED. It holds the original Operation UPDATE and a SOURCE-WIDE empty
// file-terminal decision slot through a freshly pinned physical CAS check.
// Every identity is reauthenticated in the same SQL transaction. Neither an
// expired reservation nor a released native OS Writer lock is a physical
// CANCEL witness. This does not write a terminal, retire secrets or enable
// another first file; a future terminal writer must redo all checks under
// its own retained transaction with an independently held native witness.
func (s *Server) observeBoundLocalPushHistoricalPhysicalTerminalCandidate(
	c *gin.Context, sourceID, revision uint64, proof localSourceExecutorProof,
	stageID, relativeLeaf string, requestKey []byte, operationID string, generation uint64,
) (localPushPhysicalTerminalCandidate, error) {
	var empty localPushPhysicalTerminalCandidate
	if s == nil || s.DB == nil || s.Store == nil || c == nil ||
		c.Request == nil || c.Request.Context().Err() != nil ||
		sourceID == 0 || revision == 0 || stageID == "" ||
		generation == 0 || !validLocalPushPrepareOperationUUID(operationID) {
		return empty, errLocalPushOperationIntentDenied
	}
	local, ok := s.Store.(*storage.Local)
	if !ok || local == nil {
		return empty, errLocalPushOperationIntentDenied
	}
	selector := &localPushHistoricalOperationPhysicalSelector{
		requestKey:  append([]byte(nil), requestKey...),
		operationID: operationID, generation: generation,
		requireFileTerminalVacant: true,
	}
	receipt, err := s.readBoundLocalPushFirstLeafReceiptWithCASInspector(
		c, sourceID, revision, proof, stageID, relativeLeaf,
		local.InspectPinnedLocalPushHistoricalCAS, selector,
	)
	if err != nil || c.Request.Context().Err() != nil ||
		receipt.State != localPushFirstLeafSQLReceiptState ||
		receipt.NodeID == 0 || receipt.SourceItemID == 0 {
		return empty, errLocalPushOperationIntentDenied
	}
	return localPushPhysicalTerminalCandidate{
		operationID: operationID, generation: generation, stageID: stageID,
		nodeID: receipt.NodeID, sourceItemID: receipt.SourceItemID,
		physicalCASObserved: true,
	}, nil
}
