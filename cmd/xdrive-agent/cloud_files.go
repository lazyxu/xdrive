package main

import (
	"archive/zip"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	pathpkg "path"
	"path/filepath"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/mount"
	"github.com/lazyxu/xdrive/internal/transfer"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

const cloudSearchLimit = 200
const maxAgentMediaMotionBytes int64 = 64 << 20
const maxAgentArchiveEntries = 200000

type agentCloudCrumb struct {
	ID   uint64 `json:"id"`
	Name string `json:"name"`
}

type agentCloudSearchResult struct {
	Node   client.Node       `json:"node"`
	Path   string            `json:"path"`
	Crumbs []agentCloudCrumb `json:"crumbs"`
}

type agentCloudSearchPage struct {
	Items      []agentCloudSearchResult `json:"items"`
	NextCursor string                   `json:"next_cursor,omitempty"`
}

type agentCloudSearchRange struct {
	Items      []agentCloudSearchResult `json:"items"`
	TotalCount int64                    `json:"total_count"`
	Offset     int                      `json:"offset"`
	Limit      int                      `json:"limit"`
	Sort       string                   `json:"sort"`
	Order      string                   `json:"order"`
}

type agentCloudUploadResult struct {
	Node             client.Node `json:"node"`
	Skipped          bool        `json:"skipped"`
	TransferredBytes int64       `json:"transferred_bytes"`
}

type agentCloudArchiveDownloadResult struct {
	Downloaded []string `json:"downloaded"`
}

type agentCloudFolderDownloadResult struct {
	Root       string `json:"root"`
	Downloaded int    `json:"downloaded"`
	Failed     int    `json:"failed"`
}

type agentCloudFolderDownloadFile struct {
	Node         client.Node
	RelativePath string
}

type agentCloudFolderDownloadManifest struct {
	Directories []string
	Files       []agentCloudFolderDownloadFile
	TotalBytes  int64
}

type agentCreatedShare struct {
	Share client.CreatedFileShare `json:"share"`
	URL   string                  `json:"url"`
}

type agentMediaThumbnail struct {
	ContentType string
	Data        []byte
}

type agentMediaMotion struct {
	ContentType string `json:"content_type"`
	DataBase64  string `json:"data_base64"`
	Size        int64  `json:"size"`
}

func startAgentCloudTransfer(
	manager *transfer.Manager,
	kind, direction, fileName, path string,
	total int64,
) (*transfer.Handle, func(done, total int64)) {
	if manager == nil {
		return nil, nil
	}
	handle := manager.Start(transfer.Spec{
		FileName:   fileName,
		Path:       filepath.ToSlash(path),
		Kind:       kind,
		Direction:  direction,
		TotalBytes: total,
	})
	first := true
	progress := func(done, total int64) {
		if handle == nil {
			return
		}
		if first {
			first = false
			handle.Baseline(done, total)
			return
		}
		handle.Progress(done, total)
	}
	return handle, progress
}

func finishAgentCloudTransfer(handle *transfer.Handle, err error) {
	if handle == nil {
		return
	}
	if err != nil {
		handle.Fail(err)
		return
	}
	handle.Complete()
}

func (c *agentController) cloudClient() (*client.Client, userconfig.Config, error) {
	cfg, err := userconfig.Load()
	if err != nil {
		return nil, userconfig.Config{}, err
	}
	cli, err := userconfig.NewClient(cfg)
	if err != nil {
		return nil, userconfig.Config{}, err
	}
	return cli, cfg, nil
}

func (c *agentController) CloudRoot(ctx context.Context) (client.Node, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.Node{}, err
	}
	return cli.Root(ctx)
}

func (c *agentController) CloudList(ctx context.Context, parentID uint64) ([]client.Node, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.List(ctx, parentID)
}

func (c *agentController) CloudListPage(ctx context.Context, parentID uint64, options client.ChildrenOptions) (client.ChildrenPage, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.ChildrenPage{}, err
	}
	if parentID == 0 {
		return client.ChildrenPage{}, fmt.Errorf("parent id is required")
	}
	return cli.ListPage(ctx, parentID, options)
}

func (c *agentController) CloudListRange(ctx context.Context, parentID uint64, options client.ChildrenRangeOptions) (client.ChildrenRange, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.ChildrenRange{}, err
	}
	if parentID == 0 {
		return client.ChildrenRange{}, fmt.Errorf("parent id is required")
	}
	return cli.ListRange(ctx, parentID, options)
}

func (c *agentController) CloudFileQuickAccess(ctx context.Context) ([]client.FileQuickAccessItem, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.FileQuickAccess(ctx)
}

func (c *agentController) CloudPinFileQuickAccess(ctx context.Context, nodeID uint64) (client.FileQuickAccessItem, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.FileQuickAccessItem{}, err
	}
	if nodeID == 0 {
		return client.FileQuickAccessItem{}, fmt.Errorf("node id is required")
	}
	return cli.PinFileQuickAccess(ctx, nodeID)
}

func (c *agentController) CloudUnpinFileQuickAccess(ctx context.Context, nodeID uint64) error {
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	if nodeID == 0 {
		return fmt.Errorf("node id is required")
	}
	return cli.UnpinFileQuickAccess(ctx, nodeID)
}

func (c *agentController) CloudFileRecent(ctx context.Context, limit int) ([]client.FileRecentItem, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.FileRecent(ctx, limit)
}

func (c *agentController) CloudTouchFileRecent(ctx context.Context, nodeID uint64) (client.FileRecentItem, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.FileRecentItem{}, err
	}
	if nodeID == 0 {
		return client.FileRecentItem{}, fmt.Errorf("node id is required")
	}
	return cli.TouchFileRecent(ctx, nodeID)
}

func (c *agentController) CloudClearFileRecent(ctx context.Context) error {
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	return cli.ClearFileRecent(ctx)
}

func (c *agentController) CloudCreateDir(ctx context.Context, parentID uint64, name string) (client.Node, error) {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return client.Node{}, err
	}
	name = strings.TrimSpace(name)
	if parentID == 0 || name == "" {
		return client.Node{}, fmt.Errorf("parent id and directory name are required")
	}
	node, err := cli.CreateDir(ctx, parentID, name)
	if err == nil {
		c.requestCloudSync(cfg)
	}
	return node, err
}

func (c *agentController) CloudRename(ctx context.Context, id, revision uint64, name string) (client.Node, error) {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return client.Node{}, err
	}
	name = strings.TrimSpace(name)
	if id == 0 || revision == 0 || name == "" {
		return client.Node{}, fmt.Errorf("node id, revision, and name are required")
	}
	node, err := cli.RenameMove(ctx, id, revision, &name, nil)
	if err == nil {
		c.requestCloudSync(cfg)
	}
	return node, err
}

func (c *agentController) CloudCopy(ctx context.Context, id, parentID uint64) (client.Node, error) {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return client.Node{}, err
	}
	if id == 0 || parentID == 0 {
		return client.Node{}, fmt.Errorf("node id and target parent id are required")
	}
	node, err := cli.Copy(ctx, id, parentID, nil)
	if err == nil {
		c.requestCloudSync(cfg)
	}
	return node, err
}

func (c *agentController) CloudMove(ctx context.Context, id, revision, parentID uint64) (client.Node, error) {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return client.Node{}, err
	}
	if id == 0 || revision == 0 || parentID == 0 {
		return client.Node{}, fmt.Errorf("node id, revision, and target parent id are required")
	}
	node, err := cli.Move(ctx, id, revision, parentID)
	if err == nil {
		c.requestCloudSync(cfg)
	}
	return node, err
}

