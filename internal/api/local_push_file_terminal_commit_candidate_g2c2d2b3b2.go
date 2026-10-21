package api

import (
	"errors"

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

// localPushOriginalCASPrecommitError preserves only the safe typed outcomes.
// The original physical Local error can include private OS paths or callback
// secrets; never return it over a Server/Agent/UI boundary. A busy CAS pin has
// NOT entered the commit callback; an uncertain result MAY have committed.
// Both remain private and never authorize retries, cancellation or key release.
func localPushOriginalCASPrecommitError(err error) error {
	switch {
	case errors.Is(err, storage.ErrLocalPushCASPrecommitOutcomeUncertain):
		return errors.Join(errLocalPushOperationIntentDenied,
			storage.ErrLocalPushCASPrecommitOutcomeUncertain)
	case errors.Is(err, storage.ErrLocalPushCASPrecommitBusy):
		return errors.Join(errLocalPushOperationIntentDenied,
			storage.ErrLocalPushCASPrecommitBusy)
	default:
		return errLocalPushOperationIntentDenied
	}
}

// observeBoundLocalPushHistoricalPhysicalTerminalCandidate is intentionally
// UNROUTED. It holds the original Operation UPDATE and a SOURCE-WIDE empty
// file-terminal decision slot through a doubly verified pinned physical CAS
// pre-COMMIT check. Only the original read-only SQL transaction is committed
// under the same physical pin; no file-terminal SQL mutation is performed.
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
		local.InspectPinnedLocalPushHistoricalCASBeforeCommit, selector,
	)
	if err != nil {
		return empty, localPushOriginalCASPrecommitError(err)
	}
	// This successful physical inspector has already entered its pinned
	// transaction callback. A subsequent cancellation is NOT a rollback.
	if c.Request.Context().Err() != nil {
		return empty, errors.Join(errLocalPushOperationIntentDenied,
			storage.ErrLocalPushCASPrecommitOutcomeUncertain)
	}
	if receipt.State != localPushFirstLeafSQLReceiptState ||
		receipt.NodeID == 0 || receipt.SourceItemID == 0 {
		return empty, errLocalPushOperationIntentDenied
	}
	return localPushPhysicalTerminalCandidate{
		operationID: operationID, generation: generation, stageID: stageID,
		nodeID: receipt.NodeID, sourceItemID: receipt.SourceItemID,
		physicalCASObserved: true,
	}, nil
}
