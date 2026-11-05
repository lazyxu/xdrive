package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

// Desktop Notes are current Owner Server records, not local Agent databases.
// The existing cloudClient() performs the same Server identity/token refresh
// checks as Desktop Files, Viewer and Share Center.
func (c *agentController) CloudNotesInitialize(ctx context.Context) (client.NotesNamespace, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.NotesNamespace{}, err
	}
	return cli.NotesInitialize(ctx)
}

func (c *agentController) CloudNotesList(ctx context.Context, source, query string, offset int) (client.NotesPage, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.NotesPage{}, err
	}
	return cli.NotesList(ctx, source, query, offset)
}

func (c *agentController) CloudNotesRead(ctx context.Context, id string) (client.NotesDetail, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.NotesDetail{}, err
	}
	return cli.NotesRead(ctx, id)
}

func (c *agentController) CloudNotesCreate(ctx context.Context, write client.NotesWrite) (client.NotesRow, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.NotesRow{}, err
	}
	return cli.NotesCreate(ctx, write)
}

func (c *agentController) CloudNotesImportIOS(
	ctx context.Context, write client.NotesImportWrite,
) (client.NotesRow, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.NotesRow{}, err
	}
	return cli.NotesImportIOS(ctx, write)
}

func (c *agentController) CloudNotesImportIOSImage(
	ctx context.Context, id string, image []byte,
) (client.NotesImageReceipt, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.NotesImageReceipt{}, err
	}
	return cli.NotesImportIOSImage(ctx, id, image)
}

func (c *agentController) CloudNotesUpdate(ctx context.Context, id string, write client.NotesWrite) (client.NotesRow, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.NotesRow{}, err
	}
	return cli.NotesUpdate(ctx, id, write)
}

func (c *agentController) CloudNotesDelete(ctx context.Context, id string, revision uint64) error {
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	return cli.NotesDelete(ctx, id, revision)
}

func (c *agentController) CloudNotesVersions(ctx context.Context, id string) (client.NotesVersions, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.NotesVersions{}, err
	}
	return cli.NotesVersions(ctx, id)
}

func (c *agentController) CloudNotesReadVersion(ctx context.Context, nodeID, versionID uint64) (string, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return "", err
	}
	return cli.NotesReadVersion(ctx, nodeID, versionID)
}