func (c *agentController) CloudDelete(ctx context.Context, id, revision uint64) error {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return err
	}
	if id == 0 || revision == 0 {
		return fmt.Errorf("node id and revision are required")
	}
	if err := cli.Delete(ctx, id, revision); err != nil {
		return err
	}
	c.requestCloudSync(cfg)
	return nil
}

func (c *agentController) CloudBatchCopy(ctx context.Context, items []client.BatchNodeRef, parentID uint64) (client.BatchNodesResult, error) {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return client.BatchNodesResult{}, err
	}
	result, err := cli.BatchCopy(ctx, items, parentID)
	if err == nil {
		c.requestCloudSync(cfg)
	}
	return result, err
}

func (c *agentController) CloudBatchMove(ctx context.Context, items []client.BatchNodeRef, parentID uint64) (client.BatchNodesResult, error) {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return client.BatchNodesResult{}, err
	}
	result, err := cli.BatchMove(ctx, items, parentID)
	if err == nil {
		c.requestCloudSync(cfg)
	}
	return result, err
}

func (c *agentController) CloudBatchDelete(ctx context.Context, items []client.BatchNodeRef) (client.BatchNodesResult, error) {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return client.BatchNodesResult{}, err
	}
	result, err := cli.BatchDelete(ctx, items)
	if err == nil {
		c.requestCloudSync(cfg)
	}
	return result, err
}

func (c *agentController) CloudFilePropertiesStats(
	ctx context.Context,
	items []client.BatchNodeRef,
) (client.FilePropertiesStats, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.FilePropertiesStats{}, err
	}
	return cli.FilePropertiesStats(ctx, items)
}

func (c *agentController) CloudCreateFileOperation(
	ctx context.Context,
	operationType string,
	items []client.BatchNodeRef,
	parentID uint64,
) (client.FileOperation, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.FileOperation{}, err
	}
	return cli.CreateFileOperation(ctx, operationType, items, parentID)
}

func (c *agentController) CloudBackgroundTaskActiveSummary(
	ctx context.Context,
) (client.BackgroundTaskActiveSummary, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.BackgroundTaskActiveSummary{}, err
	}
	return cli.BackgroundTaskActiveSummary(ctx)
}

func (c *agentController) CloudBackgroundTaskPage(
	ctx context.Context,
	global bool,
	limit int,
	cursor string,
) (client.BackgroundTaskPage, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.BackgroundTaskPage{}, err
	}
	return cli.BackgroundTaskPage(ctx, limit, cursor, global)
}

func (c *agentController) CloudBackgroundTasks(ctx context.Context, global bool, limit int) ([]client.BackgroundTask, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	if global {
		return cli.ListAdminBackgroundTasks(ctx, limit)
	}
	return cli.ListBackgroundTasks(ctx, limit)
}

func (c *agentController) CloudControlBackgroundTask(
	ctx context.Context,
	global bool,
	id, action string,
) (client.BackgroundTaskControlResult, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.BackgroundTaskControlResult{}, err
	}
	return cli.ControlBackgroundTask(ctx, id, action, global)
}

func (c *agentController) CloudFileOperations(ctx context.Context, limit int) ([]client.FileOperation, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.ListFileOperations(ctx, limit)
}

func (c *agentController) CloudClearFileOperationHistory(ctx context.Context) error {
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	return cli.ClearFileOperationHistory(ctx)
}

func (c *agentController) CloudFileOperation(ctx context.Context, id string) (client.FileOperation, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.FileOperation{}, err
	}
	return cli.GetFileOperation(ctx, strings.TrimSpace(id))
}

func (c *agentController) CloudCancelFileOperation(ctx context.Context, id string) (client.FileOperation, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.FileOperation{}, err
	}
	return cli.CancelFileOperation(ctx, strings.TrimSpace(id))
}

func (c *agentController) CloudRetryFileOperation(ctx context.Context, id string) (client.FileOperation, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.FileOperation{}, err
	}
	return cli.RetryFileOperation(ctx, strings.TrimSpace(id))
}

func (c *agentController) CloudUndoFileOperation(ctx context.Context, id string) (client.FileOperation, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.FileOperation{}, err
	}
	return cli.UndoFileOperation(ctx, strings.TrimSpace(id))
}

func (c *agentController) CloudRedoFileOperation(ctx context.Context, id string) (client.FileOperation, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.FileOperation{}, err
	}
	return cli.RedoFileOperation(ctx, strings.TrimSpace(id))
}

func (c *agentController) CloudResolveFileOperationConflict(ctx context.Context, id, policy string) (client.FileOperation, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.FileOperation{}, err
	}
	return cli.ResolveFileOperationConflict(ctx, strings.TrimSpace(id), strings.TrimSpace(policy))
}

func (c *agentController) CloudUploadConflictPreflight(
	ctx context.Context,
	parentID uint64,
	name string,
) (client.UploadConflictPreflight, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.UploadConflictPreflight{}, err
	}
	return cli.UploadConflictPreflight(ctx, parentID, strings.TrimSpace(name))
}

func (c *agentController) CloudUploadWithConflictPolicy(
	ctx context.Context,
	parentID uint64,
	localPath, name, conflictPolicy string,
) (agentCloudUploadResult, error) {
	return c.cloudUploadWithConflictPolicyTracked(
		ctx, parentID, localPath, name, conflictPolicy, "",
	)
}

func (c *agentController) CloudUploadWithConflictPolicyTracked(
	ctx context.Context,
	parentID uint64,
	localPath, name, conflictPolicy, transferID string,
) (agentCloudUploadResult, error) {
	return c.cloudUploadWithConflictPolicyTracked(
		ctx, parentID, localPath, name, conflictPolicy, strings.TrimSpace(transferID),
	)
}

func (c *agentController) cloudUploadWithConflictPolicyTracked(
	ctx context.Context,
	parentID uint64,
	localPath, name, conflictPolicy, transferID string,
) (agentCloudUploadResult, error) {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return agentCloudUploadResult{}, err
	}
	localPath = filepath.Clean(strings.TrimSpace(localPath))
	if parentID == 0 || localPath == "." || !filepath.IsAbs(localPath) {
		return agentCloudUploadResult{}, fmt.Errorf("parent id and absolute local path are required")
	}
	info, err := os.Stat(localPath)
	if err != nil {
		return agentCloudUploadResult{}, err
	}
	if !info.Mode().IsRegular() {
		return agentCloudUploadResult{}, fmt.Errorf("upload path must reference a regular file")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = filepath.Base(localPath)
	}
	policy := client.UploadConflictPolicy(strings.TrimSpace(conflictPolicy))
	switch policy {
	case client.UploadConflictPolicyFail, client.UploadConflictPolicySkip, client.UploadConflictPolicyKeepBoth, client.UploadConflictPolicyOverwrite:
	default:
		return agentCloudUploadResult{}, fmt.Errorf("invalid upload conflict policy %q", conflictPolicy)
	}

	var handle *transfer.Handle
	var progress func(done, total int64)
	managedExternally := transferID != ""
	if managedExternally {
		handle = c.transfers.Handle(transferID)
		if handle == nil {
			return agentCloudUploadResult{}, fmt.Errorf("transfer child not found")
		}
		first := true
		progress = func(done, total int64) {
			if first {
				first = false
				handle.Baseline(done, total)
				return
			}
			handle.Progress(done, total)
		}
	} else {
		handle, progress = startAgentCloudTransfer(
			c.transfers,
			transfer.KindUpload,
			"upload",
			name,
			localPath,
			info.Size(),
		)
	}

	result, err := cli.UploadFileResumableWithConflictPolicyResult(
		ctx, parentID, localPath, name, policy, progress,
	)
	if err != nil {
		if !managedExternally {
			finishAgentCloudTransfer(handle, err)
		}
		return agentCloudUploadResult{}, err
	}
	if !managedExternally {
		if result.Skipped {
			handle.CompleteSkipped()
		} else {
			finishAgentCloudTransfer(handle, nil)
		}
	}
	if !result.Skipped {
		c.requestCloudSync(cfg)
	}
	return agentCloudUploadResult{
		Node: result.Node, Skipped: result.Skipped, TransferredBytes: result.TransferredBytes,
	}, nil
}

