package client

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type MediaMetadata struct {
	MediaKind                string         `json:"media_kind"`
	MIMEType                 string         `json:"mime_type,omitempty"`
	ContainerKind            string         `json:"container_kind,omitempty"`
	LivePhotoAssetIdentifier string         `json:"live_photo_asset_identifier,omitempty"`
	Width                    int            `json:"width,omitempty"`
	Height                   int            `json:"height,omitempty"`
	Orientation              int            `json:"orientation,omitempty"`
	RotationDegrees          int            `json:"rotation_degrees,omitempty"`
	DurationMS               int64          `json:"duration_ms,omitempty"`
	FrameRate                float64        `json:"frame_rate,omitempty"`
	BitRate                  int64          `json:"bit_rate,omitempty"`
	VideoCodec               string         `json:"video_codec,omitempty"`
	AudioCodec               string         `json:"audio_codec,omitempty"`
	CapturedAt               *time.Time     `json:"captured_at,omitempty"`
	Latitude                 *float64       `json:"latitude,omitempty"`
	Longitude                *float64       `json:"longitude,omitempty"`
	AltitudeM                *float64       `json:"altitude_m,omitempty"`
	CameraMake               string         `json:"camera_make,omitempty"`
	CameraModel              string         `json:"camera_model,omitempty"`
	LensModel                string         `json:"lens_model,omitempty"`
	EXIF                     map[string]any `json:"exif,omitempty"`
	Video                    map[string]any `json:"video,omitempty"`
	IndexState               string         `json:"index_state"`
	IndexError               string         `json:"index_error,omitempty"`
	HasThumbnail             bool           `json:"has_thumbnail"`
	ThumbnailMIME            string         `json:"thumbnail_mime_type,omitempty"`
	ThumbnailWidth           int            `json:"thumbnail_width,omitempty"`
	ThumbnailHeight          int            `json:"thumbnail_height,omitempty"`
}

type MediaDerivedResource struct {
	Role      string `json:"role"`
	Name      string `json:"name"`
	MediaKind string `json:"media_kind"`
	MIMEType  string `json:"mime_type"`
	Size      int64  `json:"size"`
}

type MediaResource struct {
	Kind      string `json:"kind"`
	NodeID    uint64 `json:"node_id"`
	Role      string `json:"role"`
	Name      string `json:"name"`
	MediaKind string `json:"media_kind"`
	MIMEType  string `json:"mime_type,omitempty"`
	Size      int64  `json:"size"`
}

type MediaItem struct {
	Node             Node                   `json:"node"`
	Metadata         MediaMetadata          `json:"metadata"`
	AssetKind        string                 `json:"asset_kind,omitempty"`
	Resources        []MediaResource        `json:"resources,omitempty"`
	DerivedResources []MediaDerivedResource `json:"derived_resources,omitempty"`
	LivePhoto        bool                   `json:"live_photo,omitempty"`
}

type MediaAlbum struct {
	ID          string     `json:"id"`
	Kind        string     `json:"kind"`
	Name        string     `json:"name"`
	ItemCount   int64      `json:"item_count"`
	CoverNodeID *uint64    `json:"cover_node_id,omitempty"`
	UpdatedAt   *time.Time `json:"updated_at,omitempty"`
}

func (c *Client) MediaItems(
	ctx context.Context,
	kind string,
	limit, offset int,
) ([]MediaItem, error) {
	values := url.Values{}
	if kind = strings.TrimSpace(kind); kind != "" {
		values.Set("kind", kind)
	}
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		values.Set("offset", strconv.Itoa(offset))
	}
	path := "/api/v1/media/items"
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out []MediaItem
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) MediaItem(ctx context.Context, nodeID uint64) (MediaItem, error) {
	var out MediaItem
	err := c.json(
		ctx,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d", nodeID),
		nil,
		&out,
	)
	return out, err
}

func (c *Client) MediaAlbums(ctx context.Context) ([]MediaAlbum, error) {
	var out []MediaAlbum
	err := c.json(ctx, http.MethodGet, "/api/v1/media/albums", nil, &out)
	return out, err
}

func (c *Client) MediaAlbumItems(
	ctx context.Context,
	albumID string,
	limit, offset int,
) ([]MediaItem, error) {
	values := url.Values{}
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		values.Set("offset", strconv.Itoa(offset))
	}
	path := "/api/v1/media/albums/" + url.PathEscape(albumID) + "/items"
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out []MediaItem
	err := c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) MediaThumbnail(
	ctx context.Context,
	nodeID uint64,
) ([]byte, string, error) {
	req, err := c.request(
		ctx,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/thumbnail", nodeID),
		nil,
	)
	if err != nil {
		return nil, "", err
	}
	resp, err := c.do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return nil, "", responseError(resp)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, "", err
	}
	return data, resp.Header.Get("Content-Type"), nil
}

func (c *Client) MediaLivePhotoMotion(
	ctx context.Context,
	nodeID uint64,
) (io.ReadCloser, string, int64, error) {
	req, err := c.request(
		ctx,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/live-photo-motion", nodeID),
		nil,
	)
	if err != nil {
		return nil, "", 0, err
	}
	resp, err := c.do(req)
	if err != nil {
		return nil, "", 0, err
	}
	if resp.StatusCode/100 != 2 {
		defer resp.Body.Close()
		return nil, "", 0, responseError(resp)
	}
	return resp.Body, resp.Header.Get("Content-Type"), resp.ContentLength, nil
}
