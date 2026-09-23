package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/conflictstate"
)

type conflictActionClient interface {
	Walk(context.Context) (map[string]client.Node, error)
	Delete(context.Context, uint64, uint64) error
	OverwriteFileResumable(context.Context, uint64, uint64, string, client.UploadProgress) (client.Node, error)
}

func applyConflictChoice(
	ctx context.Context,
	cli conflictActionClient,
	root string,
	record conflictstate.Record,
	choice string,
) error {
	remote, err := cli.Walk(ctx)
	if err != nil {
		return err
	}
	original, originalOK := findConflictNode(remote, record.OriginalPath, record.OriginalNodeID)
	conflict, conflictOK := findConflictNode(remote, record.ConflictPath, record.ConflictNodeID)
	conflictAbs := filepath.Join(root, filepath.FromSlash(record.ConflictPath))

	switch choice {
	case "server":
		if conflictOK {
			if err := cli.Delete(ctx, conflict.ID, conflict.Revision); err != nil && !isNotFound(err) {
				return err
			}
		}
	case "local":
		if !originalOK {
			return fmt.Errorf("服务器原文件已不存在，无法用本地版本覆盖")
		}
		if _, err := os.Stat(conflictAbs); err != nil {
			return fmt.Errorf("本地冲突副本不可用: %w", err)
		}
		if _, err := cli.OverwriteFileResumable(ctx, original.ID, original.Revision, conflictAbs, nil); err != nil {
			return fmt.Errorf("保留本地版本失败: %w", err)
		}
		if conflictOK {
			if err := cli.Delete(ctx, conflict.ID, conflict.Revision); err != nil && !isNotFound(err) {
				return err
			}
		}
	default:
		return fmt.Errorf("未知的冲突处理方式")
	}
	return nil
}
