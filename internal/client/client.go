package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const childrenDefaultPageLimit = 200

type Client struct {
	BaseURL string
	Token   string
	HTTP    *http.Client

	sessionMu        sync.RWMutex
	refreshMu        sync.Mutex
	sharedRefreshMu  *sync.Mutex
	refreshToken     string
	accessExpiresAt  time.Time
	refreshExpiresAt time.Time
	onTokens         func(SessionTokens) error
	loadTokens       func() (SessionTokens, error)
}

type Node struct {
	ID        uint64     `json:"id"`
	ParentID  *uint64    `json:"parent_id,omitempty"`
	Name      string     `json:"name"`
	Type      string     `json:"type"`
	Size      int64      `json:"size"`
	Revision  uint64     `json:"revision"`
	SHA256    string     `json:"sha256,omitempty"`
	DeletedAt *time.Time `json:"deleted_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

type FileTextPreview struct {
	Text      string `json:"text"`
	Truncated bool   `json:"truncated"`
	Size      int64  `json:"size"`
}

type SearchBreadcrumb struct {
	ID   uint64 `json:"id"`
	Name string `json:"name"`
}

type SearchResult struct {
	Node        Node               `json:"node"`
	Path        string             `json:"path"`
	Breadcrumbs []SearchBreadcrumb `json:"breadcrumbs"`
}

type SearchPage struct {
	Items      []SearchResult `json:"items"`
	NextCursor string         `json:"next_cursor,omitempty"`
}

type FileExplorerGroupIndex struct {
	Key        string `json:"key"`
	ItemCount  int64  `json:"item_count"`
	StartIndex int64  `json:"start_index"`
}

type FileExplorerGroupingOptions struct {
	Group        string
	FoldersFirst *bool
}

type SearchRange struct {
	Items              []SearchResult           `json:"items"`
	TotalCount         int64                    `json:"total_count"`
	TotalCountIncluded *bool                    `json:"total_count_included,omitempty"`
	Offset             int                      `json:"offset"`
	Limit              int                      `json:"limit"`
	Sort               string                   `json:"sort"`
	Order              string                   `json:"order"`
	Groups             []FileExplorerGroupIndex `json:"groups,omitempty"`
}

func (r SearchRange) HasTotalCount() bool {
	return r.TotalCountIncluded == nil || *r.TotalCountIncluded
}

type FileQuickAccessItem struct {
	Node     Node               `json:"node"`
	Path     string             `json:"path"`
	Crumbs   []SearchBreadcrumb `json:"crumbs"`
	Position int                `json:"position"`
	PinnedAt time.Time          `json:"pinned_at"`
}

type FileTag struct {
	ID        uint64    `json:"id"`
	Name      string    `json:"name"`
	Color     string    `json:"color,omitempty"`
	ItemCount int64     `json:"item_count"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type FileNodeTags struct {
	NodeID uint64    `json:"node_id"`
	Tags   []FileTag `json:"tags"`
}

type FileSavedSearchFilters struct {
	Kind         string `json:"kind,omitempty"`
	ModifiedFrom string `json:"modifiedFrom,omitempty"`
	ModifiedTo   string `json:"modifiedTo,omitempty"`
	MinSize      *int64 `json:"minSize,omitempty"`
	MaxSize      *int64 `json:"maxSize,omitempty"`
	SourceID     uint64 `json:"sourceID,omitempty"`
	TagID        uint64 `json:"tagID,omitempty"`
}

type FileSavedSearch struct {
	ID        uint64                 `json:"id"`
	Name      string                 `json:"name"`
	Query     string                 `json:"query"`
	Filters   FileSavedSearchFilters `json:"filters"`
	Position  int                    `json:"position"`
	CreatedAt time.Time              `json:"created_at"`
	UpdatedAt time.Time              `json:"updated_at"`
}

type FileSavedSearchInput struct {
	Name    string                 `json:"name"`
	Query   string                 `json:"query"`
	Filters FileSavedSearchFilters `json:"filters"`
}

type FileFavoriteItem struct {
	Node        Node               `json:"node"`
	Path        string             `json:"path"`
	Crumbs      []SearchBreadcrumb `json:"crumbs"`
	FavoritedAt time.Time          `json:"favorited_at"`
}

type FileRecentItem struct {
	Node       Node               `json:"node"`
	Path       string             `json:"path"`
	Crumbs     []SearchBreadcrumb `json:"crumbs"`
	AccessedAt time.Time          `json:"accessed_at"`
}

type SearchFilters struct {
	Kind         string
	ModifiedFrom string
	ModifiedTo   string
	MinSize      *int64
	MaxSize      *int64
	SourceID     uint64
	TagID        uint64
}

func (filters SearchFilters) Active() bool {
	return strings.TrimSpace(filters.Kind) != "" ||
		strings.TrimSpace(filters.ModifiedFrom) != "" ||
		strings.TrimSpace(filters.ModifiedTo) != "" ||
		filters.MinSize != nil ||
		filters.MaxSize != nil ||
		filters.SourceID != 0 ||
		filters.TagID != 0
}

type SearchOptions struct {
	Query   string
	Type    string
	Filters SearchFilters
	Limit   int
	Cursor  string
	Sort    string
	Order   string
}

type SearchRangeOptions struct {
	Query          string
	Type           string
	Filters        SearchFilters
	Grouping       FileExplorerGroupingOptions
	IncludeAll     bool
	OmitTotalCount bool
	Limit          int
	Offset         int
	Sort           string
	Order          string
}

type ChildrenOptions struct {
	Limit  int
	Cursor string
	Sort   string
	Order  string
	Name   string
	NameCI string
}

type ChildrenPage struct {
	Items      []Node `json:"items"`
	NextCursor string `json:"next_cursor,omitempty"`
	HasMore    bool   `json:"has_more"`
	Sort       string `json:"sort"`
	Order      string `json:"order"`
}

type ChildrenRangeOptions struct {
	Limit          int
	Offset         int
	Sort           string
	Order          string
	OmitTotalCount bool
	Grouping       FileExplorerGroupingOptions
}

type ChildrenRange struct {
	Items              []Node                   `json:"items"`
	TotalCount         int64                    `json:"total_count"`
	TotalCountIncluded *bool                    `json:"total_count_included,omitempty"`
	Offset             int                      `json:"offset"`
	Limit              int                      `json:"limit"`
	Sort               string                   `json:"sort"`
	Order              string                   `json:"order"`
	Groups             []FileExplorerGroupIndex `json:"groups,omitempty"`
}

func (r ChildrenRange) HasTotalCount() bool {
	return r.TotalCountIncluded == nil || *r.TotalCountIncluded
}

type BatchNodeRef struct {
	ID       uint64 `json:"id"`
	Revision uint64 `json:"revision"`
}

type BatchNodesResult struct {
	OperationID string   `json:"operation_id"`
	Items       []Node   `json:"items,omitempty"`
	DeletedIDs  []uint64 `json:"deleted_ids,omitempty"`
}

type FilePropertiesSource struct {
	ID   uint64 `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

type FilePropertiesStats struct {
	SelectedCount      int64                  `json:"selected_count"`
	EffectiveRootCount int64                  `json:"effective_root_count"`
	TotalBytes         int64                  `json:"total_bytes"`
	FileCount          int64                  `json:"file_count"`
	FolderCount        int64                  `json:"folder_count"`
	Sources            []FilePropertiesSource `json:"sources,omitempty"`
}

type FileMediaDetails struct {
	ID         uint64 `json:"id"`
	Revision   uint64 `json:"revision"`
	Width      int    `json:"width,omitempty"`
	Height     int    `json:"height,omitempty"`
	DurationMS int64  `json:"duration_ms,omitempty"`
}

type BackgroundTaskProgress struct {
	Phase       string   `json:"phase,omitempty"`
	Current     int64    `json:"current,omitempty"`
	Total       int64    `json:"total,omitempty"`
	Unit        string   `json:"unit,omitempty"`
	Percent     *float64 `json:"percent,omitempty"`
	CurrentItem string   `json:"current_item,omitempty"`
}

type BackgroundTaskControlResult struct {
	TaskID       string `json:"task_id"`
	Action       string `json:"action"`
	ResultTaskID string `json:"result_task_id,omitempty"`
	Accepted     bool   `json:"accepted"`
}

type BackgroundTaskPage struct {
	CurrentItems []BackgroundTask `json:"current_items"`
	HistoryItems []BackgroundTask `json:"history_items"`
	NextCursor   string           `json:"next_cursor,omitempty"`
}

type ServiceDependency struct {
	ID         string `json:"id"`
	Group      string `json:"group"`
	Label      string `json:"label"`
	Status     string `json:"status"`
	Detail     string `json:"detail"`
	Version    string `json:"version,omitempty"`
	Model      string `json:"model,omitempty"`
	ConfigMode string `json:"config_mode"`
	ApplyMode  string `json:"apply_mode"`
	ConfigHint string `json:"config_hint,omitempty"`
}

type AdminGeoNamesConfig struct {
	DatasetConfigured bool    `json:"dataset_configured"`
	ReloadSupported   bool    `json:"reload_supported"`
	Source            string  `json:"source"`
	CurrentVersion    string  `json:"current_version"`
	MaxDistanceKM     float64 `json:"max_distance_km"`
	RequiresRestart   bool    `json:"requires_restart"`
}
type AdminGeoNamesReloadResult struct {
	Applied         bool   `json:"applied"`
	Changed         bool   `json:"changed"`
	PreviousVersion string `json:"previous_version"`
	CurrentVersion  string `json:"current_version"`
	CheckedAt       string `json:"checked_at"`
}

func (c *Client) AdminGeoNamesConfig(ctx context.Context) (AdminGeoNamesConfig, error) {
	var out AdminGeoNamesConfig
	err := c.json(ctx, http.MethodGet, "/api/v1/admin/services/geonames", nil, &out)
	return out, err
}
func (c *Client) ReloadAdminGeoNames(ctx context.Context, expectedVersion string) (AdminGeoNamesReloadResult, error) {
	var out AdminGeoNamesReloadResult
	err := c.json(ctx, http.MethodPost, "/api/v1/admin/services/geonames/reload", map[string]string{"expected_version": expectedVersion}, &out)
	return out, err
}

type AdminBaiduMapConfig struct {
	Enabled         bool       `json:"enabled"`
	Configured      bool       `json:"configured"`
	Source          string     `json:"source"`
	Editable        bool       `json:"editable"`
	RequiresRestart bool       `json:"requires_restart"`
	Revision        uint64     `json:"revision"`
	UpdatedAt       *time.Time `json:"updated_at,omitempty"`
}

type AdminBaiduMapUpdate struct {
	Enabled  bool   `json:"enabled"`
	Revision uint64 `json:"revision"`
	AK       string `json:"ak,omitempty"`
	ClearAK  bool   `json:"clear_ak,omitempty"`
}

type AdminBaiduMapAKReveal struct {
	Field            string `json:"field"`
	Value            string `json:"value"`
	ExpiresInSeconds int    `json:"expires_in_seconds"`
}

func (c *Client) RevealAdminBaiduMapAK(ctx context.Context, revision uint64) (AdminBaiduMapAKReveal, error) {
	var out AdminBaiduMapAKReveal
	err := c.json(ctx, http.MethodPost, "/api/v1/admin/services/baidu-map/reveal",
		map[string]uint64{"revision": revision}, &out)
	return out, err
}

func (c *Client) AdminBaiduMapConfig(ctx context.Context) (AdminBaiduMapConfig, error) {
	var result AdminBaiduMapConfig
	err := c.json(ctx, http.MethodGet, "/api/v1/admin/services/baidu-map", nil, &result)
	return result, err
}

func (c *Client) UpdateAdminBaiduMapConfig(ctx context.Context, input AdminBaiduMapUpdate) (AdminBaiduMapConfig, error) {
	var result AdminBaiduMapConfig
	err := c.json(ctx, http.MethodPut, "/api/v1/admin/services/baidu-map", input, &result)
	return result, err
}

type ServiceDependenciesSnapshot struct {
	CheckedAt string              `json:"checked_at"`
	Services  []ServiceDependency `json:"services"`
}

func (c *Client) AdminServices(ctx context.Context) (ServiceDependenciesSnapshot, error) {
	var out ServiceDependenciesSnapshot
	err := c.json(ctx, http.MethodGet, "/api/v1/admin/services", nil, &out)
	return out, err
}

type BackgroundTaskActiveSummary struct {
	ActiveTotal    int `json:"active_total"`
	FileOperation  int `json:"file_operation"`
	SyncRun        int `json:"sync_run"`
	ArchivePrepare int `json:"archive_prepare"`
	Scheduler      int `json:"scheduler"`
}

type BackgroundTask struct {
	ID             string                 `json:"id"`
	Kind           string                 `json:"kind"`
	Domain         string                 `json:"domain"`
	Scope          string                 `json:"scope"`
	OwnerID        uint64                 `json:"owner_id,omitempty"`
	OwnerUsername  string                 `json:"owner_username,omitempty"`
	State          string                 `json:"state"`
	Trigger        string                 `json:"trigger,omitempty"`
	Initiator      string                 `json:"initiator,omitempty"`
	Priority       *uint8                 `json:"priority,omitempty"`
	Resource       string                 `json:"resource,omitempty"`
	SourceID       uint64                 `json:"source_id,omitempty"`
	SourceName     string                 `json:"source_name,omitempty"`
	SourceKind     string                 `json:"source_kind,omitempty"`
	Progress       BackgroundTaskProgress `json:"progress"`
	ActiveCount    int                    `json:"active_count,omitempty"`
	QueuedCount    int                    `json:"queued_count,omitempty"`
	RunningCount   int                    `json:"running_count,omitempty"`
	InstanceCount  int                    `json:"instance_count,omitempty"`
	Attempt        int                    `json:"attempt,omitempty"`
	RetryAt        *time.Time             `json:"retry_at,omitempty"`
	TraceID        string                 `json:"trace_id,omitempty"`
	ParentKey      string                 `json:"parent_key,omitempty"`
	ControlActions []string               `json:"control_actions,omitempty"`
	StartedAt      *time.Time             `json:"started_at,omitempty"`
	UpdatedAt      time.Time              `json:"updated_at"`
	FinishedAt     *time.Time             `json:"finished_at,omitempty"`
	Error          string                 `json:"error,omitempty"`
}

type FileOperation struct {
	ID                string     `json:"id"`
	Type              string     `json:"type"`
	Status            string     `json:"status"`
	ParentID          *uint64    `json:"parent_id,omitempty"`
	RetryOfID         *string    `json:"retry_of_id,omitempty"`
	UndoOfID          *string    `json:"undo_of_id,omitempty"`
	UndoneByID        *string    `json:"undone_by_id,omitempty"`
	RedoOfID          *string    `json:"redo_of_id,omitempty"`
	RedoneByID        *string    `json:"redone_by_id,omitempty"`
	Undoable          bool       `json:"undoable"`
	Redoable          bool       `json:"redoable"`
	ConflictPolicy    string     `json:"conflict_policy,omitempty"`
	TotalItems        int64      `json:"total_items"`
	ProcessedItems    int64      `json:"processed_items"`
	TotalBytes        int64      `json:"total_bytes"`
	ProcessedBytes    int64      `json:"processed_bytes"`
	Percent           float64    `json:"percent"`
	CurrentItem       string     `json:"current_item,omitempty"`
	FailedItemID      uint64     `json:"failed_item_id,omitempty"`
	FailureCode       string     `json:"failure_code,omitempty"`
	Error             string     `json:"error,omitempty"`
	Retryable         bool       `json:"retryable"`
	CancelRequestedAt *time.Time `json:"cancel_requested_at,omitempty"`
	StartedAt         *time.Time `json:"started_at,omitempty"`
	FinishedAt        *time.Time `json:"finished_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type QuotaUsage struct {
	QuotaBytes         int64  `json:"quota_bytes"`
	PhysicalUsedBytes  int64  `json:"physical_used_bytes"`
	AvailableBytes     int64  `json:"available_bytes"`
	DiskAvailableBytes *int64 `json:"disk_available_bytes,omitempty"`
	LogicalFileBytes   int64  `json:"logical_file_bytes"`
	TrashBytes         int64  `json:"trash_bytes"`
	HistoryBytes       int64  `json:"history_bytes"`
	OverQuota          bool   `json:"over_quota"`
}

type StorageSizeBucket struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Count int64  `json:"count"`
	Bytes int64  `json:"bytes"`
}

