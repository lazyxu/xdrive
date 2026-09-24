package update

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	defaultRepository = "lazyxu/xdrive"
	defaultAPIBase    = "https://api.github.com"
	maxMetadataBytes  = 2 << 20

	ChannelStable = "stable"
	ChannelMaster = "master"
	ChannelCommit = "commit"
)

type Asset struct {
	ID         int64
	Name       string
	ReleaseTag string
	URL        string
	APIURL     string
	Size       int64
	Digest     string
}

type Result struct {
	Current         string
	Latest          string
	Channel         string
	Commit          string
	UpdateAvailable bool
	Asset           Asset
	Checksums       Asset
}

type Checker struct {
	Repository    string
	APIBase       string
	HTTP          *http.Client
	RetryAttempts int
	RetryBase     time.Duration
}

type releaseResponse struct {
	TagName string `json:"tag_name"`
	Assets  []struct {
		ID                 int64  `json:"id"`
		URL                string `json:"url"`
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
		Size               int64  `json:"size"`
		Digest             string `json:"digest"`
	} `json:"assets"`
}

type refResponse struct {
	Object struct {
		SHA  string `json:"sha"`
		Type string `json:"type"`
	} `json:"object"`
}

type commitResponse struct {
	SHA string `json:"sha"`
}

func DefaultChecker() Checker {
	repo := strings.TrimSpace(os.Getenv("XD_UPDATE_REPOSITORY"))
	if repo == "" {
		repo = defaultRepository
	}
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("XD_UPDATE_API_BASE")), "/")
	if base == "" {
		base = defaultAPIBase
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = http.ProxyFromEnvironment
	transport.DialContext = (&net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
	}).DialContext
	transport.TLSHandshakeTimeout = 10 * time.Second
	transport.ResponseHeaderTimeout = 15 * time.Second
	return Checker{
		Repository:    repo,
		APIBase:       base,
		HTTP:          &http.Client{Transport: transport, Timeout: 20 * time.Second},
		RetryAttempts: 5,
		RetryBase:     2 * time.Second,
	}
}

func IsReleaseVersion(v string) bool {
	_, ok := parseVersion(v)
	return ok && strings.HasPrefix(strings.TrimSpace(v), "v")
}

func IsSnapshotVersion(v string) bool {
	v = strings.TrimSpace(v)
	if !strings.HasPrefix(v, "snapshot-") {
		return false
	}
	sha := strings.TrimPrefix(v, "snapshot-")
	if len(sha) < 7 || len(sha) > 40 {
		return false
	}
	for _, r := range sha {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return false
		}
	}
	return true
}

func DefaultChannel(current string) string {
	switch {
	case IsReleaseVersion(current):
		return ChannelStable
	case IsSnapshotVersion(current):
		return ChannelMaster
	default:
		return ""
	}
}

func NormalizeChannel(channel string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(channel)) {
	case ChannelStable:
		return ChannelStable, nil
	case ChannelMaster, "snapshot":
		return ChannelMaster, nil
	case ChannelCommit:
		return ChannelCommit, nil
	default:
		return "", fmt.Errorf("invalid update channel %q; expected stable, master, or commit", channel)
	}
}

func AutomaticTarget(current string) (string, string, error) {
	channel := ""
	if requested := strings.TrimSpace(os.Getenv("XD_UPDATE_CHANNEL")); requested != "" {
		normalized, err := NormalizeChannel(requested)
		if err != nil {
			return "", "", err
		}
		channel = normalized
	} else {
		channel = DefaultChannel(current)
	}
	commit := strings.TrimSpace(os.Getenv("XD_UPDATE_COMMIT"))
	if channel == ChannelCommit && commit == "" {
		return "", "", fmt.Errorf("commit update channel requires XD_UPDATE_COMMIT")
	}
	return channel, commit, nil
}

func AutomaticChannel(current string) (string, error) {
	channel, _, err := AutomaticTarget(current)
	return channel, err
}

func (c Checker) Check(ctx context.Context, current, assetName string) (Result, error) {
	return c.CheckChannel(ctx, current, assetName, ChannelStable)
}

