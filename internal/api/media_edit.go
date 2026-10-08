package api

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/mediagroup"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photoasset"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const mediaEditRecipeVersion = 1

var errMediaEditRevisionConflict = errors.New("media edit revision conflict")

type mediaEditRecipeInput struct {
	Revision        uint64  `json:"revision"`
	RotationDegrees int     `json:"rotation_degrees"`
	FlipHorizontal  bool    `json:"flip_horizontal"`
	FlipVertical    bool    `json:"flip_vertical"`
	CropX           float64 `json:"crop_x"`
	CropY           float64 `json:"crop_y"`
	CropWidth       float64 `json:"crop_width"`
	CropHeight      float64 `json:"crop_height"`
	ExposureEV      float64 `json:"exposure_ev"`
	Contrast        float64 `json:"contrast"`
	Saturation      float64 `json:"saturation"`
	TrimStartMS     int64   `json:"trim_start_ms"`
	TrimEndMS       int64   `json:"trim_end_ms"`
}

type editableMediaAsset struct {
	Node     meta.Node
	Metadata meta.MediaMetadata
	Asset    meta.PhotoAsset
}

func defaultMediaEditRecipeDTO(kind string) mediaEditRecipeDTO {
	return mediaEditRecipeDTO{
		Version:       mediaEditRecipeVersion,
		SourceCurrent: true,
		MediaKind:     kind,
		CropWidth:     1,
		CropHeight:    1,
	}
}

func toMediaEditRecipeDTO(
	recipe meta.PhotoEditRecipe,
	kind string,
	sourceCurrent bool,
) mediaEditRecipeDTO {
	updated := recipe.UpdatedAt
	return mediaEditRecipeDTO{
		Version:         mediaEditRecipeVersion,
		Revision:        recipe.Revision,
		SourceCurrent:   sourceCurrent,
		MediaKind:       kind,
		RotationDegrees: recipe.RotationDegrees,
		FlipHorizontal:  recipe.FlipHorizontal,
		FlipVertical:    recipe.FlipVertical,
		CropX:           recipe.CropX,
		CropY:           recipe.CropY,
		CropWidth:       recipe.CropWidth,
		CropHeight:      recipe.CropHeight,
		ExposureEV:      recipe.ExposureEV,
		Contrast:        recipe.Contrast,
		Saturation:      recipe.Saturation,
		TrimStartMS:     recipe.TrimStartMS,
		TrimEndMS:       recipe.TrimEndMS,
		UpdatedAt:       &updated,
	}
}

func mediaEditRecipeRevisionAccepted(
	current meta.PhotoEditRecipe,
	value editableMediaAsset,
	requested uint64,
) bool {
	if requested == current.Revision {
		return true
	}
	return requested == 0 && !mediaEditRecipeSourceCurrent(current, value)
}

func mediaEditRecipeSourceCurrent(
	recipe meta.PhotoEditRecipe,
	value editableMediaAsset,
) bool {
	return recipe.SourceNodeID == value.Node.ID &&
		recipe.SourceNodeRevision == value.Node.Revision &&
		strings.EqualFold(
			strings.TrimSpace(recipe.SourceSHA256),
			strings.TrimSpace(value.Node.File.SHA256),
		)
}

func (s *Server) resolveEditableMediaAsset(
	c *gin.Context,
) (editableMediaAsset, bool) {
	var out editableMediaAsset
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid media id")
		return out, false
	}
	node, err := s.ownedNode(userID(c), id, true)
	if err != nil || node.Type != meta.NodeTypeFile || node.File == nil {
		fail(c, http.StatusNotFound, "file not found")
		return out, false
	}
	metadata, err := s.ensureMediaMetadata(c.Request.Context(), node)
	if err != nil {
		fail(c, http.StatusInternalServerError, "media indexing failed")
		return out, false
	}
	if metadata.MediaKind != meta.MediaKindImage &&
		metadata.MediaKind != meta.MediaKindVideo {
		fail(c, http.StatusUnsupportedMediaType, "media editing is not supported")
		return out, false
	}
	if err := mediagroup.ReconcileLocalEvidenceGroups(
		c.Request.Context(),
		s.DB,
		node.OwnerID,
	); err != nil {
		fail(c, http.StatusInternalServerError, "resolve media relations failed")
		return out, false
	}
	if _, err := photoasset.ReconcileOwner(
		c.Request.Context(),
		s.DB,
		node.OwnerID,
	); err != nil {
		fail(c, http.StatusInternalServerError, "resolve photo asset failed")
		return out, false
	}
	var asset meta.PhotoAsset
	if err := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ? AND primary_node_id = ?", node.OwnerID, node.ID).
		First(&asset).Error; err != nil {
		fail(c, http.StatusNotFound, "photo asset not found")
		return out, false
	}
	if asset.Kind != meta.PhotoAssetKindImage &&
		asset.Kind != meta.PhotoAssetKindVideo {
		fail(c, http.StatusUnsupportedMediaType, "editing grouped media is not supported yet")
		return out, false
	}
	out.Node = node
	out.Metadata = metadata
	out.Asset = asset
	return out, true
}

