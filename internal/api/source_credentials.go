package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourcecredential"
	"gorm.io/gorm"
)

const maxSourceCredentialPayloadBytes = 64 << 10

type sourceCredentialStatusDTO struct {
	Configured bool       `json:"configured"`
	KeyVersion uint32     `json:"key_version,omitempty"`
	UpdatedAt  *time.Time `json:"updated_at,omitempty"`
}

func (s *Server) getSourceCredentialStatus(c *gin.Context) {
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	if _, err := s.ownedSource(userID(c), sourceID); err != nil {
		fail(c, statusForLookup(err), "source not found")
		return
	}

	var row meta.SourceCredential
	if err := s.DB.Where("source_id = ?", sourceID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, sourceCredentialStatusDTO{})
			return
		}
		fail(c, http.StatusInternalServerError, "read source credential status failed")
		return
	}
	updated := row.UpdatedAt
	c.JSON(http.StatusOK, sourceCredentialStatusDTO{
		Configured: true, KeyVersion: row.KeyVersion, UpdatedAt: &updated,
	})
}

func (s *Server) putSourceCredential(c *gin.Context) {
	if s.ConnectorSecrets == nil {
		fail(c, http.StatusServiceUnavailable, "source credential encryption is not configured")
		return
	}
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	source, err := s.ownedSource(userID(c), sourceID)
	if err != nil {
		fail(c, statusForLookup(err), "source not found")
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSourceCredentialPayloadBytes+4096)
	var req struct {
		Payload json.RawMessage `json:"payload"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	if len(req.Payload) == 0 || len(req.Payload) > maxSourceCredentialPayloadBytes {
		fail(c, http.StatusBadRequest, "credential payload must be between 1 byte and 64 KiB")
		return
	}
	var object map[string]any
	if err := json.Unmarshal(req.Payload, &object); err != nil || object == nil {
		fail(c, http.StatusBadRequest, "credential payload must be a JSON object")
		return
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, req.Payload); err != nil {
		fail(c, http.StatusBadRequest, "invalid credential payload")
		return
	}
	if compact.Len() > maxSourceCredentialPayloadBytes {
		fail(c, http.StatusBadRequest, "credential payload exceeds 64 KiB")
		return
	}

	if err := sourcecredential.Put(c.Request.Context(), s.DB, s.ConnectorSecrets, source, compact.Bytes()); err != nil {
		fail(c, http.StatusInternalServerError, "store source credential failed")
		return
	}
	var row meta.SourceCredential
	if err := s.DB.Where("source_id = ?", source.ID).First(&row).Error; err != nil {
		fail(c, http.StatusInternalServerError, "read source credential status failed")
		return
	}
	recordSourceCredentialAudit(c, s.DB, auditpkg.ActionSourceCredentialUpdate, source, row.KeyVersion)
	updated := row.UpdatedAt
	c.JSON(http.StatusOK, sourceCredentialStatusDTO{
		Configured: true, KeyVersion: row.KeyVersion, UpdatedAt: &updated,
	})
}

func (s *Server) deleteSourceCredential(c *gin.Context) {
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	source, err := s.ownedSource(userID(c), sourceID)
	if err != nil {
		fail(c, statusForLookup(err), "source not found")
		return
	}
	if err := sourcecredential.Delete(c.Request.Context(), s.DB, source.ID); err != nil {
		fail(c, http.StatusInternalServerError, "delete source credential failed")
		return
	}
	recordSourceCredentialAudit(c, s.DB, auditpkg.ActionSourceCredentialDelete, source, 0)
	c.Status(http.StatusNoContent)
}

func recordSourceCredentialAudit(c *gin.Context, db *gorm.DB, action string, source meta.Source, keyVersion uint32) {
	user, ok := currentUser(c)
	if !ok {
		return
	}
	uid := user.ID
	metadata := map[string]any{"source_kind": source.Kind}
	if keyVersion != 0 {
		metadata["key_version"] = keyVersion
	}
	if err := auditpkg.Record(db, auditpkg.Event{
		ActorUserID:   &uid,
		ActorUsername: user.Username,
		ActorRole:     user.Role,
		Action:        action,
		TargetType:    "source",
		TargetID:      strconv.FormatUint(source.ID, 10),
		TargetLabel:   source.Name,
		Result:        auditpkg.ResultSuccess,
		RequestID:     c.GetString("requestID"),
		IPAddress:     c.ClientIP(),
		Metadata:      metadata,
	}); err != nil {
		slog.Warn("source_credential_audit_failed", "source_id", source.ID, "action", action, "error", err)
	}
}