func (c *agentController) CloudUpload(ctx context.Context, parentID uint64, localPath, name string) (client.Node, error) {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return client.Node{}, err
	}
	localPath = filepath.Clean(strings.TrimSpace(localPath))
	if parentID == 0 || localPath == "." || !filepath.IsAbs(localPath) {
		return client.Node{}, fmt.Errorf("parent id and absolute local path are required")
	}
	info, err := os.Stat(localPath)
	if err != nil {
		return client.Node{}, err
	}
	if !info.Mode().IsRegular() {
		return client.Node{}, fmt.Errorf("upload path must reference a regular file")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = filepath.Base(localPath)
	}
	handle, progress := startAgentCloudTransfer(
		c.transfers,
		transfer.KindUpload,
		"upload",
		name,
		localPath,
		info.Size(),
	)
	node, err := cli.UploadFileResumable(ctx, parentID, localPath, name, progress)
	finishAgentCloudTransfer(handle, err)
	if err == nil {
		c.requestCloudSync(cfg)
	}
	return node, err
}

func (c *agentController) CloudFileTextPreview(ctx context.Context, id uint64) (client.FileTextPreview, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.FileTextPreview{}, err
	}
	return cli.FileTextPreview(ctx, id)
}

func (c *agentController) CloudFilePreviewTicket(
	ctx context.Context,
	id uint64,
) (client.FilePreviewTicket, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.FilePreviewTicket{}, err
	}
	return cli.FilePreviewTicket(ctx, id)
}

func (c *agentController) CloudDownload(ctx context.Context, id uint64, destination string) error {
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	destination = filepath.Clean(strings.TrimSpace(destination))
	if id == 0 || destination == "." || !filepath.IsAbs(destination) {
		return fmt.Errorf("node id and absolute destination path are required")
	}
	parent := filepath.Dir(destination)
	if info, statErr := os.Stat(parent); statErr != nil {
		return statErr
	} else if !info.IsDir() {
		return fmt.Errorf("download destination parent is not a directory")
	}

	handle, progress := startAgentCloudTransfer(
		c.transfers,
		transfer.KindDownload,
		"download",
		filepath.Base(destination),
		destination,
		0,
	)
	tmp, err := os.CreateTemp(parent, ".xdrive-download-*")
	if err != nil {
		finishAgentCloudTransfer(handle, err)
		return err
	}
	tmpPath := tmp.Name()
	cleanup := func() {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
	}
	if err := tmp.Chmod(0o600); err != nil {
		finishAgentCloudTransfer(handle, err)
		cleanup()
		return err
	}
	if err := cli.DownloadToProgress(ctx, id, tmp, progress); err != nil {
		finishAgentCloudTransfer(handle, err)
		cleanup()
		return err
	}
	if err := tmp.Sync(); err != nil {
		finishAgentCloudTransfer(handle, err)
		cleanup()
		return err
	}
	if err := tmp.Close(); err != nil {
		finishAgentCloudTransfer(handle, err)
		_ = os.Remove(tmpPath)
		return err
	}
	if err := replaceDownloadedFile(tmpPath, destination); err != nil {
		finishAgentCloudTransfer(handle, err)
		_ = os.Remove(tmpPath)
		return err
	}
	finishAgentCloudTransfer(handle, nil)
	return nil
}

func replaceDownloadedFile(stagedPath, destination string) error {
	info, err := os.Stat(destination)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return os.Rename(stagedPath, destination)
		}
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("download destination is a directory")
	}

	parent := filepath.Dir(destination)
	backup, err := os.CreateTemp(parent, ".xdrive-download-backup-*")
	if err != nil {
		return err
	}
	backupPath := backup.Name()
	if err := backup.Close(); err != nil {
		_ = os.Remove(backupPath)
		return err
	}
	if err := os.Remove(backupPath); err != nil {
		return err
	}

	if err := os.Rename(destination, backupPath); err != nil {
		return err
	}
	if err := os.Rename(stagedPath, destination); err != nil {
		restoreErr := os.Rename(backupPath, destination)
		if restoreErr != nil {
			return fmt.Errorf("replace downloaded file: %w; restore original: %v", err, restoreErr)
		}
		return err
	}
	_ = os.Remove(backupPath)
	return nil
}

func agentCloudDownloadPathSegment(name string) (string, error) {
	if err := meta.ValidateName(name); err != nil {
		return "", err
	}
	if name == "." || name == ".." || strings.ContainsAny(name, "/\\\x00") {
		return "", fmt.Errorf("unsafe cloud download path segment %q", name)
	}
	return name, nil
}

func resolveAgentCloudDownloadFolderRoot(
	ctx context.Context,
	cli *client.Client,
	id uint64,
	parentID uint64,
) (client.Node, error) {
	if id == 0 || parentID == 0 {
		return client.Node{}, fmt.Errorf("folder id and parent id are required")
	}
	children, err := cli.List(ctx, parentID)
	if err != nil {
		return client.Node{}, err
	}
	for _, node := range children {
		if node.ID != id {
			continue
		}
		if node.Type != meta.NodeTypeDir {
			return client.Node{}, fmt.Errorf("download root is not a directory")
		}
		if _, err := agentCloudDownloadPathSegment(node.Name); err != nil {
			return client.Node{}, err
		}
		return node, nil
	}
	return client.Node{}, fmt.Errorf("download folder is no longer available")
}

func scanAgentCloudDownloadFolder(
	ctx context.Context,
	root client.Node,
	list func(context.Context, uint64) ([]client.Node, error),
) (agentCloudFolderDownloadManifest, error) {
	if root.Type != meta.NodeTypeDir {
		return agentCloudFolderDownloadManifest{}, fmt.Errorf("download root is not a directory")
	}
	manifest := agentCloudFolderDownloadManifest{}
	visited := make(map[uint64]struct{})

	var walk func(client.Node, string) error
	walk = func(node client.Node, relativePath string) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if _, exists := visited[node.ID]; exists {
			return fmt.Errorf("cloud download tree contains a cycle")
		}
		visited[node.ID] = struct{}{}
		if len(visited) > maxAgentArchiveEntries {
			return fmt.Errorf("cloud download tree contains too many entries")
		}

		switch node.Type {
		case meta.NodeTypeDir:
			manifest.Directories = append(manifest.Directories, relativePath)
			children, err := list(ctx, node.ID)
			if err != nil {
				return err
			}
			for _, child := range children {
				segment, err := agentCloudDownloadPathSegment(child.Name)
				if err != nil {
					return err
				}
				childPath := segment
				if relativePath != "" {
					childPath = pathpkg.Join(relativePath, segment)
				}
				if err := walk(child, childPath); err != nil {
					return err
				}
			}
		case meta.NodeTypeFile:
			if node.Size < 0 {
				return fmt.Errorf("cloud download file has invalid size")
			}
			const maxInt64 = int64(^uint64(0) >> 1)
			if node.Size > 0 && manifest.TotalBytes > maxInt64-node.Size {
				return fmt.Errorf("cloud download tree is too large")
			}
			manifest.TotalBytes += node.Size
			manifest.Files = append(manifest.Files, agentCloudFolderDownloadFile{
				Node:         node,
				RelativePath: relativePath,
			})
		default:
			return fmt.Errorf("unsupported cloud download node type %q", node.Type)
		}
		return nil
	}

	if err := walk(root, ""); err != nil {
		return agentCloudFolderDownloadManifest{}, err
	}
	return manifest, nil
}

