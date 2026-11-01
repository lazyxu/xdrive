package localbackupipc

import (
	"context"
	"errors"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

func (c *Client) OwnerMapOverview(ctx context.Context,
	bounds client.MediaPlacesViewportBounds) (client.OwnerMapOverview, error) {
	var empty client.OwnerMapOverview
	if err := c.requireOwnerPlacesRead(); err != nil {
		return empty, err
	}
	if !client.ValidOwnerMapBounds(bounds) {
		return empty, errors.New("invalid Owner map viewport")
	}
	var out client.OwnerMapOverview
	err := c.request(ctx, http.MethodGet,
		"/v1/cloud/owner-map-overview?"+client.OwnerMapBoundsQuery(bounds), nil, &out)
	if err != nil {
		return empty, err
	}
	if !client.ValidOwnerMapOverview(out, bounds) {
		return empty, errors.New("invalid Agent Owner GPS map")
	}
	return out, nil
}
