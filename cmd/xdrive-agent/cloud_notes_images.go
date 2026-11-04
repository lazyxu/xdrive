package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

// This optional port is the same current Owner-bound client as normal Notes.
// It neither stores image bytes locally nor gives a Renderer an Owner bearer.
func (c *agentController) CloudNotesUploadImage(
	ctx context.Context, id string, data []byte,
) (client.NotesImageReceipt, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.NotesImageReceipt{}, err
	}
	return cli.NotesUploadMineImage(ctx, id, data)
}

func (c *agentController) CloudNotesReadImage(
	ctx context.Context, id, relativePath string,
) ([]byte, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.NotesReadImage(ctx, id, relativePath)
}
