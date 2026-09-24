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
	"net/http"
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
	Name string
	URL  string
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
	Repository string
	APIBase    string
	HTTP       *http.Client
}

type releaseResponse struct {
	TagName string `json:"tag_name"`
	Assets  []struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
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
	return Checker{
		Repository: repo,
		APIBase:    base,
		HTTP:       &http.Client{Timeout: 30 * time.Second},
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
		switch a.Name {
		case assetName:
			result.Asset = Asset{Name: a.Name, URL: a.BrowserDownloadURL}
		case "SHA256SUMS.txt":
			result.Checksums = Asset{Name: a.Name, URL: a.BrowserDownloadURL}
		}
	}
	if result.UpdateAvailable {
		if result.Asset.URL == "" {
			return result, fmt.Errorf("%s channel %s does not contain %s", channel, result.Latest, assetName)
		}
		if result.Checksums.URL == "" {
			return result, fmt.Errorf("%s channel %s does not contain SHA256SUMS.txt", channel, result.Latest)
		}
	}
	return result, nil
}

func (c Checker) withDefaults() Checker {
	if c.HTTP == nil {
		c.HTTP = http.DefaultClient
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
	url := fmt.Sprintf("%s/repos/%s%s", c.APIBase, c.Repository, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return rel, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "xdrive-updater/"+current)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return rel, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return rel, fmt.Errorf("update check failed: %s", resp.Status)
	}
	dec := json.NewDecoder(io.LimitReader(resp.Body, maxMetadataBytes))
	if err := dec.Decode(&rel); err != nil {
		return rel, fmt.Errorf("decode release metadata: %w", err)
	}
	return rel, nil
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
	url := fmt.Sprintf("%s/repos/%s/commits/%s", c.APIBase, c.Repository, commit)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "xdrive-updater/"+current)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("commit %s is not available: %s", commit, resp.Status)
	}
	var out commitResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxMetadataBytes)).Decode(&out); err != nil {
		return "", fmt.Errorf("decode commit metadata: %w", err)
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
	url := fmt.Sprintf("%s/repos/%s/git/ref/tags/%s", c.APIBase, c.Repository, tag)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "xdrive-updater/"+current)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("tag %s lookup failed: %s", tag, resp.Status)
	}
	var ref refResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxMetadataBytes)).Decode(&ref); err != nil {
		return "", fmt.Errorf("decode tag ref: %w", err)
	}
	sha := strings.ToLower(strings.TrimSpace(ref.Object.SHA))
	if len(sha) != 40 || ref.Object.Type != "commit" {
		return "", fmt.Errorf("tag %s does not point at a commit", tag)
	}
	return sha, nil
}

func (c Checker) snapshotCommit(ctx context.Context, current string) (string, error) {
	url := fmt.Sprintf("%s/repos/%s/git/ref/tags/snapshot", c.APIBase, c.Repository)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "xdrive-updater/"+current)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("snapshot ref check failed: %s", resp.Status)
	}
	var ref refResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxMetadataBytes)).Decode(&ref); err != nil {
		return "", fmt.Errorf("decode snapshot ref: %w", err)
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

	reportProgress(progress, ProgressEvent{Step: 2, Stage: "checksum", Message: "downloading SHA256SUMS.txt"})
	expected, err := downloadChecksum(ctx, checker.HTTP, result.Checksums.URL, result.Asset.Name, result.Current)
	if err != nil {
		return "", err
	}
	reportProgress(progress, ProgressEvent{Step: 2, Stage: "checksum", Message: "checksum manifest ready"})

	dst := filepath.Join(dir, result.Asset.Name)
	tmp := dst + ".tmp"
	if err := downloadFileWithProgress(ctx, checker.HTTP, result.Asset.URL, tmp, result.Current, result.Asset.Name, progress); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}

	reportProgress(progress, ProgressEvent{Step: 4, Stage: "verify", Message: "verifying SHA-256"})
	f, err := os.Open(tmp)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	_, hashErr := io.Copy(h, f)
	closeErr := f.Close()
	if hashErr != nil {
		return "", hashErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	actual := hex.EncodeToString(h.Sum(nil))
	if !strings.EqualFold(actual, expected) {
		_ = os.Remove(tmp)
		return "", fmt.Errorf("checksum mismatch for %s: got %s want %s", result.Asset.Name, actual, expected)
	}
	reportProgress(progress, ProgressEvent{Step: 4, Stage: "verify", Message: "SHA-256 verified"})
	if err := os.Rename(tmp, dst); err != nil {
		return "", err
	}
	return dst, nil
}

func downloadChecksum(ctx context.Context, h *http.Client, url, assetName, current string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "xdrive-updater/"+current)
	resp, err := h.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download checksums failed: %s", resp.Status)
	}
	s := bufio.NewScanner(io.LimitReader(resp.Body, maxMetadataBytes))
	for s.Scan() {
		fields := strings.Fields(s.Text())
		if len(fields) >= 2 && strings.TrimPrefix(fields[len(fields)-1], "*") == assetName {
			if len(fields[0]) != 64 {
				return "", fmt.Errorf("invalid checksum for %s", assetName)
			}
			return strings.ToLower(fields[0]), nil
		}
	}
	if err := s.Err(); err != nil {
		return "", err
	}
	return "", fmt.Errorf("checksum for %s not found", assetName)
}

func downloadFileWithProgress(ctx context.Context, h *http.Client, url, path, current, name string, progress ProgressFunc) error {
	if h == nil {
		h = http.DefaultClient
	}
	downloadClient := *h
	// Metadata requests keep their short timeout, but a large installer must not
	// inherit that as a total transfer deadline. Cancellation still comes from ctx.
	downloadClient.Timeout = 0

	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		if attempt > 1 {
			reportProgress(progress, ProgressEvent{
				Step: 3, Stage: "download", Message: fmt.Sprintf("retrying %s (attempt %d/3)", name, attempt),
			})
		}
		lastErr = downloadFileAttempt(ctx, &downloadClient, url, path, current, name, progress)
		if lastErr == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if attempt < 3 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(attempt) * time.Second):
			}
		}
	}
	return lastErr
}

func downloadFileAttempt(ctx context.Context, h *http.Client, url, path, current, name string, progress ProgressFunc) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "xdrive-updater/"+current)
	resp, err := h.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download update failed: %s", resp.Status)
	}

	f, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}

	total := resp.ContentLength
	if total < 0 {
		total = 0
	}
	start := time.Now()
	lastReport := start
	var currentBytes int64
	var lastBytes int64
	reportProgress(progress, ProgressEvent{Step: 3, Stage: "download " + name, Total: total})

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
					Step: 3, Stage: "download " + name,
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
			return readErr
		}
	}

	if err := f.Close(); err != nil {
		return err
	}
	elapsed := time.Since(start)
	rate := float64(currentBytes)
	if elapsed > 0 {
		rate /= elapsed.Seconds()
	}
	reportProgress(progress, ProgressEvent{
		Step: 3, Stage: "download " + name,
		Current: currentBytes, Total: total, BytesPerSecond: rate, Elapsed: elapsed,
	})
	return nil
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
// SHA256SUMS.txt and starts/executes the platform installer.
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
	reportProgress(progress, ProgressEvent{
		Step: 1, Stage: "check", Message: fmt.Sprintf("update available: %s -> %s", current, result.Latest),
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