func (c Checker) CheckChannel(ctx context.Context, current, assetName, channel string) (Result, error) {
	return c.CheckTarget(ctx, current, assetName, channel, "")
}

func (c Checker) CheckTarget(ctx context.Context, current, assetName, channel, commit string) (Result, error) {
	channel, err := NormalizeChannel(channel)
	if err != nil {
		return Result{Current: current}, err
	}
	result := Result{Current: current, Channel: channel}
	c = c.withDefaults()

	var releasePath string
	switch channel {
	case ChannelStable:
		releasePath = "/releases/latest"
	case ChannelMaster:
		releasePath = "/releases/tags/snapshot"
	case ChannelCommit:
		full, err := c.resolveCommit(ctx, commit, current)
		if err != nil {
			return result, err
		}
		result.Commit = full
		releasePath = "/releases/tags/snapshot-" + full[:12]
	}
	rel, err := c.release(ctx, releasePath, current)
	if err != nil {
		return result, err
	}

	switch channel {
	case ChannelStable:
		result.Latest = strings.TrimSpace(rel.TagName)
		if !IsReleaseVersion(result.Latest) {
			return result, fmt.Errorf("latest release has invalid tag %q", result.Latest)
		}
		if IsReleaseVersion(current) {
			result.UpdateAvailable = Compare(result.Latest, current) > 0
		} else {
			result.UpdateAvailable = result.Latest != strings.TrimSpace(current)
		}
	case ChannelMaster:
		sha, err := c.snapshotCommit(ctx, current)
		if err != nil {
			return result, err
		}
		result.Commit = sha
		result.Latest = snapshotVersion(sha)
		result.UpdateAvailable = !sameSnapshot(current, sha)
	case ChannelCommit:
		if err := c.verifySnapshotTag(ctx, result.Commit, current); err != nil {
			return result, err
		}
		result.Latest = snapshotVersion(result.Commit)
		result.UpdateAvailable = !sameSnapshot(current, result.Commit)
	}

	for _, a := range rel.Assets {
		apiURL := strings.TrimSpace(a.URL)
		if a.ID > 0 {
			apiURL = fmt.Sprintf("%s/repos/%s/releases/assets/%d", c.APIBase, c.Repository, a.ID)
		}
		asset := Asset{
			ID: a.ID, Name: a.Name, ReleaseTag: result.Latest,
			URL: a.BrowserDownloadURL, APIURL: apiURL,
			Size: a.Size, Digest: a.Digest,
		}
		switch a.Name {
		case assetName:
			result.Asset = asset
		case "SHA256SUMS.txt":
			result.Checksums = asset
		}
	}
	if result.UpdateAvailable {
		if len(assetDownloadSources(result.Asset)) == 0 {
			return result, fmt.Errorf("%s channel %s does not contain %s", channel, result.Latest, assetName)
		}
		if _, ok := assetSHA256(result.Asset); !ok && len(assetDownloadSources(result.Checksums)) == 0 {
			return result, fmt.Errorf("%s channel %s does not contain a SHA-256 digest or SHA256SUMS.txt", channel, result.Latest)
		}
	}
	return result, nil
}

func (c Checker) withDefaults() Checker {
	if c.HTTP == nil {
		c.HTTP = http.DefaultClient
	}
	if c.RetryAttempts <= 0 {
		c.RetryAttempts = 5
	}
	if c.RetryAttempts > 10 {
		c.RetryAttempts = 10
	}
	if c.RetryBase <= 0 {
		c.RetryBase = 2 * time.Second
	}
	if strings.TrimSpace(c.Repository) == "" {
		c.Repository = defaultRepository
	}
	if strings.TrimSpace(c.APIBase) == "" {
		c.APIBase = defaultAPIBase
	}
	c.APIBase = strings.TrimRight(c.APIBase, "/")
	return c
}

func (c Checker) release(ctx context.Context, path, current string) (releaseResponse, error) {
	var rel releaseResponse
	requestURL := fmt.Sprintf("%s/repos/%s%s", c.APIBase, c.Repository, path)
	if err := c.getJSONWithRetry(ctx, requestURL, current, "release metadata", &rel); err != nil {
		return rel, err
	}
	return rel, nil
}

