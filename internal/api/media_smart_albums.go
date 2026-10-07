package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type mediaSmartAlbumQuery struct {
	MediaKind      string     `json:"media_kind,omitempty"`
	Search         string     `json:"search,omitempty"`
	AssetKind      string     `json:"asset_kind,omitempty"`
	Category       string     `json:"category,omitempty"`
	CapturedFrom   *time.Time `json:"captured_from,omitempty"`
	CapturedTo     *time.Time `json:"captured_to,omitempty"`
	HasLocation    *bool      `json:"has_location,omitempty"`
	Favorite       *bool      `json:"favorite,omitempty"`
	Tag            string     `json:"tag,omitempty"`
	Person         string     `json:"person,omitempty"`
	PersonIdentity string     `json:"person_identity,omitempty"`
	Place          string     `json:"place,omitempty"`
}

func normalizeMediaSmartAlbumQuery(
	value mediaSmartAlbumQuery,
) (mediaSmartAlbumQuery, error) {
	value.MediaKind = strings.TrimSpace(value.MediaKind)
	if value.MediaKind != "" &&
		value.MediaKind != meta.MediaKindImage &&
		value.MediaKind != meta.MediaKindVideo {
		return mediaSmartAlbumQuery{}, fmt.Errorf("media_kind must be image or video")
	}
	value.Search = strings.TrimSpace(value.Search)
	if len([]rune(value.Search)) > mediaSearchMaxRunes {
		return mediaSmartAlbumQuery{}, fmt.Errorf("search must be at most %d characters", mediaSearchMaxRunes)
	}
	value.AssetKind = strings.TrimSpace(value.AssetKind)
	if value.AssetKind != "" && !meta.ValidPhotoAssetKind(value.AssetKind) {
		return mediaSmartAlbumQuery{}, fmt.Errorf("asset_kind is invalid")
	}
	value.Category = strings.TrimSpace(value.Category)
	if value.Category != "" && !validMediaCategory(value.Category) {
		return mediaSmartAlbumQuery{}, fmt.Errorf("category is invalid")
	}
	value.Place = strings.TrimSpace(value.Place)
	if value.Place != "" {
		if _, ok := parseMediaPlaceKey(value.Place); !ok {
			return mediaSmartAlbumQuery{}, fmt.Errorf("place is invalid")
		}
	}
	if value.Tag != "" {
		normalized, err := normalizeMediaTag(value.Tag)
		if err != nil {
			return mediaSmartAlbumQuery{}, err
		}
		value.Tag = normalized
	}
	if value.Person != "" {
		normalized, err := normalizeMediaPerson(value.Person)
		if err != nil {
			return mediaSmartAlbumQuery{}, err
		}
		value.Person = normalized
	}
	value.PersonIdentity = strings.TrimSpace(value.PersonIdentity)
	if value.PersonIdentity != "" && !validMediaPersonIdentityID(value.PersonIdentity) {
		return mediaSmartAlbumQuery{}, fmt.Errorf("person_identity is invalid")
	}
	if value.CapturedFrom != nil {
		normalized := value.CapturedFrom.UTC()
		value.CapturedFrom = &normalized
	}
	if value.CapturedTo != nil {
		normalized := value.CapturedTo.UTC()
		value.CapturedTo = &normalized
	}
	if value.CapturedFrom != nil && value.CapturedTo != nil &&
		!value.CapturedFrom.Before(*value.CapturedTo) {
		return mediaSmartAlbumQuery{}, fmt.Errorf("captured_from must be before captured_to")
	}
	if value.empty() {
		return mediaSmartAlbumQuery{}, fmt.Errorf("smart album query must contain at least one filter")
	}
	return value, nil
}

func (value mediaSmartAlbumQuery) empty() bool {
	return value.MediaKind == "" &&
		value.Search == "" &&
		value.AssetKind == "" &&
		value.Category == "" &&
		value.CapturedFrom == nil &&
		value.CapturedTo == nil &&
		value.HasLocation == nil &&
		value.Favorite == nil &&
		value.Tag == "" &&
		value.Person == "" &&
		value.PersonIdentity == "" &&
		value.Place == ""
}

func (value mediaSmartAlbumQuery) options() mediaQueryOptions {
	var place *mediaPlaceCell
	if value.Place != "" {
		if parsed, ok := parseMediaPlaceKey(value.Place); ok {
			place = &parsed
		}
	}
	return mediaQueryOptions{
		MediaKind:      value.MediaKind,
		Search:         value.Search,
		AssetKind:      value.AssetKind,
		Category:       value.Category,
		CapturedFrom:   value.CapturedFrom,
		CapturedTo:     value.CapturedTo,
		HasLocation:    value.HasLocation,
		Favorite:       value.Favorite,
		Tag:            value.Tag,
		Person:         value.Person,
		PersonIdentity: value.PersonIdentity,
		Place:          place,
	}
}

