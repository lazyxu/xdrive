package api

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	mediaSearchMaxRunes        = 200
	mediaFacetMaxValues        = 32
	mediaFacetMaxValueRunes    = 160
	mediaCameraFacetValueSQL   = "LOWER(TRIM(CONCAT_WS(' ', NULLIF(TRIM(xd_media_metadata.camera_make), ''), NULLIF(TRIM(xd_media_metadata.camera_model), ''))))"
	mediaCameraFacetDisplaySQL = "TRIM(CONCAT_WS(' ', NULLIF(TRIM(xd_media_metadata.camera_make), ''), NULLIF(TRIM(xd_media_metadata.camera_model), '')))"
)

type mediaQueryOptions struct {
	TimeZone       string
	AnchorNodeID   uint64
	SortBy         string
	SortDir        string
	MediaKind      string
	Search         string
	AssetKind      string
	Category       string
	FolderID       *uint64
	CapturedFrom   *time.Time
	CapturedTo     *time.Time
	HasLocation    *bool
	Favorite       *bool
	Tag            string
	Person         string
	Cameras        []string
	Formats        []string
	Place          *mediaPlaceCell
	PersonCluster  string
	PersonIdentity string
}

func mediaQueryFromRequest(c *gin.Context) (mediaQueryOptions, bool) {
	var out mediaQueryOptions
	var err error
	_, out.TimeZone, err = mediaIANAZone(c.Query("time_zone"))
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return mediaQueryOptions{}, false
	}
	if raw := strings.TrimSpace(c.Query("anchor_node_id")); raw != "" {
		nodeID, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || nodeID == 0 {
			fail(c, http.StatusBadRequest, "anchor_node_id must be a positive integer")
			return mediaQueryOptions{}, false
		}
		out.AnchorNodeID = nodeID
	}
	out.SortBy = strings.TrimSpace(c.Query("sort_by"))
	if out.SortBy != "" && out.SortBy != "captured" && out.SortBy != "added" {
		fail(c, http.StatusBadRequest, "sort_by must be captured or added")
		return mediaQueryOptions{}, false
	}
	out.SortDir = strings.TrimSpace(c.Query("sort_dir"))
	if out.SortDir != "" && out.SortDir != "asc" && out.SortDir != "desc" {
		fail(c, http.StatusBadRequest, "sort_dir must be asc or desc")
		return mediaQueryOptions{}, false
	}
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
	out.Category = strings.TrimSpace(c.Query("category"))
	if out.Category != "" && !validMediaCategory(out.Category) {
		fail(c, http.StatusBadRequest, "category is invalid")
		return mediaQueryOptions{}, false
	}
	if raw := strings.TrimSpace(c.Query("folder_id")); raw != "" {
		value, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || value == 0 {
			fail(c, http.StatusBadRequest, "folder_id must be a positive integer")
			return mediaQueryOptions{}, false
		}
		out.FolderID = &value
	}
	out.Cameras, err = normalizeMediaFacetValues("camera", c.QueryArray("camera"))
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return mediaQueryOptions{}, false
	}
	out.Formats, err = normalizeMediaFacetValues("format", c.QueryArray("format"))
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
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
	if raw := strings.TrimSpace(c.Query("favorite")); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			fail(c, http.StatusBadRequest, "favorite must be true or false")
			return mediaQueryOptions{}, false
		}
		out.Favorite = &value
	}
	if raw := strings.TrimSpace(c.Query("tag")); raw != "" {
		value, err := normalizeMediaTag(raw)
		if err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return mediaQueryOptions{}, false
		}
		out.Tag = value
	}
	if raw := strings.TrimSpace(c.Query("person")); raw != "" {
		value, err := normalizeMediaPerson(raw)
		if err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return mediaQueryOptions{}, false
		}
		out.Person = value
	}
	if raw := strings.TrimSpace(c.Query("person_identity")); raw != "" {
		if !validMediaPersonIdentityID(raw) {
			fail(c, http.StatusBadRequest, "person_identity is invalid")
			return mediaQueryOptions{}, false
		}
		out.PersonIdentity = raw
	}
	if raw := strings.TrimSpace(c.Query("place")); raw != "" {
		value, ok := parseMediaPlaceKey(raw)
		if !ok {
			fail(c, http.StatusBadRequest, "place is invalid")
			return mediaQueryOptions{}, false
		}
		out.Place = &value
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

func validMediaCategory(value string) bool {
	switch value {
	case "gif", "panorama":
		return true
	default:
		return false
	}
}

func normalizeMediaFacetValues(name string, values []string) ([]string, error) {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, raw := range values {
		value := strings.ToLower(strings.TrimSpace(raw))
		if value == "" {
			continue
		}
		if strings.ContainsRune(value, 0) || len([]rune(value)) > mediaFacetMaxValueRunes {
			return nil, fmt.Errorf("%s filter is invalid", name)
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
		if len(out) > mediaFacetMaxValues {
			return nil, fmt.Errorf("%s accepts at most %d values", name, mediaFacetMaxValues)
		}
	}
	sort.Strings(out)
	return out, nil
}

func (options mediaQueryOptions) withoutSearch() mediaQueryOptions {
	options.Search = ""
	return options
}

func (options mediaQueryOptions) withoutCameras() mediaQueryOptions {
	options.Cameras = nil
	return options
}

func (options mediaQueryOptions) withoutFormats() mediaQueryOptions {
	options.Formats = nil
	return options
}

func applyMediaSearchFilter(query *gorm.DB, search string) *gorm.DB {
	search = strings.TrimSpace(search)
	if search == "" {
		return query
	}
	like := "%" + strings.ToLower(search) + "%"
	return query.Where(
		"LOWER(n.name) LIKE ? "+
			"OR LOWER(COALESCE(xd_media_metadata.camera_make, '')) LIKE ? "+
			"OR LOWER(COALESCE(xd_media_metadata.camera_model, '')) LIKE ? "+
			"OR LOWER(COALESCE(xd_media_metadata.lens_model, '')) LIKE ? "+
			"OR LOWER(COALESCE(pm.description, '')) LIKE ? "+
			"OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(NULLIF(pm.tags_json, ''), '[]')::jsonb) AS media_tag(value) WHERE LOWER(media_tag.value) LIKE ?) "+
			"OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(NULLIF(pm.people_json, ''), '[]')::jsonb) AS media_person(value) WHERE LOWER(media_person.value) LIKE ?) "+
			"OR EXISTS ("+
			"SELECT 1 FROM xd_photo_people AS search_person "+
			"JOIN xd_photo_person_assets AS search_membership ON search_membership.person_id = search_person.id "+
			"WHERE search_person.owner_id = pa.owner_id AND search_membership.asset_id = pa.id "+
			"AND LOWER(COALESCE(search_person.name, '')) LIKE ?"+
			") "+
			"OR EXISTS ("+
			"SELECT 1 FROM xd_photo_visual_labels AS search_visual "+
			"JOIN xd_photo_analysis_states AS search_visual_state ON search_visual_state.asset_id = search_visual.asset_id "+
			"WHERE search_visual.asset_id = pa.id AND search_visual_state.kind = ? AND search_visual_state.state = ? "+
			"AND LOWER(search_visual.label) LIKE ?"+
			") "+
			"OR EXISTS ("+
			"SELECT 1 FROM xd_photo_ocr_texts AS search_ocr "+
			"JOIN xd_photo_analysis_states AS search_ocr_state ON search_ocr_state.asset_id = search_ocr.asset_id "+
			"WHERE search_ocr.asset_id = pa.id AND search_ocr_state.kind = ? AND search_ocr_state.state = ? "+
			"AND LOWER(search_ocr.text) LIKE ?"+
			") "+
			"OR EXISTS ("+
			"SELECT 1 FROM xd_photo_place_labels AS search_place "+
			"JOIN xd_photo_analysis_states AS search_place_state ON search_place_state.asset_id = search_place.asset_id "+
			"WHERE search_place.asset_id = pa.id AND search_place_state.kind = ? AND search_place_state.state = ? "+
			"AND LOWER(CONCAT_WS(' ', search_place.formatted, search_place.country, search_place.region, search_place.city, search_place.district, search_place.locality)) LIKE ?"+
			")",
		like, like, like, like, like, like, like, like,
		meta.PhotoAnalysisKindVisualLabel, meta.PhotoAnalysisStateReady, like,
		meta.PhotoAnalysisKindOCRText, meta.PhotoAnalysisStateReady, like,
		meta.PhotoAnalysisKindPlaceLabel, meta.PhotoAnalysisStateReady, like,
	)
}

func applyMediaQueryFilters(query *gorm.DB, options mediaQueryOptions) *gorm.DB {
	if options.MediaKind != "" {
		query = query.Where("xd_media_metadata.media_kind = ?", options.MediaKind)
	}
	if options.AssetKind != "" {
		query = query.Where("pa.kind = ?", options.AssetKind)
	}
	if options.FolderID != nil {
		query = query.Where("n.parent_id = ?", *options.FolderID)
	}
	switch options.Category {
	case "gif":
		query = query.Where("LOWER(xd_media_metadata.mime_type) = ?", "image/gif")
	case "panorama":
		query = query.Where(
			"COALESCE(NULLIF(xd_media_metadata.exif_json, ''), '{}')::jsonb @> ?::jsonb",
			`{"is_panorama":true}`,
		)
	}
	if len(options.Cameras) > 0 {
		query = query.Where(mediaCameraFacetValueSQL+" IN ?", options.Cameras)
	}
	if len(options.Formats) > 0 {
		query = query.Where("LOWER(TRIM(xd_media_metadata.mime_type)) IN ?", options.Formats)
	}
	query = applyMediaSearchFilter(query, options.Search)
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
	if options.Favorite != nil {
		query = query.Where("pm.favorite = ?", *options.Favorite)
	}
	if options.Tag != "" {
		query = query.Where(
			"EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(NULLIF(pm.tags_json, ''), '[]')::jsonb) AS media_tag(value) WHERE LOWER(media_tag.value) = LOWER(?))",
			options.Tag,
		)
	}
	if options.Person != "" {
		query = query.Where(
			"EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(NULLIF(pm.people_json, ''), '[]')::jsonb) AS media_person(value) WHERE LOWER(media_person.value) = LOWER(?))",
			options.Person,
		)
	}
	if options.Place != nil {
		latMin, latMax, lonMin, lonMax := mediaPlaceBounds(*options.Place)
		query = query.Where(
			"xd_media_metadata.latitude >= ? AND xd_media_metadata.latitude < ? AND "+
				"xd_media_metadata.longitude >= ? AND xd_media_metadata.longitude < ?",
			latMin,
			latMax,
			lonMin,
			lonMax,
		)
	}
	if options.PersonCluster != "" {
		query = query.Where(
			"EXISTS ("+
				"SELECT 1 FROM xd_photo_person_clusters AS person_pc "+
				"JOIN xd_photo_person_cluster_states AS person_pcs "+
				"ON person_pcs.owner_id = person_pc.owner_id "+
				"AND person_pcs.state = ? "+
				"AND person_pcs.analyzer_version = person_pc.analyzer_version "+
				"AND person_pcs.embedding_version = person_pc.embedding_version "+
				"JOIN xd_photo_person_cluster_faces AS person_pcf "+
				"ON person_pcf.cluster_id = person_pc.id "+
				"JOIN xd_photo_faces AS person_pf "+
				"ON person_pf.id = person_pcf.face_id "+
				"WHERE person_pc.owner_id = pa.owner_id "+
				"AND person_pc.cluster_key = ? "+
				"AND person_pf.asset_id = pa.id"+
				")",
			meta.PhotoAnalysisStateReady,
			options.PersonCluster,
		)
	}
	if options.PersonIdentity != "" {
		query = query.Where(
			"EXISTS ("+
				"SELECT 1 FROM xd_photo_people AS durable_person "+
				"JOIN xd_photo_person_assets AS durable_membership "+
				"ON durable_membership.person_id = durable_person.id "+
				"WHERE durable_person.owner_id = pa.owner_id "+
				"AND durable_person.person_key = ? "+
				"AND durable_membership.asset_id = pa.id"+
				")",
			options.PersonIdentity,
		)
	}
	return query
}
