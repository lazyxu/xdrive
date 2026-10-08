package client

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type MediaMetadata struct {
	MediaKind                string         `json:"media_kind"`
	MIMEType                 string         `json:"mime_type,omitempty"`
	ContainerKind            string         `json:"container_kind,omitempty"`
	LivePhotoAssetIdentifier string         `json:"live_photo_asset_identifier,omitempty"`
	Width                    int            `json:"width,omitempty"`
	Height                   int            `json:"height,omitempty"`
	Orientation              int            `json:"orientation,omitempty"`
	RotationDegrees          int            `json:"rotation_degrees,omitempty"`
	DurationMS               int64          `json:"duration_ms,omitempty"`
	FrameRate                float64        `json:"frame_rate,omitempty"`
	BitRate                  int64          `json:"bit_rate,omitempty"`
	VideoCodec               string         `json:"video_codec,omitempty"`
	AudioCodec               string         `json:"audio_codec,omitempty"`
	CapturedAt               *time.Time     `json:"captured_at,omitempty"`
	Latitude                 *float64       `json:"latitude,omitempty"`
	Longitude                *float64       `json:"longitude,omitempty"`
	AltitudeM                *float64       `json:"altitude_m,omitempty"`
	CameraMake               string         `json:"camera_make,omitempty"`
	CameraModel              string         `json:"camera_model,omitempty"`
	LensModel                string         `json:"lens_model,omitempty"`
	EXIF                     map[string]any `json:"exif,omitempty"`
	Video                    map[string]any `json:"video,omitempty"`
	IndexState               string         `json:"index_state"`
	IndexError               string         `json:"index_error,omitempty"`
	HasThumbnail             bool           `json:"has_thumbnail"`
	ThumbnailMIME            string         `json:"thumbnail_mime_type,omitempty"`
	ThumbnailWidth           int            `json:"thumbnail_width,omitempty"`
	ThumbnailHeight          int            `json:"thumbnail_height,omitempty"`
}

type MediaDerivedResource struct {
	Role      string `json:"role"`
	Name      string `json:"name"`
	MediaKind string `json:"media_kind"`
	MIMEType  string `json:"mime_type"`
	Size      int64  `json:"size"`
}

type MediaEditRecipe struct {
	Version         int        `json:"version"`
	Revision        uint64     `json:"revision"`
	SourceCurrent   bool       `json:"source_current"`
	MediaKind       string     `json:"media_kind"`
	RotationDegrees int        `json:"rotation_degrees"`
	FlipHorizontal  bool       `json:"flip_horizontal"`
	FlipVertical    bool       `json:"flip_vertical"`
	CropX           float64    `json:"crop_x"`
	CropY           float64    `json:"crop_y"`
	CropWidth       float64    `json:"crop_width"`
	CropHeight      float64    `json:"crop_height"`
	ExposureEV      float64    `json:"exposure_ev"`
	Contrast        float64    `json:"contrast"`
	Saturation      float64    `json:"saturation"`
	TrimStartMS     int64      `json:"trim_start_ms"`
	TrimEndMS       int64      `json:"trim_end_ms"`
	UpdatedAt       *time.Time `json:"updated_at,omitempty"`
}

