package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/synology"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const maxSourceConnectorConfigBytes = 16 << 10

var errUnsupportedSourceConnectorConfig = errors.New("unsupported source connector config")

type sourceConnectorConfigDTO struct {
	Configured bool            `json:"configured"`
	Revision   uint64          `json:"revision"`
	Payload    json.RawMessage `json:"payload"`
	UpdatedAt  *time.Time      `json:"updated_at,omitempty"`
}

func defaultSourceConnectorConfig(source meta.Source) (json.RawMessage, error) {
	if source.Kind == synologySourceKind && source.Direction == meta.SourceDirectionPull {
		return json.Marshal(synology.DefaultPullConfig())
	}
	return nil, errUnsupportedSourceConnectorConfig
}

func normalizeSourceConnectorConfig(source meta.Source, payload json.RawMessage) (json.RawMessage, error) {
	if source.Kind != synologySourceKind || source.Direction != meta.SourceDirectionPull {
		return nil, errUnsupportedSourceConnectorConfig
	}
	if len(payload) == 0 || len(payload) > maxSourceConnectorConfigBytes {
		return nil, errInvalidSourceConfig
	}
	config, err := synology.ParsePullConfig(payload)
	if err != nil {
		return nil, errInvalidSourceConfig
	}
	return json.Marshal(config)
}

func (s *Server) getSourceConnectorConfig(c *gin.Context) {
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

	var row meta.SourceConnectorConfig
	err = s.DB.Where("source_id = ?", sourceID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		payload, defaultErr := defaultSourceConnectorConfig(source)
		if errors.Is(defaultErr, errUnsupportedSourceConnectorConfig) {
			fail(c, http.StatusBadRequest, "source_connector_config_unsupported")
			return
		}
		if defaultErr != nil {
			fail(c, http.StatusInternalServerError, "load source connector config failed")
			return
		}
		c.Header("ETag", strconv.Quote("1"))
		c.JSON(http.StatusOK, sourceConnectorConfigDTO{
			Configured: false, Revision: 1, Payload: payload,
		})
		return
	}
	if err != nil {
		fail(c, http.StatusInternalServerError, "load source connector config failed")
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(row.Revision, 10)))
	updated := row.UpdatedAt
	c.JSON(http.StatusOK, sourceConnectorConfigDTO{
		Configured: true, Revision: row.Revision,
		Payload: json.RawMessage(row.Payload), UpdatedAt: &updated,
	})
}

func (s *Server) putSourceConnectorConfig(c *gin.Context) {
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	source, err := s.ownedSource(userID(c), sourceID)
	if err != nil {
		fail(c, statusForLookup(err), "source not found")
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSourceConnectorConfigBytes+4096)
	var req struct {
		Payload json.RawMessage `json:"payload"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	payload, err := normalizeSourceConnectorConfig(source, req.Payload)
	if errors.Is(err, errUnsupportedSourceConnectorConfig) {
		fail(c, http.StatusBadRequest, "source_connector_config_unsupported")
		return
	}
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid_source_connector_config")
		return
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, payload); err != nil {
		fail(c, http.StatusBadRequest, "invalid_source_connector_config")
		return
	}

	var out meta.SourceConnectorConfig
	var currentRevision uint64
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var row meta.SourceConnectorConfig
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("source_id = ?", sourceID).First(&row).Error
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			currentRevision = 1
			if expected != currentRevision {
				return errRevisionConflict
			}
			out = meta.SourceConnectorConfig{
				SourceID: sourceID, Payload: compact.String(), Revision: currentRevision + 1,
			}
			return tx.Create(&out).Error
		case err != nil:
			return err
		default:
			currentRevision = row.Revision
			if expected != currentRevision {
				return errRevisionConflict
			}
			next := currentRevision + 1
			if err := tx.Model(&meta.SourceConnectorConfig{}).Where("source_id = ?", sourceID).
				Updates(map[string]any{
					"payload": compact.String(), "revision": next, "updated_at": time.Now().UTC(),
				}).Error; err != nil {
				return err
			}
			return tx.Where("source_id = ?", sourceID).First(&out).Error
		}
	})
	if errors.Is(err, errRevisionConflict) {
		revisionConflict(c, expected, currentRevision)
		return
	}
	if err != nil {
		fail(c, http.StatusInternalServerError, "store source connector config failed")
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(out.Revision, 10)))
	updated := out.UpdatedAt
	c.JSON(http.StatusOK, sourceConnectorConfigDTO{
		Configured: true, Revision: out.Revision,
		Payload: json.RawMessage(out.Payload), UpdatedAt: &updated,
	})
}
