package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localbackupipc"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// backupTargetsCmd reuses the ordinary authenticated, owner-scoped cloud
// directory pagination API. This is read-only; there is no remote local-Root
// grant, second cloud crawler or independent backup configuration store.
func backupTargetsCmd(args []string) error {
	fs := flag.NewFlagSet("backup targets", flag.ContinueOnError)
	parent := fs.Uint64("parent", 0, "existing cloud directory ID (omitted: cloud root)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 || (*parent != 0 && !localbackupipc.ValidSourceID(*parent)) {
		return errors.New("targets accepts only --parent ID")
	}
	cfg, err := userconfig.Load()
	if err != nil {
		return err
	}
	cli, err := userconfig.NewClient(cfg)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	id := *parent
	if id == 0 {
		root, err := cli.Root(ctx)
		if err != nil {
			return err
		}
		if root.ID == 0 || root.Type != meta.NodeTypeDir {
			return errors.New("invalid cloud root directory")
		}
		id = root.ID
	} else {
		dir, err := cli.Node(ctx, id)
		if err != nil {
			return err
		}
		if dir.ID != id || dir.Type != meta.NodeTypeDir {
			return errors.New("requested cloud target parent is not a directory")
		}
	}
	fmt.Fprintf(os.Stdout, "Cloud directory %d; choose a directory ID for --target-id\n", id)
	return visitBackupTargetDirectories(ctx, cli, id, func(n client.Node) {
		fmt.Fprintf(os.Stdout, "%d  %s\n", n.ID, n.Name)
	})
}

type backupTargetPager interface {
	ListPage(context.Context, uint64, client.ChildrenOptions) (client.ChildrenPage, error)
}

func visitBackupTargetDirectories(ctx context.Context, pager backupTargetPager, parent uint64, display func(client.Node)) error {
	if ctx == nil || ctx.Err() != nil || pager == nil || display == nil ||
		!localbackupipc.ValidSourceID(parent) {
		return errors.New("invalid target directory listing")
	}
	var cursor string
	seen := make(map[string]bool)
	for page := 0; page < 64; page++ {
		items, err := pager.ListPage(ctx, parent,
			client.ChildrenOptions{Limit: 200, Cursor: cursor})
		if err != nil {
			return err
		}
		if len(items.Items) > 200 {
			return errors.New("cloud target directory page exceeded limit")
		}
		for _, n := range items.Items {
			if n.Type == meta.NodeTypeDir && localbackupipc.ValidSourceID(n.ID) {
				display(n)
			}
		}
		if !items.HasMore {
			return nil
		}
		if items.NextCursor == "" || items.NextCursor == cursor || seen[items.NextCursor] {
			return errors.New("invalid cloud target directory cursor")
		}
		seen[items.NextCursor] = true
		cursor = items.NextCursor
	}
	return errors.New("too many cloud directories to list safely; choose --parent ID")
}
