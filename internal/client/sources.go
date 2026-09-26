package client

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

type Source struct {
	ID            uint64     `json:"id"`
	Name          string     `json:"name"`
	Kind          string     `json:"kind"`
	Direction     string     `json:"direction"`
	SyncMode      string     `json:"sync_mode"`
	RunMode       string     `json:"run_mode"`
	Status        string     `json:"status"`
	Revision      uint64     `json:"revision"`
	TargetNodeID  *uint64    `json:"target_node_id,omitempty"`
	IgnoreRules   string     `json:"ignore_rules,omitempty"`
	Checkpoint    string     `json:"checkpoint,omitempty"`
	LastRunAt     *time.Time `json:"last_run_at,omitempty"`
	LastSuccessAt *time.Time `json:"last_success_at,omitempty"`
	LastError     string     `json:"last_error,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
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

func (c *Client) SourceRuns(ctx context.Context, id uint64, limit int) ([]SyncRun, error) {
	var out []SyncRun
	path := fmt.Sprintf("/api/v1/sources/%d/runs", id)
	if limit > 0 {
		path += "?limit=" + url.QueryEscape(strconv.Itoa(limit))
	}
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) SourceRun(ctx context.Context, id uint64, runID string) (SyncRun, error) {
	var out SyncRun
	err := c.json(ctx, http.MethodGet, fmt.Sprintf("/api/v1/sources/%d/runs/%s", id, url.PathEscape(runID)), nil, &out)
	return out, err
}