func (c Checker) getJSONWithRetry(ctx context.Context, requestURL, current, label string, out any) error {
	c = c.withDefaults()
	var lastErr error
	for attempt := 1; attempt <= c.RetryAttempts; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
		if err != nil {
			return err
		}
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("User-Agent", "xdrive-updater/"+current)
		resp, err := c.HTTP.Do(req)
		if err == nil {
			if resp.StatusCode == http.StatusOK {
				decodeErr := json.NewDecoder(io.LimitReader(resp.Body, maxMetadataBytes)).Decode(out)
				_ = resp.Body.Close()
				if decodeErr == nil {
					return nil
				}
				lastErr = fmt.Errorf("decode %s: %w", label, decodeErr)
			} else {
				lastErr = fmt.Errorf("%s request failed: %s", label, resp.Status)
				_ = resp.Body.Close()
				if !retryableStatus(resp.StatusCode) {
					return lastErr
				}
			}
		} else {
			lastErr = err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if attempt < c.RetryAttempts {
			if err := waitRetry(ctx, c.RetryBase, attempt); err != nil {
				return err
			}
		}
	}
	return fmt.Errorf("%s failed after %d attempts via %s: %w; check HTTPS connectivity/HTTPS_PROXY, or configure XD_UPDATE_ASSET_MIRROR for release downloads",
		label, c.RetryAttempts, endpointHost(requestURL), lastErr)
}

func retryableStatus(status int) bool {
	return status == http.StatusRequestTimeout || status == http.StatusTooEarly ||
		status == http.StatusTooManyRequests || status >= http.StatusInternalServerError
}

func waitRetry(ctx context.Context, base time.Duration, attempt int) error {
	multipliers := [...]int{1, 2, 5, 10, 15}
	index := attempt - 1
	if index < 0 {
		index = 0
	}
	if index >= len(multipliers) {
		index = len(multipliers) - 1
	}
	delay := time.Duration(multipliers[index]) * base
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(delay):
		return nil
	}
}

func endpointHost(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return raw
	}
	return parsed.Host
}

func assetSHA256(asset Asset) (string, bool) {
	digest := strings.TrimSpace(asset.Digest)
	if len(digest) != len("sha256:")+64 || !strings.HasPrefix(strings.ToLower(digest), "sha256:") {
		return "", false
	}
	hexDigest := strings.ToLower(strings.TrimPrefix(strings.ToLower(digest), "sha256:"))
	if _, err := hex.DecodeString(hexDigest); err != nil {
		return "", false
	}
	return hexDigest, true
}

func assetDownloadSources(asset Asset) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, 3)
	mirror := strings.TrimRight(strings.TrimSpace(os.Getenv("XD_UPDATE_ASSET_MIRROR")), "/")
	if mirror != "" && asset.ReleaseTag != "" && asset.Name != "" {
		mirrorURL := mirror + "/" + url.PathEscape(asset.ReleaseTag) + "/" + url.PathEscape(asset.Name)
		seen[mirrorURL] = struct{}{}
		out = append(out, mirrorURL)
	}
	for _, raw := range []string{asset.APIURL, asset.URL} {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		if _, ok := seen[raw]; ok {
			continue
		}
		seen[raw] = struct{}{}
		out = append(out, raw)
	}
	return out
}

func validCommitRef(ref string) bool {
	ref = strings.TrimSpace(ref)
	if len(ref) < 7 || len(ref) > 40 {
		return false
	}
	for _, r := range ref {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return false
		}
	}
	return true
}

func snapshotVersion(sha string) string {
	sha = strings.ToLower(strings.TrimSpace(sha))
	if len(sha) > 12 {
		sha = sha[:12]
	}
	return "snapshot-" + sha
}

func (c Checker) resolveCommit(ctx context.Context, commit, current string) (string, error) {
	commit = strings.TrimSpace(commit)
	if !validCommitRef(commit) {
		return "", fmt.Errorf("commit must be 7-40 hexadecimal characters")
	}
	requestURL := fmt.Sprintf("%s/repos/%s/commits/%s", c.APIBase, c.Repository, commit)
	var out commitResponse
	if err := c.getJSONWithRetry(ctx, requestURL, current, "commit metadata", &out); err != nil {
		return "", err
	}
	sha := strings.ToLower(strings.TrimSpace(out.SHA))
	if len(sha) != 40 {
		return "", fmt.Errorf("commit API returned invalid SHA")
	}
	return sha, nil
}

