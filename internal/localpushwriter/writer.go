// Package localpushwriter owns a one-shot, OS-private native file-writer claim.
// A released kernel lock never means that remote SQL/CAS work was cancelled.
package localpushwriter

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
)

var ErrUnavailable = errors.New("local Push native writer claim is unavailable")

// Scope is kept private to the owning Agent. Its fields never enter IPC or JSON.
// Server/account/device/Source identify the permanent slot; changing the Root,
// login, target or original file must not create a replacement first writer.
type Scope struct {
	configDir, rootPath, server, account, sessionID string
	deviceID, rootID, rootFingerprint               string
	originalKey, contentSHA256                      string
	sourceID, revision, targetID                    uint64
}

func (Scope) MarshalJSON() ([]byte, error) { return []byte("{}"), nil }

func NewScope(configDir, rootPath, server, account, sessionID,
	deviceID, rootID, rootFingerprint string, sourceID, revision, targetID uint64,
	originalKey, contentSHA256 string,
) (Scope, error) {
	s := Scope{configDir: configDir, rootPath: rootPath, server: server,
		account: account, sessionID: sessionID, deviceID: deviceID, rootID: rootID,
		rootFingerprint: rootFingerprint, sourceID: sourceID, revision: revision,
		targetID: targetID, originalKey: originalKey, contentSHA256: contentSHA256}
	if !s.valid() {
		return Scope{}, ErrUnavailable
	}
	return s, nil
}

func hexDigest(s string) bool {
	if len(s) != 64 {
		return false
	}
	for i := 0; i < len(s); i++ {
		b := s[i]
		if (b < '0' || b > '9') && (b < 'a' || b > 'f') {
			return false
		}
	}
	return true
}

func privateString(s string) bool {
	return s != "" && len(s) <= 2048 && strings.TrimSpace(s) == s && !strings.ContainsAny(s, "\x00\r\n")
}

func (s Scope) valid() bool {
	if !filepath.IsAbs(s.configDir) || !filepath.IsAbs(s.rootPath) ||
		filepath.Clean(s.configDir) != s.configDir || filepath.Clean(s.rootPath) != s.rootPath ||
		s.sourceID == 0 || s.revision == 0 || s.targetID == 0 ||
		!hexDigest(s.rootFingerprint) || !hexDigest(s.originalKey) || !hexDigest(s.contentSHA256) {
		return false
	}
	for _, v := range []string{s.server, s.account, s.sessionID, s.deviceID, s.rootID} {
		if !privateString(v) {
			return false
		}
	}
	// A private claim must never be created inside a user-selected backup Root,
	// nor may that Root reside inside the Agent's private configuration tree.
	for _, pair := range [][2]string{{s.rootPath, s.configDir}, {s.configDir, s.rootPath}} {
		rel, err := filepath.Rel(pair[0], pair[1])
		if err != nil || rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))) {
			return false
		}
	}
	return true
}

func (s Scope) path() string {
	sum := sha256.Sum256([]byte("xdrive/native-writer-slot-v1\x00" + s.server + "\x00" + s.account + "\x00" + s.deviceID + "\x00" + strconv.FormatUint(s.sourceID, 10)))
	return filepath.Join(s.configDir, "localpush", "native-writers", hex.EncodeToString(sum[:16])+".claim")
}

func (s Scope) marker() string {
	parts := []string{"xdrive/native-writer-evidence-v1", s.server, s.account, s.sessionID, s.deviceID, s.rootID, s.rootFingerprint, strconv.FormatUint(s.sourceID, 10), strconv.FormatUint(s.revision, 10), strconv.FormatUint(s.targetID, 10), s.originalKey, s.contentSHA256}
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return "xdrive-localpush-native-writer-v1 " + hex.EncodeToString(sum[:]) + "\n"
}

func privateDirsSafe(configDir, dir string) bool {
	for _, p := range []string{configDir, filepath.Dir(dir), dir} {
		info, err := os.Lstat(p)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 ||
			(runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
			return false
		}
	}
	return true
}

// Claim holds a live nonblocking kernel lock until the bounded first-file
// Runner finishes. Its disk marker is NEVER removed by Close or cancellation.
// A crash may release the kernel lock but cannot authorize a new writer.
type Claim struct {
	mu   sync.Mutex
	file *os.File
}

// Begin creates a persistent O_EXCL quarantine before any first-file Stage or
// remote bytes. Existing, empty, corrupt or stale markers fail CLOSED.
// The owning Agent must already have checked the current device/Root/Source,
// saved grant and native original; this primitive grants NO such authority.
func Begin(ctx context.Context, s Scope) (*Claim, error) {
	if ctx == nil || ctx.Err() != nil || !s.valid() {
		return nil, ErrUnavailable
	}
	path := s.path()
	dir := filepath.Dir(path)
	// Reject preexisting symlink/junction-like parents BEFORE MkdirAll so the
	// operation cannot accidentally create a directory outside the Agent tree.
	for _, parent := range []string{s.configDir, filepath.Dir(dir), dir} {
		info, err := os.Lstat(parent)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 ||
			(runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
			return nil, ErrUnavailable
		}
	}
	if err := os.MkdirAll(dir, 0o700); err != nil || !privateDirsSafe(s.configDir, dir) {
		return nil, ErrUnavailable
	}
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, ErrUnavailable
	}
	// A failure after exclusive creation is quarantined. Never unlink it.
	claim := &Claim{file: f}
	fail := func() (*Claim, error) { _ = claim.Close(); return nil, ErrUnavailable }
	if err := lockNativeWriter(f); err != nil {
		return fail()
	}
	if _, err := f.WriteString(s.marker()); err != nil {
		return fail()
	}
	if err := f.Sync(); err != nil {
		return fail()
	}
	if runtime.GOOS != "windows" {
		parent, err := os.Open(dir)
		if err != nil {
			return fail()
		}
		syncErr := parent.Sync()
		closeErr := parent.Close()
		if syncErr != nil || closeErr != nil {
			return fail()
		}
	}
	if ctx.Err() != nil || !privateDirsSafe(s.configDir, dir) {
		return fail()
	}
	return claim, nil
}

// Close ends only this process's native lifetime. It intentionally does NOT
// delete the disk claim, mark physical CANCEL, retire Stage/key or complete a
// SourceRun. Those decisions require separately replayable Server evidence.
func (c *Claim) Close() error {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.file == nil {
		return nil
	}
	f := c.file
	c.file = nil
	unlockErr := unlockNativeWriter(f)
	closeErr := f.Close()
	if unlockErr != nil || closeErr != nil {
		return ErrUnavailable
	}
	return nil
}
