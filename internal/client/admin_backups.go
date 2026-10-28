package client

import (
	"context"
	"encoding/json"
	"net/http"
)

// Fixed Server actions; no raw Host path or arbitrary command input.
type AdminServerBackupRequest struct {
	Action           string `json:"action"`
	SnapshotID       string `json:"snapshot_id,omitempty"`
	Format           string `json:"format,omitempty"`
	Mode             string `json:"mode,omitempty"`
	KeepLast         int    `json:"keep_last,omitempty"`
	RetentionDays    int    `json:"retention_days,omitempty"`
	Revision         string `json:"revision,omitempty"`
	Confirmation     string `json:"confirmation,omitempty"`
	PreviewRequestID string `json:"preview_request_id,omitempty"`
}

func (c *Client) AdminServerBackups(ctx context.Context) (json.RawMessage, error) {
	var out json.RawMessage
	if err := c.json(ctx, http.MethodGet, "/api/v1/admin/backups", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *Client) AdminServerBackupAction(ctx context.Context, input AdminServerBackupRequest) (json.RawMessage, error) {
	var out json.RawMessage
	if err := c.json(ctx, http.MethodPost, "/api/v1/admin/backups/actions", input, &out); err != nil {
		return nil, err
	}
	return out, nil
}
