package client

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
)

type NodeChange struct {
	Cursor            uint64   `json:"cursor"`
	NodeID            uint64   `json:"node_id"`
	Operation         string   `json:"operation"`
	AffectedParentIDs []uint64 `json:"affected_parent_ids,omitempty"`
	Path              string   `json:"path,omitempty"`
	Node              *Node    `json:"node,omitempty"`
}

type NodeChangePage struct {
	Changes       []NodeChange `json:"changes"`
	NextCursor    uint64       `json:"next_cursor"`
	LatestCursor  uint64       `json:"latest_cursor"`
	HasMore       bool         `json:"has_more"`
	ResetRequired bool         `json:"reset_required,omitempty"`
}

func (c *Client) NodeChanges(ctx context.Context, after uint64, limit int) (NodeChangePage, error) {
	values := url.Values{}
	values.Set("after", strconv.FormatUint(after, 10))
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	var out NodeChangePage
	err := c.json(ctx, http.MethodGet, "/api/v1/changes?"+values.Encode(), nil, &out)
	if err != nil {
		return NodeChangePage{}, fmt.Errorf("list node changes: %w", err)
	}
	return out, nil
}