type StorageInventoryItem struct {
	Key              string `json:"key"`
	Label            string `json:"label"`
	Category         string `json:"category"`
	Path             string `json:"path"`
	Files            int64  `json:"files"`
	Bytes            int64  `json:"bytes"`
	ReclaimableFiles int64  `json:"reclaimable_files"`
	ReclaimableBytes int64  `json:"reclaimable_bytes"`
	Deletable        bool   `json:"deletable"`
	CleanupKind      string `json:"cleanup_kind,omitempty"`
	Status           string `json:"status"`
}

type StorageInventory struct {
	Items             []StorageInventoryItem `json:"items"`
	StorageRootBytes  int64                  `json:"storage_root_bytes"`
	DatabaseBytes     int64                  `json:"database_bytes"`
	BackupBytes       int64                  `json:"backup_bytes"`
	HostServiceBytes  int64                  `json:"host_service_bytes"`
	TotalManagedBytes int64                  `json:"total_managed_bytes"`
	ReclaimableBytes  int64                  `json:"reclaimable_bytes"`
	UnclassifiedBytes int64                  `json:"unclassified_bytes"`
	GeneratedAt       time.Time              `json:"generated_at"`
}

type StorageCacheCleanup struct {
	Kind         string           `json:"kind"`
	DeletedFiles int64            `json:"deleted_files"`
	DeletedBytes int64            `json:"deleted_bytes"`
	FailedFiles  int64            `json:"failed_files"`
	Inventory    StorageInventory `json:"inventory"`
}

