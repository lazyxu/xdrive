package api

import (
	"context"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

// observeBoundLocalPushOriginalCASWithPrivatePrecommit is an UNROUTED,
// Server-private physical CAS + original Operation transaction window.
//
// The exact Local Store, not a caller-supplied inspector, must double-hash
// physical CAS while the owning SQL locks are retained. The callback runs
// before SQL COMMIT and cannot escape as an advisory ticket. This function
// deliberately has NO production caller: authenticating and correlating a
// native Agent-held original Writer witness is a separate prerequisite.
// No UI, Agent IPC, HTTP route, retry, second file or SourceRun may call it.
func (s *Server) observeBoundLocalPushOriginalCASWithPrivatePrecommit(
	c *gin.Context, sourceID, revision uint64, proof localSourceExecutorProof,
	stageID, relativeLeaf string, selector *localPushHistoricalOperationPhysicalSelector,
	privateCommit func(context.Context, *gorm.DB, localPushFirstLeafSQLReceipt) error,
) (localPushFirstLeafSQLReceipt, error) {
	var empty localPushFirstLeafSQLReceipt
	if s == nil || s.DB == nil || s.Store == nil ||
		selector == nil || !selector.requireFileTerminalVacant || privateCommit == nil {
		return empty, errLocalPushOperationIntentDenied
	}
	local, ok := s.Store.(*storage.Local)
	if !ok || local == nil {
		return empty, errLocalPushOperationIntentDenied
	}
	return s.readBoundLocalPushFirstLeafReceiptWithPrivatePrecommitTx(
		c, sourceID, revision, proof, stageID, relativeLeaf,
		local.InspectPinnedLocalPushHistoricalCASBeforeCommit,
		privateCommit, selector,
	)
}
