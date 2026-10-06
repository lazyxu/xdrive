package api

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	mediaPersonIdentityKeyPrefix = "person:v1:"
	mediaPersonIdentityMaxLimit  = 100
	mediaPersonIdentityMaxBatch  = 500
	mediaPersonIdentityMaxMerge  = 32
)

type mediaPersonIdentityDTO struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Hidden      bool       `json:"hidden"`
	Revision    uint64     `json:"revision"`
	ItemCount   int64      `json:"item_count"`
	CoverNodeID *uint64    `json:"cover_node_id,omitempty"`
	UpdatedAt   *time.Time `json:"updated_at,omitempty"`
}

type mediaPersonSplitDTO struct {
	Source  mediaPersonIdentityDTO `json:"source"`
	Created mediaPersonIdentityDTO `json:"created"`
}

func newMediaPersonIdentityKey() string {
	return mediaPersonIdentityKeyPrefix + uuid.NewString()
}

func validMediaPersonIdentityID(value string) bool {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, mediaPersonIdentityKeyPrefix) {
		return false
	}
	raw := strings.TrimPrefix(value, mediaPersonIdentityKeyPrefix)
	_, err := uuid.Parse(raw)
	return err == nil
}

func normalizeMediaPersonIdentityName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	return normalizeMediaPerson(value)
}

