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
	if !strings.HasPrefix(out.URL, "/api/v1/file-preview/") || strings.HasPrefix(out.URL, "//") {
		return FilePreviewTicket{}, fmt.Errorf("file preview returned invalid URL")
	}
	base, err := url.Parse(c.BaseURL)
	if err != nil {
		return FilePreviewTicket{}, err
	}
	relative, err := url.Parse(out.URL)
	if err != nil || relative.IsAbs() || relative.Host != "" || relative.Fragment != "" {
		return FilePreviewTicket{}, fmt.Errorf("file preview returned invalid URL")
	}
	resolved := base.ResolveReference(relative)
	if resolved.Scheme != base.Scheme || resolved.Host != base.Host || resolved.User != nil {
		return FilePreviewTicket{}, fmt.Errorf("file preview URL escaped configured server origin")
	}
	out.URL = resolved.String()
	return out, nil
}
