package client

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
)

type AdminAuditRangeQuery struct {
	Limit         int     `json:"limit"`
	Offset        int     `json:"offset"`
	SnapshotMaxID *uint64 `json:"snapshot_max_id,omitempty"`
	Action        string  `json:"action,omitempty"`
	Result        string  `json:"result,omitempty"`
	Actor         string  `json:"actor,omitempty"`
}

type AdminAuditEvent struct {
	ID            uint64         `json:"id"`
	ActorUserID   *uint64        `json:"actor_user_id,omitempty"`
	ActorUsername string         `json:"actor_username,omitempty"`
	ActorRole     string         `json:"actor_role,omitempty"`
	Action        string         `json:"action"`
	TargetType    string         `json:"target_type,omitempty"`
	TargetID      string         `json:"target_id,omitempty"`
	TargetLabel   string         `json:"target_label,omitempty"`
	Result        string         `json:"result"`
	RequestID     string         `json:"request_id,omitempty"`
	IPAddress     string         `json:"ip_address,omitempty"`
	Metadata      map[string]any `json:"metadata,omitempty"`
	CreatedAt     string         `json:"created_at"`
}

type AdminAuditRange struct {
	Items         []AdminAuditEvent `json:"items"`
	TotalCount    int64             `json:"total_count"`
	Offset        int               `json:"offset"`
	Limit         int               `json:"limit"`
	SnapshotMaxID uint64            `json:"snapshot_max_id"`
}

// Server requireAdmin and the current token remain authoritative.
func (c *Client) AdminAuditRange(ctx context.Context, input AdminAuditRangeQuery) (AdminAuditRange, error) {
	query := url.Values{}
	query.Set("range", "true")
	query.Set("limit", strconv.Itoa(input.Limit))
	query.Set("offset", strconv.Itoa(input.Offset))
	if input.SnapshotMaxID != nil {
		query.Set("snapshot_max_id", strconv.FormatUint(*input.SnapshotMaxID, 10))
	}
	if input.Action != "" {
		query.Set("action", input.Action)
	}
	if input.Result != "" {
		query.Set("result", input.Result)
	}
	if input.Actor != "" {
		query.Set("actor", input.Actor)
	}
	var result AdminAuditRange
	err := c.json(ctx, http.MethodGet, "/api/v1/admin/audit?"+query.Encode(), nil, &result)
	return result, err
}
