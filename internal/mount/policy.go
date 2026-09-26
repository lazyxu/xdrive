package mount

import (
	"strings"

	"github.com/lazyxu/xdrive/internal/transfer"
)

type Options struct {
	ExcludedPaths    []string
	AlwaysLocalPaths []string
	CacheLimitBytes  int64
	StatePath        string
	Transfers        *transfer.Manager
}

type syncPolicy struct {
	excluded    []string
	alwaysLocal []string
}

func newSyncPolicy(opts Options) syncPolicy {
	return syncPolicy{
		excluded:    normalizePolicyPaths(opts.ExcludedPaths),
		alwaysLocal: normalizePolicyPaths(opts.AlwaysLocalPaths),
	}
}

func normalizePolicyPaths(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		value = strings.Trim(strings.ReplaceAll(strings.TrimSpace(value), "\\", "/"), "/")
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, value)
	}
	return out
}

func (p syncPolicy) mode(rel string) string {
	rel = strings.Trim(strings.ReplaceAll(rel, "\\", "/"), "/")
	bestDepth := -1
	bestMode := ""
	for _, path := range p.alwaysLocal {
		if policyContains(path, rel) {
			if depth := policyDepth(path); depth > bestDepth {
				bestDepth = depth
				bestMode = "always-local"
			}
		}
	}
	for _, path := range p.excluded {
		if policyContains(path, rel) {
			if depth := policyDepth(path); depth >= bestDepth {
				bestDepth = depth
				bestMode = "exclude"
			}
		}
	}
	return bestMode
}

func (p syncPolicy) excludedPath(rel string) bool {
	return p.mode(rel) == "exclude"
}

func (p syncPolicy) alwaysLocalPath(rel string) bool {
	return p.mode(rel) == "always-local"
}

func policyContains(parent, child string) bool {
	parent = strings.ToLower(strings.Trim(parent, "/"))
	child = strings.ToLower(strings.Trim(child, "/"))
	return child == parent || strings.HasPrefix(child, parent+"/")
}

func policyDepth(path string) int {
	path = strings.Trim(path, "/")
	if path == "" {
		return 0
	}
	return strings.Count(path, "/") + 1
}
