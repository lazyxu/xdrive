package cicontract

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// GitLab's shared Docker daemon has failed image-config size validation while
// resolving docker.io/docker/dockerfile:1. These Dockerfiles use only standard
// Dockerfile instructions, so an external syntax frontend is unnecessary.
// Guard all source-built release images against reintroducing that dependency.
func TestGitLabPackageDockerfilesUseBundledFrontend(t *testing.T) {
	root := repositoryRoot(t)
	for _, name := range []string{
		"Dockerfile",
		"deploy/MediaWorker.Dockerfile",
		"deploy/Caddy.Dockerfile",
	} {
		t.Run(name, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(root, name))
			if err != nil {
				t.Fatal(err)
			}
			for lineNo, line := range strings.Split(string(data), "\n") {
				directive := strings.ToLower(strings.TrimSpace(line))
				if strings.HasPrefix(directive, "# syntax=") || strings.HasPrefix(directive, "# syntax =") {
					t.Fatalf("%s:%d: external Dockerfile syntax frontend is not needed by GitLab release builds", name, lineNo+1)
				}
			}
		})
	}
}