type StorageStats struct {
	Scope                     string              `json:"scope"`
	DiskTotalBytes            *int64              `json:"disk_total_bytes,omitempty"`
	DiskUsedBytes             *int64              `json:"disk_used_bytes,omitempty"`
	DiskAvailableBytes        *int64              `json:"disk_available_bytes,omitempty"`
	XDrivePhysicalBytes       *int64              `json:"xdrive_physical_bytes,omitempty"`
	Inventory                 *StorageInventory   `json:"inventory,omitempty"`
	FileCount                 int64               `json:"file_count,omitempty"`
	LogicalFileBytes          int64               `json:"logical_file_bytes,omitempty"`
	AverageFileSizeBytes      float64             `json:"average_file_size_bytes,omitempty"`
	P50FileSizeBytes          int64               `json:"p50_file_size_bytes,omitempty"`
	P90FileSizeBytes          int64               `json:"p90_file_size_bytes,omitempty"`
	P99FileSizeBytes          int64               `json:"p99_file_size_bytes,omitempty"`
	FileBuckets               []StorageSizeBucket `json:"file_buckets,omitempty"`
	CASBlobCount              int64               `json:"cas_blob_count,omitempty"`
	CASPhysicalBytes          int64               `json:"cas_physical_bytes,omitempty"`
	UnreferencedBlobCount     int64               `json:"unreferenced_blob_count,omitempty"`
	UnreferencedBlobBytes     int64               `json:"unreferenced_blob_bytes,omitempty"`
	CASLogicalReferencedBytes int64               `json:"cas_logical_referenced_bytes,omitempty"`
	CASDedupSavedBytes        int64               `json:"cas_dedup_saved_bytes,omitempty"`
	CASDedupRatio             float64             `json:"cas_dedup_ratio,omitempty"`
	CASSavingsRatio           float64             `json:"cas_savings_ratio,omitempty"`
	AverageBlobSizeBytes      float64             `json:"average_blob_size_bytes,omitempty"`
	P50BlobSizeBytes          int64               `json:"p50_blob_size_bytes,omitempty"`
	P90BlobSizeBytes          int64               `json:"p90_blob_size_bytes,omitempty"`
	P99BlobSizeBytes          int64               `json:"p99_blob_size_bytes,omitempty"`
	LegacyBlobCount           int64               `json:"legacy_blob_count,omitempty"`
	LegacyPhysicalBytes       int64               `json:"legacy_physical_bytes,omitempty"`
	Buckets                   []StorageSizeBucket `json:"buckets,omitempty"`
	GeneratedAt               time.Time           `json:"generated_at"`
}

