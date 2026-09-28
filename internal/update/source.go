package update

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/lazyxu/xdrive/internal/version"
)

var gitLabReleaseCommitMarker = regexp.MustCompile(`(?:^|[^A-Za-z0-9_])XDRIVE_RELEASE_COMMIT=([0-9a-fA-F]{40})(?:$|[^A-Za-z0-9_])`)

const (
	SourceGitHub = "github"
	SourceGitLab = "gitlab"

	defaultGitLabBaseURL = "http://gitlab.t-fluid.com:1080"
	defaultGitLabProject = "xuliang/xdrive"
)

type gitLabRelease struct {
	TagName     string `json:"tag_name"`
	Name        string `json:"name"`
	Description string `json:"description"`
	ReleasedAt  string `json:"released_at"`
	Commit      struct {
		ID string `json:"id"`
	} `json:"commit"`
	Assets struct {
		Links []struct {
			Name           string `json:"name"`
			URL            string `json:"url"`
			DirectAssetURL string `json:"direct_asset_url"`
		} `json:"links"`
	} `json:"assets"`
}

type gitLabCommit struct {
	ID string `json:"id"`
}

func NormalizeSource(source string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case "", SourceGitHub:
		return SourceGitHub, nil
	case SourceGitLab:
		return SourceGitLab, nil
	default:
		return "", fmt.Errorf("invalid update source %q; expected github or gitlab", source)
	}
}

func AutomaticSource() (string, error) {
	return NormalizeSource(os.Getenv("XD_UPDATE_SOURCE"))
}

func CheckPlatformTargetFromSource(ctx context.Context, current, channel, source string) (Result, error) {
	return CheckAssetTargetFromSource(ctx, current, platformAssetName(), channel, source)
}

func CheckAssetTargetFromSource(ctx context.Context, current, assetName, channel, source string) (Result, error) {
	normalized, err := NormalizeSource(source)
	if err != nil {
		return Result{Current: current}, err
	}
	if normalized == SourceGitHub {
		return DefaultChecker().CheckTarget(ctx, current, assetName, channel)
	}
	return checkGitLabTarget(ctx, current, assetName, channel)
}

func InstallTargetFromSourceWithProgress(ctx context.Context, current, channel, source string, progress ProgressFunc) (bool, Result, error) {
	normalizedChannel, err := NormalizeChannel(channel)
	if err != nil {
		return false, Result{Current: current}, err
	}
	normalizedSource, err := NormalizeSource(source)
	if err != nil {
		return false, Result{Current: current}, err
	}
	reportProgress(progress, ProgressEvent{
		Step: 1, Stage: "check",
		Message: fmt.Sprintf("checking %s channel from %s via %s", normalizedChannel, current, normalizedSource),
	})
	result, err := CheckAssetTargetFromSource(ctx, current, platformAssetName(), normalizedChannel, normalizedSource)
	if err != nil {
		return false, result, err
	}
	if !result.UpdateAvailable {
		reportProgress(progress, ProgressEvent{
			Step: 1, Stage: "check",
			Message: fmt.Sprintf("%s is current on %s channel via %s", current, normalizedChannel, normalizedSource),
		})
		return false, result, nil
	}
	message := fmt.Sprintf("update available: %s -> %s", current, result.Latest)
	if result.Asset.Size > 0 {
		message += fmt.Sprintf(" | %s %s", result.Asset.Name, formatBytes(float64(result.Asset.Size)))
	}
	reportProgress(progress, ProgressEvent{Step: 1, Stage: "check", Message: message})

	cache, err := os.UserCacheDir()
	if err != nil {
		cache = os.TempDir()
	}
	dir := filepath.Join(cache, "xdrive", "updates", result.Latest)
	downloadChecker := DefaultChecker()
	pathname, err := DownloadVerifiedWithProgress(ctx, downloadChecker, result, dir, progress)
	if err != nil {
		return false, result, err
	}
	reportProgress(progress, ProgressEvent{Step: 5, Stage: "install", Message: "starting platform installer"})
	installMessage, err := installDownloaded(ctx, pathname, result)
	if err != nil {
		return false, result, err
	}
	if strings.TrimSpace(installMessage) == "" {
		installMessage = "platform installer accepted"
	}
	reportProgress(progress, ProgressEvent{Step: 5, Stage: "install", Message: installMessage})
	return true, result, nil
}