func (c Checker) verifySnapshotTag(ctx context.Context, sha, current string) error {
	tag := "snapshot-" + sha[:12]
	got, err := c.tagCommit(ctx, tag, current)
	if err != nil {
		return fmt.Errorf("commit %s does not have a successful published client build: %w", sha[:12], err)
	}
	if got != sha {
		return fmt.Errorf("snapshot tag %s points to %s instead of %s", tag, got, sha)
	}
	return nil
}

func (c Checker) tagCommit(ctx context.Context, tag, current string) (string, error) {
	requestURL := fmt.Sprintf("%s/repos/%s/git/ref/tags/%s", c.APIBase, c.Repository, tag)
	var ref refResponse
	if err := c.getJSONWithRetry(ctx, requestURL, current, "tag metadata", &ref); err != nil {
		return "", err
	}
	sha := strings.ToLower(strings.TrimSpace(ref.Object.SHA))
	if len(sha) != 40 || ref.Object.Type != "commit" {
		return "", fmt.Errorf("tag %s does not point at a commit", tag)
	}
	return sha, nil
}

func (c Checker) snapshotCommit(ctx context.Context, current string) (string, error) {
	requestURL := fmt.Sprintf("%s/repos/%s/git/ref/tags/snapshot", c.APIBase, c.Repository)
	var ref refResponse
	if err := c.getJSONWithRetry(ctx, requestURL, current, "snapshot metadata", &ref); err != nil {
		return "", err
	}
	sha := strings.ToLower(strings.TrimSpace(ref.Object.SHA))
	if len(sha) != 40 || ref.Object.Type != "commit" {
		return "", fmt.Errorf("snapshot ref does not point at a commit")
	}
	for _, r := range sha {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')) {
			return "", fmt.Errorf("snapshot ref contains invalid commit SHA")
		}
	}
	return sha, nil
}

func sameSnapshot(current, sha string) bool {
	current = strings.TrimSpace(current)
	if !IsSnapshotVersion(current) {
		return false
	}
	currentSHA := strings.ToLower(strings.TrimPrefix(current, "snapshot-"))
	sha = strings.ToLower(strings.TrimSpace(sha))
	return strings.HasPrefix(sha, currentSHA) || strings.HasPrefix(currentSHA, sha)
}

// Compare compares release versions of the form vMAJOR.MINOR.PATCH.
// It returns -1, 0, or 1.
func Compare(a, b string) int {
	av, aok := parseVersion(a)
	bv, bok := parseVersion(b)
	if !aok && !bok {
		return strings.Compare(a, b)
	}
	if !aok {
		return -1
	}
	if !bok {
		return 1
	}
	for i := 0; i < 3; i++ {
		if av[i] < bv[i] {
			return -1
		}
		if av[i] > bv[i] {
			return 1
		}
	}
	return 0
}

func parseVersion(v string) ([3]int64, bool) {
	var out [3]int64
	v = strings.TrimSpace(v)
	if !strings.HasPrefix(v, "v") {
		return out, false
	}
	core := strings.TrimPrefix(v, "v")
	if i := strings.IndexAny(core, "-+"); i >= 0 {
		core = core[:i]
	}
	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return out, false
	}
	for i, p := range parts {
		if p == "" {
			return out, false
		}
		n, err := strconv.ParseInt(p, 10, 64)
		if err != nil || n < 0 {
			return out, false
		}
		out[i] = n
	}
	return out, true
}

func DownloadVerified(ctx context.Context, checker Checker, result Result, dir string) (string, error) {
	return DownloadVerifiedWithProgress(ctx, checker, result, dir, nil)
}

