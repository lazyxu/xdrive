package client

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type FileVersion struct {
	ID        uint64    `json:"id"`
	NodeID    uint64    `json:"node_id"`
	Revision  uint64    `json:"revision"`
	Size      int64     `json:"size"`
	SHA256    string    `json:"sha256,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type FileShare struct {
	ID            uint64     `json:"id"`
	NodeID        uint64     `json:"node_id"`
	HasPassword   bool       `json:"has_password"`
	ExpiresAt     *time.Time `json:"expires_at,omitempty"`
	MaxDownloads  int64      `json:"max_downloads"`
	DownloadCount int64      `json:"download_count"`
	RevokedAt     *time.Time `json:"revoked_at,omitempty"`
	Status        string     `json:"status"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type CreatedFileShare struct {
	FileShare
	Token string `json:"token"`
}

type CreateShareInput struct {
	ExpiresAt    *time.Time `json:"expires_at,omitempty"`
	Password     string     `json:"password"`
	MaxDownloads int64      `json:"max_downloads"`
}

type TrashRange struct {
	Items              []Node `json:"items"`
	TotalCount         int64  `json:"total_count"`
	TotalCountIncluded *bool  `json:"total_count_included,omitempty"`
	Offset             int    `json:"offset"`
	Limit              int    `json:"limit"`
	Sort               string `json:"sort"`
	Order              string `json:"order"`
}

func (r TrashRange) HasTotalCount() bool {
	return r.TotalCountIncluded == nil || *r.TotalCountIncluded
}

func (c *Client) Trash(ctx context.Context) ([]Node, error) {
	var out []Node
	err := c.json(ctx, http.MethodGet, "/api/v1/trash", nil, &out)
	return out, err
}

func (c *Client) TrashRange(ctx context.Context, offset, limit int, sort, order string, includeCount bool) (TrashRange, error) {
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	sort = strings.TrimSpace(sort)
	if sort == "" {
		sort = "name"
	}
	order = strings.TrimSpace(order)
	if order == "" {
		order = "asc"
	}
	values := url.Values{
		"range":         []string{"true"},
		"offset":        []string{strconv.Itoa(offset)},
		"limit":         []string{strconv.Itoa(limit)},
		"sort":          []string{sort},
		"order":         []string{order},
		"include_count": []string{strconv.FormatBool(includeCount)},
	}
	var out TrashRange
	err := c.json(ctx, http.MethodGet, "/api/v1/trash?"+values.Encode(), nil, &out)
	return out, err
}

func (c *Client) RestoreTrash(ctx context.Context, nodeID, revision uint64) (Node, error) {
	var out Node
	err := c.jsonRevision(ctx, http.MethodPost, fmt.Sprintf("/api/v1/trash/%d/restore", nodeID), revision, nil, &out)
	return out, err
}

func (c *Client) PermanentlyDeleteTrash(ctx context.Context, nodeID, revision uint64) error {
	return c.jsonRevision(ctx, http.MethodDelete, fmt.Sprintf("/api/v1/trash/%d", nodeID), revision, nil, nil)
}

func (c *Client) Versions(ctx context.Context, nodeID uint64) ([]FileVersion, error) {
	var out []FileVersion
	err := c.json(ctx, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/versions", nodeID), nil, &out)
	return out, err
}

func (c *Client) RestoreVersion(ctx context.Context, nodeID, currentRevision, versionID uint64) (Node, error) {
	var out Node
	err := c.jsonRevision(
		ctx,
		http.MethodPost,
		fmt.Sprintf("/api/v1/files/%d/versions/%d/restore", nodeID, versionID),
		currentRevision,
		nil,
		&out,
	)
	return out, err
}

func (c *Client) CreateShare(ctx context.Context, nodeID uint64, input CreateShareInput) (CreatedFileShare, error) {
	var out CreatedFileShare
	err := c.json(ctx, http.MethodPost, fmt.Sprintf("/api/v1/files/%d/shares", nodeID), input, &out)
	return out, err
}

func (c *Client) Shares(ctx context.Context, nodeID uint64) ([]FileShare, error) {
	var out []FileShare
	err := c.json(ctx, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/shares", nodeID), nil, &out)
	return out, err
}

func (c *Client) RevokeShare(ctx context.Context, shareID uint64) error {
	return c.json(ctx, http.MethodDelete, fmt.Sprintf("/api/v1/shares/%d", shareID), nil, nil)
}
