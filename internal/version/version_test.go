package version

import (
	"encoding/base64"
	"testing"
)

func TestMetadataDecodesCommitMessage(t *testing.T) {
	oldVersion, oldChannel, oldCommit := Version, Channel, Commit
	oldMessage, oldCommitTime, oldBuildTime := CommitMessageBase64, CommitTime, BuildTime
	t.Cleanup(func() {
		Version, Channel, Commit = oldVersion, oldChannel, oldCommit
		CommitMessageBase64, CommitTime, BuildTime = oldMessage, oldCommitTime, oldBuildTime
	})

	Version = "snapshot"
	Channel = "master"
	Commit = "abcdef1234567890"
	CommitMessageBase64 = base64.StdEncoding.EncodeToString([]byte("feat: add server metadata"))
	CommitTime = "2026-09-27T13:00:00Z"
	BuildTime = "2026-09-27T13:05:00Z"

	info := Metadata()
	if info.Version != Version || info.Channel != Channel || info.Commit != Commit {
		t.Fatalf("metadata=%+v", info)
	}
	if info.CommitMessage != "feat: add server metadata" {
		t.Fatalf("commit message=%q", info.CommitMessage)
	}
	if info.CommitTime != CommitTime || info.BuildTime != BuildTime {
		t.Fatalf("timestamps=%+v", info)
	}
}