func downloadAgentCloudFileIntoPath(
	ctx context.Context,
	cli *client.Client,
	id uint64,
	destination string,
	progress func(done, total int64),
) error {
	parent := filepath.Dir(destination)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(parent, ".xdrive-download-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	cleanup := func() {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
	}
	if err := tmp.Chmod(0o600); err != nil {
		cleanup()
		return err
	}
	if err := cli.DownloadToProgress(ctx, id, tmp, progress); err != nil {
		cleanup()
		return err
	}
	if err := tmp.Sync(); err != nil {
		cleanup()
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	if err := replaceDownloadedFile(tmpPath, destination); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return nil
}

func existingAgentCloudDownloadRootNames(destination string) (map[string]struct{}, error) {
	entries, err := os.ReadDir(destination)
	if err != nil {
		return nil, err
	}
	reserved := make(map[string]struct{}, len(entries)+1)
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".xdrive-download-") ||
			strings.HasPrefix(name, ".xdrive-archive-") ||
			strings.HasPrefix(name, ".xdrive-extract-") {
			continue
		}
		reserved[strings.ToLower(name)] = struct{}{}
	}
	return reserved, nil
}

func (c *agentController) CloudDownloadFolder(
	ctx context.Context,
	id uint64,
	parentID uint64,
	destination string,
) (agentCloudFolderDownloadResult, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return agentCloudFolderDownloadResult{}, err
	}
	destination = filepath.Clean(strings.TrimSpace(destination))
	if destination == "." || !filepath.IsAbs(destination) {
		return agentCloudFolderDownloadResult{}, fmt.Errorf("absolute folder download destination is required")
	}
	if info, err := os.Stat(destination); err != nil {
		return agentCloudFolderDownloadResult{}, err
	} else if !info.IsDir() {
		return agentCloudFolderDownloadResult{}, fmt.Errorf("folder download destination is not a directory")
	}

	root, err := resolveAgentCloudDownloadFolderRoot(ctx, cli, id, parentID)
	if err != nil {
		return agentCloudFolderDownloadResult{}, err
	}

	group := c.transfers.StartGroup(transfer.Spec{
		FileName:     root.Name,
		Path:         destination,
		Kind:         transfer.KindDownload,
		Direction:    "download",
		Phase:        transfer.PhaseScanning,
		ScanComplete: false,
	})
	if group == nil {
		return agentCloudFolderDownloadResult{}, fmt.Errorf("transfer manager is unavailable")
	}

	manifest, err := scanAgentCloudDownloadFolder(ctx, root, cli.List)
	if err != nil {
		_ = group.Finish(transfer.StateFailed, err)
		return agentCloudFolderDownloadResult{}, err
	}

	reserved, err := existingAgentCloudDownloadRootNames(destination)
	if err != nil {
		_ = group.Finish(transfer.StateFailed, err)
		return agentCloudFolderDownloadResult{}, err
	}
	rootName, err := allocateDownloadedArchiveName(root.Name, true, reserved)
	if err != nil {
		_ = group.Finish(transfer.StateFailed, err)
		return agentCloudFolderDownloadResult{}, err
	}
	rootPath := filepath.Join(destination, rootName)
	if err := os.Mkdir(rootPath, 0o755); err != nil {
		_ = group.Finish(transfer.StateFailed, err)
		return agentCloudFolderDownloadResult{}, err
	}
	for _, relativeDir := range manifest.Directories {
		if relativeDir == "" {
			continue
		}
		if err := os.MkdirAll(filepath.Join(rootPath, filepath.FromSlash(relativeDir)), 0o755); err != nil {
			_ = group.Finish(transfer.StateFailed, err)
			return agentCloudFolderDownloadResult{}, err
		}
	}

	childHandles := make([]*transfer.Handle, len(manifest.Files))
	childDone := make([]int64, len(manifest.Files))
	childTotals := make([]int64, len(manifest.Files))
	for index, file := range manifest.Files {
		childTotals[index] = max(int64(0), file.Node.Size)
		childHandles[index] = c.transfers.StartChild(group, transfer.Spec{
			FileName:     file.Node.Name,
			Path:         filepath.Join(rootPath, filepath.FromSlash(file.RelativePath)),
			RelativePath: pathpkg.Join(root.Name, file.RelativePath),
			Kind:         transfer.KindDownload,
			Direction:    "download",
			Phase:        transfer.PhaseQueued,
			TotalBytes:   childTotals[index],
		})
		if childHandles[index] == nil {
			err := fmt.Errorf("cannot create folder download child transfer")
			_ = group.Finish(transfer.StateFailed, err)
			return agentCloudFolderDownloadResult{}, err
		}
	}

	completed := int64(0)
	failed := int64(0)
	running := int64(0)
	processed := int64(0)
	groupProgress := func() transfer.GroupProgress {
		var bytesDone int64
		var bytesTotal int64
		for index := range childDone {
			bytesDone += max(int64(0), childDone[index])
			bytesTotal += max(int64(0), childTotals[index])
		}
		return transfer.GroupProgress{
			Phase:          transfer.PhaseTransferring,
			ScanComplete:   true,
			BytesDone:      bytesDone,
			BytesTotal:     bytesTotal,
			TotalItems:     int64(len(manifest.Files)),
			CompletedItems: completed,
			FailedItems:    failed,
			RunningItems:   running,
			QueuedItems:    max(int64(0), int64(len(manifest.Files))-processed-running),
		}
	}
	group.UpdateGroup(groupProgress())

	result := agentCloudFolderDownloadResult{Root: rootName}
	if len(manifest.Files) == 0 {
		_ = group.Finish(transfer.StateCompleted, nil)
		return result, nil
	}

	var firstFailure error
	for index, file := range manifest.Files {
		child := childHandles[index]
		running = 1
		child.SetPhase(transfer.PhaseTransferring)
		group.UpdateGroup(groupProgress())

		firstProgress := true
		progress := func(done, total int64) {
			if total > 0 && total != childTotals[index] {
				childTotals[index] = total
			}
			childDone[index] = max(int64(0), done)
			if firstProgress {
				firstProgress = false
				child.Baseline(done, total)
			} else {
				child.Progress(done, total)
			}
			group.UpdateGroup(groupProgress())
		}

		target := filepath.Join(rootPath, filepath.FromSlash(file.RelativePath))
		err := downloadAgentCloudFileIntoPath(ctx, cli, file.Node.ID, target, progress)
		running = 0
		processed++
		if err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || ctx.Err() != nil {
				_ = child.Finish(transfer.StateCancelled, err)
				for next := index + 1; next < len(childHandles); next++ {
					_ = childHandles[next].Finish(transfer.StateCancelled, nil)
				}
				group.UpdateGroup(groupProgress())
				_ = group.Finish(transfer.StateCancelled, err)
				return result, err
			}
			failed++
			result.Failed++
			if firstFailure == nil {
				firstFailure = err
			}
			_ = child.Finish(transfer.StateFailed, err)
			group.UpdateGroup(groupProgress())
			continue
		}

		childDone[index] = childTotals[index]
		completed++
		result.Downloaded++
		child.Complete()
		group.UpdateGroup(groupProgress())
	}

	switch {
	case failed == 0:
		_ = group.Finish(transfer.StateCompleted, nil)
	case completed == 0:
		_ = group.Finish(transfer.StateFailed, firstFailure)
		return result, firstFailure
	default:
		_ = group.Finish(transfer.StatePartial, firstFailure)
	}
	return result, nil
}

