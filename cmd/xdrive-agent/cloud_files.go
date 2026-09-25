package main

import (
	"context"
	"fmt"
	"net/url"
	"path"
	"sort"
	"strings"
	"time"

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
	walkCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	remote, err := cli.Walk(walkCtx)
	if err != nil {
		return nil, err
	}

	lowerQuery := strings.ToLower(query)
	paths := make([]string, 0)
	for rel := range remote {
		if rel == "" {
			continue
		}
		if strings.Contains(strings.ToLower(rel), lowerQuery) {
			paths = append(paths, rel)
		}
	}
	sort.Slice(paths, func(i, j int) bool {
		ni, nj := remote[paths[i]], remote[paths[j]]
		if ni.Type != nj.Type {
			return ni.Type == "dir"
		}
		return strings.ToLower(paths[i]) < strings.ToLower(paths[j])
	})
	if len(paths) > cloudSearchLimit {
		paths = paths[:cloudSearchLimit]
	}

	root := remote[""]
	out := make([]agentCloudSearchResult, 0, len(paths))
	for _, rel := range paths {
		node := remote[rel]
		crumbs := []agentCloudCrumb{{ID: root.ID, Name: "My files"}}
		if node.Type == "dir" {
			crumbs = appendCloudCrumbs(crumbs, remote, rel)
		} else {
			parent := path.Dir(rel)
			if parent != "." && parent != "" {
				crumbs = appendCloudCrumbs(crumbs, remote, parent)
			}
		}
		out = append(out, agentCloudSearchResult{Node: node, Path: rel, Crumbs: crumbs})
	}
	return out, nil
}

func appendCloudCrumbs(out []agentCloudCrumb, remote map[string]client.Node, rel string) []agentCloudCrumb {
	parts := strings.Split(strings.Trim(rel, "/"), "/")
	current := ""
	for _, part := range parts {
		if part == "" {
			continue
		}
		if current == "" {
			current = part
		} else {
			current += "/" + part
		}
		if node, ok := remote[current]; ok && node.Type == "dir" {
			out = append(out, agentCloudCrumb{ID: node.ID, Name: node.Name})
		}
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
