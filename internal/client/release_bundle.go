package client

// An authenticated current-Server Bundle is an optional download origin, never
// permission to force a client to match the Server or to install unsigned bytes.
import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var bundleFullCommit = regexp.MustCompile(`^[a-f0-9]{40}$`)
var bundleFullDigest = regexp.MustCompile(`^[a-f0-9]{64}$`)
var bundlePackageName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+-]{0,180}$`)

type ReleaseBundleArtifact struct {
	Platform string `json:"platform"`
	Filename string `json:"filename"`
	BuildCommit string `json:"build_commit"`
	SHA256 string `json:"sha256"`
	Size int64 `json:"size"`
	Cached bool `json:"cached"`
	CacheStatus string `json:"cache_status"`
	Sources struct {
		GitLab string `json:"gitlab"`
		GitHub string `json:"github"`
	} `json:"sources"`
	DownloadURLs []string `json:"download_urls"`
}

type ReleaseBundleListing struct {
	State string `json:"state"`
	Commit string `json:"commit"`
	Channel string `json:"channel"`
	Artifacts []ReleaseBundleArtifact `json:"artifacts"`
}

// CurrentReleaseBundle returns only the Server's current version. The
// immutable history remains a Host-side audit record, not a selection UI.
func (c *Client) CurrentReleaseBundle(ctx context.Context) (ReleaseBundleListing, error) {
	req, err := c.request(ctx, http.MethodGet, "/api/v1/release-bundles/current", nil)
	if err != nil {
		return ReleaseBundleListing{}, err
	}
	resp, err := c.do(req)
	if err != nil {
		return ReleaseBundleListing{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ReleaseBundleListing{}, responseError(resp)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024+1))
	if err != nil || len(body) > 2*1024*1024 {
		return ReleaseBundleListing{}, errors.New("current Bundle metadata is too large")
	}
	var listing ReleaseBundleListing
	if err := json.Unmarshal(body, &listing); err != nil {
		return ReleaseBundleListing{}, err
	}
	if !bundleFullCommit.MatchString(listing.Commit) || len(listing.Artifacts) > 30 {
		return ReleaseBundleListing{}, errors.New("invalid current Server Bundle identity")
	}
	for _, artifact := range listing.Artifacts {
		if !validCurrentBundleArtifact(listing.Commit, artifact) {
			return ReleaseBundleListing{}, errors.New("invalid current Server Bundle artifact or source")
		}
	}
	return listing, nil
}

func validCurrentBundleArtifact(commit string, artifact ReleaseBundleArtifact) bool {
	if artifact.BuildCommit != commit || !bundlePackageName.MatchString(artifact.Filename) ||
		!bundleFullDigest.MatchString(artifact.SHA256) || artifact.Size <= 0 ||
		artifact.Size > 8*1024*1024*1024 {
		return false
	}
	github := "https://github.com/lazyxu/xdrive/releases/download/bundle-" +
		commit + "/" + url.PathEscape(artifact.Filename)
	gitlab := "http://gitlab.t-fluid.com:1080/api/v4/projects/xuliang%2Fxdrive" +
		"/packages/generic/xdrive-build-packages/sha-" +
		commit + "/" + url.PathEscape(artifact.Filename)
	if artifact.Sources.GitHub != github || artifact.Sources.GitLab != gitlab {
		return false
	}
	sources := []string{gitlab, github}
	if artifact.Cached {
		sources = append([]string{"/api/v1/release-bundles/current/artifacts/" + artifact.Filename}, sources...)
	}
	if len(artifact.DownloadURLs) != len(sources) {
		return false
	}
	for i := range sources {
		if artifact.DownloadURLs[i] != sources[i] {
			return false
		}
	}
	return true
}

func releaseBundleFileMatches(path string, wantSize int64, wantSHA string) bool {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() != wantSize {
		return false
	}
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	defer file.Close()
	h := sha256.New()
	n, err := io.Copy(h, file)
	return err == nil && n == wantSize && hex.EncodeToString(h.Sum(nil)) == wantSHA
}

func releaseBundleDownloadResponse(ctx context.Context, response *http.Response,
	filename, destination string, size int64, digest string) error {
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: HTTP %d", filename, response.StatusCode)
	}
	// Every fallback starts from offset zero. Never splice partial bytes from
	// different origins or expose an unverified executable to the installer.
	tmp := destination + ".part"
	_ = os.Remove(tmp)
	file, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer func() { file.Close(); os.Remove(tmp) }()
	hash := sha256.New()
	count, err := io.Copy(io.MultiWriter(file, hash), io.LimitReader(response.Body, size+1))
	if err != nil {
		return err
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if count != size || hex.EncodeToString(hash.Sum(nil)) != digest {
		return fmt.Errorf("%s: expected package size or SHA-256 mismatch", filename)
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	_ = os.Remove(destination)
	return os.Rename(tmp, destination)
}

// DownloadCurrentReleaseArtifact prefers verified Server cache, then attempts
// the exact-commit GitLab package and immutable GitHub Bundle asset. Missing
// cache or any failed mirror is noncritical to the Server. The local session
// credential is sent only to this authenticated Server; never to fallbacks.
func (c *Client) DownloadCurrentReleaseArtifact(
	ctx context.Context, commit string, expected ReleaseBundleArtifact, destination string,
) error {
	if !bundleFullCommit.MatchString(commit) || !validCurrentBundleArtifact(commit, expected) {
		return errors.New("invalid expected current Bundle")
	}
	listing, err := c.CurrentReleaseBundle(ctx)
	if err != nil {
		return err
	}
	if listing.Commit != commit {
		return errors.New("Server Bundle advanced since client update selection")
	}
	found := false
	var artifact ReleaseBundleArtifact
	for _, current := range listing.Artifacts {
		if current.Filename == expected.Filename && current.Platform == expected.Platform &&
			current.SHA256 == expected.SHA256 && current.Size == expected.Size {
			found, artifact = true, current
			break
		}
	}
	if !found {
		return errors.New("Server Bundle no longer contains the selected exact-commit package")
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
		return err
	}
	if releaseBundleFileMatches(destination, artifact.Size, artifact.SHA256) {
		return nil
	}
	var lastErr error
	for _, source := range artifact.DownloadURLs {
		if err := ctx.Err(); err != nil {
			return err
		}
		var request *http.Request
		if strings.HasPrefix(source, "/api/v1/") {
			request, err = c.request(ctx, http.MethodGet, source, nil)
		} else {
			request, err = http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
		}
		if err != nil {
			lastErr = err
			continue
		}
		request.Header.Set("Accept-Encoding", "identity")
		request.Header.Set("User-Agent", "xdrive-client-bundle/1")
		var response *http.Response
		if strings.HasPrefix(source, "/api/v1/") {
			response, err = c.do(request)
		} else {
			// External CDN mirror must never receive the Owner bearer or
			// device credentials; compare against immutable expected digest.
			response, err = http.DefaultClient.Do(request)
		}
		if err != nil {
			lastErr = err
			continue
		}
		if err = releaseBundleDownloadResponse(ctx, response, artifact.Filename,
			destination, artifact.Size, artifact.SHA256); err != nil {
			lastErr = err
			continue
		}
		return nil
	}
	return fmt.Errorf("all current-commit Release Bundle sources failed: %w", lastErr)
}
