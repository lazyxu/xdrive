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
	Platform    string `json:"platform"`
	Filename    string `json:"filename"`
	BuildCommit string `json:"build_commit"`
	SHA256      string `json:"sha256"`
	Size        int64  `json:"size"`
	Cached      bool   `json:"cached"`
	CacheStatus string `json:"cache_status"`
	InstallMode string `json:"install_mode"`
	Sources     struct {
		GitLab string `json:"gitlab"`
		GitHub string `json:"github"`
	} `json:"sources"`
	DownloadURLs []string `json:"download_urls"`
}

type ReleaseBundleListing struct {
	State     string                  `json:"state"`
	Commit    string                  `json:"commit"`
	Channel       string                  `json:"channel"`
	ServerVersion string                  `json:"server_version"`
	Artifacts     []ReleaseBundleArtifact `json:"artifacts"`
}

// RetryCurrentReleaseBundle only requests an independent Host retry. The
// authenticated admin Server endpoint may not redirect or move an Owner
// credential to an unrelated host. A failed cache retry never alters Server.
func (c *Client) RetryCurrentReleaseBundle(ctx context.Context) error {
	req, err := c.request(ctx, http.MethodPost,
		"/api/v1/admin/release-bundles/retry", strings.NewReader("{}"))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	noRedirect := *httpClient
	noRedirect.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	resp, err := noRedirect.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		return responseError(resp)
	}
	return nil
}

// CurrentReleaseBundle returns only the Server's current version. The
// immutable history remains a Host-side audit record, not a selection UI.
func (c *Client) CurrentReleaseBundle(ctx context.Context) (ReleaseBundleListing, error) {
	req, err := c.request(ctx, http.MethodGet, "/api/v1/release-bundles/current", nil)
	if err != nil {
		return ReleaseBundleListing{}, err
	}
	// Bundle metadata is Owner-authenticated. Never let a 301/302/307
	// move its bearer to a different URL, including a subdomain or a
	// cross-origin CDN. No redirect is part of this API contract.
	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	noRedirect := *httpClient
	noRedirect.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	resp, err := noRedirect.Do(req)
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
	// Python's immutable manifest generator percent-encodes '+' as %2B.
	// Unlike PathEscape, QueryEscape matches it for our admitted filename
	// alphabet (letters, digits, dot, underscore, hyphen, plus).
	escapedName := url.QueryEscape(artifact.Filename)
	github := "https://github.com/lazyxu/xdrive/releases/download/bundle-" +
		commit + "/" + escapedName
	gitlab := "http://gitlab.t-fluid.com:1080/api/v4/projects/xuliang%2Fxdrive" +
		"/packages/generic/xdrive-build-packages/sha-" +
		commit + "/" + escapedName
	if artifact.Sources.GitHub != github || artifact.Sources.GitLab != gitlab {
		return false
	}
	sources := []string{gitlab, github}
	if artifact.Cached {
		sources = append([]string{"/api/v1/release-bundles/current/artifacts/" + escapedName}, sources...)
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

// Client package mirrors are not generic HTTP redirects. Authenticated
// Server cache must never redirect, and public release origins may only
// redirect to their own explicitly recognized asset delivery hosts. No
// credentials or cookies are forwarded. The final package still must match
// the exact independent SHA-256 and expected file size.
func releaseBundleRedirectAllowed(source string, req *http.Request, via []*http.Request) bool {
	if len(via) == 0 || len(via) > 3 || strings.HasPrefix(source, "/api/v1/") {
		return false
	}
	original, err := url.Parse(source)
	if err != nil || original.User != nil || req.URL.User != nil {
		return false
	}
	target := req.URL
	host := strings.ToLower(target.Hostname())
	if original.Scheme == "https" && original.Hostname() == "github.com" {
		if target.Scheme != "https" || target.Port() != "" && target.Port() != "443" {
			return false
		}
		switch host {
		case "release-assets.githubusercontent.com", "objects.githubusercontent.com", "github.com":
			return true
		}
		return false
	}
	if original.Scheme == "http" && original.Hostname() == "gitlab.t-fluid.com" && original.Port() == "1080" {
		// GitLab's same-origin release/download redirects are allowed, but
		// no downgrade or jump to LAN, loopback, or another package authority.
		return target.Scheme == "http" && host == "gitlab.t-fluid.com" && target.Port() == "1080"
	}
	return false
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
		// The local authenticated Server may never redirect. GitHub release
		// asset delivery legitimately redirects to release-assets hosts; allow
		// ONLY exact approved mirror destinations, never an arbitrary target.
		h := http.DefaultClient
		if strings.HasPrefix(source, "/api/v1/") && c.HTTP != nil {
			h = c.HTTP
		}
		downloadClient := *h
		downloadClient.Jar = nil // never attach browser/session cookies to a CDN
		downloadClient.CheckRedirect = func(next *http.Request, via []*http.Request) error {
			if !releaseBundleRedirectAllowed(source, next, via) {
				return http.ErrUseLastResponse
			}
			for _, key := range []string{
				"Authorization", "Cookie", "X-XDrive-Device-ID",
				"X-XDrive-Device-Token", "Proxy-Authorization",
			} {
				next.Header.Del(key)
			}
			return nil
		}
		// Installer streams can be large; cancellation remains context-owned.
		// Transport dial/TLS/header timeouts still apply.
		downloadClient.Timeout = 0
		response, err := downloadClient.Do(request)
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
