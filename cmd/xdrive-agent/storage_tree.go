package main

import (
	"path"
	"sort"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

type agentStorageTreeNode struct {
	Path          string                 `json:"path"`
	Name          string                 `json:"name"`
	Mode          string                 `json:"mode"`
	EffectiveMode string                 `json:"effective_mode"`
	FileCount     int                    `json:"file_count"`
	TotalBytes    int64                  `json:"total_bytes"`
	Children      []agentStorageTreeNode `json:"children,omitempty"`
}

func buildStorageTree(remote map[string]client.Node, rules []userconfig.SyncRule) agentStorageTreeNode {
	root := agentStorageTreeNode{
		Path:          "",
		Name:          "xDrive",
		Mode:          "default",
		EffectiveMode: "default",
	}
	nodes := map[string]*agentStorageTreeNode{"": &root}
	children := map[string][]string{}

	for rel, remoteNode := range remote {
		if rel == "" || remoteNode.Type != "dir" {
			continue
		}
		nodes[rel] = &agentStorageTreeNode{
			Path:          rel,
			Name:          path.Base(rel),
			Mode:          explicitStorageMode(rel, rules),
			EffectiveMode: effectiveStorageMode(rel, rules),
		}
		parent := path.Dir(rel)
		if parent == "." {
			parent = ""
		}
		children[parent] = append(children[parent], rel)
	}
	for parent := range children {
		sort.Slice(children[parent], func(i, j int) bool {
			return strings.ToLower(path.Base(children[parent][i])) < strings.ToLower(path.Base(children[parent][j]))
		})
	}

	for rel, remoteNode := range remote {
		if rel == "" || remoteNode.Type != "file" {
			continue
		}
		parent := path.Dir(rel)
		if parent == "." {
			parent = ""
		}
		for {
			if target := nodes[parent]; target != nil {
				target.FileCount++
				target.TotalBytes += remoteNode.Size
			}
			if parent == "" {
				break
			}
			parent = path.Dir(parent)
			if parent == "." {
				parent = ""
			}
		}
	}

	var clone func(string) agentStorageTreeNode
	clone = func(rel string) agentStorageTreeNode {
		out := *nodes[rel]
		out.Children = nil
		for _, childPath := range children[rel] {
			out.Children = append(out.Children, clone(childPath))
		}
		return out
	}
	return clone("")
}

func explicitStorageMode(rel string, rules []userconfig.SyncRule) string {
	for _, rule := range rules {
		if strings.EqualFold(strings.Trim(rule.Path, "/"), strings.Trim(rel, "/")) {
			return storageMode(rule.Mode)
		}
	}
	return "default"
}

func effectiveStorageMode(rel string, rules []userconfig.SyncRule) string {
	rel = strings.Trim(rel, "/")
	bestDepth := -1
	mode := "default"
	for _, rule := range rules {
		rulePath := strings.Trim(rule.Path, "/")
		if rulePath == "" {
			continue
		}
		lowerRule, lowerRel := strings.ToLower(rulePath), strings.ToLower(rel)
		if lowerRel != lowerRule && !strings.HasPrefix(lowerRel, lowerRule+"/") {
			continue
		}
		depth := strings.Count(rulePath, "/")
		if depth > bestDepth {
			bestDepth = depth
			mode = storageMode(rule.Mode)
		}
	}
	return mode
}

func storageMode(mode string) string {
	switch strings.TrimSpace(mode) {
	case userconfig.SyncModeExclude:
		return "exclude"
	case userconfig.SyncModeAlwaysLocal:
		return "always-local"
	default:
		return "default"
	}
}
