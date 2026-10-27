package client

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// OwnerThumbnail is one original-Server, Owner-authorized derivative. This
// projection contains image bytes and the same alpha-mask proof used by
// Desktop, never a signed URL, server token, CAS key or NAS path.
type OwnerThumbnail struct {
	ContentType string `json:"content_type"`
	AlphaState  string `json:"alpha_state"`
	AlphaMask   string `json:"alpha_mask"`
	Data        []byte `json:"data"`
}

const OwnerThumbnailMaxBytes = 2 << 20

// A derivative normally has a 512px edge. This conservative upper bound
// prevents a tiny compressed image from expanding into a huge NAS-side
// allocation while still permitting legacy enlarged thumbnails.
const ownerThumbnailMaxDimension = 2048

func ValidateOwnerThumbnail(value OwnerThumbnail) bool {
	if value.ContentType != "image/png" && value.ContentType != "image/jpeg" {
		return false
	}
	if len(value.Data) == 0 || len(value.Data) > OwnerThumbnailMaxBytes {
		return false
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(value.Data))
	if err != nil || cfg.Width < 1 || cfg.Height < 1 ||
		cfg.Width > ownerThumbnailMaxDimension || cfg.Height > ownerThumbnailMaxDimension ||
		(value.ContentType == "image/png" && format != "png") ||
		(value.ContentType == "image/jpeg" && format != "jpeg") {
		return false
	}
	// DecodeConfig validates only the header: a truncated PNG/JPEG may pass.
	// Fully decode only after the dimensions and byte size are bounded.
	if _, _, err := image.Decode(bytes.NewReader(value.Data)); err != nil {
		return false
	}
	switch value.AlphaState {
	case "", "opaque", "unavailable":
		return value.AlphaMask == ""
	case "masked":
		if value.ContentType != "image/png" || len(value.AlphaMask) == 0 ||
			len(value.AlphaMask) > 4096 {
			return false
		}
		mask, err := base64.StdEncoding.Strict().DecodeString(value.AlphaMask)
		if err != nil || len(mask) == 0 {
			return false
		}
		maskCfg, maskFormat, err := image.DecodeConfig(bytes.NewReader(mask))
		if err != nil || maskFormat != "png" ||
			maskCfg.Width != cfg.Width || maskCfg.Height != cfg.Height {
			return false
		}
		// The alpha mask itself must not be a truncated PNG whose header
		// merely advertises matching dimensions.
		_, decodedFormat, err := image.Decode(bytes.NewReader(mask))
		return err == nil && decodedFormat == "png"
	default:
		return false
	}
}

// MediaOwnerThumbnail bypasses Agent's revision-keyed warm cache: the Server
// must independently authorize the current account AND compare the requested
// source revision before returning any derivative bytes. That avoids showing
// an earlier user's/revision's cached image after account rebind or rename.
func (c *Client) MediaOwnerThumbnail(ctx context.Context, id, revision uint64) (OwnerThumbnail, error) {
	if id == 0 || revision == 0 || id > 1<<53-1 || revision > 1<<53-1 {
		return OwnerThumbnail{}, errors.New("invalid Owner thumbnail identity")
	}
	path := fmt.Sprintf("/api/v1/media/items/%d/thumbnail?v=4&revision=%s",
		id, strconv.FormatUint(revision, 10))
	req, err := c.request(ctx, http.MethodGet, path, nil)
	if err != nil {
		return OwnerThumbnail{}, err
	}
	resp, err := c.do(req)
	if err != nil {
		return OwnerThumbnail{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return OwnerThumbnail{}, fmt.Errorf("Owner thumbnail unavailable (HTTP %d)", resp.StatusCode)
	}
	if resp.ContentLength > OwnerThumbnailMaxBytes {
		return OwnerThumbnail{}, errors.New("oversized Owner thumbnail")
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, OwnerThumbnailMaxBytes+1))
	if err != nil || len(body) == 0 || len(body) > OwnerThumbnailMaxBytes {
		return OwnerThumbnail{}, errors.New("truncated or oversized Owner thumbnail")
	}
	result := OwnerThumbnail{
		ContentType: strings.TrimSpace(resp.Header.Get("Content-Type")),
		AlphaState:  strings.TrimSpace(resp.Header.Get("X-XDrive-Thumbnail-Alpha-State")),
		AlphaMask:   strings.TrimSpace(resp.Header.Get("X-XDrive-Thumbnail-Alpha-Mask")),
		Data:        body,
	}
	if !ValidateOwnerThumbnail(result) {
		return OwnerThumbnail{}, errors.New("unsafe Owner thumbnail image or transparency metadata")
	}
	return result, nil
}