func checkGitLabTarget(ctx context.Context, current, assetName, channel string) (Result, error) {
	channel, err := NormalizeChannel(channel)
	if err != nil {
		return Result{Current: current}, err
	}
	result := Result{Current: current, Channel: channel}
	checker := DefaultChecker()
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("XD_UPDATE_GITLAB_BASE_URL")), "/")
	if base == "" {
		base = defaultGitLabBaseURL
	}
	project := strings.Trim(strings.TrimSpace(os.Getenv("XD_UPDATE_GITLAB_PROJECT")), "/")
	if project == "" {
		project = defaultGitLabProject
	}
	projectAPI := base + "/api/v4/projects/" + url.PathEscape(project)

	var release gitLabRelease
	switch channel {
	case ChannelStable:
		releases, err := gitLabReleases(ctx, checker, projectAPI, current)
		if err != nil {
			return result, err
		}
		found := false
		for _, candidate := range releases {
			tag := strings.TrimSpace(candidate.TagName)
			if !IsReleaseVersion(tag) {
				continue
			}
			if !found || Compare(tag, release.TagName) > 0 {
				release = candidate
				found = true
			}
		}
		if !found {
			return result, fmt.Errorf("gitlab has no stable vMAJOR.MINOR.PATCH release")
		}
		result.Latest = strings.TrimSpace(release.TagName)
		if IsReleaseVersion(current) {
			result.UpdateAvailable = Compare(result.Latest, current) > 0
		} else {
			result.UpdateAvailable = result.Latest != strings.TrimSpace(current)
		}

	case ChannelMaster:
		var err error
		release, err = gitLabReleaseByTag(ctx, checker, projectAPI, "snapshot", current)
		if err != nil {
			return result, fmt.Errorf("gitlab has no published master snapshot: %w", err)
		}
		result.Latest = "snapshot"
		result.Commit = gitLabReleaseCommit(release)
		if result.Commit == "" {
			return result, fmt.Errorf("gitlab snapshot release does not identify its commit")
		}
		publishedCommit, err := gitLabCommitByRef(ctx, checker, projectAPI, result.Commit, current)
		if err != nil {
			return result, fmt.Errorf("gitlab snapshot commit %s is unavailable: %w", result.Commit, err)
		}
		if normalizeFullCommit(publishedCommit.ID) != result.Commit {
			return result, fmt.Errorf("gitlab snapshot commit lookup did not match %s", result.Commit)
		}
		result.UpdateAvailable = !sameSnapshot(current, version.Metadata().Commit, result.Commit)
	}

	result.ReleaseName = strings.TrimSpace(release.Name)
	result.PublishedAt = strings.TrimSpace(release.ReleasedAt)
	result.ReleaseNotes = strings.TrimSpace(release.Description)
	if tag := strings.TrimSpace(release.TagName); tag != "" {
		result.ReleaseURL = strings.TrimRight(base, "/") + "/" + strings.Trim(project, "/") + "/-/releases/" + url.PathEscape(tag)
	}

	for _, link := range release.Assets.Links {
		name := strings.TrimSpace(link.Name)
		raw := strings.TrimSpace(link.DirectAssetURL)
		if raw == "" {
			raw = strings.TrimSpace(link.URL)
		}
		raw = absoluteProviderURL(base, raw)
		asset := Asset{Name: name, ReleaseTag: result.Latest, URL: raw}
		switch name {
		case assetName:
			result.Asset = asset
		case "SHA256SUMS.txt":
			result.Checksums = asset
		}
	}
	if result.UpdateAvailable {
		if len(assetDownloadSources(result.Asset)) == 0 {
			return result, fmt.Errorf("%s channel %s on gitlab does not contain %s", channel, result.Latest, assetName)
		}
		if len(assetDownloadSources(result.Checksums)) == 0 {
			return result, fmt.Errorf("%s channel %s on gitlab does not contain SHA256SUMS.txt", channel, result.Latest)
		}
	}
	return result, nil
}

func gitLabReleases(ctx context.Context, checker Checker, projectAPI, current string) ([]gitLabRelease, error) {
	var releases []gitLabRelease
	if err := checker.getJSONWithRetry(ctx, projectAPI+"/releases?per_page=100", current, "GitLab release metadata", &releases); err != nil {
		return nil, err
	}
	return releases, nil
}

func gitLabReleaseByTag(ctx context.Context, checker Checker, projectAPI, tag, current string) (gitLabRelease, error) {
	var release gitLabRelease
	requestURL := projectAPI + "/releases/" + url.PathEscape(tag)
	if err := checker.getJSONWithRetry(ctx, requestURL, current, "GitLab release metadata", &release); err != nil {
		return release, err
	}
	return release, nil
}

func gitLabCommitByRef(ctx context.Context, checker Checker, projectAPI, ref, current string) (gitLabCommit, error) {
	var commit gitLabCommit
	requestURL := projectAPI + "/repository/commits/" + url.PathEscape(ref)
	if err := checker.getJSONWithRetry(ctx, requestURL, current, "GitLab commit metadata", &commit); err != nil {
		return commit, err
	}
	return commit, nil
}

func gitLabReleaseCommit(release gitLabRelease) string {
	if match := gitLabReleaseCommitMarker.FindStringSubmatch(release.Description); len(match) == 2 {
		return normalizeFullCommit(match[1])
	}
	return normalizeFullCommit(release.Commit.ID)
}

func normalizeFullCommit(value string) string {
	full := strings.ToLower(strings.TrimSpace(value))
	if len(full) != 40 {
		return ""
	}
	for _, r := range full {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')) {
			return ""
		}
	}
	return full
}

func absoluteProviderURL(base, raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err == nil && parsed.IsAbs() {
		return raw
	}
	baseURL, err := url.Parse(strings.TrimRight(base, "/") + "/")
	if err != nil {
		return raw
	}
	ref, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	return baseURL.ResolveReference(ref).String()
}
