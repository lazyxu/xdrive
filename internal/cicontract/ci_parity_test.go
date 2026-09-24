package cicontract

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

var ciReservedGitLabKeys = map[string]struct{}{
	"default":   {},
	"include":   {},
	"stages":    {},
	"variables": {},
	"workflow":  {},
}

func TestGitHubAndGitLabCIStayInParity(t *testing.T) {
	root := repositoryRoot(t)
	githubRaw := readFile(t, filepath.Join(root, ".github", "workflows", "ci.yml"))
	gitlabRaw := readFile(t, filepath.Join(root, ".gitlab-ci.yml"))

	var github, gitlab map[string]any
	if err := yaml.Unmarshal([]byte(githubRaw), &github); err != nil {
		t.Fatalf("parse GitHub CI: %v", err)
	}
	if err := yaml.Unmarshal([]byte(gitlabRaw), &gitlab); err != nil {
		t.Fatalf("parse GitLab CI: %v", err)
	}

	githubJobs := nestedMapKeys(t, github, "jobs")
	gitlabJobs := gitlabJobKeys(gitlab)
	if !reflect.DeepEqual(githubJobs, gitlabJobs) {
		t.Fatalf("CI job drift: GitHub=%v GitLab=%v", githubJobs, gitlabJobs)
	}

	expectedPlatforms := map[string]string{
		"single-commit":   "linux",
		"desktop-linux":   "linux",
		"desktop-windows": "windows",
		"go-linux":        "linux",
		"go-windows":      "windows",
		"web":             "linux",
	}
	assertRunnerParity(t, github, gitlab, expectedPlatforms)

	githubText := collectYAMLStrings(github)
	gitlabText := collectYAMLStrings(gitlab)
	for _, command := range []string{
		"npm install --no-audit --no-fund",
		"npm run test:main",
		"node scripts/set-version.mjs 0.0.0-ci",
		"npm run dist:linux",
		"npm run dist:win",
		"go mod tidy",
		"git diff --exit-code -- go.mod go.sum",
		"go test -p 1 -race ./...",
		"go vet ./...",
		"go build ./cmd/server ./cmd/xd ./cmd/xdrive-agent ./cmd/xdrive-updater",
		"bash scripts/build-linux-deb.sh 0.0.0+ci dist desktop/release/xdrive-desktop-linux-amd64.deb",
		"bash scripts/test-server-doctor.sh",
		"bash scripts/test-server-installer-bootstrap.sh",
		"bash scripts/test-server-installer-transaction.sh",
		"bash scripts/test-server-installer-pipe.sh",
		"bash scripts/test-xdrive-server-host.sh",
		"bash scripts/test-cleanup-merged-branches.sh",
		"bash scripts/test-update-channels.sh",
		"docker build -t xdrive/server:test .",
		"bash scripts/test-server-chunk-storage.sh",
		"docker build -f deploy/Caddy.Dockerfile -t xdrive/caddy:test .",
		"bash scripts/test-server-backup-restore.sh",
		"go test ./internal/... ./cmd/xdrive-agent",
		"go test -tags=xdrive_e2e ./internal/mount -run TestWindowsCfAPIE2E -v -count=1",
		"go build -o xd.exe ./cmd/xd",
		"go build -ldflags=\"-H=windowsgui\" -o xdrive-agent.exe ./cmd/xdrive-agent",
		"choco install innosetup --no-progress -y",
		"./scripts/build-windows-installer.ps1 -Version 0.0.0-ci -OutputDir dist -DesktopSourceDir desktop/release/win-unpacked -TimestampUrl \"\" -SkipSignatureTrustCheck",
		"npm ci --no-audit --no-fund",
		"npm run lint",
		"npm run build",
		"docker build -f Dockerfile -t xdrive/web:test ..",
	} {
		if !strings.Contains(githubText, command) {
			t.Errorf("GitHub CI is missing parity command %q", command)
		}
		if !strings.Contains(gitlabText, command) {
			t.Errorf("GitLab CI is missing parity command %q", command)
		}
	}

	for _, token := range []string{"postgres:17-alpine", "1.25", "22"} {
		if !strings.Contains(githubRaw, token) {
			t.Errorf("GitHub CI is missing toolchain token %q", token)
		}
		if !strings.Contains(gitlabRaw, token) {
			t.Errorf("GitLab CI is missing toolchain token %q", token)
		}
	}

	requireRaw(t, "GitHub CI", githubRaw,
		"pull_request:",
		"push:",
		"branches: [\"master\"]",
		"workflow_dispatch:",
		"cancel-in-progress: true",
	)
	requireRaw(t, "GitLab CI", gitlabRaw,
		"$CI_PIPELINE_SOURCE == \"merge_request_event\"",
		"$CI_MERGE_REQUEST_TARGET_BRANCH_NAME == \"master\"",
		"$CI_PIPELINE_SOURCE == \"push\" && $CI_COMMIT_BRANCH == \"master\"",
		"$CI_PIPELINE_SOURCE == \"web\"",
		"on_new_commit: interruptible",
		"interruptible: true",
	)
}

func repositoryRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve CI contract test path")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(data)
}

func nestedMapKeys(t *testing.T, root map[string]any, key string) []string {
	t.Helper()
	value, ok := root[key]
	if !ok {
		t.Fatalf("missing YAML key %q", key)
	}
	m, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("YAML key %q has type %T, want map", key, value)
	}
	keys := make([]string, 0, len(m))
	for name := range m {
		keys = append(keys, name)
	}
	sort.Strings(keys)
	return keys
}

func gitlabJobKeys(root map[string]any) []string {
	var keys []string
	for name, value := range root {
		if _, reserved := ciReservedGitLabKeys[name]; reserved || strings.HasPrefix(name, ".") {
			continue
		}
		if _, ok := value.(map[string]any); !ok {
			continue
		}
		keys = append(keys, name)
	}
	sort.Strings(keys)
	return keys
}

func assertRunnerParity(t *testing.T, github, gitlab map[string]any, expected map[string]string) {
	t.Helper()
	githubJobs, ok := github["jobs"].(map[string]any)
	if !ok {
		t.Fatalf("GitHub jobs has type %T, want map", github["jobs"])
	}
	for jobName, platform := range expected {
		githubJob, ok := githubJobs[jobName].(map[string]any)
		if !ok {
			t.Fatalf("GitHub job %q missing or invalid", jobName)
		}
		runsOn, _ := githubJob["runs-on"].(string)
		githubRunner := map[string]string{
			"linux":   "ubuntu-latest",
			"windows": "windows-latest",
		}[platform]
		if githubRunner == "" {
			t.Fatalf("unsupported CI platform %q for job %s", platform, jobName)
		}
		if runsOn != githubRunner {
			t.Errorf("GitHub job %s runs-on=%q want=%q", jobName, runsOn, githubRunner)
		}

		gitlabJob, ok := gitlab[jobName].(map[string]any)
		if !ok {
			t.Fatalf("GitLab job %q missing or invalid", jobName)
		}
		tagValues, ok := gitlabJob["tags"].([]any)
		if !ok || len(tagValues) != 1 {
			t.Fatalf("GitLab job %s tags=%v, want one platform tag", jobName, gitlabJob["tags"])
		}
		wantTag := platform
		if got := fmt.Sprint(tagValues[0]); got != wantTag {
			t.Errorf("GitLab job %s tag=%q want=%q", jobName, got, wantTag)
		}
	}
}

func collectYAMLStrings(value any) string {
	var out strings.Builder
	var walk func(any)
	walk = func(current any) {
		switch v := current.(type) {
		case string:
			out.WriteString(v)
			out.WriteByte('\n')
		case []any:
			for _, item := range v {
				walk(item)
			}
		case map[string]any:
			for key, item := range v {
				out.WriteString(key)
				out.WriteByte('\n')
				walk(item)
			}
		default:
			if v != nil {
				out.WriteString(fmt.Sprint(v))
				out.WriteByte('\n')
			}
		}
	}
	walk(value)
	return out.String()
}

func requireRaw(t *testing.T, label, content string, needles ...string) {
	t.Helper()
	for _, needle := range needles {
		if !strings.Contains(content, needle) {
			t.Errorf("%s is missing %q", label, needle)
		}
	}
}
