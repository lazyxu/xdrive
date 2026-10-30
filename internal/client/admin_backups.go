package client

import (
	"context"
	"encoding/json"
	"fmt"
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

// Keep the Desktop Agent client envelope in sync with the Server's v2
// read-only 10,000-generation index. Older Hosts still return the v1 1,000
// bound and explicitly disclose truncation; this does not authorize restore.
func validAdminServerBackupSnapshotPage(offset, limit int) bool {
	return offset >= 0 && offset <= 10_000 && limit >= 1 && limit <= 100
}

func (c *Client) AdminServerBackupSnapshotPage(ctx context.Context, offset, limit int) (json.RawMessage, error) {
	if !validAdminServerBackupSnapshotPage(offset, limit) {
		return nil, fmt.Errorf("invalid administrator backup snapshot page")
	}
	var out json.RawMessage
	path := fmt.Sprintf("/api/v1/admin/backups/snapshots?offset=%d&limit=%d", offset, limit)
	if err := c.json(ctx, http.MethodGet, path, nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}
