package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/mount"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

const cloudSearchLimit = 200

type agentCloudCrumb struct {
	ID   uint64 `json:"id"`
	Name string `json:"name"`
}

type agentCloudSearchResult struct {
	Node   client.Node       `json:"node"`
	Path   string            `json:"path"`
	Crumbs []agentCloudCrumb `json:"crumbs"`
}

type agentCreatedShare struct {
	Share client.CreatedFileShare `json:"share"`
	URL   string                  `json:"url"`
}

type agentMediaThumbnail struct {
	ContentType string `json:"content_type"`
	DataBase64  string `json:"data_base64"`
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
	node, err := cli.UploadFile(ctx, parentID, localPath, name)
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
	if err := cli.DownloadTo(ctx, id, tmp); err != nil {
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

func (c *agentController) CloudSearch(ctx context.Context, query string) ([]agentCloudSearchResult, error) {
	query = strings.TrimSpace(query)
	if len([]rune(query)) < 2 {
		return nil, fmt.Errorf("search query must contain at least 2 characters")
	}
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	page, err := cli.Search(ctx, client.SearchOptions{Query: query, Limit: cloudSearchLimit})
	if err != nil {
		return nil, err
	}

	out := make([]agentCloudSearchResult, 0, len(page.Items))
	for _, item := range page.Items {
		out = append(out, agentCloudSearchResult{
			Node: item.Node, Path: item.Path, Crumbs: agentCloudCrumbs(item.Breadcrumbs),
		})
	}
	return out, nil
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