func normalizeMediaPersonIdentityNodeIDs(values []uint64) ([]uint64, error) {
	if len(values) == 0 || len(values) > mediaPersonIdentityMaxBatch {
		return nil, fmt.Errorf(
			"node_ids must contain between 1 and %d items",
			mediaPersonIdentityMaxBatch,
		)
	}
	seen := make(map[uint64]struct{}, len(values))
	out := make([]uint64, 0, len(values))
	for _, value := range values {
		if value == 0 {
			return nil, fmt.Errorf("node_ids contains an invalid id")
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out, nil
}

func normalizeMediaPersonIdentityIDs(values []string) ([]string, error) {
	if len(values) == 0 || len(values) > mediaPersonIdentityMaxMerge {
		return nil, fmt.Errorf(
			"source_ids must contain between 1 and %d items",
			mediaPersonIdentityMaxMerge,
		)
	}
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if !validMediaPersonIdentityID(value) {
			return nil, fmt.Errorf("source_ids contains an invalid person id")
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Strings(out)
	return out, nil
}

func (s *Server) listMediaPersonIdentities(c *gin.Context) {
	includeHidden := false
	if raw := strings.TrimSpace(c.Query("include_hidden")); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			fail(c, http.StatusBadRequest, "include_hidden must be true or false")
			return
		}
		includeHidden = value
	}
	limit := mediaPersonIdentityMaxLimit
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > mediaPersonIdentityMaxLimit {
			fail(c, http.StatusBadRequest, "limit must be between 1 and 100")
			return
		}
		limit = value
	}
	offset := 0
	if raw := strings.TrimSpace(c.Query("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			fail(c, http.StatusBadRequest, "offset must be zero or greater")
			return
		}
		offset = value
	}
	items, err := queryMediaPersonIdentities(
		c.Request.Context(),
		s.DB,
		userID(c),
		includeHidden,
		limit,
		offset,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "list people failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, items)
}

type mediaPersonIdentityQueryRow struct {
	ID          string
	Name        string
	Hidden      bool
	Revision    uint64
	ItemCount   int64
	CoverNodeID *uint64
	UpdatedAt   *time.Time
}

func mediaPersonIdentityQuery(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
) *gorm.DB {
	return db.WithContext(ctx).
		Table("xd_photo_people AS p").
		Select(
			"p.person_key AS id, p.name, p.hidden, p.revision, "+
				"COUNT(DISTINCT CASE WHEN n.deleted_at IS NULL THEN ppa.asset_id END) AS item_count, "+
				"COALESCE("+
				"(SELECT cover_asset.primary_node_id "+
				"FROM xd_photo_assets AS cover_asset "+
				"JOIN xd_photo_person_assets AS cover_membership "+
				"ON cover_membership.person_id = p.id AND cover_membership.asset_id = cover_asset.id "+
				"JOIN xd_nodes AS cover_node ON cover_node.id = cover_asset.primary_node_id "+
				"WHERE cover_asset.id = p.cover_asset_id "+
				"AND cover_asset.owner_id = p.owner_id "+
				"AND cover_node.deleted_at IS NULL LIMIT 1), "+
				"(SELECT fallback_asset.primary_node_id "+
				"FROM xd_photo_person_assets AS fallback_membership "+
				"JOIN xd_photo_assets AS fallback_asset ON fallback_asset.id = fallback_membership.asset_id "+
				"JOIN xd_nodes AS fallback_node ON fallback_node.id = fallback_asset.primary_node_id "+
				"WHERE fallback_membership.person_id = p.id "+
				"AND fallback_asset.owner_id = p.owner_id "+
				"AND fallback_node.deleted_at IS NULL "+
				"ORDER BY fallback_asset.updated_at DESC, fallback_asset.id DESC LIMIT 1)"+
				") AS cover_node_id, p.updated_at",
		).
		Joins("LEFT JOIN xd_photo_person_assets AS ppa ON ppa.person_id = p.id").
		Joins("LEFT JOIN xd_photo_assets AS pa ON pa.id = ppa.asset_id").
		Joins("LEFT JOIN xd_nodes AS n ON n.id = pa.primary_node_id").
		Where("p.owner_id = ?", ownerID).
		Group("p.id, p.person_key, p.name, p.hidden, p.revision, p.cover_asset_id, p.updated_at")
}

func mediaPersonIdentityDTOFromRow(
	row mediaPersonIdentityQueryRow,
) mediaPersonIdentityDTO {
	return mediaPersonIdentityDTO{
		ID:          row.ID,
		Name:        row.Name,
		Hidden:      row.Hidden,
		Revision:    row.Revision,
		ItemCount:   row.ItemCount,
		CoverNodeID: row.CoverNodeID,
		UpdatedAt:   row.UpdatedAt,
	}
}

func queryMediaPersonIdentities(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
	includeHidden bool,
	limit, offset int,
) ([]mediaPersonIdentityDTO, error) {
	if db == nil || ownerID == 0 {
		return nil, fmt.Errorf("person identity query is not configured")
	}
	if limit <= 0 || limit > mediaPersonIdentityMaxLimit {
		limit = mediaPersonIdentityMaxLimit
	}
	query := mediaPersonIdentityQuery(ctx, db, ownerID)
	if !includeHidden {
		query = query.Where("p.hidden = false")
	}
	var rows []mediaPersonIdentityQueryRow
	if err := query.
		Order(
			"CASE WHEN p.name = '' THEN 1 ELSE 0 END ASC, " +
				"LOWER(p.name) ASC, item_count DESC, p.updated_at DESC, p.person_key ASC",
		).
		Limit(limit).
		Offset(offset).
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]mediaPersonIdentityDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, mediaPersonIdentityDTOFromRow(row))
	}
	return out, nil
}

func mediaPersonIdentityDTOByKey(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
	personKey string,
) (mediaPersonIdentityDTO, error) {
	var out mediaPersonIdentityDTO
	if db == nil || ownerID == 0 || !validMediaPersonIdentityID(personKey) {
		return out, gorm.ErrRecordNotFound
	}
	var row mediaPersonIdentityQueryRow
	result := mediaPersonIdentityQuery(ctx, db, ownerID).
		Where("p.person_key = ?", personKey).
		Take(&row)
	if result.Error != nil {
		return out, result.Error
	}
	return mediaPersonIdentityDTOFromRow(row), nil
}

