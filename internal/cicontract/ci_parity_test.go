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
	var githubCoreJobs []string
	for _, name := range githubJobs {
		if name != "publish" {
			githubCoreJobs = append(githubCoreJobs, name)
		}
	}
	if !reflect.DeepEqual(githubCoreJobs, gitlabJobs) {
		t.Fatalf("CI core job drift: GitHub=%v GitLab=%v", githubCoreJobs, gitlabJobs)
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
	assertGitLabJobImages(t, gitlab, map[string]string{
		"single-commit":   "$XDRIVE_CI_GO_IMAGE",
		"desktop-linux":   "$XDRIVE_CI_NODE_IMAGE",
		"desktop-windows": "",
		"go-linux":        "$XDRIVE_CI_GO_IMAGE",
		"go-windows":      "",
		"web":             "$XDRIVE_CI_NODE_IMAGE",
	})
	assertGitLabCache(t, gitlab, "go-windows",
		"xdrive-go-windows-v2-$CI_RUNNER_EXECUTABLE_ARCH",
		[]string{".cache/go-mod/cache/download/", ".cache/npm/"},
	)

	imageConfigRaw := readFile(t, filepath.Join(root, "infra", "ci", "images.yml"))
	var imageConfig map[string]any
	if err := yaml.Unmarshal([]byte(imageConfigRaw), &imageConfig); err != nil {
		t.Fatalf("parse GitLab CI image config: %v", err)
	}
	requireRaw(t, "GitLab CI image config", imageConfigRaw,
		"XDRIVE_CI_GO_IMAGE: \"golang:1.25-bookworm\"",
		"XDRIVE_CI_NODE_IMAGE: \"node:22-bookworm\"",
		"XDRIVE_CI_NODE_VERSION: \"22.23.3\"",
		"XDRIVE_CI_DOCKER_VERSION: \"27.5.1\"",
		"XDRIVE_CI_COMPOSE_VERSION: \"v2.32.4\"",
		"GOPROXY: \"https://goproxy.cn|https://mirrors.aliyun.com/goproxy/|https://proxy.golang.org|direct\"",
		"GOSUMDB: \"sum.golang.google.cn\"",
		"NPM_CONFIG_REGISTRY: \"https://registry.npmmirror.com\"",
		"XDRIVE_CI_NODE_MIRROR: \"https://mirrors.huaweicloud.com/nodejs\"",
		"XDRIVE_CI_DOCKER_MIRROR: \"https://mirrors.aliyun.com/docker-ce\"",
		"XDRIVE_CI_GITHUB_RELEASE_PROXY: \"\"",
		"XDRIVE_CI_DOWNLOAD_ATTEMPTS: \"5\"",
		"ELECTRON_MIRROR: \"https://cdn.npmmirror.com/binaries/electron/\"",
		"ELECTRON_BUILDER_BINARIES_MIRROR: \"https://cdn.npmmirror.com/binaries/electron-builder-binaries/\"",
	)

	desktopPackageRaw := readFile(t, filepath.Join(root, "desktop", "package.json"))
	requireRaw(t, "desktop package scripts", desktopPackageRaw,
		"electron-builder --win --x64 --dir --publish never",
		"electron-builder --linux --x64 --dir --publish never",
	)
	if strings.Contains(desktopPackageRaw, "dist:win") || strings.Contains(desktopPackageRaw, "dist:linux") {
		t.Errorf("desktop package scripts must build unpacked runtimes only; standalone installer scripts returned")
	}

	githubText := collectYAMLStrings(github)
	gitlabText := collectYAMLStrings(gitlab)
	downloadHelper := readFile(t, filepath.Join(root, "scripts", "ci", "download-with-fallback.sh"))
	nodeInstaller := readFile(t, filepath.Join(root, "scripts", "ci", "install-node22.sh"))
	dockerInstaller := readFile(t, filepath.Join(root, "scripts", "ci", "install-docker-cli.sh"))
	goVersionCheck := readFile(t, filepath.Join(root, "scripts", "ci", "check-go-min-version.sh"))
	artifactVersion := readFile(t, filepath.Join(root, "scripts", "ci", "client-artifact-version.sh"))
	goCachePrep := readFile(t, filepath.Join(root, "scripts", "ci", "prepare-go-mod-cache.sh"))
	gitlabGoWindows := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-go-windows.sh"))
	gitlabWindowsBash := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-desktop-windows.sh")) + "\n" +
		gitlabGoWindows
	gitlabWindowsNative := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-windows-native.ps1"))
	windowsUninstallerResolver := readFile(t, filepath.Join(root, "scripts", "ci", "resolve-windows-uninstaller.ps1"))
	windowsUninstallerTest := readFile(t, filepath.Join(root, "scripts", "ci", "test-windows-uninstaller-resolver.ps1"))
	windowsUpgradeTest := readFile(t, filepath.Join(root, "scripts", "test-windows-client-upgrade.ps1"))
	gitlabContractText := gitlabText + "\n" + downloadHelper + "\n" + nodeInstaller + "\n" + dockerInstaller + "\n" + goVersionCheck + "\n" + artifactVersion + "\n" + gitlabWindowsBash + "\n" + gitlabWindowsNative
	for _, command := range []string{
		"npm install --no-audit --no-fund",
		"npm run test:main",
		"source scripts/ci/client-artifact-version.sh",
		"npm run runtime:linux",
		"npm run runtime:win",
		"go mod tidy \"-go=1.25\"",
		"git diff --exit-code -- go.mod go.sum",
		"go test -p 1 -race ./...",
		"go vet ./...",
		"go build ./cmd/server ./cmd/xd ./cmd/xdrive-agent ./cmd/xdrive-updater",
		"bash scripts/build-linux-deb.sh \"$XDRIVE_RELEASE_VERSION\" release desktop/release/linux-unpacked",
		"bash scripts/test-server-doctor.sh",
		"bash scripts/test-server-installer-bootstrap.sh",
		"bash scripts/test-server-installer-transaction.sh",
		"bash scripts/test-server-installer-pipe.sh",
		"bash scripts/test-xdrive-server-host.sh",
		"bash scripts/test-cleanup-merged-branches.sh",
		"bash scripts/test-update-channels.sh",
		"bash scripts/ci/test-download-with-fallback.sh",
		"bash scripts/ci/test-prepare-go-mod-cache.sh",
		"bash scripts/ci/test-client-artifact-version.sh",
		"docker build -t xdrive/server:test .",
		"bash scripts/test-server-chunk-storage.sh",
		"docker build -f deploy/Caddy.Dockerfile -t xdrive/caddy:test .",
		"bash scripts/test-server-backup-restore.sh",
		"go test -mod=readonly ./internal/... ./cmd/xdrive-agent",
		"go test -mod=readonly -tags=xdrive_e2e ./internal/mount -run TestWindowsCfAPIE2E -v -count=1",
		"release/xDriveSetup-amd64.exe",
		"XDRIVE_RELEASE_VERSION",
		"[scriptblock]::Create((Get-Content -Raw ./internal/update/windows_upgrade_transaction.ps1))",
		"[scriptblock]::Create((Get-Content -Raw ./internal/update/windows_legacy_cleanup.ps1))",
		"npm ci --no-audit --no-fund",
		"npm run lint",
		"npm run build",
		"docker build -f Dockerfile -t xdrive/web:test ..",
	} {
		if !strings.Contains(githubText, command) {
			t.Errorf("GitHub CI is missing parity command %q", command)
		}
		if !strings.Contains(gitlabContractText, command) {
			t.Errorf("GitLab CI contract is missing parity command %q", command)
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
		"tags: [\"v*\"]",
		"workflow_dispatch:",
		"cancel-in-progress: true",
		"name: desktop-runtime-linux-amd64",
		"name: desktop-runtime-windows-amd64",
		"name: xdrive-linux-amd64",
		"name: xdrive-windows-amd64",
		"uses: ./.github/workflows/release.yml",
		"secrets: inherit",
	)
	requireRaw(t, "GitLab CI", gitlabRaw,
		"- local: /infra/ci/images.yml",
		"- local: /infra/ci/gitlab-release.yml",
		"- gate",
		"- build",
		"- package",
		"- promote",
		"- release",
		"$CI_PIPELINE_SOURCE == \"push\" && $CI_COMMIT_TAG =~ /^v.+/",
		"bash scripts/ci/check-go-min-version.sh 1.25",
		".electron-linux-cache:",
		"XDG_CACHE_HOME: \"$CI_PROJECT_DIR/.cache\"",
		"ELECTRON_BUILDER_CACHE: \"$CI_PROJECT_DIR/.cache/electron-builder\"",
		"extends: .electron-linux-cache",
		"bash scripts/ci/gitlab-desktop-windows.sh",
		"bash scripts/ci/gitlab-go-windows.sh",
		"desktop-runtime-linux-amd64.tar.gz",
		"desktop/release/win-unpacked/",
		"release/xdrive-linux-amd64.deb",
		"release/xDriveSetup-amd64.exe",
		"xdrive-go-windows-v2-$CI_RUNNER_EXECUTABLE_ARCH",
		".cache/go-mod/cache/download/",
		"$CI_PIPELINE_SOURCE == \"merge_request_event\"",
		"$CI_MERGE_REQUEST_TARGET_BRANCH_NAME == \"master\"",
		"$CI_PIPELINE_SOURCE == \"push\" && $CI_COMMIT_BRANCH == \"master\"",
		"$CI_PIPELINE_SOURCE == \"web\"",
		"on_new_commit: interruptible",
		"interruptible: true",
		"pre_get_sources_script:",
		"command -v powershell.exe",
		"GOFLAGS= go clean -modcache",
		"Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop",
		"GOMODCACHE: \"$CI_PROJECT_DIR/.cache/go-mod\"",
		"NPM_CONFIG_CACHE: \"$CI_PROJECT_DIR/.cache/npm\"",
		"bash scripts/ci/install-node22.sh",
		"bash scripts/ci/install-docker-cli.sh",
		"postgresql-client",
		"alias: postgres",
		"XD_TEST_DATABASE_URL: \"postgres://xdrive:xdrive@postgres:5432/xdrive_test?sslmode=disable\"",
		"pg_isready",
		"-h postgres -p 5432",
		".cache/ci-tools/",
		"when: always",
		"echo \"GOPROXY=$(go env GOPROXY)\"",
		"echo \"GOSUMDB=$(go env GOSUMDB)\"",
	)

	if strings.Contains(gitlabRaw, "$ErrorActionPreference") ||
		strings.Contains(gitlabRaw, "Set-Location desktop") ||
		strings.Contains(gitlabRaw, "$LASTEXITCODE") {
		t.Errorf("GitLab Windows jobs must be Bash-compatible; raw PowerShell syntax found in .gitlab-ci.yml")
	}

	if strings.Contains(gitlabRaw, "127.0.0.1::5432") ||
		strings.Contains(gitlabRaw, "docker port \"$pg_container\"") ||
		strings.Contains(gitlabRaw, "xdrive-ci-postgres-$CI_JOB_ID") {
		t.Errorf("GitLab Docker-executor PostgreSQL tests must use the GitLab service network, not host-loopback Docker port publishing")
	}
	requireRaw(t, "Go module cache preparation", goCachePrep,
		"go mod download",
		"go mod verify",
		"go clean -modcache",
		"restored Go module cache failed verification; rebuilding it",
		"Go module cache rebuilt and verified",
	)
	requireRaw(t, "GitLab Windows Go wrapper", gitlabGoWindows,
		"source scripts/ci/client-artifact-version.sh",
		"bash scripts/ci/prepare-go-mod-cache.sh",
		"go test -mod=readonly ./internal/... ./cmd/xdrive-agent",
		"go test -mod=readonly -tags=xdrive_e2e ./internal/mount -run TestWindowsCfAPIE2E -v -count=1",
		"desktop/release/win-unpacked/xdrive-desktop.exe",
		"release/xDriveSetup-amd64.exe",
	)
	if strings.Contains(gitlabGoWindows, "go mod tidy") {
		t.Errorf("GitLab Windows wrapper must not run go mod tidy under a newer self-hosted Go toolchain")
	}

	if strings.Contains(gitlabRaw, "key: \"xdrive-go-windows-$CI_RUNNER_EXECUTABLE_ARCH\"") {
		t.Errorf("GitLab Windows Go cache key must be versioned so legacy full-module archives are not restored")
	}
	requireRaw(t, "CI resumable downloader", downloadHelper,
		"--continue-at -",
		"XDRIVE_CI_DOWNLOAD_ATTEMPTS",
		"download failed from all configured sources",
	)
	requireRaw(t, "CI Node installer", nodeInstaller,
		"XDRIVE_CI_NODE_MIRROR",
		"https://nodejs.org/dist",
		"sha256sum -c",
	)
	requireRaw(t, "CI Docker installer", dockerInstaller,
		"XDRIVE_CI_DOCKER_MIRROR",
		"https://download.docker.com",
		"XDRIVE_CI_GITHUB_RELEASE_PROXY",
		"https://github.com/docker/compose/releases/download",
	)
	requireRaw(t, "Go minimum-version check", goVersionCheck,
		"Go >= $minimum is required",
		"Go version OK:",
	)
	requireRaw(t, "client artifact version resolver", artifactVersion,
		"XDRIVE_RELEASE_VERSION=\"snapshot-$short_sha\"",
		"XDRIVE_DESKTOP_VERSION=\"0.0.0-snapshot.$short_sha\"",
		"XDRIVE_RELEASE_VERSION=\"$tag\"",
		"XDRIVE_RELEASE_VERSION=\"0.0.0-ci\"",
	)
	requireRaw(t, "GitLab Windows Bash wrappers", gitlabWindowsBash,
		"set -euo pipefail",
		"source scripts/ci/client-artifact-version.sh",
		"bash scripts/ci/check-go-min-version.sh 1.25",
		"powershell.exe",
		"go test -mod=readonly -tags=xdrive_e2e ./internal/mount -run TestWindowsCfAPIE2E -v -count=1",
		"npm run runtime:win",
		"install innosetup --no-progress -y",
		"test-windows-uninstaller-resolver.ps1",
		"release/xDriveSetup-amd64.exe",
	)
	requireRaw(t, "GitLab Windows native helper", gitlabWindowsNative,
		"ValidateSet(\"ValidateScripts\", \"PrepareSigning\", \"BuildInstaller\", \"VerifySignatures\", \"SmokeInstall\")",
		"resolve-windows-uninstaller.ps1",
		"./scripts/build-windows-installer.ps1",
		"Get-AuthenticodeSignature",
		"Start-Process -FilePath $installer",
	)
	requireRaw(t, "Windows uninstaller resolver", windowsUninstallerResolver,
		"UninstallString",
		"^unins\\d+\\.exe$",
		"outside the unified app directory",
	)
	requireRaw(t, "Windows uninstaller resolver regression", windowsUninstallerTest,
		"unins001.exe",
		"resolver must reject uninstallers outside the unified app directory",
	)
	requireRaw(t, "Windows upgrade transaction test", windowsUpgradeTest,
		"resolve-windows-uninstaller.ps1",
		"transaction test uninstalling via",
	)
	for label, content := range map[string]string{
		"GitHub Windows CI":                githubRaw,
		"GitLab Windows native helper":     gitlabWindowsNative,
		"Windows upgrade transaction test": windowsUpgradeTest,
	} {
		if strings.Contains(content, "unins000.exe") {
			t.Errorf("%s must not hard-code Inno Setup uninstaller filename unins000.exe", label)
		}
	}
}

func TestGitHubAndGitLabReleaseStayInParity(t *testing.T) {
	root := repositoryRoot(t)
	githubRaw := readFile(t, filepath.Join(root, ".github", "workflows", "ci.yml"))
	gitlabRaw := readFile(t, filepath.Join(root, ".gitlab-ci.yml"))
	githubRelease := readFile(t, filepath.Join(root, ".github", "workflows", "release.yml"))
	gitlabRelease := readFile(t, filepath.Join(root, "infra", "ci", "gitlab-release.yml"))
	installerTemplate := readFile(t, filepath.Join(root, "deploy", "install-server.sh"))
	gitlabReleaseScripts := strings.Join([]string{
		readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-release-version.sh")),
		readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-package-linux.sh")),
		readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-package-windows.sh")),
		readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-package-windows-native.ps1")),
		readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-server-images.sh")),
		readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-promote-images.sh")),
		readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-publish-release.sh")),
	}, "\n")

	releaseAssets := []string{
		"xdrive-linux-amd64.deb",
		"xDriveSetup-amd64.exe",
		"xdrive-server-install.sh",
		"server-backup.sh",
		"server-backup-scheduled.sh",
		"server-restore.sh",
		"server-verify.sh",
		"server-doctor.sh",
		"xdrive-server",
		"docker-compose.yml",
		"Caddyfile",
		"xdrive.env.example",
		"SHA256SUMS.txt",
	}
	for _, asset := range releaseAssets {
		if !strings.Contains(githubRelease, asset) {
			t.Errorf("GitHub release contract is missing asset %q", asset)
		}
		if !strings.Contains(gitlabRelease+"\n"+gitlabReleaseScripts, asset) {
			t.Errorf("GitLab release contract is missing asset %q", asset)
		}
	}

	for _, imageName := range []string{"xdrive-server", "xdrive-web", "xdrive-caddy"} {
		if !strings.Contains(githubRelease, imageName) {
			t.Errorf("GitHub release contract is missing image %q", imageName)
		}
		if !strings.Contains(gitlabReleaseScripts, imageName) {
			t.Errorf("GitLab release contract is missing image %q", imageName)
		}
	}

	requireRaw(t, "server installer registry contract", installerTemplate,
		"IMAGE_REGISTRY=\"${XD_IMAGE_REGISTRY:-@IMAGE_REGISTRY@}\"",
		`[[ -z "$IMAGE_REGISTRY" || "$IMAGE_REGISTRY" == "@IMAGE_REGISTRY@" ]]`,
		`[[ -n "$IMAGE_REGISTRY" ]] || IMAGE_REGISTRY="ghcr.io/lazyxu"`,
	)

	for _, forbidden := range []string{
		"npm install --no-audit --no-fund",
		"npm run runtime:linux",
		"npm run runtime:win",
		"build-linux-deb.sh",
		"build-windows-installer.ps1",
	} {
		if strings.Contains(githubRelease, forbidden) {
			t.Errorf("GitHub publish workflow must not rebuild client artifacts: %q", forbidden)
		}
		if strings.Contains(readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-package-linux.sh"))+"\n"+
			readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-package-windows.sh")), forbidden) {
			t.Errorf("GitLab package jobs must not rebuild client artifacts: %q", forbidden)
		}
	}

	requireRaw(t, "GitHub Publish Packages", githubRelease,
		"workflow_call:",
		"name: xdrive-linux-amd64",
		"name: xdrive-windows-amd64",
		"snapshot-${GITHUB_SHA::12}",
		"target_tag=\"edge\"",
		"target_tag=\"latest\"",
		"retention-days: 14",
		"s|@IMAGE_REGISTRY@|ghcr.io/$GITHUB_REPOSITORY_OWNER|g",
		"Download exact Linux installer tested by CI",
		"Download exact Windows installer tested by CI",
		"Verify single-installer distribution contract",
	)
	requireRaw(t, "GitLab Build Packages", gitlabRelease,
		"package-linux-amd64:",
		"package-windows-amd64:",
		"package-server-images:",
		"promote-server-images:",
		"publish-release:",
		"expire_in: 14 days",
		"GLAB_ENABLE_CI_AUTOLOGIN: \"true\"",
		"image: $XDRIVE_CI_GLAB_IMAGE",
	)

	requireRaw(t, "GitLab release scripts", gitlabReleaseScripts,
		"snapshot-$short_sha",
		"0.0.0-snapshot.$short_sha",
		"XDRIVE_PROMOTION_TAG=\"edge\"",
		"XDRIVE_PROMOTION_TAG=\"latest\"",
		"--use-package-registry",
		"--package-name xdrive-build-packages",
		"CI-tested Linux installer artifact is missing",
		"CI-tested Windows installer artifact is missing",
		"s|@IMAGE_REGISTRY@|$CI_REGISTRY_IMAGE|g",
	)
	for _, legacy := range []string{
		"xdrive-client-linux-amd64.deb",
		"xdrive-desktop-linux-amd64.deb",
		"xDriveDesktopSetup-amd64.exe",
	} {
		if strings.Contains(githubRaw+"\n"+gitlabRaw+"\n"+githubRelease+"\n"+gitlabRelease+"\n"+gitlabReleaseScripts, legacy) {
			t.Errorf("legacy standalone/duplicate installer name returned to CI or release contract: %s", legacy)
		}
	}
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

func assertGitLabJobImages(t *testing.T, gitlab map[string]any, expected map[string]string) {
	t.Helper()
	for jobName, wantImage := range expected {
		job, ok := gitlab[jobName].(map[string]any)
		if !ok {
			t.Fatalf("GitLab job %q missing or invalid", jobName)
		}
		imageValue, hasImage := job["image"]
		if wantImage == "" {
			if hasImage {
				t.Errorf("GitLab job %s image=%v, want no image for native Windows runner", jobName, imageValue)
			}
			continue
		}
		if !hasImage {
			t.Errorf("GitLab job %s is missing image=%q", jobName, wantImage)
			continue
		}
		if got := fmt.Sprint(imageValue); got != wantImage {
			t.Errorf("GitLab job %s image=%q want=%q", jobName, got, wantImage)
		}
	}
}

func assertGitLabCache(t *testing.T, root map[string]any, jobName, wantKey string, wantPaths []string) {
	t.Helper()
	job, ok := root[jobName].(map[string]any)
	if !ok {
		t.Fatalf("GitLab job %q missing or invalid", jobName)
	}
	cache, ok := job["cache"].(map[string]any)
	if !ok {
		t.Fatalf("GitLab job %s cache=%v, want map", jobName, job["cache"])
	}
	if got := fmt.Sprint(cache["key"]); got != wantKey {
		t.Errorf("GitLab job %s cache key=%q want=%q", jobName, got, wantKey)
	}
	rawPaths, ok := cache["paths"].([]any)
	if !ok {
		t.Fatalf("GitLab job %s cache paths=%v, want list", jobName, cache["paths"])
	}
	gotPaths := make([]string, 0, len(rawPaths))
	for _, path := range rawPaths {
		gotPaths = append(gotPaths, fmt.Sprint(path))
	}
	if !reflect.DeepEqual(gotPaths, wantPaths) {
		t.Errorf("GitLab job %s cache paths=%v want=%v", jobName, gotPaths, wantPaths)
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
