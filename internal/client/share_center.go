package client

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
)

// OwnerShare is metadata only. It must never carry a public capability token.
type OwnerShare struct {
	FileShare
	NodeName    string `json:"node_name"`
	NodeType    string `json:"node_type"`
	NodeMissing bool   `json:"node_missing"`
}

type OwnerSharePage struct {
	Items      []OwnerShare `json:"items"`
	NextCursor uint64       `json:"next_cursor"`
}

type OwnerShareLink struct {
	Token       string `json:"token"`
	LegacyAlias bool   `json:"legacy_alias"`
}

func (c *Client) OwnerShares(ctx context.Context, cursor uint64, limit int) (OwnerSharePage, error) {
	if limit < 1 || limit > 100 {
		return OwnerSharePage{}, fmt.Errorf("invalid Owner share page limit")
	}
	params := url.Values{"limit": {strconv.Itoa(limit)}}
	if cursor != 0 {
		params.Set("cursor", strconv.FormatUint(cursor, 10))
	}
	var out OwnerSharePage
	err := c.json(ctx, http.MethodGet, "/api/v1/shares?"+params.Encode(), nil, &out)
	return out, err
}

// Explicit Owner action. Never call from a list poll or log the returned token.
func (c *Client) ShareLink(ctx context.Context, shareID uint64) (OwnerShareLink, error) {
	if shareID == 0 {
		return OwnerShareLink{}, fmt.Errorf("invalid Share id")
	}
	var out OwnerShareLink
	err := c.json(ctx, http.MethodPost, fmt.Sprintf("/api/v1/shares/%d/link", shareID), struct{}{}, &out)
	return out, err
}