func DownloadVerifiedWithProgress(ctx context.Context, checker Checker, result Result, dir string, progress ProgressFunc) (string, error) {
	if !result.UpdateAvailable {
		return "", errors.New("no update is available")
	}
	checker = checker.withDefaults()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}

	expected, hasDigest := assetSHA256(result.Asset)
	if hasDigest {
		message := "using SHA-256 from release metadata"
		if result.Asset.Size > 0 {
			message += "; installer size " + formatBytes(float64(result.Asset.Size))
		}
		reportProgress(progress, ProgressEvent{Step: 2, Stage: "checksum", Message: message})
	} else {
		reportProgress(progress, ProgressEvent{Step: 2, Stage: "checksum", Message: "release digest unavailable; downloading SHA256SUMS.txt with retry/fallback"})
		var err error
		expected, err = downloadChecksum(ctx, checker, result.Checksums, result.Asset.Name, result.Current, progress)
		if err != nil {
			return "", err
		}
		reportProgress(progress, ProgressEvent{Step: 2, Stage: "checksum", Message: "checksum manifest ready"})
	}

	dst := filepath.Join(dir, result.Asset.Name)
	_ = os.Remove(dst + ".tmp")
	if ok, err := verifyFileSHA256(dst, expected); err == nil && ok {
		reportProgress(progress, ProgressEvent{
			Step: 3, Stage: "download " + result.Asset.Name,
			Message: "verified installer already cached; reusing it",
		})
		return dst, nil
	}

	part := dst + ".part"
	if result.Asset.Size > 0 {
		if info, err := os.Stat(part); err == nil {
			switch {
			case info.Size() > result.Asset.Size:
				_ = os.Remove(part)
			case info.Size() == result.Asset.Size:
				if ok, verifyErr := verifyFileSHA256(part, expected); verifyErr != nil || !ok {
					_ = os.Remove(part)
				}
			}
		}
	}
	if err := downloadFileWithProgress(ctx, checker, result.Asset, part, result.Current, progress); err != nil {
		return "", err
	}

	reportProgress(progress, ProgressEvent{Step: 4, Stage: "verify", Message: "verifying SHA-256"})
	ok, err := verifyFileSHA256(part, expected)
	if err != nil {
		return "", err
	}
	if !ok {
		_ = os.Remove(part)
		return "", fmt.Errorf("checksum mismatch for %s; partial cache removed", result.Asset.Name)
	}
	reportProgress(progress, ProgressEvent{Step: 4, Stage: "verify", Message: "SHA-256 verified"})
	_ = os.Remove(dst)
	if err := os.Rename(part, dst); err != nil {
		return "", err
	}
	return dst, nil
}

func verifyFileSHA256(path, expected string) (bool, error) {
	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return false, err
	}
	actual := hex.EncodeToString(h.Sum(nil))
	return strings.EqualFold(actual, expected), nil
}

func downloadChecksum(ctx context.Context, checker Checker, asset Asset, assetName, current string, progress ProgressFunc) (string, error) {
	checker = checker.withDefaults()
	sources := assetDownloadSources(asset)
	if len(sources) == 0 {
		return "", fmt.Errorf("SHA256SUMS.txt has no download source")
	}

	var lastErr error
	for attempt := 1; attempt <= checker.RetryAttempts; attempt++ {
		for _, source := range sources {
			body, err := downloadSmallAsset(ctx, checker.HTTP, source, asset.APIURL, current)
			if err == nil {
				lastErr = nil
				s := bufio.NewScanner(strings.NewReader(string(body)))
				for s.Scan() {
					fields := strings.Fields(s.Text())
					if len(fields) >= 2 && strings.TrimPrefix(fields[len(fields)-1], "*") == assetName {
						if len(fields[0]) != 64 {
							lastErr = fmt.Errorf("invalid checksum for %s", assetName)
							break
						}
						if _, decodeErr := hex.DecodeString(fields[0]); decodeErr != nil {
							lastErr = fmt.Errorf("invalid checksum for %s", assetName)
							break
						}
						return strings.ToLower(fields[0]), nil
					}
				}
				if scanErr := s.Err(); scanErr != nil {
					lastErr = scanErr
				} else if lastErr == nil {
					lastErr = fmt.Errorf("checksum for %s not found", assetName)
				}
			} else {
				lastErr = err
			}
		}
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		if attempt < checker.RetryAttempts {
			reportProgress(progress, ProgressEvent{
				Step: 2, Stage: "checksum",
				Message: fmt.Sprintf("checksum download failed; retrying attempt %d/%d", attempt+1, checker.RetryAttempts),
			})
			if err := waitRetry(ctx, checker.RetryBase, attempt); err != nil {
				return "", err
			}
		}
	}
	return "", fmt.Errorf("checksum download failed after %d attempts via %s: %w; check HTTPS connectivity/HTTPS_PROXY or XD_UPDATE_ASSET_MIRROR",
		checker.RetryAttempts, sourceHosts(sources), lastErr)
}

