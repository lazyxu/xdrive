package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/mount"
	"github.com/lazyxu/xdrive/internal/transfer"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

const cloudSearchLimit = 200
const maxAgentMediaMotionBytes int64 = 64 << 20

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

type agentCreatedShare struct {
	Share client.CreatedFileShare `json:"share"`
	URL   string                  `json:"url"`
}

type agentMediaThumbnail struct {
	ContentType string `json:"content_type"`
	DataBase64  string `json:"data_base64"`
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

func (c *agentController) CloudSearch(ctx context.Context, query, cursor string) (agentCloudSearchPage, error) {
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

func (c *agentController) CloudStartServerUpdate(ctx context.Context, source, channel string) (client.ServerUpdateState, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.ServerUpdateState{}, err
	}
	return cli.StartServerUpdate(ctx, source, channel)
}

func (c *agentController) CloudStorageStats(ctx context.Context) (client.StorageStats, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.StorageStats{}, err
	}
	return cli.StorageStats(ctx)
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

func (c *agentController) CloudMediaItems(ctx context.Context, kind string, limit, offset int) ([]client.MediaItem, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.MediaItems(ctx, kind, limit, offset)
}

func (c *agentController) CloudMediaAlbums(ctx context.Context) ([]client.MediaAlbum, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.MediaAlbums(ctx)
}

func (c *agentController) CloudMediaAlbumItems(ctx context.Context, albumID string, limit, offset int) ([]client.MediaItem, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.MediaAlbumItems(ctx, albumID, limit, offset)
}

func (c *agentController) CloudMediaThumbnail(ctx context.Context, nodeID uint64) (agentMediaThumbnail, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return agentMediaThumbnail{}, err
	}
	data, contentType, err := cli.MediaThumbnail(ctx, nodeID)
	if err != nil {
		return agentMediaThumbnail{}, err
	}
	return agentMediaThumbnail{
		ContentType: contentType,
		DataBase64:  base64.StdEncoding.EncodeToString(data),
	}, nil
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

func (c *agentController) CloudMediaVideo(
	ctx context.Context,
	nodeID uint64,
	rangeHeader string,
) (client.MediaVideoStream, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaVideoStream{}, err
	}
	return cli.MediaPlayback(ctx, nodeID, rangeHeader)
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
