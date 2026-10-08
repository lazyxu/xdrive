package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const mediaFacetResultLimit = 100

type mediaFacetOptionDTO struct {
	Value     string `json:"value"`
	Label     string `json:"label"`
	ItemCount int64  `json:"item_count"`
}

type mediaGalleryFacetsDTO struct {
	Cameras []mediaFacetOptionDTO `json:"cameras"`
	Formats []mediaFacetOptionDTO `json:"formats"`
}

func (s *Server) mediaFacetScopeQuery(
	ctx context.Context,
	uid uint64,
	options mediaQueryOptions,
	albumKey string,
) (*gorm.DB, error) {
	if ranked, handled, err := s.semanticRankedMediaNodeIDs(ctx, uid, options, albumKey); err != nil {
		return nil, err
	} else if handled {
		query, err := s.mediaItemsBaseQuery(ctx, uid, options.withoutSearch(), albumKey)
		if err != nil {
			return nil, err
		}
		if len(ranked) == 0 {
			return query.Where("1 = 0"), nil
		}
		return query.Where("n.id IN ?", ranked), nil
	}
	return s.mediaItemsBaseQuery(ctx, uid, options, albumKey)
}

func queryMediaFacetOptions(
	query *gorm.DB,
	valueExpression string,
	labelExpression string,
) ([]mediaFacetOptionDTO, error) {
	var rows []mediaFacetOptionDTO
	if err := query.
		Session(&gorm.Session{}).
		Select(
			valueExpression + " AS value, MIN(" + labelExpression + ") AS label, " +
				"COUNT(DISTINCT xd_media_metadata.node_id) AS item_count",
		).
		Where(valueExpression + " <> ''").
		Group(valueExpression).
		Order("item_count DESC").
		Order("label ASC").
		Limit(mediaFacetResultLimit).
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func mediaFormatFacetLabel(value string) string {
	switch value {
	case "image/jpeg":
		return "JPEG"
	case "image/png":
		return "PNG"
	case "image/heic":
		return "HEIC"
	case "image/heif":
		return "HEIF"
	case "image/webp":
		return "WebP"
	case "image/gif":
		return "GIF"
	case "image/tiff":
		return "TIFF"
	case "image/x-adobe-dng":
		return "DNG"
	case "video/mp4":
		return "MP4"
	case "video/quicktime":
		return "MOV"
	case "video/webm":
		return "WebM"
	default:
		return value
	}
}

func (s *Server) queryMediaGalleryFacets(
	ctx context.Context,
	uid uint64,
	options mediaQueryOptions,
	albumKey string,
) (mediaGalleryFacetsDTO, error) {
	cameraQuery, err := s.mediaFacetScopeQuery(ctx, uid, options.withoutCameras(), albumKey)
	if err != nil {
		return mediaGalleryFacetsDTO{}, err
	}
	cameras, err := queryMediaFacetOptions(
		cameraQuery,
		mediaCameraFacetValueSQL,
		mediaCameraFacetDisplaySQL,
	)
	if err != nil {
		return mediaGalleryFacetsDTO{}, err
	}

	formatQuery, err := s.mediaFacetScopeQuery(ctx, uid, options.withoutFormats(), albumKey)
	if err != nil {
		return mediaGalleryFacetsDTO{}, err
	}
	formats, err := queryMediaFacetOptions(
		formatQuery,
		"LOWER(TRIM(xd_media_metadata.mime_type))",
		"xd_media_metadata.mime_type",
	)
	if err != nil {
		return mediaGalleryFacetsDTO{}, err
	}
	for index := range formats {
		formats[index].Label = mediaFormatFacetLabel(formats[index].Value)
	}
	return mediaGalleryFacetsDTO{Cameras: cameras, Formats: formats}, nil
}

func (s *Server) listMediaFacets(c *gin.Context) {
	options, ok := mediaQueryFromRequest(c)
	if !ok {
		return
	}
	albumKey := strings.TrimSpace(c.Query("album"))
	if albumKey != "" && !validMediaAlbumKey(albumKey) {
		fail(c, http.StatusBadRequest, "album is invalid")
		return
	}
	if err := s.refreshMediaIndexForGalleryRead(
		c.Request.Context(),
		userID(c),
		mediaRequestIndexBatch,
	); err != nil {
		fail(c, http.StatusInternalServerError, "refresh media projection failed")
		return
	}
	facets, err := s.queryMediaGalleryFacets(
		c.Request.Context(),
		userID(c),
		options,
		albumKey,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "list media facets failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, facets)
}