type VersionInfo struct {
	Version       string `json:"version"`
	Channel       string `json:"channel,omitempty"`
	Commit        string `json:"commit,omitempty"`
	CommitMessage string `json:"commit_message,omitempty"`
	CommitTime    string `json:"commit_time,omitempty"`
	BuildTime     string `json:"build_time,omitempty"`
}

type ServerUpdateState struct {
	Supported         bool   `json:"supported"`
	State             string `json:"state"`
	Source            string `json:"source"`
	Channel           string `json:"channel"`
	BackupFileData    bool   `json:"backup_file_data"`
	RequestID         string `json:"request_id,omitempty"`
	Stage             string `json:"stage,omitempty"`
	StageCurrent      int    `json:"stage_current,omitempty"`
	StageTotal        int    `json:"stage_total,omitempty"`
	BytesDone         int64  `json:"bytes_done,omitempty"`
	BytesTotal        int64  `json:"bytes_total,omitempty"`
	Message           string `json:"message,omitempty"`
	Error             string `json:"error,omitempty"`
	StartedAt         string `json:"started_at,omitempty"`
	UpdatedAt         string `json:"updated_at,omitempty"`
	FinishedAt        string `json:"finished_at,omitempty"`
	RunnerHeartbeatAt string `json:"runner_heartbeat_at,omitempty"`
}

type AuthResponse struct {
	Token              string `json:"token"`
	AccessToken        string `json:"access_token"`
	RefreshToken       string `json:"refresh_token"`
	TokenType          string `json:"token_type"`
	ExpiresIn          int64  `json:"expires_in"`
	RefreshExpiresIn   int64  `json:"refresh_expires_in"`
	Username           string `json:"username"`
	Role               string `json:"role"`
	MustChangePassword bool   `json:"must_change_password"`
}

type APIError struct {
	Status int
	Msg    string
	Detail string
}

func (e *APIError) Error() string { return fmt.Sprintf("xdrive API: %s (%d)", e.Msg, e.Status) }

func IsRevisionConflict(err error) bool {
	var apiErr *APIError
	return errors.As(err, &apiErr) && apiErr.Status == http.StatusConflict && apiErr.Msg == "revision_conflict"
}

func New(baseURL, token string) *Client {
	return &Client{BaseURL: strings.TrimRight(baseURL, "/"), Token: token, HTTP: &http.Client{Timeout: 0}}
}

func (c *Client) Login(ctx context.Context, username, password string) (AuthResponse, error) {
	return c.authenticate(ctx, "/api/v1/auth/login", username, password)
}

func (c *Client) authenticate(ctx context.Context, path, username, password string) (AuthResponse, error) {
	var out AuthResponse
	body, _ := json.Marshal(map[string]string{"username": username, "password": password})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+path, bytes.NewReader(body))
	if err != nil {
		return out, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if err := decodeResponse(resp, &out); err != nil {
		return out, err
	}
	return out, nil
}

