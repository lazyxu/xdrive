package version

import (
	"encoding/base64"
	"strings"
)

// Build metadata is replaced at build time for release artifacts.
// Development builds intentionally keep Version="dev" and empty metadata.
var (
	Version             = "dev"
	Channel             = "dev"
	Commit              = ""
	CommitMessageBase64 = ""
	CommitTime          = ""
	BuildTime           = ""
)

type Info struct {
	Version       string `json:"version"`
	Channel       string `json:"channel,omitempty"`
	Commit        string `json:"commit,omitempty"`
	CommitMessage string `json:"commit_message,omitempty"`
	CommitTime    string `json:"commit_time,omitempty"`
	BuildTime     string `json:"build_time,omitempty"`
}

func String() string {
	v := strings.TrimSpace(Version)
	if v == "" {
		return "dev"
	}
	return v
}

func Metadata() Info {
	return Info{
		Version:       String(),
		Channel:       normalized(Channel),
		Commit:        normalized(Commit),
		CommitMessage: decodeCommitMessage(CommitMessageBase64),
		CommitTime:    normalized(CommitTime),
		BuildTime:     normalized(BuildTime),
	}
}

func decodeCommitMessage(encoded string) string {
	encoded = strings.TrimSpace(encoded)
	if encoded == "" {
		return ""
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(raw))
}

func normalized(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	return value
}