type MediaEditRecipeInput struct {
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

type MediaCreativePoint struct {
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
	Foreground bool    `json:"foreground"`
}

type MediaCreativeStrokePoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type MediaCreativeStroke struct {
	Radius float64                    `json:"radius"`
	Points []MediaCreativeStrokePoint `json:"points"`
}

type MediaCreativeInput struct {
	Kind            string                `json:"kind"`
	OutputName      string                `json:"output_name,omitempty"`
	CutoutMode      string                `json:"cutout_mode,omitempty"`
	Points          []MediaCreativePoint  `json:"points,omitempty"`
	Strokes         []MediaCreativeStroke `json:"strokes,omitempty"`
	SourceNodeIDs   []uint64              `json:"source_node_ids,omitempty"`
	MovieTemplate   string                `json:"movie_template,omitempty"`
	CollageTemplate string                `json:"collage_template,omitempty"`
	FrameDurationMS int                   `json:"frame_duration_ms,omitempty"`
	TransitionMS    *int                  `json:"transition_ms,omitempty"`
}

type MediaCreativeGeneration struct {
	ID                 string     `json:"id"`
	Kind               string     `json:"kind"`
	State              string     `json:"state"`
	SourceAssetID      uint64     `json:"source_asset_id"`
	SourceNodeID       uint64     `json:"source_node_id"`
	SourceNodeRevision uint64     `json:"source_node_revision"`
	AnalyzerVersion    string     `json:"analyzer_version,omitempty"`
	OutputNodeID       *uint64    `json:"output_node_id,omitempty"`
	LastError          string     `json:"last_error,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
	CompletedAt        *time.Time `json:"completed_at,omitempty"`
}

type MediaResource struct {
	Kind      string `json:"kind"`
	NodeID    uint64 `json:"node_id"`
	Role      string `json:"role"`
	Name      string `json:"name"`
	MediaKind string `json:"media_kind"`
	MIMEType  string `json:"mime_type,omitempty"`
	Size      int64  `json:"size"`
}

type MediaItem struct {
	Node             Node                   `json:"node"`
	Metadata         MediaMetadata          `json:"metadata"`
	AssetKind        string                 `json:"asset_kind,omitempty"`
	Favorite         bool                   `json:"favorite"`
	Tags             []string               `json:"tags,omitempty"`
	People           []string               `json:"people,omitempty"`
	Description      string                 `json:"description,omitempty"`
	EditRecipe       *MediaEditRecipe       `json:"edit_recipe,omitempty"`
	Resources        []MediaResource        `json:"resources,omitempty"`
	DerivedResources []MediaDerivedResource `json:"derived_resources,omitempty"`
	LivePhoto        bool                   `json:"live_photo,omitempty"`
	TrashRoot        *Node                  `json:"trash_root,omitempty"`
}

type MediaTimelineGroupIndex struct {
	Key        string `json:"key"`
	ItemCount  int64  `json:"item_count"`
	StartIndex int64  `json:"start_index"`
}

type MediaTimelineGroupSets struct {
	Year  []MediaTimelineGroupIndex `json:"year"`
	Month []MediaTimelineGroupIndex `json:"month"`
	Day   []MediaTimelineGroupIndex `json:"day"`
}

type MediaItemRange struct {
	Items             []MediaItem               `json:"items"`
	TotalCount        int64                     `json:"total_count"`
	Offset            int                       `json:"offset"`
	Limit             int                       `json:"limit"`
	TimelineGroups    []MediaTimelineGroupIndex `json:"timeline_groups,omitempty"`
	TimelineGroupSets *MediaTimelineGroupSets   `json:"timeline_group_sets,omitempty"`
}

type MediaSmartAlbumQuery struct {
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

type MediaAlbum struct {
	ID          string                `json:"id"`
	Kind        string                `json:"kind"`
	Name        string                `json:"name"`
	Revision    uint64                `json:"revision,omitempty"`
	ItemCount   int64                 `json:"item_count"`
	CoverNodeID *uint64               `json:"cover_node_id,omitempty"`
	UpdatedAt   *time.Time            `json:"updated_at,omitempty"`
	Query       *MediaSmartAlbumQuery `json:"query,omitempty"`
}

type MediaPlaceFacet struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	Latitude       float64    `json:"latitude"`
	Longitude      float64    `json:"longitude"`
	ItemCount      int64      `json:"item_count"`
	CoverNodeID    *uint64    `json:"cover_node_id,omitempty"`
	UpdatedAt      *time.Time `json:"updated_at,omitempty"`
	Attribution    string     `json:"attribution,omitempty"`
	AttributionURL string     `json:"attribution_url,omitempty"`
}

type MediaMemory struct {
	ID          string     `json:"id"`
	Kind        string     `json:"kind"`
	Title       string     `json:"title"`
	Subtitle    string     `json:"subtitle,omitempty"`
	StartDate   string     `json:"start_date,omitempty"`
	EndDate     string     `json:"end_date,omitempty"`
	AnchorDate  string     `json:"anchor_date,omitempty"`
	PlaceName   string     `json:"place_name,omitempty"`
	ItemCount   int64      `json:"item_count"`
	YearCount   int64      `json:"year_count,omitempty"`
	CoverNodeID *uint64    `json:"cover_node_id,omitempty"`
	UpdatedAt   *time.Time `json:"updated_at,omitempty"`
}

type MediaDuplicateGroup struct {
	ID                       string     `json:"id"`
	ItemCount                int64      `json:"item_count"`
	FileSizeBytes            int64      `json:"file_size_bytes"`
	LogicalDuplicateBytes    int64      `json:"logical_duplicate_bytes"`
	PhysicalReclaimableBytes int64      `json:"physical_reclaimable_bytes"`
	RecommendedKeepNodeID    uint64     `json:"recommended_keep_node_id"`
	RecommendationReason     string     `json:"recommendation_reason"`
	CoverNodeID              *uint64    `json:"cover_node_id,omitempty"`
	UpdatedAt                *time.Time `json:"updated_at,omitempty"`
}

type MediaDuplicateGroupList struct {
	Groups                   []MediaDuplicateGroup `json:"groups"`
	TotalGroups              int64                 `json:"total_groups"`
	TotalItems               int64                 `json:"total_items"`
	LogicalDuplicateBytes    int64                 `json:"logical_duplicate_bytes"`
	PhysicalReclaimableBytes int64                 `json:"physical_reclaimable_bytes"`
}

type MediaBurstReview struct {
	ID                       string     `json:"id"`
	ItemCount                int64      `json:"item_count"`
	RecommendedNodeID        uint64     `json:"recommended_node_id"`
	RecommendationReason     string     `json:"recommendation_reason"`
	CoverNodeID              *uint64    `json:"cover_node_id,omitempty"`
	TotalBytes               int64      `json:"total_bytes"`
	PotentialCleanupBytes    int64      `json:"potential_cleanup_bytes"`
	PhysicalReclaimableBytes int64      `json:"physical_reclaimable_bytes"`
	UpdatedAt                *time.Time `json:"updated_at,omitempty"`
}

type MediaBurstReviewList struct {
	Groups                   []MediaBurstReview `json:"groups"`
	TotalGroups              int64              `json:"total_groups"`
	TotalItems               int64              `json:"total_items"`
	PotentialCleanupBytes    int64              `json:"potential_cleanup_bytes"`
	PhysicalReclaimableBytes int64              `json:"physical_reclaimable_bytes"`
}

type MediaPetFacet struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	ItemCount   int64      `json:"item_count"`
	CoverNodeID *uint64    `json:"cover_node_id,omitempty"`
	UpdatedAt   *time.Time `json:"updated_at,omitempty"`
}

type MediaPersonSuggestionReview struct {
	ID             string  `json:"id"`
	ReviewState    string  `json:"review_state,omitempty"`
	TargetPersonID *string `json:"target_person_id,omitempty"`
}

type MediaSuggestedPerson struct {
	ID             string     `json:"id"`
	FaceCount      int64      `json:"face_count"`
	ItemCount      int64      `json:"item_count"`
	CoverNodeID    *uint64    `json:"cover_node_id,omitempty"`
	UpdatedAt      *time.Time `json:"updated_at,omitempty"`
	ReviewState    string     `json:"review_state,omitempty"`
	TargetPersonID *string    `json:"target_person_id,omitempty"`
}

type MediaPersonIdentity struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Hidden      bool       `json:"hidden"`
	Revision    uint64     `json:"revision"`
	ItemCount   int64      `json:"item_count"`
	CoverNodeID *uint64    `json:"cover_node_id,omitempty"`
	UpdatedAt   *time.Time `json:"updated_at,omitempty"`
}

type MediaPersonSplit struct {
	Source  MediaPersonIdentity `json:"source"`
	Created MediaPersonIdentity `json:"created"`
}

type UpdateMediaPersonIdentityInput struct {
	Name        *string
	Hidden      *bool
	CoverNodeID *uint64
}

type MediaQuery struct {
	MediaKind      string
	Search         string
	AssetKind      string
	Category       string
	CapturedFrom   *time.Time
	CapturedTo     *time.Time
	HasLocation    *bool
	Favorite       *bool
	Tag            string
	Person         string
	PersonIdentity string
	Place          string
}

func (q MediaQuery) add(values url.Values) {
	if value := strings.TrimSpace(q.MediaKind); value != "" {
		values.Set("kind", value)
	}
	if value := strings.TrimSpace(q.Search); value != "" {
		values.Set("q", value)
	}
	if value := strings.TrimSpace(q.AssetKind); value != "" {
		values.Set("asset_kind", value)
	}
	if value := strings.TrimSpace(q.Category); value != "" {
		values.Set("category", value)
	}
	if q.CapturedFrom != nil {
		values.Set("captured_from", q.CapturedFrom.UTC().Format(time.RFC3339))
	}
	if q.CapturedTo != nil {
		values.Set("captured_to", q.CapturedTo.UTC().Format(time.RFC3339))
	}
	if q.HasLocation != nil {
		values.Set("has_location", strconv.FormatBool(*q.HasLocation))
	}
	if q.Favorite != nil {
		values.Set("favorite", strconv.FormatBool(*q.Favorite))
	}
	if value := strings.TrimSpace(q.Tag); value != "" {
		values.Set("tag", value)
	}
	if value := strings.TrimSpace(q.Person); value != "" {
		values.Set("person", value)
	}
	if value := strings.TrimSpace(q.PersonIdentity); value != "" {
		values.Set("person_identity", value)
	}
	if value := strings.TrimSpace(q.Place); value != "" {
		values.Set("place", value)
	}
}

func (c *Client) MediaItems(
	ctx context.Context,
	kind string,
	limit, offset int,
) ([]MediaItem, error) {
	return c.MediaItemsQuery(
		ctx,
		MediaQuery{MediaKind: kind},
		limit,
		offset,
	)
}

func (c *Client) MediaItemsQuery(
	ctx context.Context,
	query MediaQuery,
	limit, offset int,
) ([]MediaItem, error) {
	values := url.Values{}
	query.add(values)
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		values.Set("offset", strconv.Itoa(offset))
	}
	path := "/api/v1/media/items"
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out []MediaItem
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) MediaItemsRangeQuery(
	ctx context.Context,
	query MediaQuery,
	limit, offset int,
) (MediaItemRange, error) {
	if offset < 0 {
		return MediaItemRange{}, fmt.Errorf("offset must be zero or greater")
	}
	values := url.Values{}
	query.add(values)
	values.Set("range", "true")
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	values.Set("offset", strconv.Itoa(offset))
	path := "/api/v1/media/items?" + values.Encode()
	var out MediaItemRange
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) MediaTrashRange(
	ctx context.Context,
	limit, offset int,
) (MediaItemRange, error) {
	if offset < 0 {
		return MediaItemRange{}, fmt.Errorf("offset must be zero or greater")
	}
	values := url.Values{}
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	values.Set("offset", strconv.Itoa(offset))
	var out MediaItemRange
	err := c.json(
		ctx,
		http.MethodGet,
		"/api/v1/media/trash?"+values.Encode(),
		nil,
		&out,
	)
	return out, err
}

func (c *Client) MediaItem(ctx context.Context, nodeID uint64) (MediaItem, error) {
	var out MediaItem
	err := c.json(
		ctx,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d", nodeID),
		nil,
		&out,
	)
	return out, err
}

func (c *Client) MediaAlbums(ctx context.Context) ([]MediaAlbum, error) {
	var out []MediaAlbum
	err := c.json(ctx, http.MethodGet, "/api/v1/media/albums", nil, &out)
	return out, err
}

func (c *Client) MediaPlaces(ctx context.Context, limit int) ([]MediaPlaceFacet, error) {
	values := url.Values{}
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	path := "/api/v1/media/places"
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out []MediaPlaceFacet
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) MediaMemories(
	ctx context.Context,
	anchorDate string,
	limit int,
) ([]MediaMemory, error) {
	values := url.Values{}
	if value := strings.TrimSpace(anchorDate); value != "" {
		values.Set("anchor_date", value)
	}
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	path := "/api/v1/media/memories"
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out []MediaMemory
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) MediaMemoryItemsRange(
	ctx context.Context,
	memoryID string,
	limit, offset int,
) (MediaItemRange, error) {
	if offset < 0 {
		return MediaItemRange{}, fmt.Errorf("offset must be zero or greater")
	}
	values := url.Values{}
	values.Set("range", "true")
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	values.Set("offset", strconv.Itoa(offset))
	path := "/api/v1/media/memories/" +
		url.PathEscape(strings.TrimSpace(memoryID)) + "/items?" + values.Encode()
	var out MediaItemRange
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) MediaDuplicateGroups(
	ctx context.Context,
	limit int,
) (MediaDuplicateGroupList, error) {
	values := url.Values{}
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	path := "/api/v1/media/duplicates"
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out MediaDuplicateGroupList
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) MediaDuplicateItemsRange(
	ctx context.Context,
	duplicateID string,
	limit, offset int,
) (MediaItemRange, error) {
	if offset < 0 {
		return MediaItemRange{}, fmt.Errorf("offset must be zero or greater")
	}
	values := url.Values{}
	values.Set("range", "true")
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	values.Set("offset", strconv.Itoa(offset))
	path := "/api/v1/media/duplicates/" +
		url.PathEscape(strings.TrimSpace(duplicateID)) + "/items?" + values.Encode()
	var out MediaItemRange
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) MediaBurstReviews(
	ctx context.Context,
	limit int,
) (MediaBurstReviewList, error) {
	values := url.Values{}
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	path := "/api/v1/media/bursts"
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out MediaBurstReviewList
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) MediaBurstReviewItemsRange(
	ctx context.Context,
	burstID string,
	limit, offset int,
) (MediaItemRange, error) {
	if offset < 0 {
		return MediaItemRange{}, fmt.Errorf("offset must be zero or greater")
	}
	values := url.Values{}
	values.Set("range", "true")
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	values.Set("offset", strconv.Itoa(offset))
	path := "/api/v1/media/bursts/" +
		url.PathEscape(strings.TrimSpace(burstID)) + "/items?" + values.Encode()
	var out MediaItemRange
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) MediaPets(
	ctx context.Context,
) ([]MediaPetFacet, error) {
	var out []MediaPetFacet
	err := c.json(ctx, http.MethodGet, "/api/v1/media/pets", nil, &out)
	return out, err
}

func (c *Client) MediaPetItemsRange(
	ctx context.Context,
	petKind string,
	limit, offset int,
) (MediaItemRange, error) {
	if offset < 0 {
		return MediaItemRange{}, fmt.Errorf("offset must be zero or greater")
	}
	values := url.Values{}
	values.Set("range", "true")
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	values.Set("offset", strconv.Itoa(offset))
	path := "/api/v1/media/pets/" +
		url.PathEscape(strings.TrimSpace(petKind)) + "/items?" + values.Encode()
	var out MediaItemRange
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) MediaSuggestedPeople(
	ctx context.Context,
	limit int,
) ([]MediaSuggestedPerson, error) {
	return c.MediaSuggestedPeopleWithReview(ctx, false, limit)
}

func (c *Client) MediaSuggestedPeopleWithReview(
	ctx context.Context,
	includeReviewed bool,
	limit int,
) ([]MediaSuggestedPerson, error) {
	values := url.Values{}
	if includeReviewed {
		values.Set("include_reviewed", "true")
	}
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	path := "/api/v1/media/people/suggestions"
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out []MediaSuggestedPerson
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) MediaSuggestedPersonItemsQuery(
	ctx context.Context,
	personID string,
	query MediaQuery,
	limit, offset int,
) ([]MediaItem, error) {
	values := url.Values{}
	query.add(values)
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		values.Set("offset", strconv.Itoa(offset))
	}
	path := "/api/v1/media/people/suggestions/" +
		url.PathEscape(strings.TrimSpace(personID)) + "/items"
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out []MediaItem
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) MediaSuggestedPersonItemsRangeQuery(
	ctx context.Context,
	personID string,
	query MediaQuery,
	limit, offset int,
) (MediaItemRange, error) {
	if offset < 0 {
		return MediaItemRange{}, fmt.Errorf("offset must be zero or greater")
	}
	values := url.Values{}
	query.add(values)
	values.Set("range", "true")
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	values.Set("offset", strconv.Itoa(offset))
	path := "/api/v1/media/people/suggestions/" +
		url.PathEscape(strings.TrimSpace(personID)) + "/items?" + values.Encode()
	var out MediaItemRange
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) MediaPersonIdentities(
	ctx context.Context,
	includeHidden bool,
	limit, offset int,
) ([]MediaPersonIdentity, error) {
	values := url.Values{}
	if includeHidden {
		values.Set("include_hidden", "true")
	}
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		values.Set("offset", strconv.Itoa(offset))
	}
	path := "/api/v1/media/people/identities"
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out []MediaPersonIdentity
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) MediaPersonIdentityItemsQuery(
	ctx context.Context,
	personID string,
	query MediaQuery,
	limit, offset int,
) ([]MediaItem, error) {
	values := url.Values{}
	query.add(values)
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		values.Set("offset", strconv.Itoa(offset))
	}
	path := "/api/v1/media/people/identities/" +
		url.PathEscape(strings.TrimSpace(personID)) + "/items"
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out []MediaItem
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) MediaPersonIdentityItemsRangeQuery(
	ctx context.Context,
	personID string,
	query MediaQuery,
	limit, offset int,
) (MediaItemRange, error) {
	if offset < 0 {
		return MediaItemRange{}, fmt.Errorf("offset must be zero or greater")
	}
	values := url.Values{}
	query.add(values)
	values.Set("range", "true")
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	values.Set("offset", strconv.Itoa(offset))
	path := "/api/v1/media/people/identities/" +
		url.PathEscape(strings.TrimSpace(personID)) + "/items?" + values.Encode()
	var out MediaItemRange
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) ReviewMediaSuggestedPerson(
	ctx context.Context,
	clusterID, state string,
) (MediaPersonSuggestionReview, error) {
	var out MediaPersonSuggestionReview
	err := c.json(
		ctx,
		http.MethodPatch,
		"/api/v1/media/people/suggestions/"+
			url.PathEscape(strings.TrimSpace(clusterID))+"/review",
		map[string]string{"state": state},
		&out,
	)
	return out, err
}

func (c *Client) AddMediaSuggestedPersonToIdentity(
	ctx context.Context,
	personID string,
	revision uint64,
	clusterID string,
) (MediaPersonIdentity, error) {
	var out MediaPersonIdentity
	err := c.jsonRevision(
		ctx,
		http.MethodPost,
		"/api/v1/media/people/identities/"+
			url.PathEscape(strings.TrimSpace(personID))+
			"/suggestions/"+
			url.PathEscape(strings.TrimSpace(clusterID)),
		revision,
		nil,
		&out,
	)
	return out, err
}

func (c *Client) AdoptMediaSuggestedPerson(
	ctx context.Context,
	clusterID, name string,
) (MediaPersonIdentity, error) {
	var out MediaPersonIdentity
	err := c.json(
		ctx,
		http.MethodPost,
		"/api/v1/media/people/suggestions/"+
			url.PathEscape(strings.TrimSpace(clusterID))+"/adopt",
		map[string]string{"name": name},
		&out,
	)
	return out, err
}

func (c *Client) UpdateMediaPersonIdentity(
	ctx context.Context,
	personID string,
	revision uint64,
	input UpdateMediaPersonIdentityInput,
) (MediaPersonIdentity, error) {
	body := map[string]any{}
	if input.Name != nil {
		body["name"] = *input.Name
	}
	if input.Hidden != nil {
		body["hidden"] = *input.Hidden
	}
	if input.CoverNodeID != nil {
		body["cover_node_id"] = *input.CoverNodeID
	}
	var out MediaPersonIdentity
	err := c.jsonRevision(
		ctx,
		http.MethodPatch,
		"/api/v1/media/people/identities/"+
			url.PathEscape(strings.TrimSpace(personID)),
		revision,
		body,
		&out,
	)
	return out, err
}

func (c *Client) MergeMediaPersonIdentities(
	ctx context.Context,
	targetID string,
	revision uint64,
	sourceIDs []string,
) (MediaPersonIdentity, error) {
	var out MediaPersonIdentity
	err := c.jsonRevision(
		ctx,
		http.MethodPost,
		"/api/v1/media/people/identities/"+
			url.PathEscape(strings.TrimSpace(targetID))+"/merge",
		revision,
		map[string][]string{"source_ids": sourceIDs},
		&out,
	)
	return out, err
}

func (c *Client) SplitMediaPersonIdentity(
	ctx context.Context,
	personID string,
	revision uint64,
	nodeIDs []uint64,
	name string,
) (MediaPersonSplit, error) {
	var out MediaPersonSplit
	err := c.jsonRevision(
		ctx,
		http.MethodPost,
		"/api/v1/media/people/identities/"+
			url.PathEscape(strings.TrimSpace(personID))+"/split",
		revision,
		map[string]any{"node_ids": nodeIDs, "name": name},
		&out,
	)
	return out, err
}

func (c *Client) CreateMediaAlbum(
	ctx context.Context,
	name string,
) (MediaAlbum, error) {
	var out MediaAlbum
	err := c.json(
		ctx,
		http.MethodPost,
		"/api/v1/media/albums",
		map[string]string{"name": name},
		&out,
	)
	return out, err
}

func (c *Client) RenameMediaAlbum(
	ctx context.Context,
	albumID string,
	revision uint64,
	name string,
) (MediaAlbum, error) {
	var out MediaAlbum
	err := c.jsonRevision(
		ctx,
		http.MethodPatch,
		"/api/v1/media/albums/"+url.PathEscape(albumID),
		revision,
		map[string]string{"name": name},
		&out,
	)
	return out, err
}

func (c *Client) DeleteMediaAlbum(
	ctx context.Context,
	albumID string,
	revision uint64,
) error {
	return c.jsonRevision(
		ctx,
		http.MethodDelete,
		"/api/v1/media/albums/"+url.PathEscape(albumID),
		revision,
		nil,
		nil,
	)
}

func (c *Client) AddMediaAlbumItems(
	ctx context.Context,
	albumID string,
	revision uint64,
	nodeIDs []uint64,
) (MediaAlbum, error) {
	var out MediaAlbum
	err := c.jsonRevision(
		ctx,
		http.MethodPost,
		"/api/v1/media/albums/"+url.PathEscape(albumID)+"/items",
		revision,
		map[string][]uint64{"node_ids": nodeIDs},
		&out,
	)
	return out, err
}

func (c *Client) RemoveMediaAlbumItem(
	ctx context.Context,
	albumID string,
	revision, nodeID uint64,
) (MediaAlbum, error) {
	var out MediaAlbum
	err := c.jsonRevision(
		ctx,
		http.MethodDelete,
		fmt.Sprintf(
			"/api/v1/media/albums/%s/items/%d",
			url.PathEscape(albumID),
			nodeID,
		),
		revision,
		nil,
		&out,
	)
	return out, err
}

func (c *Client) CreateSmartMediaAlbum(
	ctx context.Context,
	name string,
	query MediaSmartAlbumQuery,
) (MediaAlbum, error) {
	var out MediaAlbum
	err := c.json(
		ctx,
		http.MethodPost,
		"/api/v1/media/smart-albums",
		map[string]any{"name": name, "query": query},
		&out,
	)
	return out, err
}

func (c *Client) UpdateSmartMediaAlbum(
	ctx context.Context,
	albumID string,
	revision uint64,
	name *string,
	query *MediaSmartAlbumQuery,
) (MediaAlbum, error) {
	input := map[string]any{}
	if name != nil {
		input["name"] = *name
	}
	if query != nil {
		input["query"] = *query
	}
	var out MediaAlbum
	err := c.jsonRevision(
		ctx,
		http.MethodPatch,
		"/api/v1/media/smart-albums/"+url.PathEscape(albumID),
		revision,
		input,
		&out,
	)
	return out, err
}

func (c *Client) DeleteSmartMediaAlbum(
	ctx context.Context,
	albumID string,
	revision uint64,
) error {
	return c.jsonRevision(
		ctx,
		http.MethodDelete,
		"/api/v1/media/smart-albums/"+url.PathEscape(albumID),
		revision,
		nil,
		nil,
	)
}

func (c *Client) MediaAlbumItems(
	ctx context.Context,
	albumID string,
	limit, offset int,
) ([]MediaItem, error) {
	return c.MediaAlbumItemsQuery(
		ctx,
		albumID,
		MediaQuery{},
		limit,
		offset,
	)
}

func (c *Client) MediaAlbumItemsQuery(
	ctx context.Context,
	albumID string,
	query MediaQuery,
	limit, offset int,
) ([]MediaItem, error) {
	values := url.Values{}
	query.add(values)
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		values.Set("offset", strconv.Itoa(offset))
	}
	path := "/api/v1/media/albums/" + url.PathEscape(albumID) + "/items"
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out []MediaItem
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) MediaAlbumItemsRangeQuery(
	ctx context.Context,
	albumID string,
	query MediaQuery,
	limit, offset int,
) (MediaItemRange, error) {
	if offset < 0 {
		return MediaItemRange{}, fmt.Errorf("offset must be zero or greater")
	}
	values := url.Values{}
	query.add(values)
	values.Set("range", "true")
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	values.Set("offset", strconv.Itoa(offset))
	path := "/api/v1/media/albums/" +
		url.PathEscape(strings.TrimSpace(albumID)) + "/items?" + values.Encode()
	var out MediaItemRange
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

type MediaFavorite struct {
	Favorite bool `json:"favorite"`
}

func (c *Client) SetMediaFavorite(
	ctx context.Context,
	nodeID uint64,
	favorite bool,
) (MediaFavorite, error) {
	var out MediaFavorite
	err := c.json(
		ctx,
		http.MethodPatch,
		fmt.Sprintf("/api/v1/media/items/%d/favorite", nodeID),
		map[string]bool{"favorite": favorite},
		&out,
	)
	return out, err
}

type MediaBatchFavorite struct {
	Updated  int  `json:"updated"`
	Favorite bool `json:"favorite"`
}

func (c *Client) SetMediaFavoriteBatch(
	ctx context.Context,
	nodeIDs []uint64,
	favorite bool,
) (MediaBatchFavorite, error) {
	var out MediaBatchFavorite
	err := c.json(
		ctx,
		http.MethodPatch,
		"/api/v1/media/batch/favorite",
		map[string]any{"node_ids": nodeIDs, "favorite": favorite},
		&out,
	)
	return out, err
}

type MediaBatchTags struct {
	Updated int      `json:"updated"`
	Tags    []string `json:"tags"`
}

func (c *Client) AddMediaTagsBatch(
	ctx context.Context,
	nodeIDs []uint64,
	tags []string,
) (MediaBatchTags, error) {
	var out MediaBatchTags
	err := c.json(
		ctx,
		http.MethodPost,
		"/api/v1/media/batch/tags",
		map[string]any{"node_ids": nodeIDs, "tags": tags},
		&out,
	)
	return out, err
}

type MediaTags struct {
	Tags []string `json:"tags"`
}

func (c *Client) SetMediaTags(
	ctx context.Context,
	nodeID uint64,
	tags []string,
) (MediaTags, error) {
	var out MediaTags
	err := c.json(
		ctx,
		http.MethodPatch,
		fmt.Sprintf("/api/v1/media/items/%d/tags", nodeID),
		map[string][]string{"tags": tags},
		&out,
	)
	return out, err
}

type MediaPeople struct {
	People []string `json:"people"`
}

func (c *Client) SetMediaPeople(
	ctx context.Context,
	nodeID uint64,
	people []string,
) (MediaPeople, error) {
	var out MediaPeople
	err := c.json(
		ctx,
		http.MethodPatch,
		fmt.Sprintf("/api/v1/media/items/%d/people", nodeID),
		map[string][]string{"people": people},
		&out,
	)
	return out, err
}

type MediaDescription struct {
	Description string `json:"description"`
}

func (c *Client) SetMediaDescription(
	ctx context.Context,
	nodeID uint64,
	description string,
) (MediaDescription, error) {
	var out MediaDescription
	err := c.json(
		ctx,
		http.MethodPatch,
		fmt.Sprintf("/api/v1/media/items/%d/description", nodeID),
		map[string]string{"description": description},
		&out,
	)
	return out, err
}

func (c *Client) MediaEditRecipe(
	ctx context.Context,
	nodeID uint64,
) (MediaEditRecipe, error) {
	var out MediaEditRecipe
	err := c.json(
		ctx,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/edit", nodeID),
		nil,
		&out,
	)
	return out, err
}

func (c *Client) SaveMediaEditRecipe(
	ctx context.Context,
	nodeID uint64,
	input MediaEditRecipeInput,
) (MediaEditRecipe, error) {
	var out MediaEditRecipe
	err := c.json(
		ctx,
		http.MethodPut,
		fmt.Sprintf("/api/v1/media/items/%d/edit", nodeID),
		input,
		&out,
	)
	return out, err
}

func (c *Client) ResetMediaEditRecipe(
	ctx context.Context,
	nodeID, revision uint64,
) (MediaEditRecipe, error) {
	var out MediaEditRecipe
	err := c.json(
		ctx,
		http.MethodDelete,
		fmt.Sprintf(
			"/api/v1/media/items/%d/edit?revision=%d",
			nodeID,
			revision,
		),
		nil,
		&out,
	)
	return out, err
}

type MediaThumbnailResponse struct {
	Data        []byte
	ContentType string
	ETag        string
	MaxAge      time.Duration
	NotModified bool
}

func mediaResponseMaxAge(cacheControl string) time.Duration {
	for _, part := range strings.Split(cacheControl, ",") {
		part = strings.TrimSpace(part)
		if !strings.HasPrefix(strings.ToLower(part), "max-age=") {
			continue
		}
		raw := strings.TrimSpace(strings.TrimPrefix(strings.ToLower(part), "max-age="))
		seconds, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || seconds < 0 {
			return 0
		}
		return time.Duration(seconds) * time.Second
	}
	return 0
}

func (c *Client) CreateMediaCreativeGeneration(
	ctx context.Context,
	nodeID uint64,
	input MediaCreativeInput,
) (MediaCreativeGeneration, error) {
	var out MediaCreativeGeneration
	err := c.json(
		ctx,
		http.MethodPost,
		fmt.Sprintf("/api/v1/media/items/%d/creative", nodeID),
		input,
		&out,
	)
	return out, err
}

func (c *Client) MediaCreativeGeneration(
	ctx context.Context,
	generationID string,
) (MediaCreativeGeneration, error) {
	var out MediaCreativeGeneration
	err := c.json(
		ctx,
		http.MethodGet,
		"/api/v1/media/creative/"+url.PathEscape(strings.TrimSpace(generationID)),
		nil,
		&out,
	)
	return out, err
}

func (c *Client) CancelMediaCreativeGeneration(
	ctx context.Context,
	generationID string,
) (MediaCreativeGeneration, error) {
	var out MediaCreativeGeneration
	err := c.json(
		ctx,
		http.MethodPost,
		"/api/v1/media/creative/"+
			url.PathEscape(strings.TrimSpace(generationID))+
			"/cancel",
		nil,
		&out,
	)
	return out, err
}

func (c *Client) MediaThumbnailConditional(
	ctx context.Context,
	nodeID uint64,
	etag string,
) (MediaThumbnailResponse, error) {
	req, err := c.request(
		ctx,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/thumbnail?v=3", nodeID),
		nil,
	)
	if err != nil {
		return MediaThumbnailResponse{}, err
	}
	if value := strings.TrimSpace(etag); value != "" {
		req.Header.Set("If-None-Match", value)
	}
	resp, err := c.do(req)
	if err != nil {
		return MediaThumbnailResponse{}, err
	}
	defer resp.Body.Close()

	out := MediaThumbnailResponse{
		ContentType: strings.TrimSpace(resp.Header.Get("Content-Type")),
		ETag:        strings.TrimSpace(resp.Header.Get("ETag")),
		MaxAge:      mediaResponseMaxAge(resp.Header.Get("Cache-Control")),
	}
	if resp.StatusCode == http.StatusNotModified {
		out.NotModified = true
		return out, nil
	}
	if resp.StatusCode/100 != 2 {
		return MediaThumbnailResponse{}, responseError(resp)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return MediaThumbnailResponse{}, err
	}
	out.Data = data
	return out, nil
}

func (c *Client) MediaThumbnail(
	ctx context.Context,
	nodeID uint64,
) ([]byte, string, error) {
	response, err := c.MediaThumbnailConditional(ctx, nodeID, "")
	if err != nil {
		return nil, "", err
	}
	if response.NotModified {
		return nil, "", fmt.Errorf("unexpected thumbnail not-modified response")
	}
	return response.Data, response.ContentType, nil
}

func (c *Client) PutMediaVideoPoster(
	ctx context.Context,
	nodeID, revision uint64,
	data []byte,
) error {
	req, err := c.request(
		ctx,
		http.MethodPut,
		fmt.Sprintf("/api/v1/media/items/%d/video-poster", nodeID),
		bytes.NewReader(data),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "image/jpeg")
	req.Header.Set("If-Match", fmt.Sprintf("\"%d\"", revision))
	resp, err := c.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return responseError(resp)
	}
	return nil
}

func (c *Client) MediaAnalysisPreview(
	ctx context.Context,
	nodeID uint64,
) ([]byte, string, error) {
	req, err := c.request(
		ctx,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/analysis-preview", nodeID),
		nil,
	)
	if err != nil {
		return nil, "", err
	}
	resp, err := c.do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return nil, "", responseError(resp)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, "", err
	}
	return data, resp.Header.Get("Content-Type"), nil
}

func (c *Client) MediaLivePhotoMotion(
	ctx context.Context,
	nodeID uint64,
) (io.ReadCloser, string, int64, error) {
	req, err := c.request(
		ctx,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/live-photo-motion", nodeID),
		nil,
	)
	if err != nil {
		return nil, "", 0, err
	}
	resp, err := c.do(req)
	if err != nil {
		return nil, "", 0, err
	}
	if resp.StatusCode/100 != 2 {
		defer resp.Body.Close()
		return nil, "", 0, responseError(resp)
	}
	return resp.Body, resp.Header.Get("Content-Type"), resp.ContentLength, nil
}