func (c *Client) ServerVersion(ctx context.Context) (VersionInfo, error) {
	var out VersionInfo
	if _, err := url.ParseRequestURI(c.BaseURL); err != nil {
		return out, fmt.Errorf("invalid server URL: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+"/api/v1/version", nil)
	if err != nil {
		return out, err
	}
	req.Header.Set("User-Agent", "xdrive-xd/0.1")
	resp, err := c.do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	err = decodeResponse(resp, &out)
	return out, err
}

func (c *Client) ServerUpdateState(ctx context.Context) (ServerUpdateState, error) {
	var out ServerUpdateState
	err := c.json(ctx, http.MethodGet, "/api/v1/admin/update", nil, &out)
	return out, err
}

func (c *Client) StartServerUpdate(ctx context.Context, source, channel string, backupFileData bool) (ServerUpdateState, error) {
	var out ServerUpdateState
	err := c.json(ctx, http.MethodPost, "/api/v1/admin/update", map[string]any{
		"source":           source,
		"channel":          channel,
		"backup_file_data": backupFileData,
	}, &out)
	return out, err
}

func (c *Client) Quota(ctx context.Context) (QuotaUsage, error) {
	var out QuotaUsage
	err := c.json(ctx, http.MethodGet, "/api/v1/me/quota", nil, &out)
	return out, err
}

func (c *Client) StorageStats(ctx context.Context) (StorageStats, error) {
	var out StorageStats
	err := c.json(ctx, http.MethodGet, "/api/v1/me/storage", nil, &out)
	return out, err
}

func (c *Client) CleanupStorageCache(ctx context.Context, kind string) (StorageCacheCleanup, error) {
	var out StorageCacheCleanup
	err := c.json(ctx, http.MethodPost, "/api/v1/admin/storage/cache/cleanup", map[string]string{
		"kind": strings.TrimSpace(kind),
	}, &out)
	return out, err
}

func (c *Client) Root(ctx context.Context) (Node, error) {
	var out Node
	err := c.json(ctx, http.MethodGet, "/api/v1/nodes/root", nil, &out)
	return out, err
}

func (c *Client) Node(ctx context.Context, id uint64) (Node, error) {
	var out Node
	err := c.json(ctx, http.MethodGet, fmt.Sprintf("/api/v1/nodes/%d", id), nil, &out)
	return out, err
}

func (c *Client) List(ctx context.Context, parentID uint64) ([]Node, error) {
	var out []Node
	err := c.json(ctx, http.MethodGet, fmt.Sprintf("/api/v1/nodes/%d/children", parentID), nil, &out)
	return out, err
}

func (c *Client) ListPage(ctx context.Context, parentID uint64, options ChildrenOptions) (ChildrenPage, error) {
	values := url.Values{}
	if options.Limit > 0 {
		values.Set("limit", strconv.Itoa(options.Limit))
	}
	if strings.TrimSpace(options.Cursor) != "" {
		values.Set("cursor", strings.TrimSpace(options.Cursor))
	}
	if strings.TrimSpace(options.Sort) != "" {
		values.Set("sort", strings.TrimSpace(options.Sort))
	}
	if strings.TrimSpace(options.Order) != "" {
		values.Set("order", strings.TrimSpace(options.Order))
	}
	if options.Name != "" {
		values.Set("name", options.Name)
	}
	if options.NameCI != "" {
		values.Set("name_ci", options.NameCI)
	}
	if values.Get("limit") == "" {
		values.Set("limit", strconv.Itoa(childrenDefaultPageLimit))
	}
	var out ChildrenPage
	err := c.json(ctx, http.MethodGet, fmt.Sprintf("/api/v1/nodes/%d/children?%s", parentID, values.Encode()), nil, &out)
	return out, err
}

func appendFileExplorerGrouping(values url.Values, grouping FileExplorerGroupingOptions) {
	if value := strings.TrimSpace(grouping.Group); value != "" {
		values.Set("group", value)
	}
	if grouping.FoldersFirst != nil {
		values.Set("folders_first", strconv.FormatBool(*grouping.FoldersFirst))
	}
}

func (c *Client) ListRange(ctx context.Context, parentID uint64, options ChildrenRangeOptions) (ChildrenRange, error) {
	if options.Offset < 0 {
		return ChildrenRange{}, fmt.Errorf("offset must be zero or greater")
	}
	values := url.Values{}
	if options.Limit > 0 {
		values.Set("limit", strconv.Itoa(options.Limit))
	}
	if values.Get("limit") == "" {
		values.Set("limit", strconv.Itoa(childrenDefaultPageLimit))
	}
	values.Set("offset", strconv.Itoa(options.Offset))
	if strings.TrimSpace(options.Sort) != "" {
		values.Set("sort", strings.TrimSpace(options.Sort))
	}
	if strings.TrimSpace(options.Order) != "" {
		values.Set("order", strings.TrimSpace(options.Order))
	}
	if options.OmitTotalCount {
		values.Set("include_count", "false")
	}
	appendFileExplorerGrouping(values, options.Grouping)
	var out ChildrenRange
	err := c.json(ctx, http.MethodGet, fmt.Sprintf("/api/v1/nodes/%d/children?%s", parentID, values.Encode()), nil, &out)
	return out, err
}

func appendSearchFilters(values url.Values, filters SearchFilters) {
	if value := strings.TrimSpace(filters.Kind); value != "" {
		values.Set("kind", value)
	}
	if value := strings.TrimSpace(filters.ModifiedFrom); value != "" {
		values.Set("modified_from", value)
	}
	if value := strings.TrimSpace(filters.ModifiedTo); value != "" {
		values.Set("modified_to", value)
	}
	if filters.MinSize != nil {
		values.Set("min_size", strconv.FormatInt(*filters.MinSize, 10))
	}
	if filters.MaxSize != nil {
		values.Set("max_size", strconv.FormatInt(*filters.MaxSize, 10))
	}
	if filters.SourceID != 0 {
		values.Set("source_id", strconv.FormatUint(filters.SourceID, 10))
	}
	if filters.TagID != 0 {
		values.Set("tag_id", strconv.FormatUint(filters.TagID, 10))
	}
}

func (c *Client) Search(ctx context.Context, options SearchOptions) (SearchPage, error) {
	values := url.Values{}
	values.Set("q", options.Query)
	if strings.TrimSpace(options.Type) != "" {
		values.Set("type", options.Type)
	}
	appendSearchFilters(values, options.Filters)
	if options.Limit > 0 {
		values.Set("limit", strconv.Itoa(options.Limit))
	}
	if strings.TrimSpace(options.Cursor) != "" {
		values.Set("cursor", options.Cursor)
	}
	if strings.TrimSpace(options.Sort) != "" {
		values.Set("sort", strings.TrimSpace(options.Sort))
	}
	if strings.TrimSpace(options.Order) != "" {
		values.Set("order", strings.TrimSpace(options.Order))
	}
	var out SearchPage
	err := c.json(ctx, http.MethodGet, "/api/v1/search?"+values.Encode(), nil, &out)
	return out, err
}

func (c *Client) SearchRange(ctx context.Context, options SearchRangeOptions) (SearchRange, error) {
	if options.Offset < 0 {
		return SearchRange{}, fmt.Errorf("offset must be zero or greater")
	}
	values := url.Values{}
	values.Set("q", options.Query)
	if strings.TrimSpace(options.Type) != "" {
		values.Set("type", options.Type)
	}
	appendSearchFilters(values, options.Filters)
	if options.Limit > 0 {
		values.Set("limit", strconv.Itoa(options.Limit))
	}
	values.Set("offset", strconv.Itoa(options.Offset))
	if options.IncludeAll {
		values.Set("include_all", "true")
	}
	if options.OmitTotalCount {
		values.Set("include_count", "false")
	}
	if strings.TrimSpace(options.Sort) != "" {
		values.Set("sort", strings.TrimSpace(options.Sort))
	}
	if strings.TrimSpace(options.Order) != "" {
		values.Set("order", strings.TrimSpace(options.Order))
	}
	appendFileExplorerGrouping(values, options.Grouping)
	var out SearchRange
	err := c.json(ctx, http.MethodGet, "/api/v1/search?"+values.Encode(), nil, &out)
	return out, err
}

func (c *Client) FileQuickAccess(ctx context.Context) ([]FileQuickAccessItem, error) {
	var out []FileQuickAccessItem
	err := c.json(ctx, http.MethodGet, "/api/v1/file-quick-access", nil, &out)
	return out, err
}

func (c *Client) PinFileQuickAccess(ctx context.Context, nodeID uint64) (FileQuickAccessItem, error) {
	var out FileQuickAccessItem
	err := c.json(ctx, http.MethodPut, fmt.Sprintf("/api/v1/file-quick-access/%d", nodeID), nil, &out)
	return out, err
}

func (c *Client) UnpinFileQuickAccess(ctx context.Context, nodeID uint64) error {
	req, err := c.request(ctx, http.MethodDelete, fmt.Sprintf("/api/v1/file-quick-access/%d", nodeID), nil)
	if err != nil {
		return err
	}
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

func (c *Client) ReorderFileQuickAccess(ctx context.Context, nodeIDs []uint64) error {
	return c.json(ctx, http.MethodPut, "/api/v1/file-quick-access/order", map[string]any{"node_ids": nodeIDs}, nil)
}

func (c *Client) FileTags(ctx context.Context) ([]FileTag, error) {
	var out []FileTag
	err := c.json(ctx, http.MethodGet, "/api/v1/file-tags", nil, &out)
	return out, err
}

func (c *Client) CreateFileTag(ctx context.Context, name, color string) (FileTag, error) {
	var out FileTag
	err := c.json(ctx, http.MethodPost, "/api/v1/file-tags", map[string]string{"name": name, "color": color}, &out)
	return out, err
}

func (c *Client) UpdateFileTag(ctx context.Context, tagID uint64, input map[string]string) (FileTag, error) {
	var out FileTag
	err := c.json(ctx, http.MethodPatch, fmt.Sprintf("/api/v1/file-tags/%d", tagID), input, &out)
	return out, err
}

func (c *Client) DeleteFileTag(ctx context.Context, tagID uint64) error {
	return c.json(ctx, http.MethodDelete, fmt.Sprintf("/api/v1/file-tags/%d", tagID), nil, nil)
}

func (c *Client) QueryFileNodeTags(ctx context.Context, nodeIDs []uint64) ([]FileNodeTags, error) {
	var out []FileNodeTags
	err := c.json(ctx, http.MethodPost, "/api/v1/nodes/tags/query", map[string]any{"node_ids": nodeIDs}, &out)
	return out, err
}

func (c *Client) SetFileTagNodes(ctx context.Context, tagID uint64, nodeIDs []uint64, assigned bool) error {
	method := http.MethodPut
	if !assigned {
		method = http.MethodDelete
	}
	return c.json(ctx, method, fmt.Sprintf("/api/v1/file-tags/%d/nodes", tagID), map[string]any{"node_ids": nodeIDs}, nil)
}

func (c *Client) FileSavedSearches(ctx context.Context) ([]FileSavedSearch, error) {
	var out []FileSavedSearch
	err := c.json(ctx, http.MethodGet, "/api/v1/file-saved-searches", nil, &out)
	return out, err
}

func (c *Client) CreateFileSavedSearch(ctx context.Context, input FileSavedSearchInput) (FileSavedSearch, error) {
	var out FileSavedSearch
	err := c.json(ctx, http.MethodPost, "/api/v1/file-saved-searches", input, &out)
	return out, err
}

func (c *Client) UpdateFileSavedSearch(ctx context.Context, id uint64, input FileSavedSearchInput) (FileSavedSearch, error) {
	var out FileSavedSearch
	err := c.json(ctx, http.MethodPatch, fmt.Sprintf("/api/v1/file-saved-searches/%d", id), input, &out)
	return out, err
}

func (c *Client) DeleteFileSavedSearch(ctx context.Context, id uint64) error {
	return c.json(ctx, http.MethodDelete, fmt.Sprintf("/api/v1/file-saved-searches/%d", id), nil, nil)
}

func (c *Client) ReorderFileSavedSearches(ctx context.Context, ids []uint64) error {
	return c.json(ctx, http.MethodPut, "/api/v1/file-saved-searches/order", map[string]any{"ids": ids}, nil)
}

func (c *Client) FileFavorites(ctx context.Context) ([]FileFavoriteItem, error) {
	var out []FileFavoriteItem
	err := c.json(ctx, http.MethodGet, "/api/v1/file-favorites", nil, &out)
	return out, err
}

func (c *Client) FavoriteFile(ctx context.Context, nodeID uint64) (FileFavoriteItem, error) {
	var out FileFavoriteItem
	err := c.json(ctx, http.MethodPut, fmt.Sprintf("/api/v1/file-favorites/%d", nodeID), nil, &out)
	return out, err
}

func (c *Client) UnfavoriteFile(ctx context.Context, nodeID uint64) error {
	req, err := c.request(ctx, http.MethodDelete, fmt.Sprintf("/api/v1/file-favorites/%d", nodeID), nil)
	if err != nil {
		return err
	}
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

func (c *Client) FileRecent(ctx context.Context, limit int) ([]FileRecentItem, error) {
	if limit <= 0 {
		limit = 16
	}
	var out []FileRecentItem
	err := c.json(ctx, http.MethodGet, fmt.Sprintf("/api/v1/file-recent?limit=%d", limit), nil, &out)
	return out, err
}

func (c *Client) TouchFileRecent(ctx context.Context, nodeID uint64) (FileRecentItem, error) {
	var out FileRecentItem
	err := c.json(ctx, http.MethodPost, fmt.Sprintf("/api/v1/file-recent/%d", nodeID), map[string]any{}, &out)
	return out, err
}

func (c *Client) ClearFileRecent(ctx context.Context) error {
	req, err := c.request(ctx, http.MethodDelete, "/api/v1/file-recent", nil)
	if err != nil {
		return err
	}
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

func (c *Client) CreateDir(ctx context.Context, parentID uint64, name string) (Node, error) {
	var out Node
	err := c.json(ctx, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", parentID), map[string]any{"name": name}, &out)
	return out, err
}

func (c *Client) Copy(ctx context.Context, id, parentID uint64, name *string) (Node, error) {
	var out Node
	body := map[string]any{"parent_id": parentID}
	if name != nil {
		body["name"] = *name
	}
	err := c.json(ctx, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/copy", id), body, &out)
	return out, err
}

func (c *Client) Move(ctx context.Context, id, revision, parentID uint64) (Node, error) {
	return c.RenameMove(ctx, id, revision, nil, &parentID)
}

func (c *Client) BatchCopy(ctx context.Context, items []BatchNodeRef, parentID uint64) (BatchNodesResult, error) {
	var out BatchNodesResult
	err := c.json(ctx, http.MethodPost, "/api/v1/nodes/batch/copy", map[string]any{"items": items, "parent_id": parentID}, &out)
	return out, err
}

func (c *Client) BatchMove(ctx context.Context, items []BatchNodeRef, parentID uint64) (BatchNodesResult, error) {
	var out BatchNodesResult
	err := c.json(ctx, http.MethodPost, "/api/v1/nodes/batch/move", map[string]any{"items": items, "parent_id": parentID}, &out)
	return out, err
}

func (c *Client) BatchDelete(ctx context.Context, items []BatchNodeRef) (BatchNodesResult, error) {
	var out BatchNodesResult
	err := c.json(ctx, http.MethodPost, "/api/v1/nodes/batch/delete", map[string]any{"items": items}, &out)
	return out, err
}

func (c *Client) FilePropertiesStats(ctx context.Context, items []BatchNodeRef) (FilePropertiesStats, error) {
	var out FilePropertiesStats
	err := c.json(
		ctx,
		http.MethodPost,
		"/api/v1/nodes/properties/stats",
		map[string]any{"items": items},
		&out,
	)
	return out, err
}

func (c *Client) FileMediaDetails(ctx context.Context, items []BatchNodeRef) ([]FileMediaDetails, error) {
	var out struct {
		Items []FileMediaDetails `json:"items"`
	}
	err := c.json(
		ctx,
		http.MethodPost,
		"/api/v1/nodes/media-details",
		map[string]any{"items": items},
		&out,
	)
	return out.Items, err
}

func (c *Client) CreateFileOperation(ctx context.Context, operationType string, items []BatchNodeRef, parentID uint64) (FileOperation, error) {
	return c.CreateFileOperationWithConflictPolicy(ctx, operationType, items, parentID, "")
}

func (c *Client) CreateFileOperationWithConflictPolicy(
	ctx context.Context,
	operationType string,
	items []BatchNodeRef,
	parentID uint64,
	conflictPolicy string,
) (FileOperation, error) {
	var out FileOperation
	body := map[string]any{"type": operationType, "items": items}
	if parentID != 0 {
		body["parent_id"] = parentID
	}
	if conflictPolicy != "" {
		body["conflict_policy"] = conflictPolicy
	}
	err := c.json(ctx, http.MethodPost, "/api/v1/file-operations", body, &out)
	return out, err
}

func (c *Client) ResolveFileOperationConflict(ctx context.Context, id, conflictPolicy string) (FileOperation, error) {
	var out FileOperation
	err := c.json(
		ctx,
		http.MethodPost,
		fmt.Sprintf("/api/v1/file-operations/%s/resolve", url.PathEscape(id)),
		map[string]any{"conflict_policy": conflictPolicy},
		&out,
	)
	return out, err
}

func (c *Client) BackgroundTaskActiveSummary(
	ctx context.Context,
) (BackgroundTaskActiveSummary, error) {
	var out BackgroundTaskActiveSummary
	err := c.json(
		ctx,
		http.MethodGet,
		"/api/v1/background-tasks/active-summary",
		nil,
		&out,
	)
	return out, err
}

func (c *Client) BackgroundTaskPage(
	ctx context.Context,
	limit int,
	cursor string,
	admin bool,
) (BackgroundTaskPage, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	endpoint := "/api/v1/background-tasks/page"
	if admin {
		endpoint = "/api/v1/admin/background-tasks/page"
	}
	query := url.Values{}
	query.Set("limit", strconv.Itoa(limit))
	if strings.TrimSpace(cursor) != "" {
		query.Set("cursor", strings.TrimSpace(cursor))
	}
	var out BackgroundTaskPage
	err := c.json(
		ctx,
		http.MethodGet,
		endpoint+"?"+query.Encode(),
		nil,
		&out,
	)
	return out, err
}

func (c *Client) ListBackgroundTasks(ctx context.Context, limit int) ([]BackgroundTask, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	var out []BackgroundTask
	err := c.json(ctx, http.MethodGet, fmt.Sprintf("/api/v1/background-tasks?limit=%d", limit), nil, &out)
	return out, err
}

func (c *Client) ListAdminBackgroundTasks(ctx context.Context, limit int) ([]BackgroundTask, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	var out []BackgroundTask
	err := c.json(ctx, http.MethodGet, fmt.Sprintf("/api/v1/admin/background-tasks?limit=%d", limit), nil, &out)
	return out, err
}

func (c *Client) ControlBackgroundTask(
	ctx context.Context,
	id, action string,
	global bool,
) (BackgroundTaskControlResult, error) {
	var out BackgroundTaskControlResult
	endpoint := "/api/v1/background-tasks/control"
	if global {
		endpoint = "/api/v1/admin/background-tasks/control"
	}
	err := c.json(
		ctx,
		http.MethodPost,
		endpoint,
		map[string]any{"id": id, "action": action},
		&out,
	)
	return out, err
}

func (c *Client) ListFileOperations(ctx context.Context, limit int) ([]FileOperation, error) {
	if limit <= 0 {
		limit = 50
	}
	var out []FileOperation
	err := c.json(ctx, http.MethodGet, fmt.Sprintf("/api/v1/file-operations?limit=%d", limit), nil, &out)
	return out, err
}

func (c *Client) ClearFileOperationHistory(ctx context.Context) error {
	req, err := c.request(ctx, http.MethodDelete, "/api/v1/file-operations", nil)
	if err != nil {
		return err
	}
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

func (c *Client) GetFileOperation(ctx context.Context, id string) (FileOperation, error) {
	var out FileOperation
	err := c.json(ctx, http.MethodGet, "/api/v1/file-operations/"+url.PathEscape(id), nil, &out)
	return out, err
}

func (c *Client) CancelFileOperation(ctx context.Context, id string) (FileOperation, error) {
	var out FileOperation
	err := c.json(ctx, http.MethodPost, "/api/v1/file-operations/"+url.PathEscape(id)+"/cancel", map[string]any{}, &out)
	return out, err
}

func (c *Client) RetryFileOperation(ctx context.Context, id string) (FileOperation, error) {
	var out FileOperation
	err := c.json(ctx, http.MethodPost, "/api/v1/file-operations/"+url.PathEscape(id)+"/retry", map[string]any{}, &out)
	return out, err
}

func (c *Client) UndoFileOperation(ctx context.Context, id string) (FileOperation, error) {
	var out FileOperation
	err := c.json(ctx, http.MethodPost, "/api/v1/file-operations/"+url.PathEscape(id)+"/undo", map[string]any{}, &out)
	return out, err
}

func (c *Client) RedoFileOperation(ctx context.Context, id string) (FileOperation, error) {
	var out FileOperation
	err := c.json(ctx, http.MethodPost, "/api/v1/file-operations/"+url.PathEscape(id)+"/redo", map[string]any{}, &out)
	return out, err
}

func (c *Client) RenameMove(ctx context.Context, id, revision uint64, name *string, parentID *uint64) (Node, error) {
	var out Node
	body := map[string]any{}
	if name != nil {
		body["name"] = *name
	}
	if parentID != nil {
		body["parent_id"] = *parentID
	}
	err := c.jsonRevision(ctx, http.MethodPatch, fmt.Sprintf("/api/v1/nodes/%d", id), revision, body, &out)
	return out, err
}

func (c *Client) Delete(ctx context.Context, id, revision uint64) error {
	req, err := c.request(ctx, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", id), nil)
	if err != nil {
		return err
	}
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

func (c *Client) UploadFile(ctx context.Context, parentID uint64, path, name string) (Node, error) {
	return c.UploadFileResumable(ctx, parentID, path, name, nil)
}

func (c *Client) Upload(ctx context.Context, parentID uint64, name string, r io.Reader) (Node, error) {
	var out Node
	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	go func() {
		part, err := mw.CreateFormFile("file", filepath.Base(name))
		if err == nil {
			_, err = io.Copy(part, r)
		}
		if err == nil {
			err = mw.Close()
		}
		_ = pw.CloseWithError(err)
	}()
	req, err := c.request(ctx, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/files", parentID), pr)
	if err != nil {
		return out, err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := c.do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if err := decodeResponse(resp, &out); err != nil {
		return out, err
	}
	return out, nil
}

func (c *Client) Overwrite(ctx context.Context, id, revision uint64, r io.Reader) (Node, error) {
	var out Node
	req, err := c.request(ctx, http.MethodPut, fmt.Sprintf("/api/v1/files/%d/content", id), r)
	if err != nil {
		return out, err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("If-Match", fmt.Sprintf("\"%d\"", revision))
	resp, err := c.do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if err := decodeResponse(resp, &out); err != nil {
		return out, err
	}
	return out, nil
}

func (c *Client) FileTextPreview(ctx context.Context, id uint64) (FileTextPreview, error) {
	var out FileTextPreview
	err := c.json(ctx, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/preview/text", id), nil, &out)
	return out, err
}

type DownloadProgress func(done, total int64)

type ArchivePrepareFile struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

type ArchivePrepare struct {
	TransferID string               `json:"transfer_id"`
	State      string               `json:"state"`
	Filename   string               `json:"filename,omitempty"`
	TotalBytes int64                `json:"total_bytes,omitempty"`
	Files      []ArchivePrepareFile `json:"files,omitempty"`
	Error      string               `json:"error,omitempty"`
}

func (c *Client) waitArchivePrepare(
	ctx context.Context,
	ids []uint64,
) (ArchivePrepare, error) {
	var prepared ArchivePrepare
	if err := c.json(
		ctx,
		http.MethodPost,
		"/api/v1/download/archive/prepare",
		map[string]any{"ids": ids},
		&prepared,
	); err != nil {
		return ArchivePrepare{}, err
	}
	for {
		switch prepared.State {
		case "completed":
			return prepared, nil
		case "failed", "cancelled":
			if prepared.Error == "" {
				prepared.Error = "archive prepare " + prepared.State
			}
			return ArchivePrepare{}, errors.New(prepared.Error)
		}
		select {
		case <-ctx.Done():
			return ArchivePrepare{}, ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
		if err := c.json(
			ctx,
			http.MethodGet,
			"/api/v1/download/archive/prepare/"+url.PathEscape(prepared.TransferID),
			nil,
			&prepared,
		); err != nil {
			return ArchivePrepare{}, err
		}
	}
}

func (c *Client) DownloadTo(ctx context.Context, id uint64, w io.Writer) error {
	return c.DownloadToProgress(ctx, id, w, nil)
}

func (c *Client) DownloadToProgress(ctx context.Context, id uint64, w io.Writer, progress DownloadProgress) error {
	req, err := c.request(ctx, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", id), nil)
	if err != nil {
		return err
	}
	resp, err := c.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return responseError(resp)
	}
	return copyDownloadResponse(resp, w, progress)
}

func (c *Client) DownloadArchiveTo(ctx context.Context, ids []uint64, w io.Writer) error {
	return c.DownloadArchiveToProgress(ctx, ids, w, nil)
}

func (c *Client) DownloadArchiveToProgress(
	ctx context.Context,
	ids []uint64,
	w io.Writer,
	progress DownloadProgress,
) error {
	if len(ids) == 0 || len(ids) > 1000 {
		return fmt.Errorf("archive download requires between 1 and 1000 node ids")
	}
	for _, id := range ids {
		if id == 0 {
			return fmt.Errorf("archive download node ids must be non-zero")
		}
	}
	prepared, err := c.waitArchivePrepare(ctx, ids)
	if err != nil {
		return err
	}
	body, err := json.Marshal(map[string]any{
		"ids":         ids,
		"transfer_id": prepared.TransferID,
	})
	if err != nil {
		return err
	}
	req, err := c.request(ctx, http.MethodPost, "/api/v1/download/archive", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return responseError(resp)
	}
	return copyDownloadResponse(resp, w, progress)
}

func copyDownloadResponse(resp *http.Response, w io.Writer, progress DownloadProgress) error {
	total := resp.ContentLength
	if total < 0 {
		total = 0
	}
	if progress != nil {
		progress(0, total)
	}
	writer := &progressWriter{writer: w, total: total, progress: progress}
	_, err := io.Copy(writer, resp.Body)
	return err
}

type progressWriter struct {
	writer     io.Writer
	total      int64
	done       int64
	progress   DownloadProgress
	lastReport time.Time
}

func (w *progressWriter) Write(p []byte) (int, error) {
	n, err := w.writer.Write(p)
	if n > 0 {
		w.done += int64(n)
		if w.progress != nil &&
			(w.lastReport.IsZero() || time.Since(w.lastReport) >= 100*time.Millisecond || (w.total > 0 && w.done >= w.total)) {
			w.progress(w.done, w.total)
			w.lastReport = time.Now()
		}
	}
	return n, err
}

func (c *Client) DownloadRange(ctx context.Context, id uint64, offset, length int64) ([]byte, error) {
	if length <= 0 {
		return nil, nil
	}
	req, err := c.request(ctx, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", id), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", offset, offset+length-1))
	resp, err := c.do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent && resp.StatusCode != http.StatusOK {
		return nil, responseError(resp)
	}
	return io.ReadAll(io.LimitReader(resp.Body, length))
}

func (c *Client) DownloadRangeInto(ctx context.Context, id uint64, offset int64, dst []byte) (int, error) {
	if len(dst) == 0 {
		return 0, nil
	}
	req, err := c.request(ctx, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", id), nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", offset, offset+int64(len(dst))-1))
	resp, err := c.do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent && resp.StatusCode != http.StatusOK {
		return 0, responseError(resp)
	}
	n, readErr := io.ReadFull(resp.Body, dst)
	if readErr == nil || errors.Is(readErr, io.EOF) || errors.Is(readErr, io.ErrUnexpectedEOF) {
		return n, nil
	}
	return n, readErr
}

const walkChildrenPageLimit = 500

func (c *Client) Walk(ctx context.Context) (map[string]Node, error) {
	root, err := c.Root(ctx)
	if err != nil {
		return nil, err
	}
	out := map[string]Node{"": root}
	var walk func(Node, string) error
	walk = func(parent Node, prefix string) error {
		cursor := ""
		for {
			page, err := c.ListPage(ctx, parent.ID, ChildrenOptions{
				Limit:  walkChildrenPageLimit,
				Cursor: cursor,
				Sort:   "name",
				Order:  "asc",
			})
			if err != nil {
				return err
			}
			for _, child := range page.Items {
				rel := child.Name
				if prefix != "" {
					rel = prefix + "/" + child.Name
				}
				out[rel] = child
				if child.Type == "dir" {
					if err := walk(child, rel); err != nil {
						return err
					}
				}
			}
			if !page.HasMore {
				break
			}
			nextCursor := strings.TrimSpace(page.NextCursor)
			if nextCursor == "" || nextCursor == cursor {
				return fmt.Errorf("children pagination did not advance for node %d", parent.ID)
			}
			cursor = nextCursor
		}
		return nil
	}
	if err := walk(root, ""); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *Client) jsonRevision(ctx context.Context, method, path string, revision uint64, in any, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := c.request(ctx, method, path, body)
	if err != nil {
		return err
	}
	req.Header.Set("If-Match", fmt.Sprintf("\"%d\"", revision))
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return decodeResponse(resp, out)
}

func (c *Client) json(ctx context.Context, method, path string, in any, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := c.request(ctx, method, path, body)
	if err != nil {
		return err
	}
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return decodeResponse(resp, out)
}

func (c *Client) request(ctx context.Context, method, path string, body io.Reader) (*http.Request, error) {
	if _, err := url.ParseRequestURI(c.BaseURL); err != nil {
		return nil, fmt.Errorf("invalid server URL: %w", err)
	}
	if err := c.ensureFresh(ctx); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, body)
	if err != nil {
		return nil, err
	}
	if token := c.accessToken(); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("User-Agent", "xdrive-xd/0.1")
	return req, nil
}

func (c *Client) do(req *http.Request) (*http.Response, error) {
	h := c.HTTP
	if h == nil {
		h = http.DefaultClient
	}
	resp, err := h.Do(req)
	if err != nil {
		return nil, err
	}
	return resp, nil
}

func decodeResponse(resp *http.Response, out any) error {
	if resp.StatusCode/100 != 2 {
		return responseError(resp)
	}
	if out == nil || resp.StatusCode == http.StatusNoContent {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func responseError(resp *http.Response) error {
	var e struct {
		Error  string `json:"error"`
		Detail string `json:"detail,omitempty"`
	}
	_ = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&e)
	if e.Error == "" {
		e.Error = http.StatusText(resp.StatusCode)
	}
	return &APIError{
		Status: resp.StatusCode,
		Msg:    e.Error,
		Detail: strings.TrimSpace(e.Detail),
	}
}

func ParseNodeID(identity []byte) (uint64, error) {
	id, err := strconv.ParseUint(strings.TrimSpace(string(identity)), 10, 64)
	if err != nil || id == 0 {
		return 0, errors.New("invalid node identity")
	}
	return id, nil
}
