package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type mediaPersonSuggestionReviewDTO struct {
	ID             string  `json:"id"`
	ReviewState    string  `json:"review_state,omitempty"`
	TargetPersonID *string `json:"target_person_id,omitempty"`
}

func upsertMediaPersonSuggestionReview(
	tx *gorm.DB,
	ownerID uint64,
	suggestionKey, state string,
	targetPersonID *uint64,
	now time.Time,
) error {
	if tx == nil || ownerID == 0 || !validMediaSuggestedPersonID(suggestionKey) {
		return gorm.ErrRecordNotFound
	}
	if !meta.ValidPhotoPersonSuggestionReviewState(state) {
		return fmt.Errorf("invalid suggestion review state")
	}
	row := meta.PhotoPersonSuggestionReview{
		OwnerID:        ownerID,
		SuggestionKey:  suggestionKey,
		State:          state,
		TargetPersonID: targetPersonID,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	return tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "owner_id"},
			{Name: "suggestion_key"},
		},
		DoUpdates: clause.Assignments(map[string]any{
			"state":            state,
			"target_person_id": targetPersonID,
			"updated_at":       now,
		}),
	}).Create(&row).Error
}

func mediaPersonSuggestionReviewDTOByKey(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
	suggestionKey string,
) (mediaPersonSuggestionReviewDTO, error) {
	out := mediaPersonSuggestionReviewDTO{ID: suggestionKey}
	type row struct {
		State          string
		TargetPersonID *string
	}
	var value row
	result := db.WithContext(ctx).
		Table("xd_photo_person_suggestion_reviews AS review").
		Select(
			"review.state, target.person_key AS target_person_id",
		).
		Joins(
			"LEFT JOIN xd_photo_people AS target ON target.id = review.target_person_id "+
				"AND target.owner_id = review.owner_id",
		).
		Where(
			"review.owner_id = ? AND review.suggestion_key = ?",
			ownerID,
			suggestionKey,
		).
		Take(&value)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			return out, nil
		}
		return out, result.Error
	}
	out.ReviewState = value.State
	out.TargetPersonID = value.TargetPersonID
	return out, nil
}