func (c *agentController) CloudDownloadArchive(
	ctx context.Context,
	ids []uint64,
	destination string,
) (agentCloudArchiveDownloadResult, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return agentCloudArchiveDownloadResult{}, err
	}
	if len(ids) == 0 || len(ids) > 1000 {
		return agentCloudArchiveDownloadResult{}, fmt.Errorf("archive download requires between 1 and 1000 node ids")
	}
	for _, id := range ids {
		if id == 0 {
			return agentCloudArchiveDownloadResult{}, fmt.Errorf("archive download node ids must be non-zero")
		}
	}
	destination = filepath.Clean(strings.TrimSpace(destination))
	if destination == "." || !filepath.IsAbs(destination) {
		return agentCloudArchiveDownloadResult{}, fmt.Errorf("absolute archive destination directory is required")
	}
	if info, err := os.Stat(destination); err != nil {
		return agentCloudArchiveDownloadResult{}, err
	} else if !info.IsDir() {
		return agentCloudArchiveDownloadResult{}, fmt.Errorf("archive destination is not a directory")
	}

	handle, progress := startAgentCloudTransfer(
		c.transfers,
		transfer.KindDownload,
		"download",
		"xDrive-download.zip",
		destination,
		0,
	)
	tmp, err := os.CreateTemp(destination, ".xdrive-archive-*.zip")
	if err != nil {
		finishAgentCloudTransfer(handle, err)
		return agentCloudArchiveDownloadResult{}, err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		finishAgentCloudTransfer(handle, err)
		return agentCloudArchiveDownloadResult{}, err
	}
	if err := cli.DownloadArchiveToProgress(ctx, ids, tmp, progress); err != nil {
		_ = tmp.Close()
		finishAgentCloudTransfer(handle, err)
		return agentCloudArchiveDownloadResult{}, err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		finishAgentCloudTransfer(handle, err)
		return agentCloudArchiveDownloadResult{}, err
	}
	if err := tmp.Close(); err != nil {
		finishAgentCloudTransfer(handle, err)
		return agentCloudArchiveDownloadResult{}, err
	}

	downloaded, err := extractDownloadedArchive(tmpPath, destination)
	finishAgentCloudTransfer(handle, err)
	if err != nil {
		return agentCloudArchiveDownloadResult{}, err
	}
	return agentCloudArchiveDownloadResult{Downloaded: downloaded}, nil
}

type validatedArchiveEntry struct {
	file  *zip.File
	path  string
	isDir bool
}

func validateDownloadedArchive(reader *zip.ReadCloser) ([]validatedArchiveEntry, []string, error) {
	if len(reader.File) > maxAgentArchiveEntries {
		return nil, nil, fmt.Errorf("archive contains too many entries")
	}
	entries := make([]validatedArchiveEntry, 0, len(reader.File))
	roots := make([]string, 0)
	rootSeen := map[string]struct{}{}
	pathSeen := map[string]struct{}{}
	var total uint64
	const maxInt64 = uint64(^uint64(0) >> 1)

	for _, entry := range reader.File {
		raw := entry.Name
		if raw == "" || strings.ContainsRune(raw, '\x00') || strings.Contains(raw, "\\") || strings.HasPrefix(raw, "/") {
			return nil, nil, fmt.Errorf("unsafe archive path %q", raw)
		}
		isDir := strings.HasSuffix(raw, "/") || entry.FileInfo().IsDir()
		raw = strings.TrimSuffix(raw, "/")
		clean := pathpkg.Clean(raw)
		if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || clean != raw {
			return nil, nil, fmt.Errorf("unsafe archive path %q", entry.Name)
		}
		parts := strings.Split(clean, "/")
		for _, part := range parts {
			if err := meta.ValidateName(part); err != nil {
				return nil, nil, fmt.Errorf("unsafe archive path %q: %w", entry.Name, err)
			}
		}
		modeType := entry.Mode() & os.ModeType
		if modeType == os.ModeSymlink || (!isDir && modeType != 0) || (isDir && modeType != 0 && modeType != os.ModeDir) {
			return nil, nil, fmt.Errorf("unsupported archive entry type for %q", entry.Name)
		}
		key := strings.ToLower(clean)
		if _, exists := pathSeen[key]; exists {
			return nil, nil, fmt.Errorf("duplicate archive path %q", entry.Name)
		}
		pathSeen[key] = struct{}{}
		if entry.UncompressedSize64 > maxInt64-total {
			return nil, nil, fmt.Errorf("archive uncompressed size is too large")
		}
		total += entry.UncompressedSize64
		rootKey := strings.ToLower(parts[0])
		if _, exists := rootSeen[rootKey]; !exists {
			rootSeen[rootKey] = struct{}{}
			roots = append(roots, parts[0])
		}
		entries = append(entries, validatedArchiveEntry{file: entry, path: clean, isDir: isDir})
	}
	return entries, roots, nil
}

func extractDownloadedArchive(zipPath, destination string) ([]string, error) {
	reader, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	entries, roots, err := validateDownloadedArchive(reader)
	if err != nil {
		return nil, err
	}
	staging, err := os.MkdirTemp(destination, ".xdrive-extract-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(staging)

	for _, entry := range entries {
		target := filepath.Join(staging, filepath.FromSlash(entry.path))
		rel, err := filepath.Rel(staging, target)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return nil, fmt.Errorf("archive path escapes staging root: %q", entry.file.Name)
		}
		if entry.isDir {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return nil, err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return nil, err
		}
		input, err := entry.file.Open()
		if err != nil {
			return nil, err
		}
		output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			_ = input.Close()
			return nil, err
		}
		written, copyErr := io.Copy(output, input)
		syncErr := output.Sync()
		closeOutErr := output.Close()
		closeInErr := input.Close()
		if copyErr != nil {
			return nil, copyErr
		}
		if syncErr != nil {
			return nil, syncErr
		}
		if closeOutErr != nil {
			return nil, closeOutErr
		}
		if closeInErr != nil {
			return nil, closeInErr
		}
		if written < 0 || uint64(written) != entry.file.UncompressedSize64 {
			return nil, fmt.Errorf("archive entry size mismatch for %q", entry.file.Name)
		}
		if err := os.Chmod(target, 0o644); err != nil {
			return nil, err
		}
	}

	existing, err := os.ReadDir(destination)
	if err != nil {
		return nil, err
	}
	reserved := make(map[string]struct{}, len(existing)+len(roots))
	for _, entry := range existing {
		if strings.HasPrefix(entry.Name(), ".xdrive-extract-") || strings.HasPrefix(entry.Name(), ".xdrive-archive-") {
			continue
		}
		reserved[strings.ToLower(entry.Name())] = struct{}{}
	}

	downloaded := make([]string, 0, len(roots))
	promoted := make([]string, 0, len(roots))
	for _, root := range roots {
		source := filepath.Join(staging, root)
		info, err := os.Lstat(source)
		if err != nil {
			return nil, err
		}
		if info.Mode()&os.ModeSymlink != 0 || (!info.IsDir() && !info.Mode().IsRegular()) {
			return nil, fmt.Errorf("unsupported extracted root %q", root)
		}
		name, err := allocateDownloadedArchiveName(root, info.IsDir(), reserved)
		if err != nil {
			return nil, err
		}
		target := filepath.Join(destination, name)
		if err := copyDownloadedArchiveRoot(source, target); err != nil {
			for _, path := range promoted {
				_ = os.RemoveAll(path)
			}
			return nil, err
		}
		promoted = append(promoted, target)
		downloaded = append(downloaded, name)
	}
	return downloaded, nil
}

