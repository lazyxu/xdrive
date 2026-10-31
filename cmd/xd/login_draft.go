package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/userconfig"
)

const xdLoginDraftFile = "login-draft.json"
const xdLoginDraftMaxBytes = 2048

// xdLoginDraft is an editable, non-secret hint. It is neither a session nor
// authority to send any cached password or token to a Server.
type xdLoginDraft struct {
	Version  int    `json:"version"`
	Server   string `json:"server"`
	Username string `json:"username"`
}

func validXDLoginUsername(username string) bool {
	return username != "" && len(username) <= 128 &&
		utf8.ValidString(username) && username == strings.TrimSpace(username) &&
		strings.IndexFunc(username, unicode.IsControl) == -1
}

func normalizedXDLoginDraft(value xdLoginDraft) (xdLoginDraft, error) {
	if value.Version != 1 || !validXDLoginUsername(value.Username) {
		return xdLoginDraft{}, errors.New("invalid saved login hints")
	}
	server, err := validateXDHTTPSLoginOrigin(value.Server)
	if err != nil {
		return xdLoginDraft{}, errors.New("invalid saved login hints")
	}
	return xdLoginDraft{Version: 1, Server: server, Username: value.Username}, nil
}

func readXDLoginDraftFromDir(dir string) (xdLoginDraft, error) {
	path := filepath.Join(dir, xdLoginDraftFile)
	info, err := os.Lstat(path)
	if err != nil {
		return xdLoginDraft{}, err
	}
	// Do not load symlinks, special devices or unbounded/untrusted files.
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > xdLoginDraftMaxBytes {
		return xdLoginDraft{}, errors.New("invalid saved login hints file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return xdLoginDraft{}, err
	}
	if len(data) > xdLoginDraftMaxBytes {
		return xdLoginDraft{}, errors.New("oversized saved login hints file")
	}
	var draft xdLoginDraft
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&draft); err != nil {
		return xdLoginDraft{}, errors.New("invalid saved login hints JSON")
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return xdLoginDraft{}, errors.New("saved login hints contain trailing data")
	}
	return normalizedXDLoginDraft(draft)
}

func loadXDLoginDraft() xdLoginDraft {
	dir, err := userconfig.Dir()
	if err != nil {
		return xdLoginDraft{}
	}
	draft, err := readXDLoginDraftFromDir(dir)
	if err != nil {
		// The authenticated config and encrypted session are independent.
		// An absent/corrupt hint must never interfere with the login flow.
		return xdLoginDraft{}
	}
	return draft
}

func saveXDLoginDraftToDir(dir string, draft xdLoginDraft) error {
	normalized, err := normalizedXDLoginDraft(draft)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(normalized)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, "login-draft-*.tmp")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	if err := file.Chmod(0o600); err != nil {
		file.Close()
		return err
	}
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(name, filepath.Join(dir, xdLoginDraftFile))
}

func saveXDLoginDraft(server, username string) error {
	dir, err := userconfig.Dir()
	if err != nil {
		return err
	}
	return saveXDLoginDraftToDir(dir, xdLoginDraft{
		Version: 1, Server: server, Username: username,
	})
}

func clearXDLoginDraft() error {
	dir, err := userconfig.Dir()
	if err != nil {
		return err
	}
	if err := os.Remove(filepath.Join(dir, xdLoginDraftFile)); err != nil &&
		!errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// No implicit username crossing: an explicit *different* Server requires the
// username flag. The password must always be supplied by the caller/OS vault.
func resolveXDLoginTarget(serverInput, usernameInput string, saved xdLoginDraft) (string, string, error) {
	var savedServer, savedUsername string
	if normalized, err := normalizedXDLoginDraft(saved); err == nil {
		savedServer, savedUsername = normalized.Server, normalized.Username
	}
	if serverInput == "" {
		serverInput = savedServer
	}
	server, err := validateXDHTTPSLoginOrigin(serverInput)
	if err != nil {
		return "", "", err
	}
	if usernameInput == "" && server == savedServer {
		usernameInput = savedUsername
	}
	if !validXDLoginUsername(usernameInput) {
		return "", "", fmt.Errorf("--username is required (and must be 1..128 UTF-8 bytes without control characters)")
	}
	return server, usernameInput, nil
}
