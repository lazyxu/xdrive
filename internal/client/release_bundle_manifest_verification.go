package client

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

const currentBundleManifestLimit = 2 << 20

// Published asset identity is obtained from GitHub's Release API (optional audit).
// No Server-provided URL, credential or arbitrary asset ID is accepted here.
type publishedBundleAsset struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	Digest string `json:"digest"`
}

type publishedBundleManifestRecord struct {
	Platform    string `json:"platform"`
	Filename    string `json:"filename"`
	BuildCommit string `json:"build_commit"`
	SHA256      string `json:"sha256"`
	Size        int64  `json:"size"`
	InstallMode string `json:"install_mode"`
	Sources     struct {
		GitLab string `json:"gitlab"`
		GitHub string `json:"github"`
	} `json:"sources"`
}

type publishedBundleManifest struct {
	SchemaVersion int                             `json:"schema_version"`
	Commit        string                          `json:"commit"`
	Channel       string                          `json:"channel"`
	Artifacts     []publishedBundleManifestRecord `json:"artifacts"`
}

// GitHub's binary asset REST endpoint responds with either 200 bytes or a 302
// to an asset CDN. Only the public API->GitHub-owned asset CDN transition is
// permitted. The request has no Owner bearer, Jar or browser session cookies.
func publishedBundleManifestRedirectAllowed(apiBase string, req *http.Request, via []*http.Request) error {
	if apiBase != "https://api.github.com" || len(via) == 0 || len(via) > 3 {
		return fmt.Errorf("unapproved published Bundle asset redirect")
	}
	origin := via[0].URL
	if origin.Scheme != "https" || origin.Hostname() != "api.github.com" || origin.Port() != "" {
		return fmt.Errorf("published Bundle redirect origin is not public GitHub")
	}
	u := req.URL
	if u.Scheme != "https" || u.User != nil || u.Fragment != "" ||
		(u.Port() != "" && u.Port() != "443") {
		return fmt.Errorf("unsafe published Bundle asset redirect")
	}
	switch strings.ToLower(u.Hostname()) {
	case "release-assets.githubusercontent.com", "objects.githubusercontent.com":
		req.Header.Del("Authorization")
		req.Header.Del("Cookie")
		return nil
	default:
		return fmt.Errorf("published Bundle manifest redirected outside approved GitHub asset CDN")
	}
}

func verifyPublishedCurrentBundleManifest(
	ctx context.Context, apiBase string, httpClient *http.Client, commit string,
	selected ReleaseBundleArtifact, manifest publishedBundleAsset, assets []publishedBundleAsset,
) error {
	if manifest.ID <= 0 || manifest.Name != "release-bundle.json" ||
		manifest.Size <= 0 || manifest.Size > currentBundleManifestLimit ||
		!strings.HasPrefix(manifest.Digest, "sha256:") ||
		!bundleFullDigest.MatchString(strings.TrimPrefix(manifest.Digest, "sha256:")) {
		return fmt.Errorf("GitHub Release has no digest-pinned manifest asset")
	}
	if httpClient == nil {
		return fmt.Errorf("public GitHub manifest client is unavailable")
	}
	endpoint := strings.TrimRight(apiBase, "/") + "/repos/lazyxu/xdrive/releases/assets/" +
		strconv.FormatInt(manifest.ID, 10)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/octet-stream")
	req.Header.Set("User-Agent", "xdrive-current-server-native-installer/1")
	download := *httpClient
	download.Jar = nil
	download.CheckRedirect = func(next *http.Request, via []*http.Request) error {
		return publishedBundleManifestRedirectAllowed(apiBase, next, via)
	}
	resp, err := download.Do(req)
	if err != nil {
		return fmt.Errorf("cannot retrieve public GitHub Bundle manifest bytes: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GitHub Bundle manifest asset returned HTTP %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, currentBundleManifestLimit+1))
	if err != nil {
		return fmt.Errorf("cannot read published Bundle manifest: %w", err)
	}
	digest := sha256.Sum256(raw)
	if int64(len(raw)) != manifest.Size ||
		"sha256:"+hex.EncodeToString(digest[:]) != manifest.Digest {
		return fmt.Errorf("public GitHub manifest bytes differ from published Release digest")
	}
	var doc publishedBundleManifest
	if err := json.Unmarshal(raw, &doc); err != nil {
		return fmt.Errorf("invalid published Bundle manifest JSON: %w", err)
	}
	if doc.SchemaVersion != 1 || doc.Commit != commit ||
		(doc.Channel != "master" && doc.Channel != "stable") ||
		len(doc.Artifacts) != len(assets)-1 || len(doc.Artifacts) > 30 {
		return fmt.Errorf("published Bundle manifest identity/inventory is inconsistent")
	}
	published := make(map[string]publishedBundleAsset, len(assets)-1)
	for _, asset := range assets {
		if asset.Name == "release-bundle.json" {
			continue
		}
		if _, exists := published[asset.Name]; exists {
			return fmt.Errorf("duplicate published Bundle asset: %s", asset.Name)
		}
		published[asset.Name] = asset
	}
	seen := make(map[string]bool, len(doc.Artifacts))
	selectedFound := false
	for _, entry := range doc.Artifacts {
		if seen[entry.Filename] {
			return fmt.Errorf("duplicate Bundle manifest artifact: %s", entry.Filename)
		}
		seen[entry.Filename] = true
		packageRecord := ReleaseBundleArtifact{
			Platform: entry.Platform, Filename: entry.Filename,
			BuildCommit: entry.BuildCommit, SHA256: entry.SHA256,
			Size: entry.Size, InstallMode: entry.InstallMode,
			DownloadURLs: []string{entry.Sources.GitLab, entry.Sources.GitHub},
		}
		packageRecord.Sources.GitLab = entry.Sources.GitLab
		packageRecord.Sources.GitHub = entry.Sources.GitHub
		if !validCurrentBundleArtifact(commit, packageRecord) {
			return fmt.Errorf("published manifest contains an unapproved artifact/source")
		}
		public, exists := published[entry.Filename]
		if !exists || public.Size != entry.Size || public.Digest != "sha256:"+entry.SHA256 {
			return fmt.Errorf("published manifest artifact is absent or has a different digest")
		}
		if entry.Filename == selected.Filename {
			if entry.Platform != selected.Platform || entry.BuildCommit != selected.BuildCommit ||
				entry.Size != selected.Size || entry.SHA256 != selected.SHA256 ||
				entry.InstallMode != selected.InstallMode ||
				entry.Sources.GitHub != selected.Sources.GitHub ||
				entry.Sources.GitLab != selected.Sources.GitLab {
				return fmt.Errorf("current Server installer differs from published Bundle manifest")
			}
			selectedFound = true
		}
	}
	if !selectedFound {
		return fmt.Errorf("current Server installer is not present in published Bundle manifest")
	}
	return nil
}
