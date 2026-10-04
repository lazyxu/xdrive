package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const mediaSearchMaxRunes = 200

type mediaQueryOptions struct {
	MediaKind    string
	Search       string
	AssetKind    string
	CapturedFrom *time.Time
	CapturedTo   *time.Time
	HasLocation  *bool
}

func mediaQueryFromRequest(c *gin.Context) (mediaQueryOptions, bool) {
	var out mediaQueryOptions
	out.MediaKind = strings.TrimSpace(c.Query("kind"))
	if out.MediaKind != "" && out.MediaKind != meta.MediaKindImage && out.MediaKind != meta.MediaKindVideo {
		fail(c, http.StatusBadRequest, "kind must be image or video")
		return mediaQueryOptions{}, false
	}
	out.Search = strings.TrimSpace(c.Query("q"))
	if len([]rune(out.Search)) > mediaSearchMaxRunes {
		fail(c, http.StatusBadRequest, "q must be at most 200 characters")
		return mediaQueryOptions{}, false
	}
	out.AssetKind = strings.TrimSpace(c.Query("asset_kind"))
	if out.AssetKind != "" && !meta.ValidPhotoAssetKind(out.AssetKind) {
		fail(c, http.StatusBadRequest, "asset_kind is invalid")
		return mediaQueryOptions{}, false
	}
	var ok bool
	if out.CapturedFrom, ok = mediaQueryTime(c, "captured_from"); !ok {
		return mediaQueryOptions{}, false
	}
	if out.CapturedTo, ok = mediaQueryTime(c, "captured_to"); !ok {
		return mediaQueryOptions{}, false
	}
	if out.CapturedFrom != nil && out.CapturedTo != nil && !out.CapturedFrom.Before(*out.CapturedTo) {
		fail(c, http.StatusBadRequest, "captured_from must be before captured_to")
		return mediaQueryOptions{}, false
	}
	if raw := strings.TrimSpace(c.Query("has_location")); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			fail(c, http.StatusBadRequest, "has_location must be true or false")
			return mediaQueryOptions{}, false
		}
		out.HasLocation = &value
	}
	return out, true
}

func mediaQueryTime(c *gin.Context, name string) (*time.Time, bool) {
	raw := strings.TrimSpace(c.Query(name))
	if raw == "" {
		return nil, true
	}
	value, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		fail(c, http.StatusBadRequest, name+" must be RFC3339")
		return nil, false
	}
	value = value.UTC()
	return &value, true
}

func applyMediaQueryFilters(query *gorm.DB, options mediaQueryOptions) *gorm.DB {
	if options.MediaKind != "" {
		query = query.Where("xd_media_metadata.media_kind = ?", options.MediaKind)
	}
	if options.AssetKind != "" {
		query = query.Where("pa.kind = ?", options.AssetKind)
	}
	if options.Search != "" {
		like := "%" + strings.ToLower(options.Search) + "%"
		query = query.Where(
			"LOWER(n.name) LIKE ? OR LOWER(COALESCE(xd_media_metadata.camera_make, '')) LIKE ? OR LOWER(COALESCE(xd_media_metadata.camera_model, '')) LIKE ? OR LOWER(COALESCE(xd_media_metadata.lens_model, '')) LIKE ?",
			like, like, like, like,
		)
	}
	if options.CapturedFrom != nil {
		query = query.Where("xd_media_metadata.captured_at >= ?", *options.CapturedFrom)
	}
	if options.CapturedTo != nil {
		query = query.Where("xd_media_metadata.captured_at < ?", *options.CapturedTo)
	}
	if options.HasLocation != nil {
		if *options.HasLocation {
			query = query.Where("xd_media_metadata.latitude IS NOT NULL AND xd_media_metadata.longitude IS NOT NULL")
		} else {
			query = query.Where("xd_media_metadata.latitude IS NULL OR xd_media_metadata.longitude IS NULL")
		}
	}
	return query
}