func finiteEditValue(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func normalizeMediaEditRecipe(
	input mediaEditRecipeInput,
	value editableMediaAsset,
) (mediaEditRecipeInput, error) {
	if input.CropWidth == 0 && input.CropHeight == 0 &&
		input.CropX == 0 && input.CropY == 0 {
		input.CropWidth = 1
		input.CropHeight = 1
	}
	switch input.RotationDegrees {
	case 0, 90, 180, 270:
	default:
		return input, fmt.Errorf("rotation_degrees must be 0, 90, 180, or 270")
	}
	for name, candidate := range map[string]float64{
		"crop_x":      input.CropX,
		"crop_y":      input.CropY,
		"crop_width":  input.CropWidth,
		"crop_height": input.CropHeight,
		"exposure_ev": input.ExposureEV,
		"contrast":    input.Contrast,
		"saturation":  input.Saturation,
	} {
		if !finiteEditValue(candidate) {
			return input, fmt.Errorf("%s must be finite", name)
		}
	}
	if input.CropX < 0 || input.CropY < 0 ||
		input.CropWidth <= 0 || input.CropHeight <= 0 ||
		input.CropX+input.CropWidth > 1.000001 ||
		input.CropY+input.CropHeight > 1.000001 {
		return input, fmt.Errorf("crop must stay inside normalized image bounds")
	}
	if input.CropWidth < 0.05 || input.CropHeight < 0.05 {
		return input, fmt.Errorf("crop width and height must be at least 0.05")
	}
	if input.ExposureEV < -2 || input.ExposureEV > 2 {
		return input, fmt.Errorf("exposure_ev must be between -2 and 2")
	}
	if input.Contrast < -1 || input.Contrast > 1 {
		return input, fmt.Errorf("contrast must be between -1 and 1")
	}
	if input.Saturation < -1 || input.Saturation > 1 {
		return input, fmt.Errorf("saturation must be between -1 and 1")
	}
	if input.TrimStartMS < 0 || input.TrimEndMS < 0 {
		return input, fmt.Errorf("trim values must be zero or greater")
	}

	if value.Metadata.MediaKind == meta.MediaKindImage {
		if input.TrimStartMS != 0 || input.TrimEndMS != 0 {
			return input, fmt.Errorf("image recipes cannot contain video trim")
		}
		return input, nil
	}
	if input.CropX != 0 || input.CropY != 0 ||
		math.Abs(input.CropWidth-1) > 0.000001 ||
		math.Abs(input.CropHeight-1) > 0.000001 ||
		input.ExposureEV != 0 || input.Contrast != 0 || input.Saturation != 0 {
		return input, fmt.Errorf("video recipes support trim, rotate, and flip only")
	}
	if input.TrimEndMS != 0 && input.TrimEndMS <= input.TrimStartMS {
		return input, fmt.Errorf("trim_end_ms must be greater than trim_start_ms")
	}
	if value.Metadata.DurationMS > 0 {
		if input.TrimStartMS != 0 && input.TrimStartMS >= value.Metadata.DurationMS {
			return input, fmt.Errorf("trim_start_ms exceeds video duration")
		}
		if input.TrimEndMS > value.Metadata.DurationMS {
			return input, fmt.Errorf("trim_end_ms exceeds video duration")
		}
	}
	return input, nil
}

func (s *Server) getMediaEditRecipe(c *gin.Context) {
	value, ok := s.resolveEditableMediaAsset(c)
	if !ok {
		return
	}
	var recipe meta.PhotoEditRecipe
	err := s.DB.WithContext(c.Request.Context()).
		Where("asset_id = ? AND owner_id = ?", value.Asset.ID, value.Node.OwnerID).
		First(&recipe).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, defaultMediaEditRecipeDTO(value.Metadata.MediaKind))
		return
	}
	if err != nil {
		fail(c, http.StatusInternalServerError, "load media edit recipe failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(
		http.StatusOK,
		toMediaEditRecipeDTO(
			recipe,
			value.Metadata.MediaKind,
			mediaEditRecipeSourceCurrent(recipe, value),
		),
	)
}