func encodeMediaSmartAlbumQuery(value mediaSmartAlbumQuery) (string, error) {
	normalized, err := normalizeMediaSmartAlbumQuery(value)
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(normalized)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func decodeMediaSmartAlbumQuery(raw string) (mediaSmartAlbumQuery, error) {
	var value mediaSmartAlbumQuery
	if strings.TrimSpace(raw) == "" {
		return value, fmt.Errorf("smart album query is missing")
	}
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return mediaSmartAlbumQuery{}, fmt.Errorf("smart album query is invalid")
	}
	return normalizeMediaSmartAlbumQuery(value)
}

var errMediaSmartAlbumPersonIdentityNotFound = fmt.Errorf("smart album durable person not found")

func lockMediaSmartAlbumPersonIdentity(
	tx *gorm.DB,
	ownerID uint64,
	query mediaSmartAlbumQuery,
) error {
	if query.PersonIdentity == "" {
		return nil
	}
	var person meta.PhotoPerson
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("id").
		Where("owner_id = ? AND person_key = ?", ownerID, query.PersonIdentity).
		First(&person).Error
	if err == gorm.ErrRecordNotFound {
		return errMediaSmartAlbumPersonIdentityNotFound
	}
	return err
}

func rewriteMediaSmartAlbumPersonIdentityReferences(
	tx *gorm.DB,
	ownerID uint64,
	sourceIDs []string,
	targetID string,
	now time.Time,
) error {
	if len(sourceIDs) == 0 {
		return nil
	}
	sources := make(map[string]struct{}, len(sourceIDs))
	for _, sourceID := range sourceIDs {
		sources[sourceID] = struct{}{}
	}
	var collections []meta.PhotoCollection
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"owner_id = ? AND kind = ? AND state = ?",
			ownerID,
			meta.PhotoCollectionKindSmart,
			meta.PhotoCollectionStateActive,
		).
		Find(&collections).Error; err != nil {
		return err
	}
	for _, collection := range collections {
		query, err := decodeMediaSmartAlbumQuery(collection.QueryJSON)
		if err != nil {
			return fmt.Errorf("decode smart album %s: %w", collection.ExternalKey, err)
		}
		if _, ok := sources[query.PersonIdentity]; !ok {
			continue
		}
		query.PersonIdentity = targetID
		encoded, err := encodeMediaSmartAlbumQuery(query)
		if err != nil {
			return fmt.Errorf("encode smart album %s: %w", collection.ExternalKey, err)
		}
		if err := tx.Model(&meta.PhotoCollection{}).
			Where("id = ? AND revision = ?", collection.ID, collection.Revision).
			Updates(map[string]any{
				"query_json": encoded,
				"revision":   gorm.Expr("revision + 1"),
				"updated_at": now,
			}).Error; err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) createSmartMediaAlbum(c *gin.Context) {
	var input struct {
		Name  string               `json:"name"`
		Query mediaSmartAlbumQuery `json:"query"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	name, err := normalizeMediaAlbumName(input.Name)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	normalizedQuery, err := normalizeMediaSmartAlbumQuery(input.Query)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	queryJSON, err := encodeMediaSmartAlbumQuery(normalizedQuery)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	now := time.Now().UTC()
	collection := meta.PhotoCollection{
		OwnerID:     userID(c),
		ExternalKey: meta.PhotoCollectionKindSmart + ":" + uuid.NewString(),
		Kind:        meta.PhotoCollectionKindSmart,
		Name:        name,
		State:       meta.PhotoCollectionStateActive,
		Revision:    1,
		QueryJSON:   queryJSON,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := lockMediaSmartAlbumPersonIdentity(tx, collection.OwnerID, normalizedQuery); err != nil {
			return err
		}
		return tx.Create(&collection).Error
	})
	if err != nil {
		if err == errMediaSmartAlbumPersonIdentityNotFound {
			fail(c, http.StatusBadRequest, "person_identity must reference an existing durable person")
		} else {
			fail(c, http.StatusInternalServerError, "create smart media album failed")
		}
		return
	}
	album, err := s.mediaAlbumDTOByKey(
		c.Request.Context(),
		collection.OwnerID,
		collection.ExternalKey,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load smart media album failed")
		return
	}
	c.Header("ETag", fmt.Sprintf("\"%d\"", album.Revision))
	c.JSON(http.StatusCreated, album)
}

func (s *Server) updateSmartMediaAlbum(c *gin.Context) {
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	key := strings.TrimSpace(c.Param("albumID"))
	if !strings.HasPrefix(key, meta.PhotoCollectionKindSmart+":") {
		fail(c, http.StatusConflict, "only smart albums can be updated here")
		return
	}
	var input struct {
		Name  *string               `json:"name,omitempty"`
		Query *mediaSmartAlbumQuery `json:"query,omitempty"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	if input.Name == nil && input.Query == nil {
		fail(c, http.StatusBadRequest, "name or query is required")
		return
	}
	var name *string
	if input.Name != nil {
		normalized, err := normalizeMediaAlbumName(*input.Name)
		if err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		name = &normalized
	}
	var normalizedQuery *mediaSmartAlbumQuery
	var queryJSON *string
	if input.Query != nil {
		value, err := normalizeMediaSmartAlbumQuery(*input.Query)
		if err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		encoded, err := encodeMediaSmartAlbumQuery(value)
		if err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		normalizedQuery = &value
		queryJSON = &encoded
	}

	var currentRevision uint64
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if normalizedQuery != nil {
			if err := lockMediaSmartAlbumPersonIdentity(tx, userID(c), *normalizedQuery); err != nil {
				return err
			}
		}
		var collection meta.PhotoCollection
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"owner_id = ? AND external_key = ? AND kind = ? AND state = ?",
				userID(c),
				key,
				meta.PhotoCollectionKindSmart,
				meta.PhotoCollectionStateActive,
			).
			First(&collection).Error; err != nil {
			return err
		}
		currentRevision = collection.Revision
		if collection.Revision != expected {
			return errRevisionConflict
		}
		updates := map[string]any{}
		if name != nil && collection.Name != *name {
			updates["name"] = *name
		}
		if queryJSON != nil && collection.QueryJSON != *queryJSON {
			updates["query_json"] = *queryJSON
		}
		if len(updates) == 0 {
			return nil
		}
		updates["revision"] = gorm.Expr("revision + 1")
		updates["updated_at"] = time.Now().UTC()
		return tx.Model(&meta.PhotoCollection{}).
			Where("id = ? AND revision = ?", collection.ID, expected).
			Updates(updates).Error
	})
	if err != nil {
		if err == errRevisionConflict {
			revisionConflict(c, expected, currentRevision)
			return
		}
		if err == errMediaSmartAlbumPersonIdentityNotFound {
			fail(c, http.StatusBadRequest, "person_identity must reference an existing durable person")
			return
		}
		if err == gorm.ErrRecordNotFound {
			fail(c, http.StatusNotFound, "smart media album not found")
			return
		}
		fail(c, http.StatusInternalServerError, "update smart media album failed")
		return
	}
	album, err := s.mediaAlbumDTOByKey(c.Request.Context(), userID(c), key)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load smart media album failed")
		return
	}
	c.Header("ETag", fmt.Sprintf("\"%d\"", album.Revision))
	c.JSON(http.StatusOK, album)
}