func (s *Server) listMediaPersonIdentityItems(c *gin.Context) {
	personID := strings.TrimSpace(c.Param("personID"))
	if !validMediaPersonIdentityID(personID) {
		fail(c, http.StatusBadRequest, "invalid person id")
		return
	}
	options, ok := mediaQueryFromRequest(c)
	if !ok {
		return
	}
	limit, offset, ok := mediaListWindow(c)
	if !ok {
		return
	}
	rangeRequested, ok := mediaRangeRequested(c)
	if !ok {
		return
	}
	if err := ensureMediaPersonIdentity(
		c.Request.Context(),
		s.DB,
		userID(c),
		personID,
	); err != nil {
		if err == gorm.ErrRecordNotFound {
			fail(c, http.StatusNotFound, "person not found")
			return
		}
		fail(c, http.StatusInternalServerError, "resolve person failed")
		return
	}
	options.PersonIdentity = personID
	if rangeRequested {
		page, err := s.queryMediaItemRange(
			c.Request.Context(),
			userID(c),
			options,
			"",
			limit,
			offset,
		)
		if err != nil {
			fail(c, http.StatusInternalServerError, "list person items failed")
			return
		}
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, page)
		return
	}
	items, err := s.queryMediaItems(
		c.Request.Context(),
		userID(c),
		options,
		"",
		limit,
		offset,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "list person items failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, items)
}

func ensureMediaPersonIdentity(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
	personKey string,
) error {
	if db == nil || ownerID == 0 || !validMediaPersonIdentityID(personKey) {
		return gorm.ErrRecordNotFound
	}
	var count int64
	if err := db.WithContext(ctx).
		Model(&meta.PhotoPerson{}).
		Where("owner_id = ? AND person_key = ?", ownerID, personKey).
		Count(&count).Error; err != nil {
		return err
	}
	if count != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (s *Server) adoptMediaSuggestedPerson(c *gin.Context) {
	clusterID := strings.TrimSpace(c.Param("clusterID"))
	if !validMediaSuggestedPersonID(clusterID) {
		fail(c, http.StatusBadRequest, "invalid suggested person id")
		return
	}
	var input struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	name, err := normalizeMediaPersonIdentityName(input.Name)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}

	var createdKey string
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var state meta.PhotoPersonClusterState
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("owner_id = ? AND state = ?", userID(c), meta.PhotoAnalysisStateReady).
			First(&state).Error; err != nil {
			return err
		}
		var cluster meta.PhotoPersonCluster
		if err := tx.Where(
			"owner_id = ? AND cluster_key = ? AND analyzer_version = ? AND embedding_version = ?",
			userID(c),
			clusterID,
			state.AnalyzerVersion,
			state.EmbeddingVersion,
		).First(&cluster).Error; err != nil {
			return err
		}
		type member struct {
			AssetID    uint64
			Confidence float64
		}
		var members []member
		if err := tx.Table("xd_photo_person_cluster_faces AS pcf").
			Select(
				"pf.asset_id, MAX(pcf.confidence) AS confidence",
			).
			Joins("JOIN xd_photo_faces AS pf ON pf.id = pcf.face_id").
			Joins(
				"JOIN xd_photo_assets AS pa ON pa.id = pf.asset_id AND pa.owner_id = ?",
				userID(c),
			).
			Where("pcf.cluster_id = ?", cluster.ID).
			Group("pf.asset_id").
			Order("confidence DESC, pf.asset_id ASC").
			Scan(&members).Error; err != nil {
			return err
		}
		if len(members) == 0 {
			return gorm.ErrRecordNotFound
		}
		assetIDs := make([]uint64, 0, len(members))
		for _, member := range members {
			assetIDs = append(assetIDs, member.AssetID)
		}
		var duplicateCount int64
		if err := tx.Table("xd_photo_people AS existing_person").
			Joins(
				"JOIN xd_photo_person_assets AS existing_membership "+
					"ON existing_membership.person_id = existing_person.id",
			).
			Where(
				"existing_person.owner_id = ? AND existing_membership.asset_id IN ?",
				userID(c),
				assetIDs,
			).
			Group("existing_person.id").
			Having(
				"COUNT(DISTINCT existing_membership.asset_id) = ? AND "+
					"(SELECT COUNT(*) FROM xd_photo_person_assets AS all_membership "+
					"WHERE all_membership.person_id = existing_person.id) = ?",
				len(assetIDs),
				len(assetIDs),
			).
			Count(&duplicateCount).Error; err != nil {
			return err
		}
		if duplicateCount > 0 {
			return fmt.Errorf("suggested person is already adopted")
		}
		now := time.Now().UTC()
		person := meta.PhotoPerson{
			OwnerID:      userID(c),
			PersonKey:    newMediaPersonIdentityKey(),
			Name:         name,
			CoverAssetID: &members[0].AssetID,
			Revision:     1,
			CreatedAt:    now,
			UpdatedAt:    now,
		}
		if err := tx.Create(&person).Error; err != nil {
			return err
		}
		rows := make([]meta.PhotoPersonAsset, 0, len(members))
		for _, member := range members {
			rows = append(rows, meta.PhotoPersonAsset{
				PersonID:  person.ID,
				AssetID:   member.AssetID,
				CreatedAt: now,
				UpdatedAt: now,
			})
		}
		if err := tx.Create(&rows).Error; err != nil {
			return err
		}
		createdKey = person.PersonKey
		return nil
	})
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			fail(c, http.StatusNotFound, "suggested person not found")
			return
		}
		if strings.Contains(err.Error(), "already adopted") {
			fail(c, http.StatusConflict, err.Error())
			return
		}
		fail(c, http.StatusInternalServerError, "adopt suggested person failed")
		return
	}
	person, err := mediaPersonIdentityDTOByKey(
		c.Request.Context(),
		s.DB,
		userID(c),
		createdKey,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load person failed")
		return
	}
	c.Header("ETag", fmt.Sprintf("\"%d\"", person.Revision))
	c.JSON(http.StatusCreated, person)
}

