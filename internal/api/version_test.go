package api

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	versionpkg "github.com/lazyxu/xdrive/internal/version"
)

func TestVersionEndpointIsPublicAndReturnsBuildMetadata(t *testing.T) {
	oldVersion, oldChannel, oldCommit := versionpkg.Version, versionpkg.Channel, versionpkg.Commit
	oldMessage, oldCommitTime, oldBuildTime := versionpkg.CommitMessageBase64, versionpkg.CommitTime, versionpkg.BuildTime
	t.Cleanup(func() {
		versionpkg.Version, versionpkg.Channel, versionpkg.Commit = oldVersion, oldChannel, oldCommit
		versionpkg.CommitMessageBase64, versionpkg.CommitTime, versionpkg.BuildTime = oldMessage, oldCommitTime, oldBuildTime
	})

	versionpkg.Version = "snapshot-0123456789ab"
	versionpkg.Channel = "master"
	versionpkg.Commit = "0123456789abcdef0123456789abcdef01234567"
	versionpkg.CommitMessageBase64 = base64.StdEncoding.EncodeToString([]byte("feat: server metadata"))
	versionpkg.CommitTime = "2026-09-27T13:00:00Z"
	versionpkg.BuildTime = "2026-09-27T13:05:00Z"

	req := httptest.NewRequest(http.MethodGet, "/api/v1/version", nil)
	res := httptest.NewRecorder()
	(&Server{}).Router().ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
	if res.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("cache-control=%q", res.Header().Get("Cache-Control"))
	}
	var body versionpkg.Info
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Version != versionpkg.Version || body.CommitMessage != "feat: server metadata" || body.BuildTime != versionpkg.BuildTime {
		t.Fatalf("body=%+v", body)
	}
}
