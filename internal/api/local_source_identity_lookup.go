package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"unicode"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"gorm.io/gorm"
)

const (
	localIdentityLookupLimit    = 128
	localIdentityLookupMaxBytes = 80 << 10
)

// Only a credential-verified owning Agent may perform this bounded
// READ-ONLY lookup. The indices map to its request order; raw local paths,
// fingerprints, external IDs and Node IDs are never reflected in the reply.
type localIdentityLookupRequest struct {
	Identities []string `json:"identities"`
}

type localIdentityLookupMatch struct {
	Index        int    `json:"index"`
	SourceItemID uint64 `json:"source_item_id"`
}

type localIdentityLookupResponse struct {
	SourceID             uint64                     `json:"source_id"`
	Revision             uint64                     `json:"revision"`
	InputCount           int                        `json:"input_count"`
	Matches              []localIdentityLookupMatch `json:"matches"`
	Authoritative        bool                       `json:"authoritative"`
	MissingInferenceSafe bool                       `json:"missing_inference_safe"`
}

var errLocalIdentityLookupConflict = errors.New("local identity lookup conflict")

func validLocalIdentityLookupIDs(values []string) bool {
	if len(values) == 0 || len(values) > localIdentityLookupLimit {
		return false
	}
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		normalized, err := sourcepkg.ValidateExternalID(value)
		if err != nil || normalized != value || !utf8.ValidString(value) {
			return false
		}
		for _, char := range value {
			if unicode.IsControl(char) {
				return false
			}
		}
		if _, exists := seen[value]; exists {
			return false
		}
		seen[value] = struct{}{}
	}
	return true
}

// The authoritative SourceItem ID is only a point-in-time READ result.
// It is not a reconciliation approval, commit token, alias mutation,
// SourceRun checkpoint, content proof or Mirror deletion evidence.
func (s *Server) localSourceIdentityLookup(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid local Source ID")
		return
	}
	if _, exists := c.Get(localSourceExecutorContextKey); !exists {
		fail(c, http.StatusForbidden, "owning device and authorized Root required")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, localIdentityLookupMaxBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var input localIdentityLookupRequest
	if err := decoder.Decode(&input); err != nil || !validLocalIdentityLookupIDs(input.Identities) {
		fail(c, http.StatusBadRequest, "invalid or oversized local identity lookup request")
		return
	}
	var tail any
	if err := decoder.Decode(&tail); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "local identity lookup contains trailing content")
		return
	}
	indexByIdentity := make(map[string]uint64, len(input.Identities))
	bind := func(identity string, itemID uint64) error {
		if itemID == 0 {
			return errLocalIdentityLookupConflict
		}
		if previous, exists := indexByIdentity[identity]; exists && previous != itemID {
			return errLocalIdentityLookupConflict
		}
		indexByIdentity[identity] = itemID
		return nil
	}
	var revision uint64
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// Locks are ordered device -> Source -> binding, like revocation.
		// A token-revoked, different-Root or stale-Source client fails closed.
		if err := s.requireLocalSourceProofTx(tx, c, id, "", false); err != nil {
			return err
		}
		var source meta.Source
		if err := tx.Select("id", "owner_id", "kind", "direction", "status", "revision").
			Where("id = ? AND owner_id = ?", id, userID(c)).Take(&source).Error; err != nil {
			return err
		}
		revision = source.Revision
		if !isLocalFolderPush(source) {
			return errLocalBindingTypeInvalid
		}
		if source.Revision != expected {
			return errRevisionConflict
		}
		if source.Status != meta.SourceStatusPaused {
			return errLocalBindingStateInvalid
		}
		// Existing identities, always scoped by SourceID; never list source
		// paths or return arbitrary SourceItem/Node contracts.
		var canonical []meta.SourceItem
		if err := tx.Select("id", "source_id", "external_id").
			Where("source_id = ? AND external_id IN ?", id, input.Identities).
			Find(&canonical).Error; err != nil {
			return err
		}
		for _, item := range canonical {
			if err := bind(item.ExternalID, item.ID); err != nil {
				return err
			}
		}
		var aliases []meta.SourceItemAlias
		if err := tx.Select("source_item_id", "alias_external_id").
			Where("source_id = ? AND alias_kind = ? AND alias_external_id IN ?",
				id, meta.SourceItemAliasKindExternalID, input.Identities).
			Find(&aliases).Error; err != nil {
			return err
		}
		if len(aliases) != 0 {
			aliasItemIDs := make([]uint64, 0, len(aliases))
			seenIDs := make(map[uint64]struct{}, len(aliases))
			for _, alias := range aliases {
				if _, exists := seenIDs[alias.SourceItemID]; !exists {
					aliasItemIDs = append(aliasItemIDs, alias.SourceItemID)
					seenIDs[alias.SourceItemID] = struct{}{}
				}
			}
			// An alias to a deleted/different-Source item is a conflict,
			// never a newly inferred identity.
			var targets []meta.SourceItem
			if err := tx.Select("id").
				Where("source_id = ? AND id IN ?", id, aliasItemIDs).
				Find(&targets).Error; err != nil {
				return err
			}
			if len(targets) != len(aliasItemIDs) {
				return errLocalIdentityLookupConflict
			}
			for _, alias := range aliases {
				if err := bind(alias.AliasExternalID, alias.SourceItemID); err != nil {
					return err
				}
			}
		}
		return c.Request.Context().Err()
	})
	if err != nil {
		switch {
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, expected, revision)
		case errors.Is(err, errLocalSourceExecutorTransactionUnauthorized):
			fail(c, http.StatusForbidden, "owning device or local Root is not authorized")
		case errors.Is(err, errLocalIdentityLookupConflict):
			fail(c, http.StatusConflict, "ambiguous or invalid SourceItem identity")
		case errors.Is(err, errLocalBindingStateInvalid):
			fail(c, http.StatusConflict, "local Source must remain paused")
		case errors.Is(err, errLocalBindingTypeInvalid):
			fail(c, http.StatusForbidden, "local Push Source required")
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "local Source not found")
		default:
			fail(c, http.StatusInternalServerError, "local identity lookup failed")
		}
		return
	}
	out := localIdentityLookupResponse{
		SourceID: id, Revision: revision, InputCount: len(input.Identities),
		Matches:       make([]localIdentityLookupMatch, 0, len(input.Identities)),
		Authoritative: false, MissingInferenceSafe: false,
	}
	for index, identity := range input.Identities {
		if itemID, exists := indexByIdentity[identity]; exists {
			out.Matches = append(out.Matches, localIdentityLookupMatch{Index: index, SourceItemID: itemID})
		}
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, out)
}
