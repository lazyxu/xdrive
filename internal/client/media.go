package client

import (
	"bytes"
	"context"
	"encoding/hex"
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
	CutoutExpand    float64               `json:"cutout_expand,omitempty"`
	CutoutFeather   float64               `json:"cutout_feather,omitempty"`
	Points          []MediaCreativePoint  `json:"points,omitempty"`
	Strokes         []MediaCreativeStroke `json:"strokes,omitempty"`
	SourceNodeIDs   []uint64              `json:"source_node_ids,omitempty"`
	MovieTemplate   string                `json:"movie_template,omitempty"`
	MusicNodeID     uint64                `json:"music_node_id,omitempty"`
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
	FoldMemberIDs    []uint64               `json:"fold_member_ids,omitempty"`
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
	AnchorIndex       *int64                    `json:"anchor_index,omitempty"`
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
	Cameras        []string   `json:"cameras,omitempty"`
	Formats        []string   `json:"formats,omitempty"`
	CapturedFrom   *time.Time `json:"captured_from,omitempty"`
	CapturedTo     *time.Time `json:"captured_to,omitempty"`
	HasLocation    *bool      `json:"has_location,omitempty"`
	Favorite       *bool      `json:"favorite,omitempty"`
	Tag            string     `json:"tag,omitempty"`
	Person         string     `json:"person,omitempty"`
	PersonIdentity string     `json:"person_identity,omitempty"`
	Place          string     `json:"place,omitempty"`
}

type MediaAlbumFolder struct {
	ID        uint64    `json:"id"`
	ParentID  uint64    `json:"parent_id"`
	Name      string    `json:"name"`
	Revision  uint64    `json:"revision"`
	UpdatedAt time.Time `json:"updated_at"`
}

type MediaAlbum struct {
	AlbumFolderID uint64                `json:"album_folder_id"`
	ID            string                `json:"id"`
	Kind          string                `json:"kind"`
	Name          string                `json:"name"`
	Revision      uint64                `json:"revision,omitempty"`
	ItemCount     int64                 `json:"item_count"`
	CoverNodeID   *uint64               `json:"cover_node_id,omitempty"`
	UpdatedAt     *time.Time            `json:"updated_at,omitempty"`
	Query         *MediaSmartAlbumQuery `json:"query,omitempty"`
}

type MediaSyncFolder struct {
	SourceID         uint64  `json:"source_id"`
	SourceName       string  `json:"source_name"`
	SourceKind       string  `json:"source_kind"`
	SourceStatus     string  `json:"source_status"`
	TargetNodeID     uint64  `json:"target_node_id"`
	TargetName       string  `json:"target_name"`
	TargetPath       string  `json:"target_path"`
	DirectMediaCount int64   `json:"direct_media_count"`
	ChildFolderCount int64   `json:"child_folder_count"`
	CoverNodeID      *uint64 `json:"cover_node_id,omitempty"`
}

type MediaFolderEntry struct {
	ID               uint64  `json:"id"`
	ParentID         *uint64 `json:"parent_id,omitempty"`
	Name             string  `json:"name"`
	Path             string  `json:"path"`
	DirectMediaCount int64   `json:"direct_media_count"`
	ChildFolderCount int64   `json:"child_folder_count"`
	CoverNodeID      *uint64 `json:"cover_node_id,omitempty"`
}