func downloadSmallAsset(ctx context.Context, h *http.Client, source, apiURL, current string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "xdrive-updater/"+current)
	req.Header.Set("Accept-Encoding", "identity")
	if source == apiURL {
		req.Header.Set("Accept", "application/octet-stream")
	}
	resp, err := h.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download from %s failed: %s", endpointHost(source), resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxMetadataBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxMetadataBytes {
		return nil, fmt.Errorf("download from %s exceeded metadata limit", endpointHost(source))
	}
	return body, nil
}

func downloadFileWithProgress(ctx context.Context, checker Checker, asset Asset, path, current string, progress ProgressFunc) error {
	checker = checker.withDefaults()
	sources := assetDownloadSources(asset)
	if len(sources) == 0 {
		return fmt.Errorf("%s has no download source", asset.Name)
	}
	downloadClient := *checker.HTTP
	// Metadata requests keep their short timeout, but installer downloads must
	// not use a total transfer deadline. Dial/TLS timeouts still come from the
	// configured transport and cancellation comes from ctx.
	downloadClient.Timeout = 0

	var lastErr error
	for attempt := 1; attempt <= checker.RetryAttempts; attempt++ {
		info, _ := os.Stat(path)
		currentBytes := int64(0)
		if info != nil {
			currentBytes = info.Size()
		}
		if asset.Size > 0 && currentBytes == asset.Size {
			reportProgress(progress, ProgressEvent{
				Step: 3, Stage: "download " + asset.Name,
				Current: currentBytes, Total: asset.Size,
			})
			return nil
		}
		if attempt > 1 {
			reportProgress(progress, ProgressEvent{
				Step: 3, Stage: "download",
				Message: fmt.Sprintf("retrying %s (attempt %d/%d); resume from %s / %s",
					asset.Name, attempt, checker.RetryAttempts,
					formatBytes(float64(currentBytes)), formatExpectedSize(asset.Size)),
			})
		}

		for _, source := range sources {
			lastErr = downloadFileAttempt(ctx, &downloadClient, source, asset.APIURL, path, current, asset, progress)
			if lastErr == nil {
				return nil
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
		}
		if attempt < checker.RetryAttempts {
			if err := waitRetry(ctx, checker.RetryBase, attempt); err != nil {
				return err
			}
		}
	}
	return fmt.Errorf("download %s failed after %d attempts via %s: %w; check HTTPS connectivity/HTTPS_PROXY or XD_UPDATE_ASSET_MIRROR",
		asset.Name, checker.RetryAttempts, sourceHosts(sources), lastErr)
}

func downloadFileAttempt(ctx context.Context, h *http.Client, source, apiURL, path, current string, asset Asset, progress ProgressFunc) error {
	resumeFrom := int64(0)
	if info, err := os.Stat(path); err == nil {
		resumeFrom = info.Size()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "xdrive-updater/"+current)
	req.Header.Set("Accept-Encoding", "identity")
	if source == apiURL {
		req.Header.Set("Accept", "application/octet-stream")
	}
	if resumeFrom > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", resumeFrom))
	}
	resp, err := h.Do(req)
	if err != nil {
		return fmt.Errorf("%s: %w", endpointHost(source), err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusRequestedRangeNotSatisfiable && asset.Size > 0 && resumeFrom == asset.Size {
		return nil
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return fmt.Errorf("%s returned %s", endpointHost(source), resp.Status)
	}
	if source == apiURL && strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "application/json") {
		return fmt.Errorf("%s returned JSON instead of the release asset", endpointHost(source))
	}

	appendMode := resp.StatusCode == http.StatusPartialContent && resumeFrom > 0
	if appendMode {
		if start, total, ok := parseContentRange(resp.Header.Get("Content-Range")); ok {
			if start != resumeFrom {
				return fmt.Errorf("%s resumed at byte %d, expected %d", endpointHost(source), start, resumeFrom)
			}
			if asset.Size > 0 && total > 0 && total != asset.Size {
				return fmt.Errorf("%s reported total %d, release metadata says %d", endpointHost(source), total, asset.Size)
			}
		}
	} else {
		resumeFrom = 0
	}

	flags := os.O_CREATE | os.O_WRONLY
	if appendMode {
		flags |= os.O_APPEND
	} else {
		flags |= os.O_TRUNC
	}
	f, err := os.OpenFile(path, flags, 0o600)
	if err != nil {
		return err
	}

	total := asset.Size
	if total <= 0 {
		if appendMode {
			total = resumeFrom + resp.ContentLength
		} else {
			total = resp.ContentLength
		}
		if total < 0 {
			total = 0
		}
	}
	start := time.Now()
	lastReport := start
	currentBytes := resumeFrom
	lastBytes := resumeFrom
	reportProgress(progress, ProgressEvent{
		Step: 3, Stage: "download " + asset.Name,
		Current: currentBytes, Total: total,
	})

	buf := make([]byte, 256*1024)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			written, writeErr := f.Write(buf[:n])
			currentBytes += int64(written)
			if writeErr != nil {
				_ = f.Close()
				return writeErr
			}
			if written != n {
				_ = f.Close()
				return io.ErrShortWrite
			}
			now := time.Now()
			if now.Sub(lastReport) >= time.Second {
				rate := float64(currentBytes-lastBytes) / now.Sub(lastReport).Seconds()
				reportProgress(progress, ProgressEvent{
					Step: 3, Stage: "download " + asset.Name,
					Current: currentBytes, Total: total, BytesPerSecond: rate, Elapsed: now.Sub(start),
				})
				lastReport = now
				lastBytes = currentBytes
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			_ = f.Close()
			return fmt.Errorf("%s interrupted at %s: %w", endpointHost(source), formatBytes(float64(currentBytes)), readErr)
		}
	}
	if err := f.Close(); err != nil {
		return err
	}
	if total > 0 && currentBytes != total {
		return fmt.Errorf("%s ended at %s / %s", endpointHost(source),
			formatBytes(float64(currentBytes)), formatBytes(float64(total)))
	}
	elapsed := time.Since(start)
	rate := float64(currentBytes - resumeFrom)
	if elapsed > 0 {
		rate /= elapsed.Seconds()
	}
	reportProgress(progress, ProgressEvent{
		Step: 3, Stage: "download " + asset.Name,
		Current: currentBytes, Total: total, BytesPerSecond: rate, Elapsed: elapsed,
	})
	return nil
}

