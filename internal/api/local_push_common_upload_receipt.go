package api

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const localPushCommonReceiptMaxBody = 256

type localPushCommonReceiptSelector struct {
	OperationID string `json:"operation_id"`
	ResumeKey   string `json:"resume_key"`
}

// This private reply is a SQL original-Operation checkpoint, not proof that a
// CAS blob still exists today or a complete backup/SourceRun receipt.
type localPushCommonReceiptDTO struct {
	SourceID           uint64 `json:"source_id"`
	Revision           uint64 `json:"revision"`
	OperationID        string `json:"operation_id"`
	State              string `json:"state"`
	Committed          bool   `json:"committed"`
	NodeID             uint64 `json:"node_id,omitempty"`
	NodeRevision       uint64 `json:"node_revision,omitempty"`
	ContentSHA256      string `json:"content_sha256,omitempty"`
	Size               int64  `json:"size"`
	BackupComplete     bool   `json:"backup_complete"`
	RetirementSafe     bool   `json:"retirement_safe"`
	CurrentCASVerified bool   `json:"current_cas_verified"`
}

func validLocalPushCommonReceiptSelector(sel localPushCommonReceiptSelector) bool {
	if !validLocalPushPrepareOperationUUID(sel.OperationID) ||
		len(sel.ResumeKey) != 68 || !strings.HasPrefix(sel.ResumeKey, "lp2_") {
		return false
	}
	for _, ch := range sel.ResumeKey[4:] {
		if ch < '0' || ch > '9' {
			if ch < 'a' || ch > 'f' {
				return false
			}
		}
	}
	return true
}

// readBoundLocalPushCommonUploadOriginal only trusts current Owner/Device/Root
// and Source proof, then copies the immutable operation row. It never reads
// the mutable current Node nor the 24-hour UploadSession, so a lost ACK and
// later Node version cannot rewrite the original outcome.
func (s *Server) readBoundLocalPushCommonUploadOriginal(
	c *gin.Context, sourceID, revision uint64, sel localPushCommonReceiptSelector,
) (localPushCommonReceiptDTO, error) {
	var out localPushCommonReceiptDTO
	deny := errLocalPushCommonUploadUnavailable
	if s == nil || s.DB == nil || c == nil || c.Request == nil ||
		c.Request.Context().Err() != nil || sourceID == 0 || revision == 0 ||
		!validLocalPushCommonReceiptSelector(sel) {
		return out, deny
	}
	proof, ok := localPushStageProof(c)
	if !ok || proof.SourceRevision != revision {
		return out, deny
	}
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		owner, source, fingerprint, err := s.localPushOperationIntentScopeTx(
			tx, c, sourceID, revision, proof)
		if err != nil || source.TargetNodeID == nil {
			return deny
		}
		var op meta.LocalPushCommonUploadOperation
		// SQL writes progress monotonically (reserved -> bound -> committed).
		// A plain MVCC read is sufficient: concurrent Finalize may still be
		// observed as bound, but an uncommitted terminal is NEVER guessed.
		// Do not acquire an Operation row lock while holding the Source lock:
		// ordinary Finalize locks Operation first and then current Source.
		if err := tx.Where("operation_id = ? AND source_id = ? AND owner_id = ?",
			sel.OperationID, sourceID, owner.ID).Take(&op).Error; err != nil {
			return deny
		}
		if op.ResumeKey != sel.ResumeKey || op.SourceID != sourceID ||
			op.OwnerID != owner.ID || op.OwnerSession != owner.SessionVersion ||
			op.DeviceID != proof.DeviceID || op.RootID != proof.RootID ||
			op.RootFingerprint != fingerprint || op.SourceRevision != revision ||
			op.SourceTargetID != *source.TargetNodeID ||
			op.TotalSize < 0 || !validSHA256(op.ContentSHA256) ||
			(op.TargetParentID == nil) == (op.TargetNodeID == nil) {
			return deny
		}
		out = localPushCommonReceiptDTO{
			SourceID: sourceID, Revision: revision,
			OperationID: op.OperationID, State: op.State,
			BackupComplete: false, RetirementSafe: false,
			CurrentCASVerified: false,
		}
		switch op.State {
		case meta.LocalPushCommonUploadReserved, meta.LocalPushCommonUploadBound:
			if op.CommittedAt != nil || op.ResultNodeID != nil ||
				op.ResultNodeRevision != 0 {
				return deny
			}
		case meta.LocalPushCommonUploadCommitted:
			if op.CommittedAt == nil || op.CommittedAt.IsZero() ||
				op.ResultNodeID == nil || *op.ResultNodeID == 0 ||
				op.ResultNodeRevision == 0 || op.UploadSessionID == nil ||
				*op.UploadSessionID == "" {
				return deny
			}
			out.Committed = true
			out.NodeID = *op.ResultNodeID
			out.NodeRevision = op.ResultNodeRevision
			out.ContentSHA256 = op.ContentSHA256
			out.Size = op.TotalSize
		default:
			return deny
		}
		return c.Request.Context().Err()
	})
	if err != nil {
		return localPushCommonReceiptDTO{}, deny
	}
	return out, nil
}

// A POST-only, no-store owning-Agent private readback. Operation selectors
// stay out of URLs, logs and generic Web/device overview APIs.
func (s *Server) readLocalPushCommonUploadReceipt(c *gin.Context) {
	if c == nil {
		return
	}
	c.Header("Cache-Control", "private, no-store")
	if c.Request == nil || c.Request.URL == nil || c.Request.Body == nil ||
		c.Request.URL.RawQuery != "" {
		fail(c, http.StatusBadRequest, "invalid private common upload receipt")
		return
	}
	kind, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || kind != "application/json" {
		fail(c, http.StatusBadRequest, "invalid private receipt content type")
		return
	}
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid local Source")
		return
	}
	revision, ok := expectedRevision(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, localPushCommonReceiptMaxBody)
	dec := json.NewDecoder(c.Request.Body)
	dec.DisallowUnknownFields()
	var selector localPushCommonReceiptSelector
	if err := dec.Decode(&selector); err != nil || !validLocalPushCommonReceiptSelector(selector) {
		fail(c, http.StatusBadRequest, "invalid private operation selector")
		return
	}
	var trailing any
	if err := dec.Decode(&trailing); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "trailing private operation selector")
		return
	}
	receipt, err := s.readBoundLocalPushCommonUploadOriginal(c, sourceID, revision, selector)
	if err != nil {
		fail(c, http.StatusConflict, "private original operation unavailable")
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, receipt)
}
