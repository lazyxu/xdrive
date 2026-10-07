package client

import (
	"context"
	"testing"
)

func TestFileFavoritesClientSurface(t *testing.T) {
	var _ func(*Client, context.Context) ([]FileFavoriteItem, error) = (*Client).FileFavorites
	var _ func(*Client, context.Context, uint64) (FileFavoriteItem, error) = (*Client).FavoriteFile
	var _ func(*Client, context.Context, uint64) error = (*Client).UnfavoriteFile
}
