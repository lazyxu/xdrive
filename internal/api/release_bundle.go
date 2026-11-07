package api

// Release Bundles have no write path from Server or clients. A Host worker
// verifies and atomically publishes the current package set; Server exposes
// bounded, authenticated metadata and byte ranges from a read-only mount.
import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

var releaseBundleCommitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
var releaseBundleNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+-]{0,180}$`)
var releaseBundleHashPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
var releaseBundleAndroidNamePattern = regexp.MustCompile(`^xdrive-android-[1-9][0-9]{0,9}-[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}\.apk$`)

type releaseBundleArtifact struct {
	Platform    string `json:"platform"`
	Filename    string `json:"filename"`
	BuildCommit string `json:"build_commit"`
	Size        int64  `json:"size"`
	SHA256      string `json:"sha256"`
	InstallMode string `json:"install_mode"`
	Sources     struct {
		GitLab string `json:"gitlab"`
		GitHub string `json:"github"`
	} `json:"sources"`
}

type releaseBundleManifest struct {
	SchemaVersion int                     `json:"schema_version"`
	Commit        string                  `json:"commit"`
	Channel       string                  `json:"channel"`
	Artifacts     []releaseBundleArtifact `json:"artifacts"`
}

type releaseBundleState struct {
	Commit    string            `json:"commit"`
	State     string            `json:"state"`
	Artifacts map[string]string `json:"artifacts"`
	Message   string            `json:"message,omitempty"`
}

type releaseBundleItem struct {
	releaseBundleArtifact
	Cached       bool     `json:"cached"`
	DownloadURLs []string `json:"download_urls"`
}

type releaseBundleListing struct {
	State        string              `json:"state"`
	Commit       string              `json:"commit,omitempty"`
	Channel      string              `json:"channel,omitempty"`
	CachedCommit string              `json:"cached_commit,omitempty"`
	Artifacts    []releaseBundleItem `json:"artifacts"`
	Message      string              `json:"message,omitempty"`
}

func readBundleJSON(path string, limit int64, dest any) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > limit {
		return errors.New("invalid release metadata inode")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	return json.NewDecoder(io.LimitReader(file, limit+1)).Decode(dest)
}

func validReleaseBundleManifest(m releaseBundleManifest) bool {
	if m.SchemaVersion != 1 || !releaseBundleCommitPattern.MatchString(m.Commit) ||
		(m.Channel != "master" && m.Channel != "stable") || len(m.Artifacts) > 30 {
		return false
	}
	names := make(map[string]bool)
	platforms := map[string]bool{"ios": true, "android": true, "windows": true,
		"linux": true, "dsm": true, "cli": true}
	for _, a := range m.Artifacts {
		if !platforms[a.Platform] || !releaseBundleNamePattern.MatchString(a.Filename) ||
			names[a.Filename] || a.BuildCommit != m.Commit || a.Size <= 0 ||
			a.Size > 8*1024*1024*1024 || !releaseBundleHashPattern.MatchString(a.SHA256) {
			return false
		}
		names[a.Filename] = true
		if a.InstallMode != "manual" && a.InstallMode != "manual_test_only" {
			return false
		}
		if a.Platform == "android" && (a.InstallMode != "manual" || !releaseBundleAndroidNamePattern.MatchString(a.Filename)) {
			return false
		}
		if a.Sources.GitHub != "https://github.com/lazyxu/xdrive/releases/download/bundle-"+
			m.Commit+"/"+a.Filename {
			return false
		}
		if a.Sources.GitLab != "http://gitlab.t-fluid.com:1080/api/v4/projects/xuliang%2Fxdrive"+
			"/packages/generic/xdrive-build-packages/sha-"+m.Commit+"/"+a.Filename {
			return false
		}
	}
	return true
}

func readReleaseBundleListing(root string) releaseBundleListing {
	result := releaseBundleListing{State: "unavailable", Artifacts: []releaseBundleItem{}}
	if root == "" {
		return result
	}
	var status releaseBundleState
	if readBundleJSON(filepath.Join(root, "status.json"), 16384, &status) == nil {
		switch status.State {
		case "syncing", "paused_for_server", "retry_needed", "ready":
			result.State = status.State
			result.Message = status.Message
		}
	}
	var current struct {
		Commit string `json:"commit"`
	}
	if readBundleJSON(filepath.Join(root, "current.json"), 1024, &current) == nil &&
		releaseBundleCommitPattern.MatchString(current.Commit) {
		result.CachedCommit = current.Commit
	}
	target := status.Commit
	if !releaseBundleCommitPattern.MatchString(target) {
		target = current.Commit
	}
	if !releaseBundleCommitPattern.MatchString(target) {
		return result
	}
	var manifest releaseBundleManifest
	if readBundleJSON(filepath.Join(root, "manifests", target+".json"), 2*1024*1024, &manifest) != nil ||
		manifest.Commit != target || !validReleaseBundleManifest(manifest) {
		result.State = "unavailable"
		return result
	}
	result.Commit, result.Channel = manifest.Commit, manifest.Channel
	for _, artifact := range manifest.Artifacts {
		path := filepath.Join(root, "packages", current.Commit, artifact.Filename)
		cached := current.Commit == target
		if cached {
			info, err := os.Lstat(path)
			cached = err == nil && info.Mode().IsRegular() && info.Size() == artifact.Size
		}
		urls := []string{}
		if cached {
			urls = append(urls, "/api/v1/release-bundles/current/artifacts/"+artifact.Filename)
		}
		urls = append(urls, artifact.Sources.GitLab, artifact.Sources.GitHub)
		result.Artifacts = append(result.Artifacts, releaseBundleItem{
			releaseBundleArtifact: artifact, Cached: cached, DownloadURLs: urls,
		})
	}
	if result.State == "unavailable" && current.Commit == target {
		result.State = "ready"
	}
	return result
}

func (s *Server) releaseBundleStatus(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, readReleaseBundleListing(os.Getenv("XD_RELEASE_BUNDLE_DIR")))
}

func (s *Server) releaseBundleArtifactDownload(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	root := strings.TrimSpace(os.Getenv("XD_RELEASE_BUNDLE_DIR"))
	name := c.Param("name")
	if !releaseBundleNamePattern.MatchString(name) || root == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "release_artifact_unavailable"})
		return
	}
	listing := readReleaseBundleListing(root)
	var match *releaseBundleItem
	for i := range listing.Artifacts {
		if listing.Artifacts[i].Filename == name && listing.Artifacts[i].Cached {
			match = &listing.Artifacts[i]
			break
		}
	}
	if match == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "release_artifact_not_cached"})
		return
	}
	file, err := os.Open(filepath.Join(root, "packages", listing.Commit, name))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "release_artifact_unavailable"})
		return
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || !stat.Mode().IsRegular() || stat.Size() != match.Size {
		c.JSON(http.StatusNotFound, gin.H{"error": "release_artifact_unavailable"})
		return
	}
	c.Header("Content-Disposition", "attachment; filename=\""+name+"\"")
	c.Header("Content-Type", "application/octet-stream")
	c.Header("X-Content-Type-Options", "nosniff")
	http.ServeContent(c.Writer, c.Request, name, time.Time{}, file)
}

func (s *Server) adminRetryReleaseBundle(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s.HostControlDir == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "host_control_unavailable"})
		return
	}
	path := filepath.Join(s.HostControlDir, "release-bundle-retry")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0660)
	if err == nil {
		err = file.Close()
	}
	if err != nil && !os.IsExist(err) {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "release_bundle_retry_unavailable"})
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"state": "queued"})
}