func allocateDownloadedArchiveName(
	name string,
	isDir bool,
	reserved map[string]struct{},
) (string, error) {
	base, ext := name, ""
	if !isDir {
		if dot := strings.LastIndex(name, "."); dot > 0 {
			base, ext = name[:dot], name[dot:]
		}
	}
	for index := 0; index <= 9999; index++ {
		candidate := name
		if index > 0 {
			suffix := " - 副本"
			if index > 1 {
				suffix = fmt.Sprintf(" - 副本 (%d)", index)
			}
			candidate = base + suffix + ext
		}
		if err := meta.ValidateName(candidate); err != nil {
			return "", err
		}
		key := strings.ToLower(candidate)
		if _, exists := reserved[key]; exists {
			continue
		}
		reserved[key] = struct{}{}
		return candidate, nil
	}
	return "", fmt.Errorf("cannot allocate archive destination name for %q", name)
}

func copyDownloadedArchiveRoot(source, destination string) error {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("symlink extracted roots are not supported")
	}
	if info.IsDir() {
		if err := os.Mkdir(destination, 0o755); err != nil {
			return err
		}
		entries, err := os.ReadDir(source)
		if err != nil {
			_ = os.RemoveAll(destination)
			return err
		}
		for _, entry := range entries {
			if err := copyDownloadedArchiveRoot(
				filepath.Join(source, entry.Name()),
				filepath.Join(destination, entry.Name()),
			); err != nil {
				_ = os.RemoveAll(destination)
				return err
			}
		}
		return nil
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("unsupported extracted file type")
	}
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	syncErr := output.Sync()
	closeErr := output.Close()
	if copyErr != nil {
		_ = os.Remove(destination)
		return copyErr
	}
	if syncErr != nil {
		_ = os.Remove(destination)
		return syncErr
	}
	if closeErr != nil {
		_ = os.Remove(destination)
		return closeErr
	}
	return os.Chmod(destination, 0o644)
}

func (c *agentController) CloudSearch(ctx context.Context, query, cursor, sortKey, order string) (agentCloudSearchPage, error) {
	query = strings.TrimSpace(query)
	if len([]rune(query)) < 2 {
		return agentCloudSearchPage{}, fmt.Errorf("search query must contain at least 2 characters")
	}
	cli, _, err := c.cloudClient()
	if err != nil {
		return agentCloudSearchPage{}, err
	}
	page, err := cli.Search(ctx, client.SearchOptions{
		Query:  query,
		Limit:  cloudSearchLimit,
		Cursor: strings.TrimSpace(cursor),
		Sort:   strings.TrimSpace(sortKey),
		Order:  strings.TrimSpace(order),
	})
	if err != nil {
		return agentCloudSearchPage{}, err
	}

	out := make([]agentCloudSearchResult, 0, len(page.Items))
	for _, item := range page.Items {
		out = append(out, agentCloudSearchResult{
			Node: item.Node, Path: item.Path, Crumbs: agentCloudCrumbs(item.Breadcrumbs),
		})
	}
	return agentCloudSearchPage{Items: out, NextCursor: page.NextCursor}, nil
}

func (c *agentController) CloudSearchRange(
	ctx context.Context,
	query string,
	offset, limit int,
	sortKey, order string,
) (agentCloudSearchRange, error) {
	query = strings.TrimSpace(query)
	if len([]rune(query)) < 2 {
		return agentCloudSearchRange{}, fmt.Errorf("search query must contain at least 2 characters")
	}
	if offset < 0 {
		return agentCloudSearchRange{}, fmt.Errorf("search offset must be zero or greater")
	}
	if limit <= 0 || limit > cloudSearchLimit {
		return agentCloudSearchRange{}, fmt.Errorf("search limit must be between 1 and %d", cloudSearchLimit)
	}
	cli, _, err := c.cloudClient()
	if err != nil {
		return agentCloudSearchRange{}, err
	}
	page, err := cli.SearchRange(ctx, client.SearchRangeOptions{
		Query:  query,
		Limit:  limit,
		Offset: offset,
		Sort:   strings.TrimSpace(sortKey),
		Order:  strings.TrimSpace(order),
	})
	if err != nil {
		return agentCloudSearchRange{}, err
	}
	out := make([]agentCloudSearchResult, 0, len(page.Items))
	for _, item := range page.Items {
		out = append(out, agentCloudSearchResult{
			Node: item.Node, Path: item.Path, Crumbs: agentCloudCrumbs(item.Breadcrumbs),
		})
	}
	return agentCloudSearchRange{
		Items:      out,
		TotalCount: page.TotalCount,
		Offset:     page.Offset,
		Limit:      page.Limit,
		Sort:       page.Sort,
		Order:      page.Order,
	}, nil
}

func agentCloudCrumbs(items []client.SearchBreadcrumb) []agentCloudCrumb {
	out := make([]agentCloudCrumb, 0, len(items))
	for index, crumb := range items {
		name := crumb.Name
		if index == 0 && name == "" {
			name = "My files"
		}
		out = append(out, agentCloudCrumb{ID: crumb.ID, Name: name})
	}
	return out
}

func (c *agentController) CloudQuota(ctx context.Context) (client.QuotaUsage, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.QuotaUsage{}, err
	}
	return cli.Quota(ctx)
}

func (c *agentController) CloudServerUpdateState(ctx context.Context) (client.ServerUpdateState, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.ServerUpdateState{}, err
	}
	return cli.ServerUpdateState(ctx)
}

func (c *agentController) CloudStartServerUpdate(ctx context.Context, source, channel string, backupFileData bool) (client.ServerUpdateState, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.ServerUpdateState{}, err
	}
	return cli.StartServerUpdate(ctx, source, channel, backupFileData)
}

func (c *agentController) CloudStorageStats(ctx context.Context) (client.StorageStats, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.StorageStats{}, err
	}
	return cli.StorageStats(ctx)
}

func (c *agentController) CloudCleanupStorageCache(ctx context.Context, kind string) (client.StorageCacheCleanup, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.StorageCacheCleanup{}, err
	}
	return cli.CleanupStorageCache(ctx, kind)
}

func (c *agentController) CloudTrash(ctx context.Context) ([]client.Node, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.Trash(ctx)
}

func (c *agentController) CloudRestoreTrash(ctx context.Context, nodeID, revision uint64) (client.Node, error) {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return client.Node{}, err
	}
	node, err := cli.RestoreTrash(ctx, nodeID, revision)
	if err == nil {
		c.requestCloudSync(cfg)
	}
	return node, err
}

func (c *agentController) CloudDeleteTrash(ctx context.Context, nodeID, revision uint64) error {
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	return cli.PermanentlyDeleteTrash(ctx, nodeID, revision)
}

func (c *agentController) CloudVersions(ctx context.Context, nodeID uint64) ([]client.FileVersion, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.Versions(ctx, nodeID)
}

func (c *agentController) CloudRestoreVersion(ctx context.Context, nodeID, revision, versionID uint64) (client.Node, error) {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return client.Node{}, err
	}
	node, err := cli.RestoreVersion(ctx, nodeID, revision, versionID)
	if err == nil {
		c.requestCloudSync(cfg)
	}
	return node, err
}

func (c *agentController) CloudShares(ctx context.Context, nodeID uint64) ([]client.FileShare, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.Shares(ctx, nodeID)
}

