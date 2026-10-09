package client

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
)

type NodeLocationBreadcrumb struct {
	ID   uint64 `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
}

type NodeLocationSource struct {
	SourceID       uint64 `json:"source_id"`
	SourceName     string `json:"source_name"`
	SourceKind     string `json:"source_kind"`
	SourceItemPath string `json:"source_item_path,omitempty"`
	OriginalPath   string `json:"original_path,omitempty"`
}

type NodeLocationSyncFolder struct {
	SourceID     uint64 `json:"source_id"`
	SourceName   string `json:"source_name"`
	SourceKind   string `json:"source_kind"`
	TargetNodeID uint64 `json:"target_node_id"`
}

type NodeLocation struct {
	NodeID      uint64                   `json:"node_id"`
	Revision    uint64                   `json:"revision"`
	NodeType    string                   `json:"node_type"`
	Path        string                   `json:"path"`
	ParentID    *uint64                  `json:"parent_id,omitempty"`
	ParentPath  string                   `json:"parent_path"`
	Breadcrumbs []NodeLocationBreadcrumb `json:"breadcrumbs"`
	Sources     []NodeLocationSource     `json:"sources"`
	SyncFolders []NodeLocationSyncFolder `json:"sync_folders"`
}

func (c *Client) NodeLocation(ctx context.Context, nodeID uint64) (NodeLocation, error) {
	if nodeID == 0 {
		return NodeLocation{}, fmt.Errorf("node id must be positive")
	}
	var out NodeLocation
	err := c.json(
		ctx, http.MethodGet,
		"/api/v1/nodes/"+strconv.FormatUint(nodeID, 10)+"/location",
		nil, &out,
	)
	return out, err
}
