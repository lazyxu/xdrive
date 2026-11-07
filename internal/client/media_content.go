package client

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// This is a closed set of photo operations, not a generic authenticated proxy.
// A content key selects a photo within the current authenticated Owner only.
type MediaContentRequest struct {
	Operation   string   `json:"operation"`
	ContentKey  string   `json:"content_key,omitempty"`
	ContentKeys []string `json:"content_keys,omitempty"`
	AlbumID     string   `json:"album_id,omitempty"`
	Revision    uint64   `json:"revision,omitempty"`
	Cursor      uint64   `json:"cursor,omitempty"`
	Favorite    *bool    `json:"favorite,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	People      []string `json:"people,omitempty"`
	Description *string  `json:"description,omitempty"`
}

func validMediaContentKey(key string) bool {
	for _, prefix := range []string{"sha256:", "photo-bundle:v1:sha256:"} {
		if strings.HasPrefix(key, prefix) {
			value := strings.TrimPrefix(key, prefix)
			_, err := hex.DecodeString(value)
			return len(value) == 64 && value == strings.ToLower(value) && err == nil
		}
	}
	return false
}

func (input MediaContentRequest) Validate() error {
	batch := input.Operation == "favorite_batch" || input.Operation == "tags_batch" || input.Operation == "album_add"
	if batch {
		limit := 1000
		if input.Operation == "album_add" {
			limit = 500
		}
		if input.ContentKey != "" || len(input.ContentKeys) == 0 || len(input.ContentKeys) > limit {
			return fmt.Errorf("invalid photo content selection")
		}
		for _, key := range input.ContentKeys {
			if !validMediaContentKey(key) {
				return fmt.Errorf("invalid photo content key")
			}
		}
	} else if len(input.ContentKeys) != 0 || (!validMediaContentKey(input.ContentKey) && !(input.Operation == "album_cover" && input.ContentKey == "")) {
		return fmt.Errorf("invalid photo content key")
	}
	switch input.Operation {
	case "get", "sources":
	case "favorite", "favorite_batch":
		if input.Favorite == nil {
			return fmt.Errorf("favorite is required")
		}
	case "tags", "tags_batch":
		if input.Tags == nil || len(input.Tags) > 32 {
			return fmt.Errorf("invalid photo tags")
		}
	case "people":
		if input.People == nil || len(input.People) > 32 {
			return fmt.Errorf("invalid photo people")
		}
	case "description":
		if input.Description == nil || len([]rune(*input.Description)) > 4096 {
			return fmt.Errorf("invalid photo description")
		}
	case "album_add", "album_remove", "album_cover":
		if !strings.HasPrefix(input.AlbumID, "manual:") || len(input.AlbumID) > 512 || input.Revision == 0 {
			return fmt.Errorf("invalid manual album revision")
		}
	default:
		return fmt.Errorf("unsupported photo content operation")
	}
	return nil
}

func (c *Client) MediaContent(ctx context.Context, input MediaContentRequest) (json.RawMessage, error) {
	if err := input.Validate(); err != nil {
		return nil, err
	}
	path := "/api/v1/media/content/" + url.PathEscape(input.ContentKey)
	method := http.MethodGet
	var body any
	switch input.Operation {
	case "sources":
		path += "/sources?cursor=" + strconv.FormatUint(input.Cursor, 10)
	case "favorite":
		path += "/favorite"
		method = http.MethodPatch
		body = map[string]any{"favorite": *input.Favorite}
	case "tags":
		path += "/tags"
		method = http.MethodPatch
		body = map[string]any{"tags": input.Tags}
	case "people":
		path += "/people"
		method = http.MethodPatch
		body = map[string]any{"people": input.People}
	case "description":
		path += "/description"
		method = http.MethodPatch
		body = map[string]any{"description": *input.Description}
	case "favorite_batch":
		path = "/api/v1/media/batch/favorite"
		method = http.MethodPatch
		body = map[string]any{"content_keys": input.ContentKeys, "favorite": *input.Favorite}
	case "tags_batch":
		path = "/api/v1/media/batch/tags"
		method = http.MethodPost
		body = map[string]any{"content_keys": input.ContentKeys, "tags": input.Tags}
	case "album_add":
		path = "/api/v1/media/albums/" + url.PathEscape(input.AlbumID) + "/items"
		method = http.MethodPost
		body = map[string]any{"content_keys": input.ContentKeys}
	case "album_remove":
		path = "/api/v1/media/albums/" + url.PathEscape(input.AlbumID) + "/content/" + url.PathEscape(input.ContentKey)
		method = http.MethodDelete
	case "album_cover":
		path = "/api/v1/media/albums/" + url.PathEscape(input.AlbumID) + "/cover"
		method = http.MethodPut
		body = map[string]any{"content_key": input.ContentKey}
	}
	var out json.RawMessage
	if strings.HasPrefix(input.Operation, "album_") {
		err := c.jsonRevision(ctx, method, path, input.Revision, body, &out)
		return out, err
	}
	err := c.json(ctx, method, path, body, &out)
	return out, err
}