func (c *agentController) CloudCreateShare(ctx context.Context, nodeID uint64, input client.CreateShareInput) (agentCreatedShare, error) {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return agentCreatedShare{}, err
	}
	created, err := cli.CreateShare(ctx, nodeID, input)
	if err != nil {
		return agentCreatedShare{}, err
	}
	base := strings.TrimRight(strings.TrimSpace(cfg.Server), "/")
	link := base + "/#/s/" + url.PathEscape(created.Token)
	return agentCreatedShare{Share: created, URL: link}, nil
}

func (c *agentController) CloudRevokeShare(ctx context.Context, shareID uint64) error {
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	return cli.RevokeShare(ctx, shareID)
}

func (c *agentController) requestCloudSync(cfg userconfig.Config) {
	root, err := userconfig.EffectiveMountPath(cfg)
	if err == nil {
		_ = mount.RequestSync(root)
	}
	select {
	case c.wake <- struct{}{}:
	default:
	}
}

func (c *agentController) CloudSources(ctx context.Context) ([]client.Source, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.Sources(ctx)
}

func (c *agentController) CloudSourceRuns(ctx context.Context, sourceID uint64, limit, offset int) ([]client.SyncRun, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.SourceRuns(ctx, sourceID, limit, offset)
}

func (c *agentController) CloudSourceRunFailures(ctx context.Context, sourceID uint64, runID string, limit, offset int) ([]client.SourceRunFailure, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.SourceRunFailures(ctx, sourceID, runID, limit, offset)
}

func (c *agentController) CloudCancelSourceRun(ctx context.Context, sourceID uint64, runID string) (client.SyncRun, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.SyncRun{}, err
	}
	return cli.CancelSourceRun(ctx, sourceID, runID)
}

func (c *agentController) CloudMediaItems(
	ctx context.Context,
	query client.MediaQuery,
	limit, offset int,
) ([]client.MediaItem, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.MediaItemsQuery(ctx, query, limit, offset)
}

func (c *agentController) CloudMediaItemsRange(
	ctx context.Context,
	query client.MediaQuery,
	limit, offset int,
) (client.MediaItemRange, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaItemRange{}, err
	}
	return cli.MediaItemsRangeQuery(ctx, query, limit, offset)
}

func (c *agentController) CloudMediaAlbums(ctx context.Context) ([]client.MediaAlbum, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.MediaAlbums(ctx)
}

func (c *agentController) CloudMediaPlaces(ctx context.Context, limit int) ([]client.MediaPlaceFacet, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.MediaPlaces(ctx, limit)
}

func (c *agentController) CloudMediaSuggestedPeople(
	ctx context.Context,
	limit int,
) ([]client.MediaSuggestedPerson, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.MediaSuggestedPeople(ctx, limit)
}

func (c *agentController) CloudMediaSuggestedPersonItems(
	ctx context.Context,
	personID string,
	query client.MediaQuery,
	limit, offset int,
) ([]client.MediaItem, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.MediaSuggestedPersonItemsQuery(
		ctx,
		personID,
		query,
		limit,
		offset,
	)
}

func (c *agentController) CloudMediaSuggestedPersonItemsRange(
	ctx context.Context,
	personID string,
	query client.MediaQuery,
	limit, offset int,
) (client.MediaItemRange, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaItemRange{}, err
	}
	return cli.MediaSuggestedPersonItemsRangeQuery(
		ctx,
		personID,
		query,
		limit,
		offset,
	)
}

func (c *agentController) CloudMediaPeople(
	ctx context.Context,
	includeHidden bool,
	limit, offset int,
) ([]client.MediaPersonIdentity, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.MediaPersonIdentities(ctx, includeHidden, limit, offset)
}

func (c *agentController) CloudMediaPersonItems(
	ctx context.Context,
	personID string,
	query client.MediaQuery,
	limit, offset int,
) ([]client.MediaItem, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.MediaPersonIdentityItemsQuery(ctx, personID, query, limit, offset)
}

func (c *agentController) CloudMediaPersonItemsRange(
	ctx context.Context,
	personID string,
	query client.MediaQuery,
	limit, offset int,
) (client.MediaItemRange, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaItemRange{}, err
	}
	return cli.MediaPersonIdentityItemsRangeQuery(ctx, personID, query, limit, offset)
}

func (c *agentController) CloudAdoptMediaSuggestedPerson(
	ctx context.Context,
	suggestionID, name string,
) (client.MediaPersonIdentity, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaPersonIdentity{}, err
	}
	return cli.AdoptMediaSuggestedPerson(ctx, suggestionID, name)
}

func (c *agentController) CloudUpdateMediaPerson(
	ctx context.Context,
	personID string,
	revision uint64,
	input client.UpdateMediaPersonIdentityInput,
) (client.MediaPersonIdentity, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaPersonIdentity{}, err
	}
	return cli.UpdateMediaPersonIdentity(ctx, personID, revision, input)
}

func (c *agentController) CloudMergeMediaPeople(
	ctx context.Context,
	targetID string,
	revision uint64,
	sourceIDs []string,
) (client.MediaPersonIdentity, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaPersonIdentity{}, err
	}
	return cli.MergeMediaPersonIdentities(ctx, targetID, revision, sourceIDs)
}

func (c *agentController) CloudSplitMediaPerson(
	ctx context.Context,
	personID string,
	revision uint64,
	nodeIDs []uint64,
	name string,
) (client.MediaPersonSplit, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaPersonSplit{}, err
	}
	return cli.SplitMediaPersonIdentity(ctx, personID, revision, nodeIDs, name)
}

func (c *agentController) CloudCreateMediaAlbum(
	ctx context.Context,
	name string,
) (client.MediaAlbum, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaAlbum{}, err
	}
	return cli.CreateMediaAlbum(ctx, name)
}

func (c *agentController) CloudRenameMediaAlbum(
	ctx context.Context,
	albumID string,
	revision uint64,
	name string,
) (client.MediaAlbum, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaAlbum{}, err
	}
	return cli.RenameMediaAlbum(ctx, albumID, revision, name)
}

func (c *agentController) CloudDeleteMediaAlbum(
	ctx context.Context,
	albumID string,
	revision uint64,
) error {
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	return cli.DeleteMediaAlbum(ctx, albumID, revision)
}

func (c *agentController) CloudAddMediaAlbumItems(
	ctx context.Context,
	albumID string,
	revision uint64,
	nodeIDs []uint64,
) (client.MediaAlbum, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaAlbum{}, err
	}
	return cli.AddMediaAlbumItems(ctx, albumID, revision, nodeIDs)
}

func (c *agentController) CloudRemoveMediaAlbumItem(
	ctx context.Context,
	albumID string,
	revision, nodeID uint64,
) (client.MediaAlbum, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaAlbum{}, err
	}
	return cli.RemoveMediaAlbumItem(ctx, albumID, revision, nodeID)
}

func (c *agentController) CloudCreateSmartMediaAlbum(
	ctx context.Context,
	name string,
	query client.MediaSmartAlbumQuery,
) (client.MediaAlbum, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaAlbum{}, err
	}
	return cli.CreateSmartMediaAlbum(ctx, name, query)
}

func (c *agentController) CloudUpdateSmartMediaAlbum(
	ctx context.Context,
	albumID string,
	revision uint64,
	name *string,
	query *client.MediaSmartAlbumQuery,
) (client.MediaAlbum, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaAlbum{}, err
	}
	return cli.UpdateSmartMediaAlbum(ctx, albumID, revision, name, query)
}

