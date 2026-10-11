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
	githubProviderSpecificJobs := map[string]struct{}{
		"server-rootless-e2e": {},
		"publish-master":      {},
		"publish-stable":      {},
	}
	var githubCoreJobs []string
	for _, name := range githubJobs {
		if _, providerSpecific := githubProviderSpecificJobs[name]; providerSpecific {
			continue
		}
		githubCoreJobs = append(githubCoreJobs, name)
	}
	if !reflect.DeepEqual(githubCoreJobs, gitlabJobs) {
		t.Fatalf("CI core job drift: GitHub=%v GitLab=%v", githubCoreJobs, gitlabJobs)
	}

	expectedPlatforms := map[string]string{
		"single-commit":                  "linux",
		"desktop-tests":                  "linux",
		"desktop-linux":                  "linux",
		"desktop-windows":                "windows",
		"build-client-core":              "linux",
		"go-linux":                       "linux",
		"go-linux-api":                   "linux",
		"go-windows":                     "windows",
		"build-source-agent":             "linux",
		"package-linux-client":           "linux",
		"package-windows-client":         "windows",
		"server-validation":              "linux",
		"server-image":                   "linux",
		"photo-face-image":               "linux",
		"media-worker-image":             "linux",
		"caddy-image":                    "linux",
		"server-backup":                  "linux",
		"test-linux-artifact":            "linux",
		"test-source-agent-artifact":     "linux",
		"test-windows-rollback-artifact": "windows",
		"test-windows-upgrade-artifact":  "windows",
		"test-windows-smoke-artifact":    "windows",
		"web":                            "linux",
		"final-gate":                     "linux",
	}
	assertRunnerParity(t, github, gitlab, expectedPlatforms)
	assertGitLabJobImages(t, gitlab, map[string]string{
		"single-commit":                  "$XDRIVE_CI_GO_IMAGE",
		"desktop-tests":                  "$XDRIVE_CI_NODE_IMAGE",
		"desktop-linux":                  "$XDRIVE_CI_NODE_IMAGE",
		"desktop-windows":                "",
		"build-client-core":              "$XDRIVE_CI_GO_IMAGE",
		"go-linux":                       "$XDRIVE_CI_GO_IMAGE",
		"go-linux-api":                   "$XDRIVE_CI_GO_IMAGE",
		"go-windows":                     "",
		"build-source-agent":             "$XDRIVE_CI_GO_IMAGE",
		"package-linux-client":           "$XDRIVE_CI_GO_IMAGE",
		"package-windows-client":         "",
		"server-validation":              "$XDRIVE_CI_GO_IMAGE",
		"server-image":                   "$XDRIVE_CI_GO_IMAGE",
		"photo-face-image":               "$XDRIVE_CI_GO_IMAGE",
		"media-worker-image":             "$XDRIVE_CI_GO_IMAGE",
		"caddy-image":                    "$XDRIVE_CI_GO_IMAGE",
		"server-backup":                  "$XDRIVE_CI_GO_IMAGE",
		"test-linux-artifact":            "$XDRIVE_CI_GO_IMAGE",
		"test-source-agent-artifact":     "$XDRIVE_CI_GO_IMAGE",
		"test-windows-rollback-artifact": "",
		"test-windows-upgrade-artifact":  "",
		"test-windows-smoke-artifact":    "",
		"web":                            "$XDRIVE_CI_NODE_IMAGE",
		"final-gate":                     "$XDRIVE_CI_GO_IMAGE",
	})
	assertGitLabCache(t, gitlab, "go-windows",
		"xdrive-go-windows-test-v3-$CI_RUNNER_EXECUTABLE_ARCH",
		[]string{".cache/go-mod/cache/download/"},
	)
	assertGitLabCache(t, gitlab, "desktop-windows",
		"xdrive-desktop-windows-$CI_RUNNER_EXECUTABLE_ARCH",
		[]string{".cache/npm/", ".cache/electron/", ".cache/electron-builder/"},
	)
	assertGitLabCache(t, gitlab, "photo-face-image",
		"xdrive-photo-face-runtime-v2-$CI_RUNNER_EXECUTABLE_ARCH",
		[]string{".cache/ci-tools/", ".cache/photo-face-runtime/", ".cache/photo-face-models/"},
	)
	photoFaceJob, ok := gitlab["photo-face-image"].(map[string]any)
	if !ok {
		t.Fatal("GitLab photo-face-image job is missing or malformed")
	}
	if got := photoFaceJob["timeout"]; got != "2h" {
		t.Errorf("GitLab Photo Face job timeout=%v, want 2h", got)
	}
	requireRaw(t, "GitLab model prefetch soft timeout", gitlabRaw,
		"timeout --signal=TERM --kill-after=30s 105m bash scripts/ci/test-photo-face-image.sh dist/photo-face-image",
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
		"XDRIVE_CI_COMPOSE_PACKAGE_VERSION: \"2.32.4-1~debian.12~bookworm\"",
		"GOPROXY: \"https://goproxy.cn|https://mirrors.aliyun.com/goproxy/|https://proxy.golang.org|direct\"",
		"GOSUMDB: \"sum.golang.google.cn\"",
		"NPM_CONFIG_REGISTRY: \"https://registry.npmmirror.com\"",
		"XDRIVE_CI_NODE_MIRROR: \"https://mirrors.huaweicloud.com/nodejs\"",
		"XDRIVE_CI_DOCKER_MIRROR: \"https://mirrors.aliyun.com/docker-ce\"",
		"XDRIVE_CI_DISTROLESS_IMAGE: \"gcr.m.daocloud.io/distroless/static-debian12:nonroot\"",
		"XDRIVE_CI_GITHUB_RELEASE_PROXY: \"\"",
		"XDRIVE_CI_DOWNLOAD_ATTEMPTS: \"5\"",
		"HF_ENDPOINT: \"https://hf-mirror.com\"",
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
	apiRaceTest := readFile(t, filepath.Join(root, "scripts", "ci", "test-go-api-race.sh"))
	clientCoreBuild := readFile(t, filepath.Join(root, "scripts", "build-client-core.sh"))
	requireRaw(t, "client core build metadata contract", clientCoreBuild,
		`source "$ROOT/scripts/ci/build-metadata.sh"`,
		`github.com/lazyxu/xdrive/internal/version.Version=$BUILD_VERSION`,
		`github.com/lazyxu/xdrive/internal/version.Channel=$BUILD_CHANNEL`,
		`github.com/lazyxu/xdrive/internal/version.Commit=$BUILD_COMMIT`,
		`github.com/lazyxu/xdrive/internal/version.CommitMessageBase64=$BUILD_COMMIT_MESSAGE_B64`,
		`github.com/lazyxu/xdrive/internal/version.CommitTime=$BUILD_COMMIT_TIME`,
		`github.com/lazyxu/xdrive/internal/version.BuildTime=$BUILD_TIME`,
		`client core $VERSION build requires a full 40-character commit SHA`,
	)
	if strings.Contains(clientCoreBuild, "$VERSION_LDFLAG") {
		t.Error("client core build must not use the legacy version-only ldflag")
	}
	dockerImageExport := readFile(t, filepath.Join(root, "scripts", "ci", "export-docker-image.sh"))
	dockerImageImport := readFile(t, filepath.Join(root, "scripts", "ci", "import-docker-image.sh"))
	gitlabGoLinux := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-go-linux.sh"))
	gitlabPackageLinux := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-package-linux-client.sh"))
	gitlabSourceAgent := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-source-agent.sh"))
	gitlabServerValidation := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-server-validation.sh"))
	gitlabServerImage := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-server-image.sh"))
	gitlabCaddyImage := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-caddy-image.sh"))
	gitlabServerBackup := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-server-backup.sh"))
	gitlabGoWindows := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-go-windows.sh"))
	gitlabPackageWindows := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-package-windows-client.sh"))
	gitlabTestLinuxArtifact := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-test-linux-artifact.sh"))
	gitlabTestSourceArtifact := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-test-source-agent-artifact.sh"))
	gitlabTestWindowsArtifact := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-test-windows-artifact.sh"))
	gitlabTestWindowsSmoke := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-test-windows-smoke-artifact.sh"))
	testLinuxPackage := readFile(t, filepath.Join(root, "scripts", "ci", "test-linux-client-package.sh"))
	testSourcePackage := readFile(t, filepath.Join(root, "scripts", "ci", "test-source-agent-package.sh"))
	testWindowsPackage := readFile(t, filepath.Join(root, "scripts", "ci", "test-windows-client-package.ps1"))
	testWindowsSmokePackage := readFile(t, filepath.Join(root, "scripts", "ci", "test-windows-smoke-package.ps1"))
	gitlabWindowsBash := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-desktop-windows.sh")) + "\n" +
		gitlabGoWindows + "\n" + gitlabPackageWindows + "\n" + gitlabTestWindowsArtifact + "\n" + gitlabTestWindowsSmoke
	gitlabLinuxBash := clientCoreBuild + "\n" + gitlabGoLinux + "\n" + gitlabPackageLinux + "\n" + gitlabSourceAgent + "\n" +
		gitlabServerValidation + "\n" + gitlabServerImage + "\n" + gitlabCaddyImage + "\n" + gitlabServerBackup + "\n" +
		gitlabTestLinuxArtifact + "\n" + gitlabTestSourceArtifact
	gitlabWindowsNative := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-windows-native.ps1"))
	windowsUninstallerResolver := readFile(t, filepath.Join(root, "scripts", "ci", "resolve-windows-uninstaller.ps1"))
	windowsPathNormalizer := readFile(t, filepath.Join(root, "scripts", "ci", "windows-path-normalization.ps1"))
	windowsUninstallerTest := readFile(t, filepath.Join(root, "scripts", "ci", "test-windows-uninstaller-resolver.ps1"))
	windowsUpgradeTest := readFile(t, filepath.Join(root, "scripts", "test-windows-client-upgrade.ps1"))
	windowsUpgradeTransaction := readFile(t, filepath.Join(root, "internal", "update", "windows_upgrade_transaction.ps1"))
	windowsLegacyCleanup := readFile(t, filepath.Join(root, "internal", "update", "windows_legacy_cleanup.ps1"))
	windowsInstaller := readFile(t, filepath.Join(root, "packaging", "windows", "xdrive.iss"))
	chunkStorageTest := readFile(t, filepath.Join(root, "scripts", "test-server-chunk-storage.sh"))
	serverBackupScript := readFile(t, filepath.Join(root, "scripts", "server-backup.sh"))
	serverRestoreScript := readFile(t, filepath.Join(root, "scripts", "server-restore.sh"))
	branchCleanup := readFile(t, filepath.Join(root, "scripts", "cleanup-merged-branches.sh"))
	serverPipeTest := readFile(t, filepath.Join(root, "scripts", "test-server-installer-pipe.sh"))
	gitlabContractText := gitlabText + "\n" + downloadHelper + "\n" + nodeInstaller + "\n" + dockerInstaller + "\n" +
		goVersionCheck + "\n" + artifactVersion + "\n" + clientCoreBuild + "\n" + gitlabLinuxBash + "\n" + gitlabWindowsBash + "\n" +
		gitlabWindowsNative + "\n" + testLinuxPackage + "\n" + testSourcePackage + "\n" + testWindowsPackage + "\n" +
		testWindowsSmokePackage
	for _, command := range []string{
		"npm run test:main",
		"source scripts/ci/client-artifact-version.sh",
		"npm run runtime:linux",
		"npm run runtime:win",
		"go mod tidy \"-go=1.25\"",
		"git diff --exit-code -- go.mod go.sum",
		"bash scripts/ci/test-go-api-race.sh",
		"go test -race -timeout=25m ./cmd/server",
		"go test -p 1 -race \"${packages[@]}\"",
		"go vet ./...",
		"go build ./cmd/server ./cmd/xd ./cmd/xdrive-agent ./cmd/xdrive-updater",
		"bash scripts/build-source-agent.sh \"$XDRIVE_RELEASE_VERSION\" release/source-agent",
		"bash scripts/build-linux-deb.sh \"$XDRIVE_RELEASE_VERSION\" release desktop/release/linux-unpacked release/core/linux-amd64",
		"bash scripts/ci/test-linux-client-package.sh \"$XDRIVE_RELEASE_VERSION\" release/xdrive-linux-amd64.deb",
		"bash scripts/ci/test-source-agent-package.sh \"$XDRIVE_RELEASE_VERSION\" release/source-agent",
		"test-windows-client-package.ps1",
		"test-windows-smoke-package.ps1",
		"bash scripts/test-server-doctor.sh",
		"bash scripts/test-server-verify.sh",
		"bash scripts/test-server-installer-bootstrap.sh",
		"bash scripts/test-server-installer-transaction.sh",
		"bash scripts/test-server-installer-pipe.sh",
		"bash scripts/test-xdrive-server-host.sh",
		"bash scripts/test-cleanup-merged-branches.sh",
		"bash scripts/test-update-channels.sh",
		"bash scripts/ci/test-download-with-fallback.sh",
		"bash scripts/ci/test-prepare-go-mod-cache.sh",
		"bash scripts/ci/test-client-artifact-version.sh",
		"source scripts/ci/build-metadata.sh",
		"--build-arg \"VERSION=$XDRIVE_BUILD_VERSION\"",
		"--build-arg \"BUILD_CHANNEL=$XDRIVE_BUILD_CHANNEL\"",
		"--build-arg \"BUILD_COMMIT=$XDRIVE_BUILD_COMMIT\"",
		"--build-arg \"BUILD_COMMIT_MESSAGE_B64=$XDRIVE_BUILD_COMMIT_MESSAGE_B64\"",
		"--build-arg \"BUILD_COMMIT_TIME=$XDRIVE_BUILD_COMMIT_TIME\"",
		"--build-arg \"BUILD_TIME=$XDRIVE_BUILD_TIME\"",
		"-t xdrive/server:test .",
		"bash scripts/test-server-chunk-storage.sh",
		"bash scripts/ci/export-docker-image.sh xdrive/server:test dist/server-image",
		"bash scripts/ci/export-docker-image.sh xdrive/caddy:test dist/caddy-image",
		"bash scripts/ci/import-docker-image.sh dist/server-image xdrive/server:test",
		"-f deploy/Caddy.Dockerfile",
		"-t xdrive/caddy:test .",
		"bash scripts/test-server-backup-restore.sh",
		"go test -mod=readonly ./internal/... ./cmd/xdrive-agent",
		"go test -mod=readonly -tags=xdrive_e2e ./internal/mount -run ^TestWindowsCfAPI -v -count=1",
		"release/xDriveSetup-amd64.exe",
		"XDRIVE_RELEASE_VERSION",
		"npm ci --no-audit --no-fund",
		"npm run lint",
		"npm run build",
	} {
		if !strings.Contains(githubText, command) {
			t.Errorf("GitHub CI is missing parity command %q", command)
		}
		if !strings.Contains(gitlabContractText, command) {
			t.Errorf("GitLab CI contract is missing parity command %q", command)
		}
	}

	// Race-instrumented API tests use sequential Go processes to release per-test
	// DB pools, and the discovery guard must keep every test in exactly one shard.
	requireRaw(t, "API race test contract", apiRaceTest,
		"shards=(",
		"'^(Test[A-F]|Example|Fuzz)'",
		"'^Test[G-M]'",
		"'^Test[N-S]'",
		"'^Test[T-Z]'",
		"go test -race -mod=readonly -list",
		"if (( matched != 1 )); then",
		"go test -race -timeout=30m -count=1 -json -run",
		"collecting runner and PostgreSQL diagnostics",
		"/proc/diskstats",
		"pg_stat_activity",
		"pg_stat_database",
	)

	for _, token := range []string{"postgres:17-alpine", "1.25", "22"} {
		if !strings.Contains(githubRaw, token) {
			t.Errorf("GitHub CI is missing toolchain token %q", token)
		}
		if !strings.Contains(gitlabRaw+"\n"+gitlabContractText, token) {
			t.Errorf("GitLab CI contract is missing toolchain token %q", token)
		}
	}

	requireRaw(t, "GitHub CI", githubRaw,
		"pull_request:",
		"push:",
		"branches: [\"master\"]",
		"tags: [\"v*\"]",
		"workflow_dispatch:",
		"cancel-in-progress: true",
		"name: xdrive-linux-amd64",
		"name: xdrive-windows-amd64",
		"name: xdrive-source-agent-linux",
		"uses: ./.github/workflows/release.yml",
		"secrets: inherit",
	)
	requireRaw(t, "GitLab CI", gitlabRaw,
		"- local: /infra/ci/images.yml",
		"- local: /infra/ci/gitlab-release.yml",
		"- gate",
		"- build",
		"- package",
		"- test",
		"- verify",
		"- release-build",
		"- promote",
		"- release",
		"$CI_PIPELINE_SOURCE == \"push\" && $CI_COMMIT_TAG =~ /^v.+/",
		".electron-linux-cache:",
		"XDG_CACHE_HOME: \"$CI_PROJECT_DIR/.cache\"",
		"ELECTRON_BUILDER_CACHE: \"$CI_PROJECT_DIR/.cache/electron-builder\"",
		"extends: .electron-linux-cache",
		"desktop-tests:",
		"desktop-linux:",
		"desktop-windows:",
		"build-client-core:",
		"build-source-agent:",
		"package-linux-client:",
		"package-windows-client:",
		"test-linux-artifact:",
		"test-source-agent-artifact:",
		"test-windows-rollback-artifact:",
		"test-windows-upgrade-artifact:",
		"test-windows-smoke-artifact:",
		"final-gate:",
		"bash scripts/ci/gitlab-desktop-windows.sh",
		"bash scripts/ci/gitlab-go-linux.sh",
		"bash scripts/ci/gitlab-package-linux-client.sh",
		"bash scripts/ci/gitlab-source-agent.sh",
		"bash scripts/ci/gitlab-server-validation.sh",
		"bash scripts/ci/gitlab-server-image.sh",
		"bash scripts/ci/gitlab-caddy-image.sh",
		"bash scripts/ci/gitlab-server-backup.sh",
		"bash scripts/ci/gitlab-go-windows.sh",
		"bash scripts/ci/gitlab-package-windows-client.sh",
		"bash scripts/ci/gitlab-test-linux-artifact.sh",
		"bash scripts/ci/gitlab-test-source-agent-artifact.sh",
		"bash scripts/ci/gitlab-test-windows-artifact.sh",
		"bash scripts/ci/gitlab-test-windows-smoke-artifact.sh",
		"desktop-runtime-linux-amd64.tar.gz",
		"desktop/release/win-unpacked/",
		"release/core/",
		"release/xdrive-linux-amd64.deb",
		"release/source-agent/xdrive-source-agent-linux-amd64",
		"release/source-agent/xdrive-source-agent-linux-arm64",
		"release/xDriveSetup-amd64.exe",
		"xdrive-go-windows-test-v3-$CI_RUNNER_EXECUTABLE_ARCH",
		"xdrive-desktop-windows-$CI_RUNNER_EXECUTABLE_ARCH",
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
		"postgresql-client",
		"alias: postgres",
		"XD_TEST_DATABASE_URL: \"postgres://xdrive:xdrive@postgres:5432/xdrive_test?sslmode=disable\"",
		".cache/ci-tools/",
		"when: always",
	)
	assertGitLabJobTextContains(t, gitlab, "server-validation",
		"apt-get install -y --no-install-recommends ca-certificates curl jq xz-utils",
	)
	assertGitLabJobTextContains(t, gitlab, "server-validation",
		"bash scripts/ci/install-docker-cli.sh",
	)
	for _, jobName := range []string{"server-image", "caddy-image", "server-backup"} {
		assertGitLabJobTextContains(t, gitlab, jobName,
			"bash scripts/ci/install-docker-cli.sh --docker-only",
		)
	}
	requireRaw(t, "GitLab CI wrappers", gitlabContractText,
		"bash scripts/ci/check-go-min-version.sh 1.25",
		"pg_isready",
		"-h postgres -p 5432",
		"echo \"GOPROXY=$(go env GOPROXY)\"",
		"echo \"GOSUMDB=$(go env GOSUMDB)\"",
	)

	requireRaw(t, "GitHub parallel client build contract", githubRaw,
		"desktop-linux:",
		"desktop-windows:",
		"build-client-core:",
		"name: desktop-runtime-linux-amd64",
		"name: desktop-runtime-windows-amd64",
		"name: xdrive-client-core",
		"needs: [desktop-linux, build-client-core]",
		"needs: [desktop-windows, build-client-core]",
	)
	requireRaw(t, "GitLab parallel client build contract", gitlabRaw,
		"desktop-linux:",
		"desktop-windows:",
		"build-client-core:",
		"desktop-runtime-linux-amd64.tar.gz",
		"desktop/release/win-unpacked/",
		"release/core/",
	)

	requireRaw(t, "GitHub preinstalled Buildx contract", githubRaw,
		"docker buildx version",
	)
	requireRaw(t, "GitHub build-once contract", githubRaw,
		"package-linux-client:",
		"package-windows-client:",
		"build-client-core:",
		"build-source-agent:",
		"test-linux-artifact:",
		"test-windows-rollback-artifact:",
		"test-windows-upgrade-artifact:",
		"test-windows-smoke-artifact:",
		"test-source-agent-artifact:",
		"final-gate:",
		"publish-master:",
		"publish-stable:",
		"needs: [final-gate]",
	)
	requireRaw(t, "GitLab build-once contract", gitlabRaw,
		"package-linux-client:",
		"package-windows-client:",
		"build-source-agent:",
		"test-linux-artifact:",
		"test-windows-rollback-artifact:",
		"test-windows-upgrade-artifact:",
		"test-windows-smoke-artifact:",
		"test-source-agent-artifact:",
		"final-gate:",
		"stage: verify",
	)

	requireRaw(t, "GitHub installer packaging contract", githubRaw,
		"package-linux-client:",
		"package-windows-client:",
		"name: xdrive-linux-amd64",
		"name: xdrive-windows-amd64",
	)
	assertYAMLStringList(t, gitlab, "stages", []string{
		"gate",
		"build",
		"package",
		"test",
		"verify",
		"release-build",
		"promote",
		"release",
	})
	requireRaw(t, "GitLab installer packaging contract", gitlabRaw,
		"package-linux-client:",
		"package-windows-client:",
		"stage: package",
	)
	for _, job := range []string{
		"desktop-tests",
		"go-linux",
		"go-linux-api",
		"go-windows",
		"server-validation",
		"server-image",
		"web",
	} {
		assertGitHubJobNeeds(t, github, job, nil)
		assertGitLabJobNeeds(t, gitlab, job, nil)
	}
	assertGitHubJobNeeds(t, github, "caddy-image", []string{"web"})
	assertGitLabJobNeeds(t, gitlab, "caddy-image", []string{"web"})
	assertGitHubJobNeeds(t, github, "server-backup", []string{"server-image"})
	assertGitLabJobNeeds(t, gitlab, "server-backup", []string{"server-image"})
	assertGitHubJobNeeds(t, github, "server-rootless-e2e", []string{"server-image", "caddy-image"})
	assertGitHubJobNeeds(t, github, "test-linux-artifact", []string{"package-linux-client"})
	assertGitHubJobNeeds(t, github, "test-source-agent-artifact", []string{"build-source-agent"})
	assertGitHubJobNeeds(t, github, "test-windows-rollback-artifact", []string{"package-windows-client"})
	assertGitHubJobNeeds(t, github, "test-windows-upgrade-artifact", []string{"package-windows-client", "test-windows-rollback-artifact"})
	assertGitHubJobNeeds(t, github, "test-windows-smoke-artifact", []string{"package-windows-client", "test-windows-upgrade-artifact"})
	assertGitLabJobNeeds(t, gitlab, "test-linux-artifact", []string{"package-linux-client"})
	assertGitLabJobNeeds(t, gitlab, "test-source-agent-artifact", []string{"build-source-agent"})
	assertGitLabJobNeeds(t, gitlab, "test-windows-rollback-artifact", []string{"package-windows-client"})
	assertGitLabJobNeeds(t, gitlab, "test-windows-upgrade-artifact", []string{"package-windows-client", "test-windows-rollback-artifact"})
	assertGitLabJobNeeds(t, gitlab, "test-windows-smoke-artifact", []string{"package-windows-client", "test-windows-upgrade-artifact"})
	assertGitHubJobNeeds(t, github, "publish-master", []string{"build-source-agent", "package-linux-client", "package-windows-client", "server-image", "caddy-image", "photo-face-image", "media-worker-image"})
	assertGitHubJobNeeds(t, github, "publish-stable", []string{"final-gate"})
	assertGitLabSharedResourceGroup(t, gitlab, []string{
		"test-windows-rollback-artifact",
		"test-windows-upgrade-artifact",
		"test-windows-smoke-artifact",
	})
	requireRaw(t, "GitHub split critical test contract", githubRaw,
		"go-linux-api:",
		"Race test internal/api",
		"Race test Go packages except internal/api",
		"test-windows-rollback-artifact:",
		"-Scenario rollback",
		"-Scenario upgrade",
	)
	requireRaw(t, "GitLab split critical test contract", gitlabRaw,
		"go-linux-api:",
		"XDRIVE_GO_TEST_SCOPE: \"api\"",
		"XDRIVE_GO_TEST_SCOPE: \"rest\"",
		"test-windows-rollback-artifact:",
		"XDRIVE_WINDOWS_TRANSACTION_SCENARIO: \"rollback\"",
		"XDRIVE_WINDOWS_TRANSACTION_SCENARIO: \"upgrade\"",
	)

	requireRaw(t, "GitHub parallel server validation contract", githubRaw,
		"server-validation:",
		"server-image:",
		"server-rootless-e2e:",
		"caddy-image:",
		"server-backup:",
	)
	requireRaw(t, "GitLab parallel server validation contract", gitlabRaw,
		"server-validation:",
		"server-image:",
		"caddy-image:",
		"server-backup:",
	)

	requireRaw(t, "GitHub exact server image artifact contract", githubRaw,
		"name: xdrive-server-image",
		"name: xdrive-web-dist",
		"name: xdrive-caddy-image",
		"path: dist/server-image",
		"path: web/dist",
		"path: dist/caddy-image",
		"compression-level: 0",
		"bash scripts/ci/import-docker-image.sh dist/server-image xdrive/server:test",
	)
	requireRaw(t, "GitHub real Rootless Docker gate", githubRaw,
		"server-rootless-e2e:",
		"runs-on: ubuntu-24.04",
		"needs: [server-image, caddy-image]",
		"https://get.docker.com/rootless",
		"FORCE_ROOTLESS_INSTALL=1",
		"SKIP_IPTABLES=1",
		"apparmor_restrict_unprivileged_userns",
		"apparmor_parser -r",
		"Delegate=cpu cpuset io memory pids",
		"loginctl enable-linger",
		`systemctl restart "user@$user_id.service"`,
		"DBUS_SESSION_BUS_ADDRESS",
		"bash scripts/ci/test-server-rootless-e2e.sh dist/server-image dist/caddy-image",
		"- server-rootless-e2e",
	)
	requireRaw(t, "GitLab exact server image artifact contract", gitlabRaw,
		"dist/server-image/",
		"web/dist/",
		"dist/caddy-image/",
		"- job: server-image",
		"artifacts: true",
	)
	requireRaw(t, "Docker image artifact exporter", dockerImageExport,
		"docker save",
		"gzip -1",
		"image.id",
		"image.ref",
	)
	requireRaw(t, "Docker image artifact importer", dockerImageImport,
		"gzip -dc",
		"docker load",
		"loaded Docker image ID mismatch",
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
	requireRaw(t, "GitLab Linux split wrappers", gitlabLinuxBash,
		"XDRIVE_GO_TEST_SCOPE",
		"bash scripts/ci/test-go-api-race.sh",
		"go test -race -timeout=25m ./cmd/server",
		"go test -p 1 -race \"${packages[@]}\"",
		"go vet ./...",
		"bash scripts/build-source-agent.sh \"$XDRIVE_RELEASE_VERSION\" release/source-agent",
		"bash scripts/build-linux-deb.sh \"$XDRIVE_RELEASE_VERSION\" release desktop/release/linux-unpacked release/core/linux-amd64",
		"bash scripts/ci/test-linux-client-package.sh \"$XDRIVE_RELEASE_VERSION\" release/xdrive-linux-amd64.deb",
		"bash scripts/ci/test-source-agent-package.sh \"$XDRIVE_RELEASE_VERSION\" release/source-agent",
		"source scripts/ci/build-metadata.sh",
		"--build-arg \"VERSION=$XDRIVE_BUILD_VERSION\"",
		"--build-arg \"BUILD_CHANNEL=$XDRIVE_BUILD_CHANNEL\"",
		"--build-arg \"BUILD_COMMIT=$XDRIVE_BUILD_COMMIT\"",
		"-t xdrive/server:test .",
		"-f deploy/Caddy.Dockerfile",
		"-t xdrive/caddy:test .",
		"bash scripts/ci/export-docker-image.sh xdrive/server:test dist/server-image",
		"bash scripts/ci/export-docker-image.sh xdrive/caddy:test dist/caddy-image",
		"bash scripts/ci/import-docker-image.sh dist/server-image xdrive/server:test",
		"bash scripts/test-server-backup-restore.sh",
		"--build-arg \"GOPROXY=$GOPROXY\"",
		"--build-arg \"GOSUMDB=$GOSUMDB\"",
		"--build-arg \"RUNTIME_IMAGE=$XDRIVE_CI_DISTROLESS_IMAGE\"",
	)
	serverDockerfile := readFile(t, filepath.Join(root, "Dockerfile"))
	caddyDockerfile := readFile(t, filepath.Join(root, "deploy", "Caddy.Dockerfile"))
	requireRaw(t, "server Dockerfile dependency overrides", serverDockerfile,
		"ARG RUNTIME_IMAGE=gcr.io/distroless/static-debian12:nonroot",
		"FROM ${RUNTIME_IMAGE}",
		"ARG GOPROXY=https://proxy.golang.org|direct",
		"ARG GOSUMDB=sum.golang.org",
	)
	requireRaw(t, "Caddy Dockerfile Go dependency overrides", caddyDockerfile,
		"ARG GOPROXY=https://proxy.golang.org|direct",
		"ARG GOSUMDB=sum.golang.org",
	)
	requireRaw(t, "GitLab Windows Go wrapper", gitlabGoWindows,
		"bash scripts/ci/prepare-go-mod-cache.sh",
		"go test -mod=readonly ./internal/... ./cmd/xdrive-agent",
		"go test -mod=readonly -tags=xdrive_e2e ./internal/mount -run ^TestWindowsCfAPI -v -count=1",
	)
	requireRaw(t, "GitLab Windows package builder", gitlabPackageWindows,
		"source scripts/ci/client-artifact-version.sh",
		"desktop/release/win-unpacked/xdrive-desktop.exe",
		"release/core/windows-amd64",
		"choco install innosetup --no-progress -y",
		"BuildInstaller",
		"release/xDriveSetup-amd64.exe",
	)
	if strings.Contains(gitlabPackageWindows, "test-windows-client-upgrade.ps1") ||
		strings.Contains(gitlabPackageWindows, "SmokeInstall") {
		t.Errorf("GitLab Windows build job must not run exact-artifact tests")
	}
	requireRaw(t, "GitLab Windows exact-artifact test wrapper", gitlabTestWindowsArtifact+"\n"+testWindowsPackage,
		"test-windows-client-package.ps1",
		"XDRIVE_WINDOWS_TRANSACTION_SCENARIO",
		"-Scenario \"$scenario\"",
		"test-windows-uninstaller-resolver.ps1",
		"test-windows-client-upgrade.ps1",
	)
	if strings.Contains(gitlabGoWindows, "go mod tidy") {
		t.Errorf("GitLab Windows wrapper must not run go mod tidy under a newer self-hosted Go toolchain")
	}

	if strings.Contains(gitlabRaw, "key: \"xdrive-go-windows-v2-$CI_RUNNER_EXECUTABLE_ARCH\"") ||
		strings.Contains(gitlabRaw, "key: \"xdrive-go-windows-$CI_RUNNER_EXECUTABLE_ARCH\"") ||
		strings.Contains(gitlabRaw, "key: \"xdrive-package-windows-v1-$CI_RUNNER_EXECUTABLE_ARCH\"") {
		t.Errorf("GitLab Windows Go cache key must not restore the legacy combined test/package cache")
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
		"XDRIVE_CI_COMPOSE_PACKAGE_VERSION",
		"https://mirrors.huaweicloud.com/docker-ce",
		"dpkg-deb -x",
		"--docker-only",
	)
	dockerOnlyExit := strings.Index(dockerInstaller, `if [[ "$install_compose" != true ]]`)
	composeVersionRequirement := strings.Index(dockerInstaller, `compose_version="${XDRIVE_CI_COMPOSE_VERSION:?`)
	if dockerOnlyExit < 0 || composeVersionRequirement < 0 || composeVersionRequirement < dockerOnlyExit {
		t.Errorf("CI Docker-only installation must not require Compose configuration")
	}
	requireRaw(t, "Go minimum-version check", goVersionCheck,
		"Go >= $minimum is required",
		"Go version OK:",
	)
	requireRaw(t, "client artifact version resolver", artifactVersion,
		"XDRIVE_RELEASE_VERSION=\"snapshot\"",
		"XDRIVE_DESKTOP_VERSION=\"0.0.0-snapshot.$short_sha\"",
		"XDRIVE_RELEASE_VERSION=\"$tag\"",
		"XDRIVE_RELEASE_VERSION=\"0.0.0-ci\"",
	)
	requireRaw(t, "GitLab Windows Bash wrappers", gitlabWindowsBash,
		"set -euo pipefail",
		"source scripts/ci/client-artifact-version.sh",
		"bash scripts/ci/check-go-min-version.sh 1.25",
		"powershell.exe",
		"go test -mod=readonly -tags=xdrive_e2e ./internal/mount -run ^TestWindowsCfAPI -v -count=1",
		"npm run runtime:win",
		"install innosetup --no-progress -y",
		"test-windows-client-package.ps1",
		"test-windows-smoke-package.ps1",
		"release/xDriveSetup-amd64.exe",
	)
	requireRaw(t, "GitLab Windows native helper", gitlabWindowsNative,
		"ValidateSet(\"ValidateScripts\", \"PrepareSigning\", \"BuildInstaller\", \"VerifySignatures\", \"SmokeInstall\")",
		"resolve-windows-uninstaller.ps1",
		"./scripts/build-windows-installer.ps1",
		"Get-AuthenticodeSignature",
		"Start-Process -FilePath $installer",
		`"/DIR=$app"`,
		`'"stage":"window_shown","visible":true'`,
		`'"stage":"startup_complete"'`,
		"$desktopTestRoot",
		"$desktopLocalAppData",
		"$desktopUserData",
		`"--user-data-dir=$desktopUserData"`,
		"$desktopPidsBefore",
		"$desktopPidsAfter",
		"test-windows-client-package.ps1",
		"test-windows-smoke-package.ps1",
	)
	if strings.Contains(gitlabWindowsNative, "MainWindowHandle") {
		t.Errorf("GitLab service-runner smoke tests must use in-process lifecycle evidence instead of MainWindowHandle")
	}
	requireRaw(t, "Windows uninstaller resolver", windowsUninstallerResolver,
		"UninstallString",
		"^unins\\d+\\.exe$",
		"outside the unified app directory",
		"windows-path-normalization.ps1",
		"Get-XDriveComparablePath",
	)
	requireRaw(t, "Windows WOW64 path normalizer", windowsPathNormalizer,
		"Get-XDriveComparablePath",
		"[Environment]::Is64BitOperatingSystem",
		"System32\\config\\systemprofile",
		"SysWOW64\\config\\systemprofile",
	)
	if strings.Contains(windowsPathNormalizer, "[Environment]::Is64BitProcess") {
		t.Errorf("Windows system-profile aliases must compare equally even when the resolver runs in 64-bit PowerShell")
	}
	if strings.Contains(windowsPathNormalizer, "Sysnative\\config\\systemprofile") {
		t.Errorf("WOW64 path normalizer must not treat Sysnative as equivalent to SysWOW64")
	}
	requireRaw(t, "Windows uninstaller resolver regression", windowsUninstallerTest,
		"unins001.exe",
		"resolver must reject uninstallers outside the unified app directory",
		"Start Menu discovery must prefer the 32-bit Inno Setup system-profile alias",
	)
	requireRaw(t, "Windows transaction scenario contract", windowsUpgradeTest,
		"ValidateSet(\"all\", \"rollback\", \"upgrade\")",
		"$Scenario = \"all\"",
		"if ($Scenario -ne \"upgrade\")",
		"if ($Scenario -eq \"rollback\")",
	)

	requireRaw(t, "Windows upgrade transaction test", windowsUpgradeTest,
		"resolve-windows-uninstaller.ps1",
		"unified client must install the xDrive Desktop shortcut",
		"xDriveAgent autorun registration missing after baseline install",
		"transaction test uninstalling via",
		"xDriveAgent autorun remains after transaction test uninstall",
	)
	for label, content := range map[string]string{
		"Windows native CI helper":         gitlabWindowsNative,
		"Windows upgrade transaction test": windowsUpgradeTest,
		"Windows upgrade transaction":      windowsUpgradeTransaction,
		"Windows legacy cleanup":           windowsLegacyCleanup,
	} {
		requireRaw(t, label+" Start Menu discovery", content,
			"Get-XDriveStartMenuProgramPaths",
		)
		if strings.Contains(content, `Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs`) &&
			!strings.Contains(content, `SysWOW64\config\systemprofile`) {
			t.Errorf("%s must use the Windows known-folder API instead of assuming Start Menu is under APPDATA", label)
		}
	}
	requireRaw(t, "Windows shortcut search roots", windowsPathNormalizer,
		"function Get-XDriveStartMenuProgramPaths",
		"GetFolderPath([Environment+SpecialFolder]::Programs)",
		"GetFolderPath([Environment+SpecialFolder]::CommonPrograms)",
		`SysWOW64\config\systemprofile`,
		`System32\config\systemprofile`,
	)
	requireRaw(t, "Windows installer Start Menu migration", windowsInstaller,
		"DefaultGroupName=xDrive",
		"UsePreviousGroup=no",
		`Name: "{userprograms}\xDrive\xDrive"`,
	)
	requireRaw(t, "chunk storage Docker-network client", chunkStorageTest,
		"test-client:",
		"http://server:8080/api/v1/readyz",
		"compose exec -T test-client curl",
		`file=@-;filename=probe-copy.bin`,
	)
	if strings.Contains(chunkStorageTest, `http://127.0.0.1:$PORT`) {
		t.Errorf("chunk storage test must not access Docker-published ports through the job container loopback")
	}
	if strings.Contains(chunkStorageTest, "/test-output") {
		t.Errorf("chunk storage test must stream data across Docker exec instead of bind-mounting job-container paths into the host daemon")
	}
	requireRaw(t, "server backup Docker-daemon boundary", serverBackupScript,
		"tar -cf - .",
		`run_to_file_with_progress "备份文件数据" "$partial_dir/blobs.tar" "$blob_bytes"`,
		`"$@" > "$output"`,
	)
	if strings.Contains(serverBackupScript, `-v "$partial_dir:/backup"`) {
		t.Errorf("server backup must stream blobs from the Docker daemon instead of bind-mounting a job-container path")
	}
	requireRaw(t, "server restore Docker-daemon boundary", serverRestoreScript,
		"tar -xf - -C /data",
		`< "$BACKUP_DIR/blobs.tar"`,
	)
	if strings.Contains(serverRestoreScript, `-v "$BACKUP_DIR:/backup:ro"`) {
		t.Errorf("server restore must stream blobs to the Docker daemon instead of bind-mounting a job-container path")
	}
	requireRaw(t, "branch cleanup jq query", branchCleanup,
		`--arg label_name "$superseded_label"`,
		`.name == $label_name`,
	)
	requireRaw(t, "server pipe installer test", serverPipeTest,
		"pipe_status=(\"${PIPESTATUS[@]}\")",
		"producer_status=",
		"installer_status=",
		"\"$producer_status\" -ne 141",
		"pipe installer consumer failed",
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
	gitlabPublishRelease := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-publish-release.sh"))
	gitlabReleaseScripts := strings.Join([]string{
		readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-release-version.sh")),
		readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-release-assets.sh")),
		readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-server-images.sh")),
		readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-promote-images.sh")),
		gitlabPublishRelease,
	}, "\n")

	releaseAssets := []string{
		"xdrive-linux-amd64.deb",
		"xDriveSetup-amd64.exe",
		"xdrive-source-agent-linux-amd64",
		"xdrive-source-agent-linux-arm64",
		"xdrive-server-install.sh",
		"server-backup.sh",
		"server-backup-scheduled.sh",
		"server-restore.sh",
		"server-verify.sh",
		"server-doctor.sh",
		"server-migrate-user.sh",
		"xdrive-server",
		"docker-compose.yml",
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
	if strings.Contains(gitlabPublishRelease, "\nCaddyfile\n") {
		t.Error("GitLab release must not publish provider-only Caddyfile outside the shared release asset set")
	}

	for _, imageName := range []string{"xdrive-server", "xdrive-caddy"} {
		if !strings.Contains(githubRelease, imageName) {
			t.Errorf("GitHub release contract is missing image %q", imageName)
		}
		if !strings.Contains(gitlabReleaseScripts, imageName) {
			t.Errorf("GitLab release contract is missing image %q", imageName)
		}
	}

	for _, retired := range []string{"xdrive-web", "xdrive-web-image", "xdrive/web:test"} {
		if strings.Contains(githubRelease+"\n"+gitlabReleaseScripts, retired) {
			t.Errorf("retired Web runtime image leaked into release contract: %q", retired)
		}
	}

	requireRaw(t, "server installer registry contract", installerTemplate,
		"IMAGE_REGISTRY=\"${XD_IMAGE_REGISTRY:-@IMAGE_REGISTRY@}\"",
		"BUILT_SOURCE=\"${XD_BUILT_SOURCE:-@UPDATE_SOURCE@}\"",
		`[[ "$1" =~ ^@[A-Z_]+@$ ]]`,
		`if [[ -n "$BUILT_CHANNEL" ]] && ! is_template_placeholder "$BUILT_CHANNEL"; then`,
		`if is_template_placeholder "$SOURCE_REF" || is_template_placeholder "$IMAGE_TAG" || is_template_placeholder "$BUILT_SOURCE"; then`,
		`if [[ "$requested_channel" == "master" && -z "$requested_commit" && -n "$BUILT_COMMIT" ]] && ! is_template_placeholder "$BUILT_COMMIT"; then`,
		`if [[ -z "${XD_IMAGE_REGISTRY:-}" && "$requested_source" != "$BUILT_SOURCE" ]] && ! is_template_placeholder "$BUILT_SOURCE"; then`,
		`if [[ -z "$IMAGE_REGISTRY" ]] || is_template_placeholder "$IMAGE_REGISTRY"; then`,
		`IMAGE_REGISTRY="$(resolve_gitlab_registry)"`,
		`IMAGE_REGISTRY="ghcr.io/lazyxu"`,
		`set_env XD_UPDATE_SOURCE "$requested_source"`,
	)
	requireRaw(t, "GitHub server update-source bake", githubRelease,
		`s|@UPDATE_SOURCE@|github|g`,
	)
	requireRaw(t, "GitLab server update-source bake", gitlabReleaseScripts,
		`s|@UPDATE_SOURCE@|gitlab|g`,
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
		if strings.Contains(readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-release-assets.sh")), forbidden) {
			t.Errorf("GitLab release jobs must not rebuild client artifacts: %q", forbidden)
		}
	}

	requireRaw(t, "GitHub master/stable publish split", githubRaw,
		"publish-master:",
		"if: github.event_name == 'push' && github.ref == 'refs/heads/master'",
		"publish-stable:",
		"if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')",
		"needs: [final-gate]",
	)
	requireRaw(t, "GitHub Publish Packages", githubRelease,
		"workflow_call:",
		"name: xdrive-linux-amd64",
		"name: xdrive-windows-amd64",
		"name: xdrive-source-agent-linux",
		"gh release create snapshot release/* --repo \"$repo\" --prerelease",
		"target_tag=\"edge\"",
		"target_tag=\"latest\"",
		"retention-days: 14",
		"s|@IMAGE_REGISTRY@|ghcr.io/$GITHUB_REPOSITORY_OWNER|g",
		"Download exact Linux installer produced by CI",
		"Download exact Windows installer produced by CI",
		"Verify single-installer distribution contract",
		"pattern: xdrive-*-image",
		"load_exact xdrive-server-image xdrive/server:test",
		"load_exact xdrive-caddy-image xdrive/caddy:test",
		"Load and verify exact CI-produced images",
		"Push exact CI-produced images in parallel",
		"docker push \"$remote\" &",
		"scripts/ci/import-docker-image.sh",
	)
	if strings.Contains(githubRelease, "${{ matrix.") {
		t.Errorf("GitHub release server image publication must use one runner instead of a matrix")
	}
	requireRaw(t, "GitHub release Buildx contract", githubRelease,
		"docker buildx imagetools create",
	)
	if strings.Contains(githubRelease, "docker/setup-buildx-action@") {
		t.Errorf("GitHub release must use the Buildx already validated on ubuntu-latest instead of setup-buildx-action")
	}
	requireRaw(t, "GitHub rolling snapshot recreation", githubRelease,
		"gh release delete snapshot --repo \"$repo\" -y",
		"gh release create snapshot release/* --repo \"$repo\" --prerelease",
	)
	if strings.Contains(githubRelease, "gh release delete-asset snapshot") {
		t.Errorf("GitHub rolling snapshot update must recreate the release instead of deleting assets one by one")
	}
	for _, forbidden := range []string{"snapshot-${GITHUB_SHA::12}", "Publish immutable master snapshot", "Prune old immutable master snapshots"} {
		if strings.Contains(githubRelease, forbidden) {
			t.Errorf("GitHub release workflow must keep only the rolling snapshot: %q", forbidden)
		}
	}
	if strings.Contains(gitlabReleaseScripts, `XDRIVE_RELEASE_TAG="snapshot-$short_sha"`) {
		t.Errorf("GitLab release workflow must keep only the rolling snapshot tag")
	}
	for _, forbidden := range []string{"docker/build-push-action", "docker build --build-arg", "docker build -f"} {
		if strings.Contains(githubRelease, forbidden) {
			t.Errorf("GitHub release workflow must publish exact tested server images without rebuilding: %q", forbidden)
		}
		if strings.Contains(gitlabReleaseScripts, forbidden) {
			t.Errorf("GitLab release workflow must publish exact tested server images without rebuilding: %q", forbidden)
		}
	}

	var gitlabReleaseYAML map[string]any
	if err := yaml.Unmarshal([]byte(gitlabRelease), &gitlabReleaseYAML); err != nil {
		t.Fatalf("parse GitLab release CI: %v", err)
	}
	assertGitLabRuleNeeds(t, gitlabReleaseYAML, "release-assets", `$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_TAG =~ /^v.+/`, []string{"build-source-agent", "final-gate"})
	assertGitLabRuleNeeds(t, gitlabReleaseYAML, "release-assets", `$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "master" && $CI_REGISTRY_IMAGE`, []string{"build-source-agent"})
	assertGitLabRuleNeeds(t, gitlabReleaseYAML, "publish-server-images", `$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_TAG =~ /^v.+/`, []string{"final-gate", "server-image", "caddy-image", "photo-face-image", "media-worker-image"})
	assertGitLabRuleNeeds(t, gitlabReleaseYAML, "publish-server-images", `$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "master" && $CI_REGISTRY_IMAGE`, []string{"server-image", "caddy-image", "photo-face-image", "media-worker-image"})

	requireRaw(t, "GitLab release pipeline", gitlabRelease,
		`$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "master" && $CI_REGISTRY_IMAGE`,
		"release-assets:",
		"publish-server-images:",
		"promote-server-images:",
		"publish-release:",
		"- job: server-image",
		"- job: caddy-image",
		"- job: package-linux-client",
		"- job: package-windows-client",
		"stage: release-build",
		"expire_in: 14 days",
		"GLAB_ENABLE_CI_AUTOLOGIN: \"true\"",
		"image: $XDRIVE_CI_GLAB_IMAGE",
		"- release/server-migrate-user.sh",
	)
	for _, legacyJob := range []string{"package-linux-amd64:", "package-windows-amd64:", "package-server-images:"} {
		if strings.Contains(gitlabRelease, legacyJob) {
			t.Errorf("GitLab release pipeline still contains obsolete post-test packaging job %q", legacyJob)
		}
	}

	requireRaw(t, "GitLab release scripts", gitlabReleaseScripts,
		"XDRIVE_RELEASE_TAG=\"snapshot\"",
		"0.0.0-snapshot.$short_sha",
		"XDRIVE_RELEASE_COMMIT=$CI_COMMIT_SHA",
		"XDRIVE_PROMOTION_TAG=\"edge\"",
		"XDRIVE_PROMOTION_TAG=\"latest\"",
		"--use-package-registry",
		"--package-name xdrive-build-packages",
		"CI-produced source-agent artifact is missing",
		"s|@IMAGE_REGISTRY@|$CI_REGISTRY_IMAGE|g",
		"scripts/ci/import-docker-image.sh",
		"docker push \"$image\" &",
		"pids=(",
		"Published exact CI-produced GitLab server images",
	)
	if strings.Contains(gitlabPublishRelease, "repository/tags/") {
		t.Error("GitLab 17.x CI job tokens must not attempt unsupported repository tag mutation during release publication")
	}
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

func TestServerHostLayoutAndRootlessContract(t *testing.T) {
	root := repositoryRoot(t)
	compose := readFile(t, filepath.Join(root, "deploy", "docker-compose.yml"))
	installer := readFile(t, filepath.Join(root, "deploy", "install-server.sh"))
	hostManager := readFile(t, filepath.Join(root, "scripts", "xdrive-server-host.sh"))
	doctor := readFile(t, filepath.Join(root, "scripts", "server-doctor.sh"))
	design := readFile(t, filepath.Join(root, "docs", "server-host-layout.md"))
	uninstallTest := readFile(t, filepath.Join(root, "scripts", "test-server-uninstall.sh"))
	statusSummaryTest := readFile(t, filepath.Join(root, "scripts", "test-server-status-summary.sh"))
	rootlessE2E := readFile(t, filepath.Join(root, "scripts", "ci", "test-server-rootless-e2e.sh"))
	githubCI := readFile(t, filepath.Join(root, ".github", "workflows", "ci.yml"))
	gitlabValidation := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-server-validation.sh"))

	requireRaw(t, "server bind-mount layout", compose,
		`${XD_FILES_DATA_DIR:-../data/files}:/data`,
		`${XD_POSTGRES_DATA_DIR:-../data/postgres}:/var/lib/postgresql/data`,
		`${XD_CADDY_DATA_DIR:-../data/caddy/data}:/data`,
		`${XD_CADDY_CONFIG_DIR:-../data/caddy/config}:/config`,
		`user: "${XD_SERVER_UID:-65532}:${XD_SERVER_GID:-65532}"`,
	)
	for _, forbidden := range []string{
		"postgres-data:/var/lib/postgresql/data",
		"file-data:/data",
		"caddy-data:/data",
		"caddy-config:/config",
	} {
		if strings.Contains(compose, forbidden) {
			t.Errorf("server Compose must not default to legacy named-volume mount %q", forbidden)
		}
	}

	requireRaw(t, "server host-layout installer contract", installer,
		`XDRIVE_HOME="${XD_CONFIG_DIR:-$HOME/.xd}"`,
		`CONFIG_DIR="$XDRIVE_HOME/config"`,
		`BIN_DIR="$XDRIVE_HOME/bin"`,
		`DATA_DIR="$XDRIVE_HOME/data"`,
		`STATE_DIR="$XDRIVE_HOME/state"`,
		`DOCKER_MODE="rootless"`,
		`SERVER_GID=65532`,
		`configure_data_path XD_FILES_DATA_DIR "$DATA_DIR/files"`,
		`migrate_legacy_named_volumes`,
		`legacy Docker named-volume deployment detected`,
		`finalize_host_layout`,
	)
	if strings.Contains(installer, "sudo ") || strings.Contains(installer, "EUID") {
		t.Fatal("server installer must not require sudo/root")
	}

	requireRaw(t, "server host manager layout", hostManager,
		`XDRIVE_HOME="${XD_CONFIG_DIR:-$DEFAULT_XDRIVE_HOME}"`,
		`CONFIG_DIR="$XDRIVE_HOME/config"`,
		`BIN_DIR="$XDRIVE_HOME/bin"`,
		`LEGACY_VOLUMES_RECORD="$STATE_DIR/legacy-volumes-retained"`,
		`xdrive-server status [--summary-only]`,
		`xDrive installation environment`,
		`Docker mode`,
		`Persistent paths`,
		`Retained legacy volumes`,
		`disk_usage_for_path`,
		`active_mount`,
		`xdrive-server cleanup legacy-volumes [--yes]`,
		`xdrive-server uninstall [--purge-data] [--purge-backups] --yes`,
		`compose down --remove-orphans`,
		`docker volume rm "$volume"`,
		`purge_container_owned_dir`,
		`uninstall requires --yes`,
	)
	requireRaw(t, "server doctor environment summary", doctor,
		"---- installation environment ----",
		"status --summary-only",
		"XD_STATUS_REDACT_HOME=1",
	)
	requireRaw(t, "server installer environment summary", installer,
		"show_install_environment",
		"status --summary-only",
		"[xDrive] installation environment",
		"interactive_tty_available",
		`[[ "${XD_NONINTERACTIVE:-0}" != "1" ]] || return 1`,
		"( exec 3<>/dev/tty ) 2>/dev/null",
		"if interactive_tty_available; then",
	)

	requireRaw(t, "server host-layout design", design,
		"# Server host layout and Rootless Docker contract",
		"## Canonical host layout",
		"## Docker modes",
		"## Legacy layout migration",
		"## Uninstall and retained-data contract",
		"### Legacy named-volume cleanup",
		"## Installation environment summary and diagnostics",
		"server-rootless-e2e",
		"## CI contract",
	)
	requireRaw(t, "server status summary test", statusSummaryTest,
		"status --summary-only",
		"Docker mode",
		"xdrive_old_files (present,unused)",
	)
	requireRaw(t, "real rootless E2E script", rootlessE2E,
		"dockerd-rootless.sh",
		"SecurityOptions",
		"grep -qi rootless",
		"CgroupDriver",
		"systemd cgroup delegation",
		"--network host",
		"REGISTRY_HTTP_ADDR=127.0.0.1",
		"install-server.sh",
		"status",
		"doctor",
		"65532:65532",
	)
	requireRaw(t, "server uninstall validation", uninstallTest,
		"uninstall --yes",
		"cleanup legacy-volumes --yes",
		"uninstall --purge-data --purge-backups --yes",
		"refusing dangerous purge path",
	)
	requireRaw(t, "GitHub server uninstall CI", githubCI,
		"bash scripts/test-server-uninstall.sh",
	)
	requireRaw(t, "GitLab server uninstall CI", gitlabValidation,
		"bash scripts/test-server-uninstall.sh",
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
	return strings.ReplaceAll(string(data), "\r\n", "\n")
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

func assertYAMLStringList(t *testing.T, root map[string]any, key string, want []string) {
	t.Helper()
	raw, ok := root[key].([]any)
	if !ok {
		t.Fatalf("YAML key %q has type %T, want list", key, root[key])
	}
	got := make([]string, 0, len(raw))
	for _, item := range raw {
		got = append(got, fmt.Sprint(item))
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("YAML key %q=%v want=%v", key, got, want)
	}
}

func assertGitLabRuleNeeds(t *testing.T, config map[string]any, jobName, condition string, want []string) {
	t.Helper()
	job, ok := config[jobName].(map[string]any)
	if !ok {
		t.Fatalf("GitLab release job %q missing or invalid", jobName)
	}
	rules, ok := job["rules"].([]any)
	if !ok {
		t.Fatalf("GitLab release job %q rules missing or invalid", jobName)
	}
	for _, rawRule := range rules {
		rule, ok := rawRule.(map[string]any)
		if !ok {
			continue
		}
		if rule["if"] == condition {
			assertNeedNames(t, "GitLab rule", jobName, rule["needs"], want)
			return
		}
	}
	t.Errorf("GitLab release job %q missing rule for %q", jobName, condition)
}

func assertGitHubJobNeeds(t *testing.T, github map[string]any, jobName string, want []string) {
	t.Helper()
	jobs, ok := github["jobs"].(map[string]any)
	if !ok {
		t.Fatalf("GitHub jobs has type %T, want map", github["jobs"])
	}
	job, ok := jobs[jobName].(map[string]any)
	if !ok {
		t.Fatalf("GitHub job %q missing or invalid", jobName)
	}
	assertNeedNames(t, "GitHub", jobName, job["needs"], want)
}

func assertGitLabJobNeeds(t *testing.T, gitlab map[string]any, jobName string, want []string) {
	t.Helper()
	job, ok := gitlab[jobName].(map[string]any)
	if !ok {
		t.Fatalf("GitLab job %q missing or invalid", jobName)
	}
	assertNeedNames(t, "GitLab", jobName, job["needs"], want)
}

func assertGitLabJobTextContains(t *testing.T, gitlab map[string]any, jobName, want string) {
	t.Helper()
	job, ok := gitlab[jobName].(map[string]any)
	if !ok {
		t.Fatalf("GitLab job %q missing or invalid", jobName)
	}
	if text := collectYAMLStrings(job); !strings.Contains(text, want) {
		t.Errorf("GitLab job %s is missing %q", jobName, want)
	}
}

func assertGitLabSharedResourceGroup(t *testing.T, gitlab map[string]any, jobNames []string) {
	t.Helper()
	var shared string
	for _, jobName := range jobNames {
		job, ok := gitlab[jobName].(map[string]any)
		if !ok {
			t.Fatalf("GitLab job %q missing or invalid", jobName)
		}
		group, _ := job["resource_group"].(string)
		if group == "" {
			t.Errorf("GitLab job %s must serialize shared Windows installer state", jobName)
			continue
		}
		if shared == "" {
			shared = group
			continue
		}
		if group != shared {
			t.Errorf("GitLab Windows artifact jobs must share one resource group: %s=%q want=%q", jobName, group, shared)
		}
	}
}

func assertNeedNames(t *testing.T, provider, jobName string, raw any, want []string) {
	t.Helper()
	var got []string
	switch value := raw.(type) {
	case nil:
	case string:
		got = append(got, value)
	case []any:
		for _, item := range value {
			switch need := item.(type) {
			case string:
				got = append(got, need)
			case map[string]any:
				name, _ := need["job"].(string)
				if name == "" {
					t.Fatalf("%s job %s has invalid needs entry: %v", provider, jobName, need)
				}
				got = append(got, name)
			default:
				t.Fatalf("%s job %s has invalid needs entry type %T", provider, jobName, item)
			}
		}
	default:
		t.Fatalf("%s job %s needs has type %T", provider, jobName, raw)
	}
	sort.Strings(got)
	want = append([]string(nil), want...)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s job %s needs=%v want=%v", provider, jobName, got, want)
	}
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

func TestPhotoFaceModelCachePersistsFailedPrefetch(t *testing.T) {
	root := repositoryRoot(t)
	var github, gitlab map[string]any
	if err := yaml.Unmarshal([]byte(readFile(t, filepath.Join(root, ".github", "workflows", "ci.yml"))), &github); err != nil {
		t.Fatalf("parse GitHub CI: %v", err)
	}
	if err := yaml.Unmarshal([]byte(readFile(t, filepath.Join(root, ".gitlab-ci.yml"))), &gitlab); err != nil {
		t.Fatalf("parse GitLab CI: %v", err)
	}

	jobs, ok := github["jobs"].(map[string]any)
	if !ok {
		t.Fatalf("GitHub jobs has type %T, want map", github["jobs"])
	}
	job, ok := jobs["photo-face-image"].(map[string]any)
	if !ok {
		t.Fatal("GitHub Photo Face job missing or invalid")
	}
	env, ok := job["env"].(map[string]any)
	if !ok || env["HF_ENDPOINT"] != `${{ vars.HF_ENDPOINT || 'https://huggingface.co' }}` {
		t.Errorf("GitHub Photo Face must default to official Hugging Face with a repository-variable override; env=%v", job["env"])
	}
	rawSteps, ok := job["steps"].([]any)
	if !ok {
		t.Fatalf("GitHub Photo Face steps=%v, want list", job["steps"])
	}
	findStep := func(field, want string) (int, map[string]any) {
		t.Helper()
		foundIndex := -1
		var found map[string]any
		for index, rawStep := range rawSteps {
			step, ok := rawStep.(map[string]any)
			if !ok {
				t.Fatalf("GitHub Photo Face step %d has type %T, want map", index, rawStep)
			}
			if step[field] == want {
				if foundIndex >= 0 {
					t.Fatalf("GitHub Photo Face has duplicate %s=%q steps", field, want)
				}
				foundIndex, found = index, step
			}
		}
		if foundIndex < 0 {
			t.Fatalf("GitHub Photo Face is missing %s=%q step", field, want)
		}
		return foundIndex, found
	}
	cacheInputs := func(step map[string]any, wantPath, wantKey string) map[string]any {
		t.Helper()
		inputs, ok := step["with"].(map[string]any)
		if !ok {
			t.Fatalf("GitHub Photo Face cache step %v is missing inputs", step["name"])
		}
		if inputs["path"] != wantPath {
			t.Errorf("GitHub Photo Face cache %v path=%v want=%q", step["name"], inputs["path"], wantPath)
		}
		if inputs["key"] != wantKey {
			t.Errorf("GitHub Photo Face cache %v key=%v want=%q", step["name"], inputs["key"], wantKey)
		}
		return inputs
	}

	runtimeIndex, runtimeCache := findStep("uses", "actions/cache@v4")
	cacheInputs(runtimeCache, ".cache/photo-face-runtime", `photo-face-runtime-v2-${{ runner.os }}-${{ steps.photo-face-runtime-cache.outputs.hash }}`)
	restoreIndex, restore := findStep("uses", "actions/cache/restore@v4")
	if restore["id"] != "photo-face-model-cache" {
		t.Errorf("GitHub model-cache restore id=%v want=photo-face-model-cache", restore["id"])
	}
	modelKeyPrefix := `photo-face-models-v1-${{ runner.os }}-`
	restoreInputs := cacheInputs(restore, ".cache/photo-face-models", modelKeyPrefix+`${{ github.run_id }}-${{ github.run_attempt }}`)
	if got := strings.TrimSpace(fmt.Sprint(restoreInputs["restore-keys"])); got != modelKeyPrefix {
		t.Errorf("GitHub model cache must restore across runs and runtime-contract changes: restore-keys=%q want=%q", got, modelKeyPrefix)
	}
	buildIndex, build := findStep("id", "photo-face-build")
	if build["run"] != "bash scripts/ci/test-photo-face-image.sh dist/photo-face-image" {
		t.Errorf("GitHub Photo Face build must run the shared prefetch/test/export script; run=%v", build["run"])
	}
	saveIndex, save := findStep("uses", "actions/cache/save@v4")
	cacheInputs(save, ".cache/photo-face-models", `${{ steps.photo-face-model-cache.outputs.cache-primary-key }}`)
	if save["if"] != "always() && steps.photo-face-build.outputs.model_cache_attempted == 'true'" {
		t.Errorf("GitHub model cache must save failed prefetches and skip hot runtimes; if=%v", save["if"])
	}
	if runtimeIndex >= buildIndex || restoreIndex >= buildIndex || saveIndex <= buildIndex {
		t.Errorf("GitHub caches must restore before the build and save model progress afterward: runtime=%d restore=%d build=%d save=%d", runtimeIndex, restoreIndex, buildIndex, saveIndex)
	}

	assertGitLabCache(t, gitlab, "photo-face-image",
		"xdrive-photo-face-runtime-v2-$CI_RUNNER_EXECUTABLE_ARCH",
		[]string{".cache/ci-tools/", ".cache/photo-face-runtime/", ".cache/photo-face-models/"},
	)
	gitlabJob := gitlab["photo-face-image"].(map[string]any)
	gitlabCache := gitlabJob["cache"].(map[string]any)
	if gitlabCache["when"] != "always" || gitlabCache["policy"] != "pull-push" {
		t.Errorf("GitLab Photo Face must restore and save model progress after failures; cache=%v", gitlabCache)
	}
}

func TestPhotoFaceTestsUseMountedBusinessSource(t *testing.T) {
	root := repositoryRoot(t)
	dockerfile := readFile(t, filepath.Join(root, "services", "photo-face-analyzer", "Dockerfile"))
	cachedDockerfile := readFile(t, filepath.Join(root, "services", "photo-face-analyzer", "Dockerfile.cached"))
	testScript := readFile(t, filepath.Join(root, "scripts", "ci", "test-photo-face-image.sh"))

	finalMarker := "FROM runtime AS final"
	finalIndex := strings.Index(dockerfile, finalMarker)
	if finalIndex < 0 {
		t.Fatalf("Photo Face Dockerfile is missing %q", finalMarker)
	}
	runtimeSection := dockerfile[:finalIndex]
	requireRaw(t, "Photo Face runtime image", runtimeSection,
		"FROM python:3.12-slim-bookworm AS dependencies",
		"FROM dependencies AS runtime",
		"ARG XDRIVE_RUNTIME_CONTRACT_HASH=unknown",
		"io.github.lazyxu.xdrive.photo-face.runtime-contract=\"$XDRIVE_RUNTIME_CONTRACT_HASH\"",
		"COPY requirements.txt",
		"COPY fetch_models.py",
		"RUN python fetch_models.py /models /licenses",
	)
	dependenciesIndex := strings.Index(runtimeSection, "FROM dependencies AS runtime")
	if dependenciesIndex < 0 {
		t.Fatal("Photo Face runtime must extend a separate dependencies target")
	}
	if strings.Contains(runtimeSection[:dependenciesIndex], "fetch_models.py") {
		t.Error("Photo Face dependencies target must be buildable before model downloads")
	}
	requireRaw(t, "Photo Face cached runtime image", cachedDockerfile,
		"ARG XDRIVE_RUNTIME_DEPENDENCIES_IMAGE",
		"FROM ${XDRIVE_RUNTIME_DEPENDENCIES_IMAGE} AS runtime",
		"ARG XDRIVE_RUNTIME_CONTRACT_HASH=unknown",
		"io.github.lazyxu.xdrive.photo-face.runtime-contract=\"$XDRIVE_RUNTIME_CONTRACT_HASH\"",
		"COPY models/ /models/",
		"COPY licenses/ /licenses/",
		"COPY fetch_models.py",
		"RUN python fetch_models.py /models /licenses --verify-only",
		"chmod -R a=rX /models /licenses",
	)
	verifiedAssetsIndex := strings.Index(cachedDockerfile, "FROM ${XDRIVE_RUNTIME_DEPENDENCIES_IMAGE} AS verified-assets")
	cachedRuntimeIndex := strings.Index(cachedDockerfile, "FROM ${XDRIVE_RUNTIME_DEPENDENCIES_IMAGE} AS runtime")
	if verifiedAssetsIndex < 0 || cachedRuntimeIndex <= verifiedAssetsIndex {
		t.Fatal("Photo Face cached runtime must copy a separate verified-assets stage")
	}
	requireRaw(t, "Photo Face verified assets stage", cachedDockerfile[verifiedAssetsIndex:cachedRuntimeIndex],
		"RUN python fetch_models.py /models /licenses --verify-only",
		"chmod -R a=rX /models /licenses",
	)
	cachedRuntime := cachedDockerfile[cachedRuntimeIndex:]
	requireRaw(t, "Photo Face exported cached runtime", cachedRuntime,
		"COPY --from=verified-assets /models/ /models/",
		"COPY --from=verified-assets /licenses/ /licenses/",
		"io.github.lazyxu.xdrive.photo-face.runtime-contract=\"$XDRIVE_RUNTIME_CONTRACT_HASH\"",
		"RUN rm -rf /opt/xdrive-photo-face-runtime",
		"WORKDIR /workspace",
	)
	for _, forbidden := range []string{"fetch_models.py", "chmod", "COPY models/", "COPY licenses/"} {
		if strings.Contains(cachedRuntime, forbidden) {
			t.Errorf("Photo Face exported runtime must only copy the verified, permission-normalized assets; found %q", forbidden)
		}
	}
	for label, content := range map[string]string{
		"runtime":        runtimeSection,
		"cached runtime": cachedDockerfile,
	} {
		for _, forbidden := range []string{
			"ARG VERSION",
			"ARG BUILD_COMMIT",
			"COPY analyzer.py",
			"COPY creative.py",
			"COPY tests",
			"RUN python -m unittest",
			"--self-test",
			"--benchmark",
		} {
			if strings.Contains(content, forbidden) {
				t.Errorf("Photo Face %s image must not contain mutable business/test input %q", label, forbidden)
			}
		}
	}

	cacheKeyScript := readFile(t, filepath.Join(root, "scripts", "ci", "photo-face-runtime-cache-key.sh"))
	cacheRegressionTest := readFile(t, filepath.Join(root, "scripts", "ci", "test-photo-face-runtime-cache.sh"))
	githubCI := readFile(t, filepath.Join(root, ".github", "workflows", "ci.yml"))
	gitlabCI := readFile(t, filepath.Join(root, ".gitlab-ci.yml"))
	gitlabServerValidation := readFile(t, filepath.Join(root, "scripts", "ci", "gitlab-server-validation.sh"))
	requireRaw(t, "Photo Face runtime cache identity", cacheKeyScript,
		`sed '/^FROM runtime AS final$/,$d' "$dockerfile"`,
		`cat "$analyzer_dir/Dockerfile.cached"`,
		`cat "$analyzer_dir/requirements.txt"`,
		`cat "$analyzer_dir/fetch_models.py"`,
	)

	requireRaw(t, "Photo Face mounted-source test script", testScript,
		`runtime_contract_hash="$(bash scripts/ci/photo-face-runtime-cache-key.sh)"`,
		`runtime_image="xdrive/photo-face:test-runtime-$runtime_contract_hash"`,
		`dependencies_image="xdrive/photo-face:test-dependencies-$runtime_contract_hash"`,
		`runtime_contract_label="io.github.lazyxu.xdrive.photo-face.runtime-contract"`,
		`runtime_archive="$runtime_cache_dir/$runtime_contract_hash.tar.gz"`,
		`model_cache_dir="${XDRIVE_PHOTO_FACE_MODEL_CACHE_DIR:-$ROOT/.cache/photo-face-models}"`,
		`docker image rm -f "$runtime_image"`,
		`runtime_image_valid()`,
		`docker image inspect --format "{{ index .Config.Labels \"$runtime_contract_label\" }}"`,
		`import cv2; import numpy; import onnxruntime; import tokenizers`,
		`cached runtime image does not match its archive key; rebuilding only $runtime_archive`,
		`gzip -dc "$runtime_archive" | docker load`,
		`--target dependencies`,
		`--target runtime`,
		`--build-arg BUILDKIT_INLINE_CACHE=1`,
		`--build-arg "XDRIVE_RUNTIME_CONTRACT_HASH=$runtime_contract_hash"`,
		`--build-arg "XDRIVE_RUNTIME_DEPENDENCIES_IMAGE=$dependencies_image"`,
		`-f Dockerfile.cached`,
		`tar --exclude='*.part*' --exclude='*.tmp'`,
		`printf 'model_cache_attempted=true\n' >>"$GITHUB_OUTPUT"`,
		`runtime_mount="type=bind,src=$analyzer_dir,dst=/workspace,readonly"`,
		`--mount "$runtime_mount"`,
		`--mount "type=bind,src=$model_cache_dir,dst=/model-cache"`,
		`python /workspace/fetch_models.py /model-cache/models /model-cache/licenses`,
		`HF_ENDPOINT XDRIVE_MODEL_DOWNLOAD_ATTEMPTS XDRIVE_MODEL_DOWNLOAD_TIMEOUT XDRIVE_MODEL_DOWNLOAD_SOURCE_MAX_SECONDS HTTP_PROXY http_proxy HTTPS_PROXY https_proxy NO_PROXY no_proxy`,
		`download_env+=(--env "$name")`,
		`python -m unittest discover -s tests -v`,
		`python analyzer.py --self-test`,
		`python analyzer.py --benchmark --iterations 1`,
		`printf 'FROM %s AS runtime\n' "$runtime_image"`,
		`sed -n '/^FROM runtime AS final$/,$p' "$analyzer_dir/Dockerfile"`,
		`-f "$final_dockerfile"`,
		`--target final`,
		`docker run --rm "$final_image" --self-test`,
		`docker run --rm "$final_image" --benchmark --iterations 1`,
		`bash scripts/ci/export-docker-image.sh "$final_image" "$artifact_dir"`,
	)
	buildLines := strings.Split(strings.ReplaceAll(testScript, "\\\n", ""), "\n")
	for _, target := range []string{"runtime", "final"} {
		found := false
		for _, line := range buildLines {
			if strings.Contains(line, "docker build ") && strings.Contains(line, "--target "+target) {
				found = true
				if !strings.Contains(line, "--network none") {
					t.Errorf("Photo Face %s packaging must disable build networking", target)
				}
			}
		}
		if !found {
			t.Errorf("Photo Face script is missing its %s packaging command", target)
		}
	}
	outputIndex := strings.Index(testScript, `printf 'model_cache_attempted=true\n'`)
	prefetchIndex := strings.Index(testScript, "python /workspace/fetch_models.py")
	if outputIndex < 0 || prefetchIndex < 0 || outputIndex >= prefetchIndex {
		t.Error("Photo Face must report its model-cache attempt before prefetch can fail")
	}
	for _, forbidden := range []string{
		"--target test ",
		"test-stage",
	} {
		if strings.Contains(testScript, forbidden) {
			t.Errorf("Photo Face tests must not rebuild a business-code test image containing %q", forbidden)
		}
	}

	requireRaw(t, "Photo Face runtime cache regression harness", cacheRegressionTest,
		"cold cache must build runtime exactly once",
		"hot cache must restore without rebuilding runtime",
		"hot runtime cache must not require raw model downloads",
		"failed prefetch must preserve partial model downloads",
		"failed prefetch must stop before runtime or final image export",
		"poisoned current-hash archive must be evicted and rebuilt",
		"dependency hash change must build a distinct runtime image",
	)
	requireRaw(t, "GitHub Photo Face runtime cache", githubCI,
		`bash scripts/ci/photo-face-runtime-cache-key.sh`,
		`bash scripts/ci/test-photo-face-runtime-cache.sh`,
		`path: .cache/photo-face-runtime`,
		`photo-face-runtime-v2-${{ runner.os }}-${{ steps.photo-face-runtime-cache.outputs.hash }}`,
	)
	requireRaw(t, "GitLab Photo Face runtime cache", gitlabCI,
		`key: "xdrive-photo-face-runtime-v2-$CI_RUNNER_EXECUTABLE_ARCH"`,
		`- .cache/photo-face-runtime/`,
		`- .cache/photo-face-models/`,
	)
	requireRaw(t, "GitLab Photo Face runtime cache regression harness", gitlabServerValidation,
		"bash scripts/ci/test-photo-face-runtime-cache.sh",
	)
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
