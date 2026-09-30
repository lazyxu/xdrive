package synology

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

const MaxFilePullRoots = 32
const MaxFilePullRootBytes = 4096

type FilePullConfig struct {
	Roots []string `json:"roots"`
}

func DefaultFilePullConfig() FilePullConfig {
	return FilePullConfig{Roots: []string{}}
}

func NormalizeFilePullConfig(input FilePullConfig) (FilePullConfig, error) {
	if len(input.Roots) == 0 {
		return FilePullConfig{}, fmt.Errorf("at least one Synology File Station root is required")
	}
	if len(input.Roots) > MaxFilePullRoots {
		return FilePullConfig{}, fmt.Errorf("at most %d Synology File Station roots are allowed", MaxFilePullRoots)
	}
	roots := make([]string, 0, len(input.Roots))
	seen := make(map[string]struct{}, len(input.Roots))
	for _, raw := range input.Roots {
		root, err := NormalizeFileStationPath(raw)
		if err != nil {
			return FilePullConfig{}, err
		}
		if root == "/" {
			return FilePullConfig{}, fmt.Errorf("File Station root must start with a shared folder")
		}
		if len([]byte(root)) > MaxFilePullRootBytes {
			return FilePullConfig{}, fmt.Errorf("File Station root exceeds %d bytes", MaxFilePullRootBytes)
		}
		if _, exists := seen[root]; exists {
			continue
		}
		seen[root] = struct{}{}
		roots = append(roots, root)
	}
	sort.Strings(roots)
	for i := 0; i < len(roots); i++ {
		for j := i + 1; j < len(roots); j++ {
			if fileStationPathContains(roots[i], roots[j]) || fileStationPathContains(roots[j], roots[i]) {
				return FilePullConfig{}, fmt.Errorf("File Station roots overlap: %q and %q", roots[i], roots[j])
			}
		}
	}
	return FilePullConfig{Roots: roots}, nil
}

func ParseFilePullConfig(payload []byte) (FilePullConfig, error) {
	var input FilePullConfig
	if err := json.Unmarshal(payload, &input); err != nil {
		return FilePullConfig{}, err
	}
	return NormalizeFilePullConfig(input)
}

func fileStationPathContains(parent, child string) bool {
	parent = strings.TrimSuffix(parent, "/")
	child = strings.TrimSuffix(child, "/")
	return parent != child && strings.HasPrefix(child, parent+"/")
}
