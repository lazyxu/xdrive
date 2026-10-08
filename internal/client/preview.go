package client

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type FilePreviewTicket struct {
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
	Kind      string    `json:"kind"`
	MIMEType  string    `json:"mime_type"`
}

func (c *Client) FilePreviewTicket(ctx context.Context, nodeID uint64) (FilePreviewTicket, error) {
	var out FilePreviewTicket
	if nodeID == 0 {
		return out, fmt.Errorf("file preview requires node id")
	}
	if err := c.json(
		ctx,
		http.MethodPost,
		fmt.Sprintf("/api/v1/files/%d/preview-ticket", nodeID),
		nil,
		&out,
	); err != nil {
		return out, err
	}
	return c.resolvePreviewTicket(out, "/api/v1/file-preview/", "file preview")
}

func (c *Client) MediaLivePhotoMotionTicket(
	ctx context.Context,
	nodeID uint64,
) (FilePreviewTicket, error) {
	var out FilePreviewTicket
	if nodeID == 0 {
		return out, fmt.Errorf("live photo motion requires node id")
	}
	if err := c.json(
		ctx,
		http.MethodPost,
		fmt.Sprintf("/api/v1/media/items/%d/live-photo-motion-ticket", nodeID),
		nil,
		&out,
	); err != nil {
		return out, err
	}
	if out.Kind != "video" {
		return FilePreviewTicket{}, fmt.Errorf("live photo motion returned invalid ticket kind")
	}
	return c.resolvePreviewTicket(
		out,
		"/api/v1/media-live-photo-motion/",
		"live photo motion",
	)
}

func (c *Client) resolvePreviewTicket(
	out FilePreviewTicket,
	pathPrefix, label string,
) (FilePreviewTicket, error) {
	if !strings.HasPrefix(out.URL, pathPrefix) || strings.HasPrefix(out.URL, "//") {
		return FilePreviewTicket{}, fmt.Errorf("%s returned invalid URL", label)
	}
	base, err := url.Parse(c.BaseURL)
	if err != nil {
		return FilePreviewTicket{}, err
	}
	relative, err := url.Parse(out.URL)
	if err != nil || relative.IsAbs() || relative.Host != "" || relative.Fragment != "" {
		return FilePreviewTicket{}, fmt.Errorf("%s returned invalid URL", label)
	}
	resolved := base.ResolveReference(relative)
	if resolved.Scheme != base.Scheme || resolved.Host != base.Host || resolved.User != nil {
		return FilePreviewTicket{}, fmt.Errorf("%s URL escaped configured server origin", label)
	}
	out.URL = resolved.String()
	return out, nil
}
