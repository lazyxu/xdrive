package synologyui

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

const maxNASShareChoices = 512

var nasVolumeName = regexp.MustCompile("^volume[1-9][0-9]{0,2}$")

// NASShareChoice is a session-scoped read-only candidate, not a Root grant.
type NASShareChoice struct {
	Label       string
	SelectionID string
}

func validNASShareName(name string) bool {
	if name == "" || len(name) > 255 || !utf8.ValidString(name) ||
		strings.HasPrefix(name, ".") || strings.HasPrefix(name, "@") ||
		strings.HasPrefix(name, "#") || strings.EqualFold(name, "homes") ||
		strings.EqualFold(name, "home") ||
		strings.ContainsAny(name, "/\\\x00\r\n") {
		return false
	}
	for _, r := range name {
		if r < 32 || r == 127 {
			return false
		}
	}
	return true
}

// Permission failures and symlinks are rejected; inspecting a directory is
// never an authorization to back it up or to use it as a native Root.
func readableNASDirectory(path string) (os.FileInfo, bool) {
	before, err := os.Lstat(path)
	if err != nil || !before.IsDir() || before.Mode()&os.ModeSymlink != 0 {
		return nil, false
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, false
	}
	_, readErr := f.Readdirnames(1)
	closeErr := f.Close()
	after, statErr := os.Lstat(path)
	if (readErr != nil && !errors.Is(readErr, io.EOF)) || closeErr != nil ||
		statErr != nil || !after.IsDir() || after.Mode()&os.ModeSymlink != 0 ||
		!os.SameFile(before, after) {
		return nil, false
	}
	return after, true
}

// Only immediate readable /volumeN/<share> directories are inventoried.
// Production uses "/" as root; no browser-supplied path is accepted.
func enumerateNASShareChoices(
	ctx context.Context, root string, key []byte, principal, cookie, host string,
) ([]NASShareChoice, error) {
	if ctx == nil || ctx.Err() != nil || !filepath.IsAbs(root) ||
		filepath.Clean(root) != root || len(key) != 32 ||
		principal == "" || cookie == "" || host == "" {
		return nil, errors.New("invalid DSM NAS inventory scope")
	}
	volumes, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	choices := make([]NASShareChoice, 0)
	for _, volume := range volumes {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if !nasVolumeName.MatchString(volume.Name()) || volume.Type()&os.ModeSymlink != 0 {
			continue
		}
		volumePath := filepath.Join(root, volume.Name())
		if _, ok := readableNASDirectory(volumePath); !ok {
			continue
		}
		entries, err := os.ReadDir(volumePath)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			if !validNASShareName(entry.Name()) || entry.Type()&os.ModeSymlink != 0 {
				continue
			}
			info, ok := readableNASDirectory(filepath.Join(volumePath, entry.Name()))
			if !ok {
				continue
			}
			if len(choices) >= maxNASShareChoices {
				return nil, errors.New("too many readable NAS shares; inventory incomplete")
			}
			label := "/" + volume.Name() + "/" + entry.Name()
			mac := hmac.New(sha256.New, key)
			fmt.Fprintf(mac, "xdrive-dsm-nas-share-v1\x00%s\x00%s\x00%s\x00%s\x00%d\x00%d",
				principal, cookie, host, label, info.Size(), info.ModTime().UnixNano())
			choices = append(choices, NASShareChoice{
				Label: label, SelectionID: hex.EncodeToString(mac.Sum(nil)),
			})
		}
	}
	return choices, nil
}