func (s *Server) updateMediaPersonIdentity(c *gin.Context) {
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	personID := strings.TrimSpace(c.Param("personID"))
	if !validMediaPersonIdentityID(personID) {
		fail(c, http.StatusBadRequest, "invalid person id")
		return
	}
	var input struct {
		Name        *string `json:"name,omitempty"`
		Hidden      *bool   `json:"hidden,omitempty"`
		CoverNodeID *uint64 `json:"cover_node_id,omitempty"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	if input.Name == nil && input.Hidden == nil && input.CoverNodeID == nil {
		fail(c, http.StatusBadRequest, "name, hidden, or cover_node_id is required")
		return
	}
	var name *string
	if input.Name != nil {
		value, err := normalizeMediaPersonIdentityName(*input.Name)
		if err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		name = &value
	}

	var currentRevision uint64
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var person meta.PhotoPerson
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("owner_id = ? AND person_key = ?", userID(c), personID).
			First(&person).Error; err != nil {
			return err
		}
		currentRevision = person.Revision
		if person.Revision != expected {
			return errRevisionConflict
		}
		updates := map[string]any{}
		if name != nil && person.Name != *name {
			updates["name"] = *name
		}
		if input.Hidden != nil && person.Hidden != *input.Hidden {
			updates["hidden"] = *input.Hidden
		}
		if input.CoverNodeID != nil {
			var membership meta.PhotoPersonAsset
			if err := tx.Table("xd_photo_person_assets AS ppa").
				Select("ppa.*").
				Joins(
					"JOIN xd_photo_assets AS pa ON pa.id = ppa.asset_id "+
						"AND pa.owner_id = ? AND pa.primary_node_id = ?",
					userID(c),
					*input.CoverNodeID,
				).
				Joins("JOIN xd_nodes AS cover_node ON cover_node.id = pa.primary_node_id AND cover_node.deleted_at IS NULL").
				Where("ppa.person_id = ?", person.ID).
				Take(&membership).Error; err != nil {
				return err
			}
			if person.CoverAssetID == nil || *person.CoverAssetID != membership.AssetID {
				updates["cover_asset_id"] = membership.AssetID
			}
		}
		if len(updates) == 0 {
			return nil
		}
		updates["revision"] = gorm.Expr("revision + 1")
		updates["updated_at"] = time.Now().UTC()
		return tx.Model(&meta.PhotoPerson{}).
			Where("id = ? AND revision = ?", person.ID, expected).
			Updates(updates).Error
	})
	if err != nil {
		switch err {
		case errRevisionConflict:
			revisionConflict(c, expected, currentRevision)
		case gorm.ErrRecordNotFound:
			fail(c, http.StatusNotFound, "person or cover media not found")
		default:
			fail(c, http.StatusInternalServerError, "update person failed")
		}
		return
	}
	person, err := mediaPersonIdentityDTOByKey(
		c.Request.Context(),
		s.DB,
		userID(c),
		personID,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load person failed")
		return
	}
	c.Header("ETag", fmt.Sprintf("\"%d\"", person.Revision))
	c.JSON(http.StatusOK, person)
}

func (s *Server) mergeMediaPersonIdentities(c *gin.Context) {
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	targetID := strings.TrimSpace(c.Param("personID"))
	if !validMediaPersonIdentityID(targetID) {
		fail(c, http.StatusBadRequest, "invalid person id")
		return
	}
	var input struct {
		SourceIDs []string `json:"source_ids"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	sourceIDs, err := normalizeMediaPersonIdentityIDs(input.SourceIDs)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	for _, sourceID := range sourceIDs {
		if sourceID == targetID {
			fail(c, http.StatusBadRequest, "source_ids must not include the target person")
			return
		}
	}

	var currentRevision uint64
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		keys := append([]string{targetID}, sourceIDs...)
		sort.Strings(keys)
		var people []meta.PhotoPerson
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("owner_id = ? AND person_key IN ?", userID(c), keys).
			Order("person_key ASC").
			Find(&people).Error; err != nil {
			return err
		}
		if len(people) != len(keys) {
			return gorm.ErrRecordNotFound
		}
		var target meta.PhotoPerson
		sources := make([]meta.PhotoPerson, 0, len(sourceIDs))
		for _, person := range people {
			if person.PersonKey == targetID {
				target = person
			} else {
				sources = append(sources, person)
			}
		}
		if target.ID == 0 {
			return gorm.ErrRecordNotFound
		}
		currentRevision = target.Revision
		if target.Revision != expected {
			return errRevisionConflict
		}
		now := time.Now().UTC()
		for _, source := range sources {
			var memberships []meta.PhotoPersonAsset
			if err := tx.Where("person_id = ?", source.ID).
				Find(&memberships).Error; err != nil {
				return err
			}
			rows := make([]meta.PhotoPersonAsset, 0, len(memberships))
			for _, membership := range memberships {
				rows = append(rows, meta.PhotoPersonAsset{
					PersonID:  target.ID,
					AssetID:   membership.AssetID,
					CreatedAt: now,
					UpdatedAt: now,
				})
			}
			if len(rows) != 0 {
				if err := tx.Clauses(clause.OnConflict{DoNothing: true}).
					Create(&rows).Error; err != nil {
					return err
				}
			}
		}
		if err := rewriteMediaSmartAlbumPersonIdentityReferences(
			tx,
			userID(c),
			sourceIDs,
			targetID,
			now,
		); err != nil {
			return err
		}
		sourceNumericIDs := make([]uint64, 0, len(sources))
		for _, source := range sources {
			sourceNumericIDs = append(sourceNumericIDs, source.ID)
		}
		if len(sourceNumericIDs) != 0 {
			if err := tx.Where("id IN ?", sourceNumericIDs).
				Delete(&meta.PhotoPerson{}).Error; err != nil {
				return err
			}
		}
		return tx.Model(&meta.PhotoPerson{}).
			Where("id = ? AND revision = ?", target.ID, expected).
			Updates(map[string]any{
				"revision":   gorm.Expr("revision + 1"),
				"updated_at": now,
			}).Error
	})
	if err != nil {
		switch err {
		case errRevisionConflict:
			revisionConflict(c, expected, currentRevision)
		case gorm.ErrRecordNotFound:
			fail(c, http.StatusNotFound, "one or more people were not found")
		default:
			fail(c, http.StatusInternalServerError, "merge people failed")
		}
		return
	}
	person, err := mediaPersonIdentityDTOByKey(
		c.Request.Context(),
		s.DB,
		userID(c),
		targetID,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load merged person failed")
		return
	}
	c.Header("ETag", fmt.Sprintf("\"%d\"", person.Revision))
	c.JSON(http.StatusOK, person)
}

