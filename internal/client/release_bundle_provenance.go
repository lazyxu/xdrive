package client

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// VerifyCurrentBundlePublisher is an independent public-GitHub provenance
// check before a *user-requested* same-Server-Commit native installation. An
// authenticated Server may offer cache bytes but cannot invent the SHA-256
// trust root. The published immutable Release must agree on ref, size,
// filename, and digest before any package may become executable.
func VerifyCurrentBundlePublisher(ctx context.Context, commit string, item ReleaseBundleArtifact) error {
	httpClient := &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	return verifyCurrentBundlePublisher(ctx, "https://api.github.com", httpClient, commit, item)
}

func verifyCurrentBundlePublisher(
	ctx context.Context, apiBase string, httpClient *http.Client,
	commit string, item ReleaseBundleArtifact,
) error {
	if !bundleFullCommit.MatchString(commit) || !validCurrentBundleArtifact(commit, item) {
		return fmt.Errorf("invalid immutable Server Bundle identity")
	}
	tag := "bundle-" + commit
	fetch := func(path string, into any) error {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet,
			strings.TrimRight(apiBase, "/")+path, nil)
		if err != nil {
			return err
		}
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("User-Agent", "xdrive-current-server-native-installer/1")
		// No Owner bearer/cookie goes to GitHub, even if the request redirects.
		resp, err := httpClient.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("immutable publisher returned HTTP %d", resp.StatusCode)
		}
		limited := io.LimitReader(resp.Body, 2*1024*1024+1)
		body, err := io.ReadAll(limited)
		if err != nil {
			return err
		}
		if len(body) > 2*1024*1024 {
			return fmt.Errorf("immutable publisher metadata exceeds 2 MiB")
		}
		if err := json.Unmarshal(body, into); err != nil {
			return fmt.Errorf("invalid immutable publisher JSON: %w", err)
		}
		return nil
	}
	var ref struct {
		Ref    string `json:"ref"`
		Object struct {
			SHA  string `json:"sha"`
			Type string `json:"type"`
		} `json:"object"`
	}
	if err := fetch("/repos/lazyxu/xdrive/git/ref/tags/"+tag, &ref); err != nil {
		return err
	}
	if ref.Ref != "refs/tags/"+tag || ref.Object.Type != "commit" ||
		ref.Object.SHA != commit {
		return fmt.Errorf("published Bundle tag is not the exact 40-character Server Commit")
	}
	var release struct {
		TagName    string `json:"tag_name"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
		Assets     []struct {
			Name   string `json:"name"`
			Size   int64  `json:"size"`
			Digest string `json:"digest"`
		} `json:"assets"`
	}
	if err := fetch("/repos/lazyxu/xdrive/releases/tags/"+tag, &release); err != nil {
		return err
	}
	if release.TagName != tag || release.Draft || !release.Prerelease ||
		len(release.Assets) < 1 || len(release.Assets) > 31 {
		return fmt.Errorf("invalid immutable Bundle Release identity")
	}
	matches, manifestCount := 0, 0
	for _, asset := range release.Assets {
		if asset.Name == "release-bundle.json" {
			manifestCount++
		}
		if asset.Name == item.Filename {
			matches++
			if asset.Size != item.Size || asset.Digest != "sha256:"+item.SHA256 {
				return fmt.Errorf("published package size or SHA-256 differs from current Server")
			}
		}
	}
	if matches != 1 || manifestCount != 1 {
		return fmt.Errorf("immutable Release is missing exactly one requested package or manifest")
	}
	return nil
}