func (s *Server) reviewMediaSuggestedPerson(c *gin.Context) {
	clusterID := strings.TrimSpace(c.Param("clusterID"))
	if !validMediaSuggestedPersonID(clusterID) {
		fail(c, http.StatusBadRequest, "invalid suggested person id")
		return
	}
	if err := ensureCurrentSuggestedPerson(
		c.Request.Context(),
		s.DB,
		userID(c),
		clusterID,
	); err != nil {
		if err == gorm.ErrRecordNotFound {
			fail(c, http.StatusNotFound, "suggested person not found")
			return
		}
		fail(c, http.StatusInternalServerError, "resolve suggested person failed")
		return
	}
	var input struct {
		State string `json:"state"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	state := strings.TrimSpace(input.State)
	switch state {
	case "pending":
		var current meta.PhotoPersonSuggestionReview
		err := s.DB.WithContext(c.Request.Context()).
			Where(
				"owner_id = ? AND suggestion_key = ?",
				userID(c),
				clusterID,
			).
			First(&current).Error
		if err != nil && err != gorm.ErrRecordNotFound {
			fail(c, http.StatusInternalServerError, "load suggestion review failed")
			return
		}
		if err == nil &&
			current.State == meta.PhotoPersonSuggestionReviewStateAccepted {
			fail(c, http.StatusConflict, "accepted suggestion cannot be restored")
			return
		}
		if err == nil {
			if err := s.DB.WithContext(c.Request.Context()).
				Delete(&current).Error; err != nil {
				fail(c, http.StatusInternalServerError, "restore suggestion failed")
				return
			}
		}
	case meta.PhotoPersonSuggestionReviewStateDismissed:
		now := time.Now().UTC()
		var existing meta.PhotoPersonSuggestionReview
		err := s.DB.WithContext(c.Request.Context()).
			Where(
				"owner_id = ? AND suggestion_key = ?",
				userID(c),
				clusterID,
			).
			First(&existing).Error
		if err != nil && err != gorm.ErrRecordNotFound {
			fail(c, http.StatusInternalServerError, "load suggestion review failed")
			return
		}
		if err == nil &&
			existing.State == meta.PhotoPersonSuggestionReviewStateAccepted {
			fail(c, http.StatusConflict, "accepted suggestion cannot be dismissed")
			return
		}
		if err := upsertMediaPersonSuggestionReview(
			s.DB.WithContext(c.Request.Context()),
			userID(c),
			clusterID,
			meta.PhotoPersonSuggestionReviewStateDismissed,
			nil,
			now,
		); err != nil {
			fail(c, http.StatusInternalServerError, "dismiss suggestion failed")
			return
		}
	default:
		fail(c, http.StatusBadRequest, "state must be pending or dismissed")
		return
	}
	out, err := mediaPersonSuggestionReviewDTOByKey(
		c.Request.Context(),
		s.DB,
		userID(c),
		clusterID,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load suggestion review failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, out)
}

func (s *Server) addMediaSuggestedPersonToIdentity(c *gin.Context) {
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	personID := strings.TrimSpace(c.Param("personID"))
	clusterID := strings.TrimSpace(c.Param("clusterID"))
	if !validMediaPersonIdentityID(personID) {
		fail(c, http.StatusBadRequest, "invalid person id")
		return
	}
	if !validMediaSuggestedPersonID(clusterID) {
		fail(c, http.StatusBadRequest, "invalid suggested person id")
		return
	}

	var currentRevision uint64
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var person meta.PhotoPerson
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"owner_id = ? AND person_key = ?",
				userID(c),
				personID,
			).
			First(&person).Error; err != nil {
			return err
		}
		currentRevision = person.Revision
		if person.Revision != expected {
			return errRevisionConflict
		}

		var state meta.PhotoPersonClusterState
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"owner_id = ? AND state = ?",
				userID(c),
				meta.PhotoAnalysisStateReady,
			).
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
			Select("pf.asset_id, MAX(pcf.confidence) AS confidence").
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

		now := time.Now().UTC()
		rows := make([]meta.PhotoPersonAsset, 0, len(members))
		for _, member := range members {
			rows = append(rows, meta.PhotoPersonAsset{
				PersonID:  person.ID,
				AssetID:   member.AssetID,
				CreatedAt: now,
				UpdatedAt: now,
			})
		}
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).
			Create(&rows)
		if result.Error != nil {
			return result.Error
		}
		updates := map[string]any{}
		if result.RowsAffected > 0 {
			updates["revision"] = gorm.Expr("revision + 1")
			updates["updated_at"] = now
		}
		if person.CoverAssetID == nil {
			updates["cover_asset_id"] = members[0].AssetID
			if _, exists := updates["revision"]; !exists {
				updates["revision"] = gorm.Expr("revision + 1")
				updates["updated_at"] = now
			}
		}
		if len(updates) != 0 {
			if err := tx.Model(&meta.PhotoPerson{}).
				Where("id = ? AND revision = ?", person.ID, expected).
				Updates(updates).Error; err != nil {
				return err
			}
		}
		targetID := person.ID
		return upsertMediaPersonSuggestionReview(
			tx,
			userID(c),
			clusterID,
			meta.PhotoPersonSuggestionReviewStateAccepted,
			&targetID,
			now,
		)
	})
	if err != nil {
		switch err {
		case errRevisionConflict:
			revisionConflict(c, expected, currentRevision)
		case gorm.ErrRecordNotFound:
			fail(c, http.StatusNotFound, "person or suggested person not found")
		default:
			fail(c, http.StatusInternalServerError, "add suggested person failed")
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
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, person)
}