func (s *Server) splitMediaPersonIdentity(c *gin.Context) {
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	sourceID := strings.TrimSpace(c.Param("personID"))
	if !validMediaPersonIdentityID(sourceID) {
		fail(c, http.StatusBadRequest, "invalid person id")
		return
	}
	var input struct {
		NodeIDs []uint64 `json:"node_ids"`
		Name    string   `json:"name"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	nodeIDs, err := normalizeMediaPersonIdentityNodeIDs(input.NodeIDs)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	name, err := normalizeMediaPersonIdentityName(input.Name)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}

	var createdKey string
	var currentRevision uint64
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var source meta.PhotoPerson
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("owner_id = ? AND person_key = ?", userID(c), sourceID).
			First(&source).Error; err != nil {
			return err
		}
		currentRevision = source.Revision
		if source.Revision != expected {
			return errRevisionConflict
		}
		var selected []meta.PhotoPersonAsset
		if err := tx.Table("xd_photo_person_assets AS ppa").
			Select("ppa.*").
			Joins(
				"JOIN xd_photo_assets AS pa ON pa.id = ppa.asset_id "+
					"AND pa.owner_id = ? AND pa.primary_node_id IN ?",
				userID(c),
				nodeIDs,
			).
			Where("ppa.person_id = ?", source.ID).
			Find(&selected).Error; err != nil {
			return err
		}
		if len(selected) != len(nodeIDs) {
			return fmt.Errorf("one or more node_ids are not members of this person")
		}
		var total int64
		if err := tx.Model(&meta.PhotoPersonAsset{}).
			Where("person_id = ?", source.ID).
			Count(&total).Error; err != nil {
			return err
		}
		if int64(len(selected)) >= total {
			return fmt.Errorf("split must leave at least one media item in the source person")
		}
		now := time.Now().UTC()
		coverAssetID := selected[0].AssetID
		created := meta.PhotoPerson{
			OwnerID:      userID(c),
			PersonKey:    newMediaPersonIdentityKey(),
			Name:         name,
			CoverAssetID: &coverAssetID,
			Revision:     1,
			CreatedAt:    now,
			UpdatedAt:    now,
		}
		if err := tx.Create(&created).Error; err != nil {
			return err
		}
		rows := make([]meta.PhotoPersonAsset, 0, len(selected))
		assetIDs := make([]uint64, 0, len(selected))
		for _, membership := range selected {
			assetIDs = append(assetIDs, membership.AssetID)
			rows = append(rows, meta.PhotoPersonAsset{
				PersonID:  created.ID,
				AssetID:   membership.AssetID,
				CreatedAt: now,
				UpdatedAt: now,
			})
		}
		if err := tx.Create(&rows).Error; err != nil {
			return err
		}
		if err := tx.Where(
			"person_id = ? AND asset_id IN ?",
			source.ID,
			assetIDs,
		).Delete(&meta.PhotoPersonAsset{}).Error; err != nil {
			return err
		}
		updates := map[string]any{
			"revision":   gorm.Expr("revision + 1"),
			"updated_at": now,
		}
		if source.CoverAssetID != nil {
			for _, assetID := range assetIDs {
				if *source.CoverAssetID == assetID {
					updates["cover_asset_id"] = nil
					break
				}
			}
		}
		if err := tx.Model(&meta.PhotoPerson{}).
			Where("id = ? AND revision = ?", source.ID, expected).
			Updates(updates).Error; err != nil {
			return err
		}
		createdKey = created.PersonKey
		return nil
	})
	if err != nil {
		switch err {
		case errRevisionConflict:
			revisionConflict(c, expected, currentRevision)
		case gorm.ErrRecordNotFound:
			fail(c, http.StatusNotFound, "person not found")
		default:
			if strings.Contains(err.Error(), "node_ids") ||
				strings.Contains(err.Error(), "split must") {
				fail(c, http.StatusConflict, err.Error())
			} else {
				fail(c, http.StatusInternalServerError, "split person failed")
			}
		}
		return
	}
	source, err := mediaPersonIdentityDTOByKey(
		c.Request.Context(),
		s.DB,
		userID(c),
		sourceID,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load source person failed")
		return
	}
	created, err := mediaPersonIdentityDTOByKey(
		c.Request.Context(),
		s.DB,
		userID(c),
		createdKey,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load split person failed")
		return
	}
	c.Header("ETag", fmt.Sprintf("\"%d\"", source.Revision))
	c.JSON(http.StatusOK, mediaPersonSplitDTO{
		Source:  source,
		Created: created,
	})
}
