package api

import (
	"sort"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

// localQuarantinedCASHashes returns at most four distinct canonical hashes,
// sorted before taking advisory locks. Untrusted owning-Agent claims are
// selectors ONLY: the persisted quarantine and canonical mapping are checked
// again under the SAME caller-controlled transaction.
func localQuarantinedCASHashes(input localEvidenceCloudMetadataRequest) ([]string, error) {
	if !validLocalQuarantinedContentClaims(input) {
		return nil, errLocalEvidenceConflict
	}
	hashes := make([]string, 0, len(input.Items))
	for _, item := range input.Items {
		hashes = append(hashes, item.SHA256)
	}
	sort.Strings(hashes)
	distinct := hashes[:0]
	for _, hash := range hashes {
		if len(distinct) == 0 || distinct[len(distinct)-1] != hash {
			distinct = append(distinct, hash)
		}
	}
	return distinct, nil
}

// checkLocalQuarantinedCASRetentionTx is an INTERNAL, READ-ONLY prerequisite
// for a future authoritative identity writer. It first rechecks owning
// device/Root/Source/quarantine inside the caller's transaction, then takes
// every canonical CAS advisory hash lock in stable order BEFORE joining the
// CAS rows with FOR SHARE. This matches GC's hash-before-row lock order and
// blocks cooperating refcount release/delete until the caller's transaction
// ends. No physical file I/O is performed under SQL locks.
//
// The returned snapshot is ONLY a verified DB observation. A future writer
// must independently prove current native + physical CAS bytes, do every
// canonical mutation and corresponding reference accounting atomically
// within the SAME transaction, and use an idempotent crash-safe protocol.
// Calling this guard alone does NOT retain or increment any reference, grant
// commit authority, activate local-folder runs or produce an upload token.
func (s *Server) checkLocalQuarantinedCASRetentionTx(
	tx *gorm.DB, c *gin.Context, sourceID, revision uint64,
	proof localSourceExecutorProof, input localEvidenceCloudMetadataRequest,
) (localEvidenceCloudTxSnapshot, error) {
	empty := localEvidenceCloudTxSnapshot{}
	if tx == nil || c == nil || c.Request == nil || sourceID == 0 || revision == 0 {
		return empty, errLocalEvidenceConflict
	}
	hashes, err := localQuarantinedCASHashes(input)
	if err != nil {
		return empty, err
	}
	boundValue, exists := c.Get(localSourceExecutorContextKey)
	bound, ok := boundValue.(localSourceExecutorProof)
	if !exists || !ok || bound != proof || proof.DeviceID == "" ||
		proof.RootID == "" || proof.SourceRevision != revision {
		return empty, errLocalSourceExecutorTransactionUnauthorized
	}
	// Device -> Source -> Root -> quarantine comes BEFORE every CAS hash.
	if err := s.checkLocalQuarantinedEvidenceScopeTx(
		tx, c, sourceID, revision, proof, input); err != nil {
		return empty, err
	}
	for _, hash := range hashes {
		if err := lockContentHash(tx, hash); err != nil {
			return empty, err
		}
	}
	// Hash locks are now held for the transaction lifetime. The CAS metadata
	// JOIN and SourceItem/alias checks run only after these locks are taken.
	var snapshot localEvidenceCloudTxSnapshot
	if err := s.checkLocalEvidenceCloudMetadataTx(
		tx, c, sourceID, revision, proof, input, &snapshot); err != nil {
		return empty, err
	}
	if snapshot.revision != revision || len(snapshot.objects) != len(input.Items) {
		return empty, errLocalEvidenceConflict
	}
	for i, object := range snapshot.objects {
		key, err := storage.ContentAddressedKey(input.Items[i].SHA256)
		if err != nil || object.Key != key ||
			object.SHA256 != input.Items[i].SHA256 ||
			object.Size != input.Items[i].Size {
			return empty, errLocalEvidenceConflict
		}
	}
	if err := c.Request.Context().Err(); err != nil {
		return empty, err
	}
	return snapshot, nil
}