func parseContentRange(value string) (start, total int64, ok bool) {
	var end int64
	if _, err := fmt.Sscanf(strings.TrimSpace(value), "bytes %d-%d/%d", &start, &end, &total); err != nil {
		return 0, 0, false
	}
	return start, total, true
}

func sourceHosts(sources []string) string {
	hosts := make([]string, 0, len(sources))
	seen := map[string]struct{}{}
	for _, source := range sources {
		host := endpointHost(source)
		if _, ok := seen[host]; ok {
			continue
		}
		seen[host] = struct{}{}
		hosts = append(hosts, host)
	}
	return strings.Join(hosts, ", ")
}

func formatExpectedSize(size int64) string {
	if size <= 0 {
		return "unknown"
	}
	return formatBytes(float64(size))
}

func ProbeAssetDownload(ctx context.Context, current string, asset Asset) (string, error) {
	checker := DefaultChecker().withDefaults()
	sources := assetDownloadSources(asset)
	if len(sources) == 0 {
		return "", fmt.Errorf("%s has no download source", asset.Name)
	}
	var lastErr error
	for _, source := range sources {
		started := time.Now()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
		if err != nil {
			return "", err
		}
		req.Header.Set("User-Agent", "xdrive-updater/"+current)
		req.Header.Set("Range", "bytes=0-0")
		if source == asset.APIURL {
			req.Header.Set("Accept", "application/octet-stream")
		}
		resp, err := checker.HTTP.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		_ = resp.Body.Close()
		if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusPartialContent {
			return fmt.Sprintf("%s reachable in %s (HTTP %d)",
				endpointHost(source), time.Since(started).Round(time.Millisecond), resp.StatusCode), nil
		}
		lastErr = fmt.Errorf("%s returned %s", endpointHost(source), resp.Status)
	}
	return "", fmt.Errorf("release asset download path unavailable via %s: %w", sourceHosts(sources), lastErr)
}

