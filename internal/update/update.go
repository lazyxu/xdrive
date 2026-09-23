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
)

type Asset struct {
	Name string
	URL  string
}

type Result struct {
	Current         string
	Latest          string
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

func (c Checker) Check(ctx context.Context, current, assetName string) (Result, error) {
	result := Result{Current: current}
	if !IsReleaseVersion(current) {
		return result, nil
	}
	if c.HTTP == nil {
		c.HTTP = http.DefaultClient
	}
	if strings.TrimSpace(c.Repository) == "" {
		c.Repository = defaultRepository
	}
	if strings.TrimSpace(c.APIBase) == "" {
		c.APIBase = defaultAPIBase
	}
	url := fmt.Sprintf("%s/repos/%s/releases/latest", strings.TrimRight(c.APIBase, "/"), c.Repository)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return result, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "xdrive-updater/"+current)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return result, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return result, fmt.Errorf("update check failed: %s", resp.Status)
	}
	var rel releaseResponse
	dec := json.NewDecoder(io.LimitReader(resp.Body, maxMetadataBytes))
	if err := dec.Decode(&rel); err != nil {
		return result, fmt.Errorf("decode release metadata: %w", err)
	}
	result.Latest = strings.TrimSpace(rel.TagName)
	if !IsReleaseVersion(result.Latest) {
		return result, fmt.Errorf("latest release has invalid tag %q", result.Latest)
	}
	result.UpdateAvailable = Compare(result.Latest, current) > 0
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
			return result, fmt.Errorf("release %s does not contain %s", result.Latest, assetName)
		}
		if result.Checksums.URL == "" {
			return result, fmt.Errorf("release %s does not contain SHA256SUMS.txt", result.Latest)
		}
	}
	return result, nil
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
	if !result.UpdateAvailable {
		return "", errors.New("no update is available")
	}
	if checker.HTTP == nil {
		checker.HTTP = http.DefaultClient
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	expected, err := downloadChecksum(ctx, checker.HTTP, result.Checksums.URL, result.Asset.Name, result.Current)
	if err != nil {
		return "", err
	}
	dst := filepath.Join(dir, result.Asset.Name)
	tmp := dst + ".tmp"
	if err := downloadFile(ctx, checker.HTTP, result.Asset.URL, tmp, result.Current); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
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

func downloadFile(ctx context.Context, h *http.Client, url, path, current string) error {
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
	_, copyErr := io.Copy(f, resp.Body)
	closeErr := f.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func CheckLatest(ctx context.Context, current string) (Result, error) {
	return DefaultChecker().Check(ctx, current, platformAssetName())
}

// InstallLatest checks the latest stable release, verifies SHA256SUMS.txt and
// starts/executes the platform installer. The bool is true only when an
// installer was actually started.
func InstallLatest(ctx context.Context, current string) (bool, Result, error) {
	result, err := CheckLatest(ctx, current)
	if err != nil || !result.UpdateAvailable {
		return false, result, err
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		cache = os.TempDir()
	}
	dir := filepath.Join(cache, "xdrive", "updates", result.Latest)
	path, err := DownloadVerified(ctx, DefaultChecker(), result, dir)
	if err != nil {
		return false, result, err
	}
	if err := installDownloaded(ctx, path); err != nil {
		return false, result, err
	}
	return true, result, nil
}