func (c *agentController) CloudDeleteSmartMediaAlbum(
	ctx context.Context,
	albumID string,
	revision uint64,
) error {
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	return cli.DeleteSmartMediaAlbum(ctx, albumID, revision)
}

func (c *agentController) CloudMediaAlbumItems(
	ctx context.Context,
	albumID string,
	query client.MediaQuery,
	limit, offset int,
) ([]client.MediaItem, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.MediaAlbumItemsQuery(ctx, albumID, query, limit, offset)
}

func (c *agentController) CloudMediaAlbumItemsRange(
	ctx context.Context,
	albumID string,
	query client.MediaQuery,
	limit, offset int,
) (client.MediaItemRange, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaItemRange{}, err
	}
	return cli.MediaAlbumItemsRangeQuery(ctx, albumID, query, limit, offset)
}

func (c *agentController) CloudSetMediaFavorite(
	ctx context.Context,
	nodeID uint64,
	favorite bool,
) (client.MediaFavorite, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaFavorite{}, err
	}
	return cli.SetMediaFavorite(ctx, nodeID, favorite)
}

func (c *agentController) CloudSetMediaTags(
	ctx context.Context,
	nodeID uint64,
	tags []string,
) (client.MediaTags, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaTags{}, err
	}
	return cli.SetMediaTags(ctx, nodeID, tags)
}

func (c *agentController) CloudSetMediaPeople(
	ctx context.Context,
	nodeID uint64,
	people []string,
) (client.MediaPeople, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaPeople{}, err
	}
	return cli.SetMediaPeople(ctx, nodeID, people)
}

func (c *agentController) CloudSetMediaDescription(
	ctx context.Context,
	nodeID uint64,
	description string,
) (client.MediaDescription, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaDescription{}, err
	}
	return cli.SetMediaDescription(ctx, nodeID, description)
}

func (c *agentController) CloudMediaThumbnail(ctx context.Context, nodeID uint64) (agentMediaThumbnail, error) {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return agentMediaThumbnail{}, err
	}
	cache := c.thumbnailCache
	if cache == nil {
		cache = newAgentMediaThumbnailCache(agentMediaThumbnailCacheMaxEntries, agentMediaThumbnailCacheMaxBytes)
	}
	key := agentMediaThumbnailCacheKey(cfg, nodeID)
	return cache.Load(ctx, key, func(etag string) (agentMediaThumbnailFetch, error) {
		response, err := cli.MediaThumbnailConditional(ctx, nodeID, etag)
		if err != nil {
			return agentMediaThumbnailFetch{}, err
		}
		return agentMediaThumbnailFetch{
			Thumbnail: agentMediaThumbnail{
				ContentType: response.ContentType,
				Data:        response.Data,
			},
			ETag:        response.ETag,
			MaxAge:      response.MaxAge,
			NotModified: response.NotModified,
		}, nil
	})
}

func (c *agentController) CloudMediaLivePhotoMotion(ctx context.Context, nodeID uint64) (agentMediaMotion, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return agentMediaMotion{}, err
	}
	body, contentType, contentLength, err := cli.MediaLivePhotoMotion(ctx, nodeID)
	if err != nil {
		return agentMediaMotion{}, err
	}
	defer body.Close()
	if contentLength > maxAgentMediaMotionBytes {
		return agentMediaMotion{}, fmt.Errorf("Live Photo motion exceeds Desktop playback limit")
	}
	data, err := io.ReadAll(io.LimitReader(body, maxAgentMediaMotionBytes+1))
	if err != nil {
		return agentMediaMotion{}, err
	}
	if int64(len(data)) > maxAgentMediaMotionBytes {
		return agentMediaMotion{}, fmt.Errorf("Live Photo motion exceeds Desktop playback limit")
	}
	return agentMediaMotion{
		ContentType: contentType,
		DataBase64:  base64.StdEncoding.EncodeToString(data),
		Size:        int64(len(data)),
	}, nil
}

func (c *agentController) CloudSourceItems(ctx context.Context, sourceID uint64, state string, limit, offset int) ([]client.SourceItem, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.SourceItems(ctx, sourceID, state, limit, offset)
}

func (c *agentController) CloudSourceCollections(ctx context.Context, sourceID uint64, state string) ([]client.SourceCollection, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.SourceCollections(ctx, sourceID, state)
}

func (c *agentController) CloudSourceCollectionItems(ctx context.Context, sourceID, collectionID uint64, limit, offset int) ([]client.SourceCollectionItem, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.SourceCollectionItems(ctx, sourceID, collectionID, limit, offset)
}

func (c *agentController) CloudSourceCredentialStatus(ctx context.Context, sourceID uint64) (client.SourceCredentialStatus, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.SourceCredentialStatus{}, err
	}
	return cli.SourceCredentialStatus(ctx, sourceID)
}

func (c *agentController) CloudRevealSourceCredential(ctx context.Context, sourceID uint64) (client.SourceCredentialReveal, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.SourceCredentialReveal{}, err
	}
	return cli.RevealSourceCredential(ctx, sourceID)
}

func (c *agentController) CloudTestSourceCredential(ctx context.Context, kind string, payload map[string]string) (client.SourceCredentialTestResult, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.SourceCredentialTestResult{}, err
	}
	return cli.TestSourceCredential(ctx, kind, payload)
}

func (c *agentController) CloudTestStoredSourceCredential(ctx context.Context, sourceID uint64) (client.SourceCredentialTestResult, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.SourceCredentialTestResult{}, err
	}
	return cli.TestStoredSourceCredential(ctx, sourceID)
}

func (c *agentController) CloudPutSourceCredential(ctx context.Context, sourceID uint64, payload map[string]string) (client.SourceCredentialStatus, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.SourceCredentialStatus{}, err
	}
	return cli.PutSourceCredential(ctx, sourceID, payload)
}

func (c *agentController) CloudDeleteSourceCredential(ctx context.Context, sourceID uint64) error {
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	return cli.DeleteSourceCredential(ctx, sourceID)
}

func (c *agentController) CloudSourceConnectorConfig(ctx context.Context, sourceID uint64) (client.SourceConnectorConfig, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.SourceConnectorConfig{}, err
	}
	return cli.SourceConnectorConfig(ctx, sourceID)
}

func (c *agentController) CloudBrowseSourceDirectories(
	ctx context.Context,
	sourceID uint64,
	remotePath string,
	limit, offset int,
) (client.SourceBrowsePage, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.SourceBrowsePage{}, err
	}
	return cli.BrowseSourceDirectories(ctx, sourceID, remotePath, limit, offset)
}

func (c *agentController) CloudPutSourceConnectorConfig(ctx context.Context, sourceID, revision uint64, payload map[string]any) (client.SourceConnectorConfig, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.SourceConnectorConfig{}, err
	}
	return cli.PutSourceConnectorConfig(ctx, sourceID, revision, payload)
}

func (c *agentController) CloudCreateSource(ctx context.Context, input client.CreateSourceInput) (client.Source, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.Source{}, err
	}
	return cli.CreateSource(ctx, input)
}

func (c *agentController) CloudUpdateSource(ctx context.Context, sourceID, revision uint64, input client.UpdateSourceInput) (client.Source, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.Source{}, err
	}
	return cli.UpdateSource(ctx, sourceID, revision, input)
}

func (c *agentController) CloudDeleteSource(ctx context.Context, sourceID, revision uint64) error {
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	return cli.DeleteSource(ctx, sourceID, revision)
}

func (c *agentController) CloudTriggerSource(ctx context.Context, sourceID uint64) (client.Source, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.Source{}, err
	}
	return cli.TriggerSource(ctx, sourceID)
}
