package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourcecredential"
	"github.com/lazyxu/xdrive/internal/yike"
	"gorm.io/gorm"
)

const (
	maxSourceCredentialPayloadBytes = 64 << 10
	sourceCredentialTestTimeout     = 15 * time.Second
)

var (
	errUnsupportedSourceCredentialTest = errors.New("unsupported source credential kind")
	errInvalidSourceCredentialTest     = errors.New("invalid source credential payload")
)

type sourceCredentialTestDTO struct {
	Valid             bool   `json:"valid"`
	Kind              string `json:"kind"`
	AccountExternalID string `json:"account_external_id,omitempty"`
	AccountName       string `json:"account_name,omitempty"`
}

type sourceCredentialTester func(context.Context, string, json.RawMessage) (sourceCredentialTestDTO, error)

type sourceCredentialStatusDTO struct {
	Configured bool       `json:"configured"`
	KeyVersion uint32     `json:"key_version,omitempty"`
	UpdatedAt  *time.Time `json:"updated_at,omitempty"`
}

func (s *Server) testSourceCredential(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSourceCredentialPayloadBytes+4096)
	var req struct {
		Kind    string          `json:"kind"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	req.Kind = strings.TrimSpace(req.Kind)
	if !meta.ValidSourceKind(req.Kind) {
		fail(c, http.StatusBadRequest, "invalid source kind")
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

	tester := s.credentialTest
	if tester == nil {
		tester = defaultSourceCredentialTester
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), sourceCredentialTestTimeout)
	defer cancel()
	result, err := tester(ctx, req.Kind, append(json.RawMessage(nil), compact.Bytes()...))
	if err != nil {
		writeSourceCredentialTestError(c, err)
		return
	}
	result.Valid = true
	result.Kind = req.Kind
	c.JSON(http.StatusOK, result)
}

func writeSourceCredentialTestError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errUnsupportedSourceCredentialTest):
		fail(c, http.StatusBadRequest, "unsupported_source_credential_kind")
	case errors.Is(err, errInvalidSourceCredentialTest):
		fail(c, http.StatusBadRequest, "invalid_source_credential")
	case errors.Is(err, yike.ErrAuthentication):
		fail(c, http.StatusUnprocessableEntity, "yike_auth_failed")
	case errors.Is(err, yike.ErrRateLimited):
		fail(c, http.StatusTooManyRequests, "yike_rate_limited")
	case errors.Is(err, context.DeadlineExceeded):
		fail(c, http.StatusGatewayTimeout, "yike_timeout")
	case errors.Is(err, yike.ErrUnavailable):
		fail(c, http.StatusBadGateway, "yike_unavailable")
	default:
		fail(c, http.StatusBadGateway, "yike_connection_failed")
	}
}

func defaultSourceCredentialTester(ctx context.Context, kind string, payload json.RawMessage) (sourceCredentialTestDTO, error) {
	if kind != "yike_photos" {
		return sourceCredentialTestDTO{}, errUnsupportedSourceCredentialTest
	}
	var credential struct {
		Cookie string `json:"cookie"`
	}
	if err := json.Unmarshal(payload, &credential); err != nil {
		return sourceCredentialTestDTO{}, fmt.Errorf("%w: decode Yike credential: %v", errInvalidSourceCredentialTest, err)
	}
	credential.Cookie = strings.TrimSpace(credential.Cookie)
	if credential.Cookie == "" {
		return sourceCredentialTestDTO{}, fmt.Errorf("%w: Yike cookie is empty", errInvalidSourceCredentialTest)
	}
	client, err := yike.New(credential.Cookie)
	credential.Cookie = ""
	if err != nil {
		return sourceCredentialTestDTO{}, fmt.Errorf("%w: %v", errInvalidSourceCredentialTest, err)
	}
	info, err := client.UserInfo(ctx)
	if err != nil {
		return sourceCredentialTestDTO{}, err
	}
	return sourceCredentialTestDTO{
		Valid: true, Kind: kind,
		AccountExternalID: strings.TrimSpace(info.YouaID),
		AccountName:       strings.TrimSpace(info.Nickname),
	}, nil
}

func (s *Server) testStoredSourceCredential(c *gin.Context) {
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
	plaintext, err := sourcecredential.Get(c.Request.Context(), s.DB, s.ConnectorSecrets, source)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusConflict, "source_credential_not_configured")
			return
		}
		fail(c, http.StatusInternalServerError, "load source credential failed")
		return
	}
	defer clear(plaintext)

	tester := s.credentialTest
	if tester == nil {
		tester = defaultSourceCredentialTester
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), sourceCredentialTestTimeout)
	defer cancel()
	result, err := tester(ctx, source.Kind, json.RawMessage(plaintext))
	if err != nil {
		writeSourceCredentialTestError(c, err)
		return
	}
	result.Valid = true
	result.Kind = source.Kind
	c.JSON(http.StatusOK, result)
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