func (s *Server) putMediaEditRecipe(c *gin.Context) {
	value, ok := s.resolveEditableMediaAsset(c)
	if !ok {
		return
	}
	var input mediaEditRecipeInput
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid media edit recipe")
		return
	}
	normalized, err := normalizeMediaEditRecipe(input, value)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}

	var saved meta.PhotoEditRecipe
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var current meta.PhotoEditRecipe
		findErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("asset_id = ? AND owner_id = ?", value.Asset.ID, value.Node.OwnerID).
			First(&current).Error
		now := time.Now().UTC()
		if errors.Is(findErr, gorm.ErrRecordNotFound) {
			if normalized.Revision != 0 {
				return errMediaEditRevisionConflict
			}
			saved = meta.PhotoEditRecipe{
				AssetID:            value.Asset.ID,
				OwnerID:            value.Node.OwnerID,
				Revision:           1,
				SourceNodeID:       value.Node.ID,
				SourceNodeRevision: value.Node.Revision,
				SourceSHA256:       strings.ToLower(strings.TrimSpace(value.Node.File.SHA256)),
				RotationDegrees:    normalized.RotationDegrees,
				FlipHorizontal:     normalized.FlipHorizontal,
				FlipVertical:       normalized.FlipVertical,
				CropX:              normalized.CropX,
				CropY:              normalized.CropY,
				CropWidth:          normalized.CropWidth,
				CropHeight:         normalized.CropHeight,
				ExposureEV:         normalized.ExposureEV,
				Contrast:           normalized.Contrast,
				Saturation:         normalized.Saturation,
				TrimStartMS:        normalized.TrimStartMS,
				TrimEndMS:          normalized.TrimEndMS,
				CreatedAt:          now,
				UpdatedAt:          now,
			}
			return tx.Create(&saved).Error
		}
		if findErr != nil {
			return findErr
		}
		if !mediaEditRecipeRevisionAccepted(
			current,
			value,
			normalized.Revision,
		) {
			return errMediaEditRevisionConflict
		}
		updates := map[string]any{
			"revision":             current.Revision + 1,
			"source_node_id":       value.Node.ID,
			"source_node_revision": value.Node.Revision,
			"source_sha256":        strings.ToLower(strings.TrimSpace(value.Node.File.SHA256)),
			"rotation_degrees":     normalized.RotationDegrees,
			"flip_horizontal":      normalized.FlipHorizontal,
			"flip_vertical":        normalized.FlipVertical,
			"crop_x":               normalized.CropX,
			"crop_y":               normalized.CropY,
			"crop_width":           normalized.CropWidth,
			"crop_height":          normalized.CropHeight,
			"exposure_ev":          normalized.ExposureEV,
			"contrast":             normalized.Contrast,
			"saturation":           normalized.Saturation,
			"trim_start_ms":        normalized.TrimStartMS,
			"trim_end_ms":          normalized.TrimEndMS,
			"updated_at":           now,
		}
		if err := tx.Model(&meta.PhotoEditRecipe{}).
			Where("asset_id = ? AND owner_id = ?", value.Asset.ID, value.Node.OwnerID).
			Updates(updates).Error; err != nil {
			return err
		}
		return tx.Where("asset_id = ?", value.Asset.ID).First(&saved).Error
	})
	if err != nil {
		if errors.Is(err, errMediaEditRevisionConflict) {
			fail(c, http.StatusConflict, "media edit recipe changed; reload and retry")
		} else {
			fail(c, http.StatusInternalServerError, "save media edit recipe failed")
		}
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, toMediaEditRecipeDTO(saved, value.Metadata.MediaKind, true))
}

func (s *Server) deleteMediaEditRecipe(c *gin.Context) {
	value, ok := s.resolveEditableMediaAsset(c)
	if !ok {
		return
	}
	revision, err := strconv.ParseUint(strings.TrimSpace(c.Query("revision")), 10, 64)
	if err != nil {
		fail(c, http.StatusBadRequest, "revision is required")
		return
	}
	result := s.DB.WithContext(c.Request.Context()).
		Where(
			"asset_id = ? AND owner_id = ? AND revision = ?",
			value.Asset.ID,
			value.Node.OwnerID,
			revision,
		).
		Delete(&meta.PhotoEditRecipe{})
	if result.Error != nil {
		fail(c, http.StatusInternalServerError, "reset media edit recipe failed")
		return
	}
	if result.RowsAffected == 0 {
		var existing int64
		if err := s.DB.WithContext(c.Request.Context()).
			Model(&meta.PhotoEditRecipe{}).
			Where("asset_id = ? AND owner_id = ?", value.Asset.ID, value.Node.OwnerID).
			Count(&existing).Error; err != nil {
			fail(c, http.StatusInternalServerError, "reset media edit recipe failed")
			return
		}
		if existing != 0 {
			fail(c, http.StatusConflict, "media edit recipe changed; reload and retry")
			return
		}
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, defaultMediaEditRecipeDTO(value.Metadata.MediaKind))
}
