package localbackupipc

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"

	"github.com/lazyxu/xdrive/internal/client"
)

// Owner-only, read-only, credential-free Gallery projections. The same-user
// Agent retains the real Server session and performs all Owner ACL checks.
type OwnerGalleryPage = client.OwnerGalleryPage
type OwnerGalleryAlbum = client.OwnerGalleryAlbum

func (c *Client) requireOwnerGalleryRead() error {
	if c == nil || !hasCapability(c.capabilities, "cloud-owner-gallery-read") {
		return errors.New("owning Agent has no bounded Owner Gallery read capability")
	}
	return nil
}

func (c *Client) OwnerGalleryItemsRange(
	ctx context.Context, kind string, limit, offset int, albumID string,
) (OwnerGalleryPage, error) {
	if err := c.requireOwnerGalleryRead(); err != nil {
		return OwnerGalleryPage{}, err
	}
	if !client.ValidOwnerGalleryKind(kind) || !client.ValidOwnerGalleryWindow(limit, offset) ||
		(albumID != "" && !client.ValidOwnerGalleryAlbumID(albumID)) {
		return OwnerGalleryPage{}, errors.New("invalid Owner Gallery range selector")
	}
	values := url.Values{
		"kind": {kind}, "limit": {strconv.Itoa(limit)},
		"offset": {strconv.Itoa(offset)},
	}
	if albumID != "" {
		values.Set("album_id", albumID)
	}
	var out OwnerGalleryPage
	if err := c.request(ctx, http.MethodGet,
		"/v1/cloud/owner-gallery-items?"+values.Encode(), nil, &out); err != nil {
		return OwnerGalleryPage{}, err
	}
	if !client.ValidOwnerGalleryPage(out, limit, offset) {
		return OwnerGalleryPage{}, errors.New("invalid Owner Gallery projection from Agent")
	}
	return out, nil
}

func (c *Client) OwnerGalleryAlbums(ctx context.Context) ([]OwnerGalleryAlbum, error) {
	if err := c.requireOwnerGalleryRead(); err != nil {
		return nil, err
	}
	var albums []OwnerGalleryAlbum
	if err := c.request(ctx, http.MethodGet,
		"/v1/cloud/owner-gallery-albums", nil, &albums); err != nil {
		return nil, err
	}
	if !client.ValidOwnerGalleryAlbums(albums) {
		return nil, errors.New("invalid Owner Gallery album inventory from Agent")
	}
	return albums, nil
}