func (s *Server) deleteSmartMediaAlbum(c *gin.Context) {
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	key := strings.TrimSpace(c.Param("albumID"))
	if !strings.HasPrefix(key, meta.PhotoCollectionKindSmart+":") {
		fail(c, http.StatusConflict, "only smart albums can be deleted here")
		return
	}
	var currentRevision uint64
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var collection meta.PhotoCollection
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"owner_id = ? AND external_key = ? AND kind = ?",
				userID(c),
				key,
				meta.PhotoCollectionKindSmart,
			).
			First(&collection).Error; err != nil {
			return err
		}
		currentRevision = collection.Revision
		if collection.Revision != expected {
			return errRevisionConflict
		}
		return tx.Delete(&collection).Error
	})
	if err != nil {
		if err == errRevisionConflict {
			revisionConflict(c, expected, currentRevision)
			return
		}
		if err == gorm.ErrRecordNotFound {
			fail(c, http.StatusNotFound, "smart media album not found")
			return
		}
		fail(c, http.StatusInternalServerError, "delete smart media album failed")
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) smartMediaAlbumStats(
	ctx context.Context,
	ownerID uint64,
	query mediaSmartAlbumQuery,
) (int64, *uint64, error) {
	base := s.DB.WithContext(ctx).
		Model(&meta.MediaMetadata{}).
		Joins(
			"JOIN xd_photo_assets AS pa ON pa.primary_node_id = xd_media_metadata.node_id AND pa.owner_id = ?",
			ownerID,
		).
		Joins("JOIN xd_nodes AS n ON n.id = xd_media_metadata.node_id AND n.deleted_at IS NULL").
		Joins("JOIN xd_photo_metadata AS pm ON pm.asset_id = pa.id").
		Where(
			"xd_media_metadata.owner_id = ? AND xd_media_metadata.media_kind IN ?",
			ownerID,
			[]string{meta.MediaKindImage, meta.MediaKindVideo},
		)
	base = applyMediaQueryFilters(base, query.options())

	var count int64
	if err := base.Session(&gorm.Session{}).
		Distinct("pa.id").
		Count(&count).Error; err != nil {
		return 0, nil, err
	}

	thumbnailMIMEs := []string{
		"image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
		"image/tiff", "image/bmp", "image/heic", "image/heif", "image/x-adobe-dng",
	}
	type coverRow struct {
		NodeID uint64
	}
	var cover coverRow
	err := base.Session(&gorm.Session{}).
		Select("pa.primary_node_id AS node_id").
		Where("lower(xd_media_metadata.mime_type) IN ?", thumbnailMIMEs).
		Order("COALESCE(xd_media_metadata.captured_at, n.created_at) DESC, n.id DESC").
		Limit(1).
		Scan(&cover).Error
	if err != nil {
		return 0, nil, err
	}
	if cover.NodeID == 0 {
		return count, nil, nil
	}
	return count, &cover.NodeID, nil
}
