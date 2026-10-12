package client

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
)

type AdminStorageRequest struct {
	Operation string `json:"operation"`
	Limit     int    `json:"limit,omitempty"`
	Offset    int    `json:"offset,omitempty"`
	Cursor    string `json:"cursor,omitempty"`
	Days      int    `json:"days,omitempty"`
	RunID     uint64 `json:"run_id,omitempty"`
	Fresh     bool   `json:"fresh,omitempty"`
	Kind      string `json:"kind,omitempty"`
}

// Fixed Server /admin/storage endpoints only: no arbitrary URL, method or path.
func (c *Client) AdminStorage(ctx context.Context, input AdminStorageRequest) (json.RawMessage, error) {
	var endpoint string
	var body any
	method := http.MethodGet
	params := url.Values{}
	switch input.Operation {
	case "stats":
		endpoint = "/api/v1/admin/storage"
	case "health":
		endpoint = "/api/v1/admin/storage/health"
	case "history":
		endpoint = "/api/v1/admin/storage/history"
		params.Set("days", strconv.Itoa(input.Days))
	case "legacy":
		endpoint = "/api/v1/admin/storage/legacy"
		params.Set("limit", strconv.Itoa(input.Limit))
		if input.Cursor != "" {
			params.Set("cursor", input.Cursor)
		}
	case "unreferenced":
		endpoint = "/api/v1/admin/storage/unreferenced-blobs"
		params.Set("limit", strconv.Itoa(input.Limit))
		if input.Cursor != "" {
			params.Set("cursor", input.Cursor)
		}
	case "staging":
		endpoint = "/api/v1/admin/storage/staging"
		params.Set("limit", strconv.Itoa(input.Limit))
		if input.Cursor != "" {
			params.Set("cursor", input.Cursor)
		}
		if input.Fresh {
			params.Set("fresh", "1")
		}
	case "cleanup-runs":
		endpoint = "/api/v1/admin/storage/staging/cleanup-runs"
		params.Set("limit", strconv.Itoa(input.Limit))
		params.Set("offset", strconv.Itoa(input.Offset))
	case "cleanup-failures":
		endpoint = fmt.Sprintf("/api/v1/admin/storage/staging/cleanup-runs/%d/failures", input.RunID)
		params.Set("limit", strconv.Itoa(input.Limit))
		params.Set("offset", strconv.Itoa(input.Offset))
	case "cleanup-staging":
		endpoint = "/api/v1/admin/storage/staging/cleanup"
		method, body = http.MethodPost, map[string]any{}
	case "cleanup-cache":
		endpoint = "/api/v1/admin/storage/cache/cleanup"
		method, body = http.MethodPost, map[string]string{"kind": input.Kind}
	default:
		return nil, errors.New("unknown administrator storage operation")
	}
	if encoded := params.Encode(); encoded != "" {
		endpoint += "?" + encoded
	}
	var out json.RawMessage
	if err := c.json(ctx, method, endpoint, body, &out); err != nil {
		return nil, err
	}
	return out, nil
}
