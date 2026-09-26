package main

import (
	"context"
	"fmt"
	"net/url"
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

func (c *agentController) CloudSourceRuns(ctx context.Context, sourceID uint64, limit int) ([]client.SyncRun, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.SourceRuns(ctx, sourceID, limit)
}

func (c *agentController) CloudSourceCredentialStatus(ctx context.Context, sourceID uint64) (client.SourceCredentialStatus, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.SourceCredentialStatus{}, err
	}
	return cli.SourceCredentialStatus(ctx, sourceID)
}