func CheckLatest(ctx context.Context, current string) (Result, error) {
	channel, commit, err := AutomaticTarget(current)
	if err != nil {
		return Result{Current: current}, err
	}
	if channel == "" {
		return Result{Current: current}, nil
	}
	return DefaultChecker().CheckTarget(ctx, current, platformAssetName(), channel, commit)
}

func CheckChannel(ctx context.Context, current, channel string) (Result, error) {
	return DefaultChecker().CheckTarget(ctx, current, platformAssetName(), channel, "")
}

func CheckTarget(ctx context.Context, current, channel, commit string) (Result, error) {
	return DefaultChecker().CheckTarget(ctx, current, platformAssetName(), channel, commit)
}

// InstallLatest checks the default channel for the current build, verifies
// the release SHA-256 digest (falling back to SHA256SUMS.txt for legacy
// releases), and starts/executes the platform installer.
func InstallLatest(ctx context.Context, current string) (bool, Result, error) {
	channel, commit, err := AutomaticTarget(current)
	if err != nil {
		return false, Result{Current: current}, err
	}
	if channel == "" {
		return false, Result{Current: current}, nil
	}
	return InstallTarget(ctx, current, channel, commit)
}

func InstallChannel(ctx context.Context, current, channel string) (bool, Result, error) {
	return InstallTarget(ctx, current, channel, "")
}

func InstallTarget(ctx context.Context, current, channel, commit string) (bool, Result, error) {
	return InstallTargetWithProgress(ctx, current, channel, commit, nil)
}

func InstallTargetWithProgress(ctx context.Context, current, channel, commit string, progress ProgressFunc) (bool, Result, error) {
	normalized, err := NormalizeChannel(channel)
	if err != nil {
		return false, Result{Current: current}, err
	}
	checker := DefaultChecker()
	reportProgress(progress, ProgressEvent{
		Step: 1, Stage: "check", Message: fmt.Sprintf("checking %s channel from %s", normalized, current),
	})
	result, err := checker.CheckTarget(ctx, current, platformAssetName(), normalized, commit)
	if err != nil {
		return false, result, err
	}
	if !result.UpdateAvailable {
		reportProgress(progress, ProgressEvent{
			Step: 1, Stage: "check", Message: fmt.Sprintf("%s is current on %s channel", current, normalized),
		})
		return false, result, nil
	}
	message := fmt.Sprintf("update available: %s -> %s", current, result.Latest)
	if result.Asset.Size > 0 {
		message += fmt.Sprintf(" | %s %s", result.Asset.Name, formatBytes(float64(result.Asset.Size)))
	}
	reportProgress(progress, ProgressEvent{
		Step: 1, Stage: "check", Message: message,
	})

	cache, err := os.UserCacheDir()
	if err != nil {
		cache = os.TempDir()
	}
	dir := filepath.Join(cache, "xdrive", "updates", result.Latest)
	path, err := DownloadVerifiedWithProgress(ctx, checker, result, dir, progress)
	if err != nil {
		return false, result, err
	}
	reportProgress(progress, ProgressEvent{Step: 5, Stage: "install", Message: "starting platform installer"})
	if err := installDownloaded(ctx, path); err != nil {
		return false, result, err
	}
	reportProgress(progress, ProgressEvent{Step: 5, Stage: "install", Message: "installer started"})
	return true, result, nil
}