type MediaFolderBreadcrumb struct {
	ID   uint64 `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
}

type MediaFolderView struct {
	Source      MediaSyncFolder         `json:"source"`
	Current     MediaFolderEntry        `json:"current"`
	Breadcrumbs []MediaFolderBreadcrumb `json:"breadcrumbs"`
	Children    []MediaFolderEntry      `json:"children"`
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

type MediaFacetOption struct {
	Value     string `json:"value"`
	Label     string `json:"label"`
	ItemCount int64  `json:"item_count"`
}

type MediaGalleryFacets struct {
	Cameras []MediaFacetOption `json:"cameras"`
	Formats []MediaFacetOption `json:"formats"`
}

type MediaGalleryIndexStatus struct {
	KnownAssets           int64     `json:"known_assets"`
	ReadyAssets           int64     `json:"ready_assets"`
	FailedAssets          int64     `json:"failed_assets"`
	UnsupportedAssets     int64     `json:"unsupported_assets"`
	MissingMetadataAssets int64     `json:"missing_metadata_assets"`
	OtherUnreadyAssets    int64     `json:"other_unready_assets"`
	Scope                 string    `json:"scope"`
	CheckedAt             time.Time `json:"checked_at"`
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
	AssetComparison          string     `json:"asset_comparison"`
	AssetComparisonReason    string     `json:"asset_comparison_reason"`
	CoverNodeID              *uint64    `json:"cover_node_id,omitempty"`
	UpdatedAt                *time.Time `json:"updated_at,omitempty"`
}

type MediaDuplicateGroupList struct {
	Groups                   []MediaDuplicateGroup `json:"groups"`
	Offset                   int                   `json:"offset"`
	HasMore                  bool                  `json:"has_more"`
	TotalGroups              int64                 `json:"total_groups"`
	TotalItems               int64                 `json:"total_items"`
	LogicalDuplicateBytes    int64                 `json:"logical_duplicate_bytes"`
	PhysicalReclaimableBytes int64                 `json:"physical_reclaimable_bytes"`
}

type MediaDuplicateOrganizeCollection struct {
	ID   uint64 `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

type MediaDuplicateOrganizePerson struct {
	PersonKey string `json:"person_key"`
	Name      string `json:"name"`
}

type MediaDuplicateOrganizeResource struct {
	Kind       string `json:"kind"`
	Role       string `json:"role"`
	NodeID     uint64 `json:"node_id"`
	Ordinal    int    `json:"ordinal"`
	Name       string `json:"name"`
	MediaKind  string `json:"media_kind"`
	MIMEType   string `json:"mime_type"`
	Size       int64  `json:"size"`
	SHA256     string `json:"sha256"`
	ByteOffset int64  `json:"byte_offset"`
}

type MediaDuplicateOrganizeSourceLink struct {
	SourceID       uint64 `json:"source_id"`
	SourceName     string `json:"source_name"`
	SourceKind     string `json:"source_kind"`
	SourceStatus   string `json:"source_status"`
	Direction      string `json:"direction"`
	SyncMode       string `json:"sync_mode"`
	SourceItemID   uint64 `json:"source_item_id"`
	ResourceNodeID uint64 `json:"resource_node_id"`
	Path           string `json:"path"`
	ItemState      string `json:"item_state"`
	MayReimport    bool   `json:"may_reimport"`
}

type MediaDuplicateOrganizeMember struct {
	NodeID        uint64                             `json:"node_id"`
	AssetID       uint64                             `json:"asset_id"`
	AssetKind     string                             `json:"asset_kind"`
	NodeRevision  uint64                             `json:"node_revision"`
	SHA256        string                             `json:"sha256"`
	Favorite      bool                               `json:"favorite"`
	Description   string                             `json:"description"`
	Tags          []string                           `json:"tags"`
	PeopleLabels  []string                           `json:"people_labels"`
	Collections   []MediaDuplicateOrganizeCollection `json:"collections"`
	People        []MediaDuplicateOrganizePerson     `json:"durable_people"`
	Resources     []MediaDuplicateOrganizeResource   `json:"original_resources"`
	SourceLinks   []MediaDuplicateOrganizeSourceLink `json:"source_links"`
	EditRecipe    *MediaEditRecipe                   `json:"edit_recipe,omitempty"`
	HasEditRecipe bool                               `json:"has_edit_recipe"`
}

type MediaDuplicateOrganizePlan struct {
	PlanRevision               string                         `json:"plan_revision"`
	KeeperNodeID               uint64                         `json:"keeper_node_id"`
	Members                    []MediaDuplicateOrganizeMember `json:"members"`
	AssetComparison            string                         `json:"asset_comparison"`
	Reason                     string                         `json:"reason"`
	Descriptions               []string                       `json:"distinct_descriptions"`
	CombinedTags               []string                       `json:"combined_tags"`
	CombinedPeopleLabels       []string                       `json:"combined_people_labels"`
	CombinedFavorites          bool                           `json:"combined_favorite"`
	ManualAlbumCount           int                            `json:"manual_album_count"`
	DurablePersonCount         int                            `json:"durable_person_count"`
	SourceManagedAssets        int                            `json:"source_managed_assets"`
	PotentialReimportAssets    int                            `json:"potential_reimport_assets"`
	ReadyForManualReview       bool                           `json:"ready_for_manual_review"`
	RequiresManualConfirmation bool                           `json:"requires_manual_confirmation"`
	NoMutation                 bool                           `json:"no_mutation"`
	PhysicalReclaimableBytes   int64                          `json:"physical_reclaimable_bytes"`
	SourceWarning              string                         `json:"source_warning"`
}

// Explicit caller confirmation and verified plan fingerprint are required.
// Files and CAS references are never deleted by this annotation-only operation.
type MediaDuplicateOrganizeApplyInput struct {
	KeeperNodeID         uint64   `json:"keeper_node_id"`
	NodeIDs              []uint64 `json:"node_ids"`
	ExpectedPlanRevision string   `json:"expected_plan_revision"`
	SelectedDescription  *string  `json:"selected_description,omitempty"`
	Confirm              bool     `json:"confirm"`
}

type MediaDuplicateOrganizeApplyResult struct {
	KeeperNodeID           uint64 `json:"keeper_node_id"`
	MetadataUpdated        bool   `json:"metadata_updated"`
	ManualAlbumsAdded      int    `json:"manual_albums_added"`
	DurablePeopleAdded     int    `json:"durable_people_added"`
	OriginalFilesRetained  bool   `json:"original_files_retained"`
	OriginalEditsRetained  bool   `json:"original_edits_retained"`
	SourceLinksUnchanged   bool   `json:"source_links_unchanged"`
	PhysicalBytesReclaimed int64  `json:"physical_bytes_reclaimed"`
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
	Offset                   int                `json:"offset"`
	HasMore                  bool               `json:"has_more"`
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
	TimeZone           string
	AnchorNodeID       uint64
	FoldDuplicates     bool
	FoldMemberIDs      []uint64
	SortBy             string
	SortDir            string
	MediaKind          string
	Search             string
	AssetKind          string
	Category           string
	Cameras            []string
	Formats            []string
	FolderID           uint64
	IncludeDescendants bool
	CapturedFrom       *time.Time
	CapturedTo         *time.Time
	HasLocation        *bool
	Favorite           *bool
	Tag                string
	Person             string
	PersonIdentity     string
	Place              string
}

func (q MediaQuery) add(values url.Values) {
	if zone := strings.TrimSpace(q.TimeZone); zone != "" {
		values.Set("time_zone", zone)
	}
	if q.AnchorNodeID > 0 {
		values.Set("anchor_node_id", strconv.FormatUint(q.AnchorNodeID, 10))
	}
	if q.FoldDuplicates {
		values.Set("fold_duplicates", "true")
	}
	for _, id := range q.FoldMemberIDs {
		if id > 0 {
			values.Add("fold_member_id", strconv.FormatUint(id, 10))
		}
	}
	if value := strings.TrimSpace(q.SortBy); value != "" {
		values.Set("sort_by", value)
	}
	if value := strings.TrimSpace(q.SortDir); value != "" {
		values.Set("sort_dir", value)
	}
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
	for _, camera := range q.Cameras {
		if value := strings.TrimSpace(camera); value != "" {
			values.Add("camera", value)
		}
	}
	for _, format := range q.Formats {
		if value := strings.TrimSpace(format); value != "" {
			values.Add("format", value)
		}
	}
	if q.FolderID > 0 {
		values.Set("folder_id", strconv.FormatUint(q.FolderID, 10))
	}
	if q.FolderID > 0 && q.IncludeDescendants {
		values.Set("include_descendants", "true")
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

func (c *Client) MediaFacets(
	ctx context.Context,
	query MediaQuery,
	albumID string,
) (MediaGalleryFacets, error) {
	values := url.Values{}
	query.add(values)
	if value := strings.TrimSpace(albumID); value != "" {
		values.Set("album", value)
	}
	path := "/api/v1/media/facets"
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out MediaGalleryFacets
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

// MediaSelectionSnapshot is a transient server-frozen, read-only selection.
type MediaSelectionSnapshot struct {
	Token     string     `json:"token"`
	Version   uint64     `json:"version"`
	Total     int        `json:"total"`
	Selected  int        `json:"selected"`
	Excluded  int        `json:"excluded"`
	Day       string     `json:"day"`
	Scope     string     `json:"scope,omitempty"`
	CreatedAt *time.Time `json:"created_at,omitempty"`
	ExpiresAt time.Time  `json:"expires_at"`
}

type MediaSelectionSnapshotItem struct {
	NodeID   uint64 `json:"node_id"`
	Revision uint64 `json:"revision"`
	Name     string `json:"name"`
	Stale    bool   `json:"stale"`
}

type MediaSelectionSnapshotPage struct {
	MediaSelectionSnapshot
	Offset  int                          `json:"offset"`
	Limit   int                          `json:"limit"`
	Items   []MediaSelectionSnapshotItem `json:"items"`
	HasMore bool                         `json:"has_more"`
}

func (c *Client) MediaCreateSelectionSnapshot(ctx context.Context, query MediaQuery, albumID, day string) (MediaSelectionSnapshot, error) {
	values := url.Values{}
	query.add(values)
	if albumID != "" {
		values.Set("album_id", albumID)
	}
	if day != "" {
		values.Set("day", day)
	}
	path := "/api/v1/media/selection-snapshots?" + values.Encode()
	var out MediaSelectionSnapshot
	err := c.json(ctx, http.MethodPost, path, nil, &out)
	return out, err
}

func (c *Client) MediaGetSelectionSnapshot(ctx context.Context, token string, offset, limit int) (MediaSelectionSnapshotPage, error) {
	if offset < 0 || limit < 1 || limit > 200 {
		return MediaSelectionSnapshotPage{}, fmt.Errorf("selection page offset/limit invalid")
	}
	path := "/api/v1/media/selection-snapshots/" + url.PathEscape(token) + "?offset=" + strconv.Itoa(offset) + "&limit=" + strconv.Itoa(limit)
	var out MediaSelectionSnapshotPage
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) MediaSetSelectionExcluded(ctx context.Context, token string, nodeID uint64, excluded bool, version uint64) (MediaSelectionSnapshot, error) {
	if nodeID == 0 || version == 0 {
		return MediaSelectionSnapshot{}, fmt.Errorf("node ID and selection version are required")
	}
	path := "/api/v1/media/selection-snapshots/" + url.PathEscape(token) + "/exclusion"
	input := struct {
		NodeID   uint64 `json:"node_id"`
		Excluded bool   `json:"excluded"`
		Version  uint64 `json:"version"`
	}{NodeID: nodeID, Excluded: excluded, Version: version}
	var out MediaSelectionSnapshot
	err := c.json(ctx, http.MethodPatch, path, input, &out)
	return out, err
}

func (c *Client) MediaDeleteSelectionSnapshot(ctx context.Context, token string) error {
	path := "/api/v1/media/selection-snapshots/" + url.PathEscape(token)
	return c.json(ctx, http.MethodDelete, path, nil, nil)
}

func (c *Client) MediaIndexStatus(ctx context.Context) (MediaGalleryIndexStatus, error) {
	var out MediaGalleryIndexStatus
	err := c.json(ctx, http.MethodGet, "/api/v1/media/index-status", nil, &out)
	return out, err
}

func (c *Client) MediaSyncFolders(ctx context.Context) ([]MediaSyncFolder, error) {
	var out []MediaSyncFolder
	err := c.json(ctx, http.MethodGet, "/api/v1/media/sync-folders", nil, &out)
	return out, err
}

func (c *Client) MediaSyncFolder(
	ctx context.Context,
	sourceID uint64,
	folderID uint64,
) (MediaFolderView, error) {
	if sourceID == 0 || folderID == 0 {
		return MediaFolderView{}, fmt.Errorf("source and folder ids are required")
	}
	var out MediaFolderView
	err := c.json(
		ctx,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/sync-folders/%d/folders/%d", sourceID, folderID),
		nil,
		&out,
	)
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

// MediaAlbumFolders lists only folders belonging to the current authenticated owner.
func (c *Client) MediaAlbumFolders(ctx context.Context) ([]MediaAlbumFolder, error) {
	var out []MediaAlbumFolder
	err := c.json(ctx, http.MethodGet, "/api/v1/media/album-folders", nil, &out)
	return out, err
}

func (c *Client) CreateMediaAlbumFolder(ctx context.Context, name string, parentID uint64) (MediaAlbumFolder, error) {
	var out MediaAlbumFolder
	err := c.json(ctx, http.MethodPost, "/api/v1/media/album-folders",
		map[string]any{"name": name, "parent_id": parentID}, &out)
	return out, err
}

func (c *Client) UpdateMediaAlbumFolder(
	ctx context.Context, folderID, revision uint64, name *string, parentID *uint64,
) (MediaAlbumFolder, error) {
	input := map[string]any{}
	if name != nil {
		input["name"] = *name
	}
	if parentID != nil {
		input["parent_id"] = *parentID
	}
	var out MediaAlbumFolder
	err := c.jsonRevision(ctx, http.MethodPatch,
		fmt.Sprintf("/api/v1/media/album-folders/%d", folderID), revision, input, &out)
	return out, err
}

func (c *Client) DeleteMediaAlbumFolder(ctx context.Context, folderID, revision uint64) error {
	return c.jsonRevision(ctx, http.MethodDelete,
		fmt.Sprintf("/api/v1/media/album-folders/%d", folderID), revision, nil, nil)
}

func (c *Client) MoveMediaAlbumToFolder(
	ctx context.Context, albumID string, revision, folderID uint64,
) (MediaAlbum, error) {
	var out MediaAlbum
	err := c.jsonRevision(ctx, http.MethodPatch,
		"/api/v1/media/albums/"+url.PathEscape(albumID)+"/folder",
		revision, map[string]uint64{"folder_id": folderID}, &out)
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
	zoneName ...string,
) ([]MediaMemory, error) {
	values := url.Values{}
	if value := strings.TrimSpace(anchorDate); value != "" {
		values.Set("anchor_date", value)
	}
	if len(zoneName) > 0 && strings.TrimSpace(zoneName[0]) != "" {
		values.Set("time_zone", strings.TrimSpace(zoneName[0]))
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
	zoneName ...string,
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
	if len(zoneName) > 0 && strings.TrimSpace(zoneName[0]) != "" {
		values.Set("time_zone", strings.TrimSpace(zoneName[0]))
	}
	path := "/api/v1/media/memories/" +
		url.PathEscape(strings.TrimSpace(memoryID)) + "/items?" + values.Encode()
	var out MediaItemRange
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) MediaDuplicateOrganizePlan(
	ctx context.Context,
	keeperID uint64,
	nodeIDs []uint64,
) (MediaDuplicateOrganizePlan, error) {
	var out MediaDuplicateOrganizePlan
	if keeperID == 0 || len(nodeIDs) < 2 || len(nodeIDs) > 32 {
		return out, fmt.Errorf("duplicate organization requires keeper and 2–32 members")
	}
	query := url.Values{}
	query.Set("keeper_id", strconv.FormatUint(keeperID, 10))
	seen := make(map[uint64]struct{}, len(nodeIDs))
	includesKeeper := false
	for _, nodeID := range nodeIDs {
		if nodeID == 0 {
			return out, fmt.Errorf("invalid duplicate organization member")
		}
		if _, exists := seen[nodeID]; exists {
			return out, fmt.Errorf("duplicate organization members must be distinct")
		}
		seen[nodeID] = struct{}{}
		includesKeeper = includesKeeper || nodeID == keeperID
		query.Add("node_id", strconv.FormatUint(nodeID, 10))
	}
	if !includesKeeper {
		return out, fmt.Errorf("keeper must belong to selected members")
	}
	err := c.json(ctx, http.MethodGet,
		"/api/v1/media/duplicate-organize/plan?"+query.Encode(), nil, &out)
	return out, err
}

// MediaDuplicateOrganizeApply transfers only user-owned annotations to the
// selected keeper. The Server re-verifies resources, ownership, edits and
// the exact preview fingerprint inside a serializable transaction.
func (c *Client) MediaDuplicateOrganizeApply(
	ctx context.Context,
	input MediaDuplicateOrganizeApplyInput,
) (MediaDuplicateOrganizeApplyResult, error) {
	var out MediaDuplicateOrganizeApplyResult
	if !input.Confirm || input.KeeperNodeID == 0 ||
		len(input.NodeIDs) < 2 || len(input.NodeIDs) > 32 ||
		len(input.ExpectedPlanRevision) != 64 {
		return out, fmt.Errorf("confirmed 2–32 distinct original nodes and current plan revision required")
	}
	if _, err := hex.DecodeString(input.ExpectedPlanRevision); err != nil {
		return out, fmt.Errorf("invalid duplicate organization plan revision")
	}
	seen := make(map[uint64]struct{}, len(input.NodeIDs))
	for _, id := range input.NodeIDs {
		if id == 0 {
			return out, fmt.Errorf("invalid duplicate organization member")
		}
		if _, duplicate := seen[id]; duplicate {
			return out, fmt.Errorf("duplicate organization members must be distinct")
		}
		seen[id] = struct{}{}
	}
	if _, ok := seen[input.KeeperNodeID]; !ok {
		return out, fmt.Errorf("keeper must belong to original members")
	}
	err := c.json(ctx, http.MethodPost, "/api/v1/media/duplicate-organize/apply", input, &out)
	return out, err
}

func (c *Client) MediaDuplicateGroups(
	ctx context.Context,
	limit int,
	offsets ...int,
) (MediaDuplicateGroupList, error) {
	values := url.Values{}
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	if len(offsets) != 0 {
		if offsets[0] < 0 {
			return MediaDuplicateGroupList{}, fmt.Errorf("offset must be zero or greater")
		}
		values.Set("offset", strconv.Itoa(offsets[0]))
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
	offsets ...int,
) (MediaBurstReviewList, error) {
	values := url.Values{}
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	if len(offsets) != 0 {
		if offsets[0] < 0 {
			return MediaBurstReviewList{}, fmt.Errorf("offset must be zero or greater")
		}
		values.Set("offset", strconv.Itoa(offsets[0]))
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

func (c *Client) SetMediaAlbumCover(
	ctx context.Context,
	albumID string,
	revision, nodeID uint64,
) (MediaAlbum, error) {
	var out MediaAlbum
	err := c.jsonRevision(
		ctx,
		http.MethodPut,
		"/api/v1/media/albums/"+url.PathEscape(albumID)+"/cover",
		revision,
		map[string]uint64{"node_id": nodeID},
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
