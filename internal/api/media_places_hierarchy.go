package api

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/photointelligence"
)

const (
	mediaPlaceHierarchyDefaultLimit = 48
	mediaPlaceHierarchyMaxLimit     = 100
	mediaPlaceHierarchySearchRunes  = 80
)

// A GeoNames nearest-city identity, not a precise jurisdiction or the legacy
// place:<latitude-cell>:<longitude-cell> grid key.
type mediaPlaceHierarchyKey struct {
	Level   string
	Country string
	Region  string
	CityID  int64
}

func mediaPlaceHierarchyCode(value string, max int) bool {
	if value == "" || len(value) > max {
		return false
	}
	for _, c := range value {
		if (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' {
			continue
		}
		return false
	}
	return true
}

func parseMediaPlaceHierarchyKey(raw string) (mediaPlaceHierarchyKey, bool) {
	parts := strings.Split(raw, ":")
	key := mediaPlaceHierarchyKey{}
	if len(parts) < 2 || !mediaPlaceHierarchyCode(parts[1], 2) ||
		len(parts[1]) != 2 || parts[1][0] < 'A' || parts[1][0] > 'Z' ||
		parts[1][1] < 'A' || parts[1][1] > 'Z' {
		return key, false
	}
	key.Country = parts[1]
	switch {
	case len(parts) == 2 && parts[0] == "country":
		key.Level = "country"
	case len(parts) == 3 && parts[0] == "region" && mediaPlaceHierarchyCode(parts[2], 16):
		key.Level, key.Region = "region", parts[2]
	case len(parts) == 4 && parts[0] == "city" && mediaPlaceHierarchyCode(parts[2], 16):
		value, err := strconv.ParseInt(parts[3], 10, 64)
		if err != nil || value <= 0 || strconv.FormatInt(value, 10) != parts[3] {
			return mediaPlaceHierarchyKey{}, false
		}
		key.Level, key.Region, key.CityID = "city", parts[2], value
	default:
		return mediaPlaceHierarchyKey{}, false
	}
	return key, true
}

func (k mediaPlaceHierarchyKey) String() string {
	switch k.Level {
	case "country":
		return "country:" + k.Country
	case "region":
		return "region:" + k.Country + ":" + k.Region
	case "city":
		return fmt.Sprintf("city:%s:%s:%d", k.Country, k.Region, k.CityID)
	default:
		return ""
	}
}

func mediaPlaceHierarchyParent(level, country, region string) (mediaPlaceHierarchyKey, bool) {
	switch level {
	case "country":
		if country == "" && region == "" {
			return mediaPlaceHierarchyKey{Level: level}, true
		}
	case "region":
		k, ok := parseMediaPlaceHierarchyKey("country:" + country)
		if ok && region == "" {
			k.Level = level
			return k, true
		}
	case "city":
		k, ok := parseMediaPlaceHierarchyKey("region:" + country + ":" + region)
		if ok {
			k.Level = level
			return k, true
		}
	}
	return mediaPlaceHierarchyKey{}, false
}

type mediaPlaceHierarchyItemDTO struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	PhotoCount  int64   `json:"photo_count"`
	CoverNodeID *uint64 `json:"cover_node_id,omitempty"`
	MatchKind   string  `json:"match_kind"`
}

type mediaPlaceHierarchyPageDTO struct {
	Items          []mediaPlaceHierarchyItemDTO `json:"items"`
	Level          string                       `json:"level"`
	HasMore        bool                         `json:"has_more"`
	NextCursor     string                       `json:"next_cursor,omitempty"`
	DatasetVersion string                       `json:"dataset_version,omitempty"`
	Available      bool                         `json:"available"`
}

func (s *Server) mediaPlaceHierarchyVersion() string {
	if s.GeoNamesRuntime != nil {
		return s.GeoNamesRuntime.Version()
	}
	if s.PhotoPlaceResolver != nil && s.PhotoPlaceResolver.Name() == photointelligence.GeoNamesResolverName {
		return s.PhotoPlaceResolver.Version()
	}
	return ""
}

