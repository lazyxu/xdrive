package localbackupipc

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"

	"github.com/lazyxu/xdrive/internal/client"
)

type OwnerPlacesPage = client.OwnerPlacesPage

func (c *Client) requireOwnerPlacesRead() error {
	if c == nil || !hasCapability(c.capabilities, "cloud-owner-places-read") {
		return errors.New("owning Agent has no bounded Owner Places read capability")
	}
	return nil
}
func (c *Client) OwnerPlacesPage(ctx context.Context, limit, offset int) (OwnerPlacesPage, error) {
	if err := c.requireOwnerPlacesRead(); err != nil {
		return OwnerPlacesPage{}, err
	}
	if !client.ValidOwnerPlacesWindow(limit, offset) {
		return OwnerPlacesPage{}, errors.New("invalid Owner Places page")
	}
	values := url.Values{"limit": {strconv.Itoa(limit)}, "offset": {strconv.Itoa(offset)}}
	var out OwnerPlacesPage
	if err := c.request(ctx, http.MethodGet, "/v1/cloud/owner-places-page?"+values.Encode(), nil, &out); err != nil {
		return OwnerPlacesPage{}, err
	}
	if !client.ValidOwnerPlacesPage(out, limit, offset) {
		return OwnerPlacesPage{}, errors.New("invalid Agent Owner Places page")
	}
	return out, nil
}
func (c *Client) OwnerPlaceItems(ctx context.Context, place string, limit, offset int) (OwnerGalleryPage, error) {
	if err := c.requireOwnerPlacesRead(); err != nil {
		return OwnerGalleryPage{}, err
	}
	if !client.ValidOwnerPlaceID(place) || !client.ValidOwnerGalleryWindow(limit, offset) {
		return OwnerGalleryPage{}, errors.New("invalid Owner place items")
	}
	values := url.Values{"place_id": {place}, "limit": {strconv.Itoa(limit)}, "offset": {strconv.Itoa(offset)}}
	var out OwnerGalleryPage
	if err := c.request(ctx, http.MethodGet, "/v1/cloud/owner-place-items?"+values.Encode(), nil, &out); err != nil {
		return OwnerGalleryPage{}, err
	}
	if !client.ValidOwnerGalleryPage(out, limit, offset) {
		return OwnerGalleryPage{}, errors.New("invalid Agent place items")
	}
	return out, nil
}
