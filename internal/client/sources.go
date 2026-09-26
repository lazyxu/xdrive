package client

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

type Source struct {
	ID             uint64     `json:"id"`
	Name           string     `json:"name"`
	Kind           string     `json:"kind"`
	Direction      string     `json:"direction"`
	SyncMode       string     `json:"sync_mode"`
	RunMode        string     `json:"run_mode"`
	Status         string     `json:"status"`
	Revision       uint64     `json:"revision"`
	TargetNodeID   *uint64    `json:"target_node_id,omitempty"`
	IgnoreRules    string     `json:"ignore_rules,omitempty"`
	Checkpoint     string     `json:"checkpoint,omitempty"`
	LastRunAt      *time.Time `json:"last_run_at,omitempty"`
	LastSuccessAt  *time.Time `json:"last_success_at,omitempty"`
	LastError      string     `json:"last_error,omitempty"`
	RunRequestedAt *time.Time `json:"run_requested_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type CreateSourceInput struct {
	Name         string `json:"name"`
	Kind         string `json:"kind"`
	Direction    string `json:"direction"`
	SyncMode     string `json:"sync_mode,omitempty"`
	RunMode      string `json:"run_mode,omitempty"`
	TargetNodeID uint64 `json:"target_node_id"`
	IgnoreRules  string `json:"ignore_rules,omitempty"`
}

type UpdateSourceInput struct {
	Name         *string `json:"name,omitempty"`
	RunMode      *string `json:"run_mode,omitempty"`
	Status       *string `json:"status,omitempty"`
	TargetNodeID *uint64 `json:"target_node_id,omitempty"`
	IgnoreRules  *string `json:"ignore_rules,omitempty"`
}

type SyncRun struct {
	ID                   string     `json:"id"`
	SourceID             uint64     `json:"source_id"`
	SourceRevision       uint64     `json:"source_revision"`
	TargetNodeID         *uint64    `json:"target_node_id,omitempty"`
	IgnoreRules          string     `json:"ignore_rules,omitempty"`
	Mode                 string     `json:"mode"`
	Trigger              string     `json:"trigger"`
	Status               string     `json:"status"`
	CheckpointBefore     string     `json:"checkpoint_before,omitempty"`
	CheckpointAfter      string     `json:"checkpoint_after,omitempty"`
	ScannedItems         int64      `json:"scanned_items"`
	ScannedBytes         int64      `json:"scanned_bytes"`
	IgnoredItems         int64      `json:"ignored_items"`
	IgnoredBytes         int64      `json:"ignored_bytes"`
	NewItems             int64      `json:"new_items"`
	NewBytes             int64      `json:"new_bytes"`
	ChangedItems         int64      `json:"changed_items"`
	ChangedBytes         int64      `json:"changed_bytes"`
	MovedItems           int64      `json:"moved_items"`
	UnchangedItems       int64      `json:"unchanged_items"`
	UnchangedBytes       int64      `json:"unchanged_bytes"`
	MissingItems         int64      `json:"missing_items"`
	MissingBytes         int64      `json:"missing_bytes"`
	PlannedTransferItems int64      `json:"planned_transfer_items"`
	PlannedTransferBytes int64      `json:"planned_transfer_bytes"`
	CreatedItems         int64      `json:"created_items"`
	UpdatedItems         int64      `json:"updated_items"`
	SkippedItems         int64      `json:"skipped_items"`
	TransferredItems     int64      `json:"transferred_items"`
	TransferredBytes     int64      `json:"transferred_bytes"`
	FailedItems          int64      `json:"failed_items"`
	Error                string     `json:"error,omitempty"`
	StartedAt            time.Time  `json:"started_at"`
	FinishedAt           *time.Time `json:"finished_at,omitempty"`
}

func (c *Client) Sources(ctx context.Context) ([]Source, error) {
	var out []Source
	err := c.json(ctx, http.MethodGet, "/api/v1/sources", nil, &out)
	return out, err
}

func (c *Client) CreateSource(ctx context.Context, input CreateSourceInput) (Source, error) {
	var out Source
	err := c.json(ctx, http.MethodPost, "/api/v1/sources", input, &out)
	return out, err
}

func (c *Client) Source(ctx context.Context, id uint64) (Source, error) {
	var out Source
	err := c.json(ctx, http.MethodGet, fmt.Sprintf("/api/v1/sources/%d", id), nil, &out)
	return out, err
}

func (c *Client) UpdateSource(ctx context.Context, id, revision uint64, input UpdateSourceInput) (Source, error) {
	var out Source
	err := c.jsonRevision(ctx, http.MethodPatch, fmt.Sprintf("/api/v1/sources/%d", id), revision, input, &out)
	return out, err
}

func (c *Client) DeleteSource(ctx context.Context, id, revision uint64) error {
	return c.jsonRevision(ctx, http.MethodDelete, fmt.Sprintf("/api/v1/sources/%d", id), revision, nil, nil)
}

func (c *Client) TriggerSource(ctx context.Context, id uint64) (Source, error) {
	var out Source
	err := c.json(ctx, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/trigger", id), nil, &out)
	return out, err
}

type SourceCollection struct {
	ID             uint64    `json:"id"`
	ExternalID     string    `json:"external_id"`
	Kind           string    `json:"kind"`
	Name           string    `json:"name"`
	State          string    `json:"state"`
	RemoteRevision string    `json:"remote_revision,omitempty"`
	ItemCount      int64     `json:"item_count"`
	LastSeenAt     time.Time `json:"last_seen_at"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type SourceItemMetadata struct {
	OriginalPath    string     `json:"original_path,omitempty"`
	OwnerExternalID string     `json:"owner_external_id,omitempty"`
	RemoteCreatedAt *time.Time `json:"remote_created_at,omitempty"`
	ContentMD5      string     `json:"content_md5,omitempty"`
	ThumbnailURL    string     `json:"thumbnail_url,omitempty"`
	PairGroupID     string     `json:"pair_group_id,omitempty"`
	PairRole        string     `json:"pair_role,omitempty"`
}

type SourceItem struct {
	SourceItemID   uint64              `json:"source_item_id"`
	ExternalID     string              `json:"external_id"`
	NodeID         *uint64             `json:"node_id,omitempty"`
	Kind           string              `json:"kind"`
	Path           string              `json:"path"`
	Size           int64               `json:"size"`
	ModifiedAt     *time.Time          `json:"modified_at,omitempty"`
	SHA256         string              `json:"sha256,omitempty"`
	RemoteRevision string              `json:"remote_revision,omitempty"`
	State          string              `json:"state"`
	Metadata       *SourceItemMetadata `json:"metadata,omitempty"`
}

type SourceCollectionItem struct {
	Position       int64               `json:"position"`
	SourceItemID   uint64              `json:"source_item_id"`
	ExternalID     string              `json:"external_id"`
	NodeID         *uint64             `json:"node_id,omitempty"`
	Kind           string              `json:"kind"`
	Path           string              `json:"path"`
	Size           int64               `json:"size"`
	ModifiedAt     *time.Time          `json:"modified_at,omitempty"`
	SHA256         string              `json:"sha256,omitempty"`
	RemoteRevision string              `json:"remote_revision,omitempty"`
	State          string              `json:"state"`
	Metadata       *SourceItemMetadata `json:"metadata,omitempty"`
}

func (c *Client) SourceItems(ctx context.Context, id uint64, state string, limit, offset int) ([]SourceItem, error) {
	var out []SourceItem
	path := fmt.Sprintf("/api/v1/sources/%d/items", id)
	query := url.Values{}
	if state != "" {
		query.Set("state", state)
	}
	if limit > 0 {
		query.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		query.Set("offset", strconv.Itoa(offset))
	}
	if encoded := query.Encode(); encoded != "" {
		path += "?" + encoded
	}
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) SourceCollections(ctx context.Context, id uint64, state string) ([]SourceCollection, error) {
	var out []SourceCollection
	path := fmt.Sprintf("/api/v1/sources/%d/collections", id)
	if state != "" {
		path += "?state=" + url.QueryEscape(state)
	}
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) SourceCollectionItems(ctx context.Context, sourceID, collectionID uint64, limit, offset int) ([]SourceCollectionItem, error) {
	var out []SourceCollectionItem
	path := fmt.Sprintf("/api/v1/sources/%d/collections/%d/items", sourceID, collectionID)
	query := url.Values{}
	if limit > 0 {
		query.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		query.Set("offset", strconv.Itoa(offset))
	}
	if encoded := query.Encode(); encoded != "" {
		path += "?" + encoded
	}
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) SourceRuns(ctx context.Context, id uint64, limit int) ([]SyncRun, error) {
	var out []SyncRun
	path := fmt.Sprintf("/api/v1/sources/%d/runs", id)
	if limit > 0 {
		path += "?limit=" + url.QueryEscape(strconv.Itoa(limit))
	}
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

type SourceCredentialStatus struct {
	Configured bool       `json:"configured"`
	KeyVersion uint32     `json:"key_version,omitempty"`
	UpdatedAt  *time.Time `json:"updated_at,omitempty"`
}

func (c *Client) SourceCredentialStatus(ctx context.Context, id uint64) (SourceCredentialStatus, error) {
	var out SourceCredentialStatus
	err := c.json(ctx, http.MethodGet, fmt.Sprintf("/api/v1/sources/%d/credential", id), nil, &out)
	return out, err
}

func (c *Client) PutSourceCredential(ctx context.Context, id uint64, payload any) (SourceCredentialStatus, error) {
	var out SourceCredentialStatus
	err := c.json(ctx, http.MethodPut, fmt.Sprintf("/api/v1/sources/%d/credential", id), map[string]any{
		"payload": payload,
	}, &out)
	return out, err
}

func (c *Client) DeleteSourceCredential(ctx context.Context, id uint64) error {
	return c.json(ctx, http.MethodDelete, fmt.Sprintf("/api/v1/sources/%d/credential", id), nil, nil)
}

func (c *Client) SourceRun(ctx context.Context, id uint64, runID string) (SyncRun, error) {
	var out SyncRun
	err := c.json(ctx, http.MethodGet, fmt.Sprintf("/api/v1/sources/%d/runs/%s", id, url.PathEscape(runID)), nil, &out)
	return out, err
}

type SourceObservation struct {
	ExternalID     string     `json:"external_id"`
	Kind           string     `json:"kind"`
	Path           string     `json:"path"`
	Size           int64      `json:"size"`
	ModifiedAt     *time.Time `json:"modified_at,omitempty"`
	SHA256         string     `json:"sha256,omitempty"`
	RemoteRevision string     `json:"remote_revision,omitempty"`
}

type SourcePlan struct {
	ExternalID   string  `json:"external_id"`
	Action       string  `json:"action"`
	NodeID       *uint64 `json:"node_id,omitempty"`
	NodeRevision uint64  `json:"node_revision,omitempty"`
}

type FinishSourceRunInput struct {
	Status            string            `json:"status"`
	CompleteInventory bool              `json:"complete_inventory"`
	Checkpoint        string            `json:"checkpoint,omitempty"`
	Summary           sourcepkg.Summary `json:"summary"`
	Error             string            `json:"error,omitempty"`
}

type SourceCommit struct {
	ExternalID       string     `json:"external_id"`
	Action           string     `json:"action"`
	NodeID           uint64     `json:"node_id"`
	NodeRevision     uint64     `json:"node_revision"`
	Kind             string     `json:"kind"`
	Path             string     `json:"path"`
	Size             int64      `json:"size"`
	ModifiedAt       *time.Time `json:"modified_at,omitempty"`
	SHA256           string     `json:"sha256,omitempty"`
	RemoteRevision   string     `json:"remote_revision,omitempty"`
	Transferred      bool       `json:"transferred,omitempty"`
	TransferredBytes int64      `json:"transferred_bytes,omitempty"`
}

func (c *Client) BeginSourceRun(ctx context.Context, sourceID uint64, runID, trigger string) (SyncRun, error) {
	var out SyncRun
	err := c.json(ctx, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/runs", sourceID), map[string]any{
		"run_id":  runID,
		"trigger": trigger,
	}, &out)
	return out, err
}

func (c *Client) ObserveSourceItems(ctx context.Context, sourceID uint64, runID string, items []SourceObservation) ([]SourcePlan, error) {
	var out struct {
		Plans []SourcePlan `json:"plans"`
	}
	err := c.json(ctx, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/runs/%s/observe", sourceID, url.PathEscape(runID)), map[string]any{
		"items": items,
	}, &out)
	return out.Plans, err
}

func (c *Client) CommitSourceItems(ctx context.Context, sourceID uint64, runID string, items []SourceCommit) error {
	return c.json(ctx, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/runs/%s/commit", sourceID, url.PathEscape(runID)), map[string]any{
		"items": items,
	}, nil)
}

func (c *Client) HeartbeatSourceRun(ctx context.Context, sourceID uint64, runID string) error {
	return c.json(ctx, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/runs/%s/heartbeat", sourceID, url.PathEscape(runID)), map[string]any{}, nil)
}

func (c *Client) FinishSourceRun(ctx context.Context, sourceID uint64, runID string, input FinishSourceRunInput) (SyncRun, error) {
	var out SyncRun
	err := c.json(ctx, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/runs/%s/finish", sourceID, url.PathEscape(runID)), input, &out)
	return out, err
}