func (s *Server) listMediaPlaceHierarchy(c *gin.Context) {
	options, ok := mediaQueryFromRequest(c)
	if !ok {
		return
	}
	raw := c.Request.URL.Query()
	for _, field := range []string{"level", "country", "region", "cursor", "limit", "search", "album"} {
		if len(raw[field]) > 1 {
			fail(c, http.StatusBadRequest, "duplicate hierarchy parameter")
			return
		}
	}
	parent, ok := mediaPlaceHierarchyParent(c.DefaultQuery("level", "country"), c.Query("country"), c.Query("region"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid hierarchy parent")
		return
	}
	limit := mediaPlaceHierarchyDefaultLimit
	if rawLimit := c.Query("limit"); rawLimit != "" {
		n, err := strconv.Atoi(rawLimit)
		if err != nil || n < 1 || n > mediaPlaceHierarchyMaxLimit {
			fail(c, http.StatusBadRequest, "invalid hierarchy limit")
			return
		}
		limit = n
	}
	search := strings.TrimSpace(c.Query("search"))
	if !utf8.ValidString(search) || utf8.RuneCountInString(search) > mediaPlaceHierarchySearchRunes || strings.ContainsRune(search, 0) {
		fail(c, http.StatusBadRequest, "invalid hierarchy search")
		return
	}
	cursor := c.Query("cursor")
	if cursor != "" {
		k, valid := parseMediaPlaceHierarchyKey(cursor)
		if !valid || k.Level != parent.Level ||
			(parent.Level != "country" && k.Country != parent.Country) ||
			(parent.Level == "city" && k.Region != parent.Region) {
			fail(c, http.StatusBadRequest, "invalid hierarchy cursor")
			return
		}
	}
	album := c.Query("album")
	if album != "" && !validMediaAlbumKey(album) {
		fail(c, http.StatusBadRequest, "invalid album")
		return
	}
	if err := s.refreshMediaIndexForGalleryRead(c.Request.Context(), userID(c), mediaRequestIndexBatch); err != nil {
		fail(c, http.StatusInternalServerError, "refresh media projection failed")
		return
	}
	page, err := s.queryMediaPlaceHierarchy(c.Request.Context(), userID(c), options, album, parent, search, cursor, limit)
	if err != nil {
		fail(c, http.StatusInternalServerError, "list hierarchy failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, page)
}

// Query only a bounded SQL result and count distinct Owner PhotoAssets. Never
// fetch 100k coordinates or IDs into the Browser/Electron renderer.
func (s *Server) queryMediaPlaceHierarchy(
	ctx context.Context, ownerID uint64, options mediaQueryOptions, album string,
	parent mediaPlaceHierarchyKey, search, cursor string, limit int,
) (mediaPlaceHierarchyPageDTO, error) {
	out := mediaPlaceHierarchyPageDTO{Items: make([]mediaPlaceHierarchyItemDTO, 0), Level: parent.Level, DatasetVersion: s.mediaPlaceHierarchyVersion()}
	if out.DatasetVersion == "" {
		return out, nil
	}
	out.Available = true
	if ownerID == 0 || limit < 1 || limit > mediaPlaceHierarchyMaxLimit ||
		!utf8.ValidString(search) || utf8.RuneCountInString(search) > mediaPlaceHierarchySearchRunes ||
		strings.ContainsRune(search, 0) {
		return out, fmt.Errorf("invalid hierarchy query")
	}
	if _, ok := mediaPlaceHierarchyParent(parent.Level, parent.Country, parent.Region); !ok {
		return out, fmt.Errorf("invalid hierarchy parent")
	}
	var after mediaPlaceHierarchyKey
	if cursor != "" {
		var ok bool
		after, ok = parseMediaPlaceHierarchyKey(cursor)
		if !ok || after.Level != parent.Level || (parent.Level != "country" && after.Country != parent.Country) ||
			(parent.Level == "city" && after.Region != parent.Region) {
			return out, fmt.Errorf("invalid cursor")
		}
	}
	query, err := s.mediaFacetScopeQuery(ctx, ownerID, options, album)
	if err != nil {
		return out, err
	}
	trust, trustArgs := mediaPlaceHierarchyTrustPredicate(out.DatasetVersion)
	query = query.
		Joins("JOIN xd_photo_place_labels AS ppl ON ppl.asset_id = pa.id").
		Joins("JOIN xd_photo_analysis_states AS pas ON pas.asset_id = pa.id").
		Where(trust, trustArgs...).
		Where("ppl.country_code ~ '^[A-Z]{2}$'")
	var groupColumn, labelColumn string
	switch parent.Level {
	case "country":
		groupColumn, labelColumn = "ppl.country_code", "ppl.country"
		if cursor != "" {
			query = query.Where("ppl.country_code > ?", after.Country)
		}
	case "region":
		groupColumn, labelColumn = "ppl.region_code", "ppl.region"
		query = query.Where("ppl.country_code = ? AND ppl.region_code <> ''", parent.Country)
		if cursor != "" {
			query = query.Where("ppl.region_code > ?", after.Region)
		}
	case "city":
		groupColumn, labelColumn = "ppl.city_geo_name_id", "ppl.city"
		query = query.Where("ppl.country_code = ? AND ppl.region_code = ? AND ppl.city_geo_name_id > 0", parent.Country, parent.Region)
		if cursor != "" {
			query = query.Where("ppl.city_geo_name_id > ?", after.CityID)
		}
	default:
		return out, fmt.Errorf("invalid hierarchy level")
	}
	if search != "" {
		query = query.Where("POSITION(LOWER(?) IN LOWER(COALESCE("+labelColumn+", ''))) > 0", search)
	}
	type row struct {
		Key         string
		NumericKey  int64
		Label       string
		PhotoCount  int64
		CoverNodeID *uint64
	}
	var rows []row
	keySelection := groupColumn + " AS key"
	if parent.Level == "city" {
		keySelection = groupColumn + " AS numeric_key"
	}
	if err := query.Select(keySelection + ", MIN(NULLIF(TRIM(" + labelColumn + "), '')) AS label, " +
		"COUNT(DISTINCT pa.id) AS photo_count, MIN(pa.primary_node_id) AS cover_node_id").
		Group(groupColumn).Order(groupColumn + " ASC").Limit(limit + 1).Scan(&rows).Error; err != nil {
		return out, err
	}
	out.HasMore = len(rows) > limit
	if out.HasMore {
		rows = rows[:limit]
	}
	for _, entry := range rows {
		key := mediaPlaceHierarchyKey{Level: parent.Level, Country: parent.Country, Region: parent.Region}
		switch parent.Level {
		case "country":
			key.Country = entry.Key
		case "region":
			key.Region = entry.Key
		case "city":
			key.CityID = entry.NumericKey
		}
		name := strings.TrimSpace(entry.Label)
		if name == "" {
			name = entry.Key
			if parent.Level == "city" {
				name = strconv.FormatInt(entry.NumericKey, 10)
			}
		}
		if parent.Level == "city" {
			name = "附近城市 · " + name
		}
		out.Items = append(out.Items, mediaPlaceHierarchyItemDTO{
			ID: key.String(), Name: name, PhotoCount: entry.PhotoCount,
			CoverNodeID: entry.CoverNodeID, MatchKind: "nearest_city_geonames",
		})
	}
	if out.HasMore && len(out.Items) > 0 {
		out.NextCursor = out.Items[len(out.Items)-1].ID
	}
	return out, nil
}
