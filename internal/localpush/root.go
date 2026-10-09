package localpush

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

var (
	ErrUnsafeRoot  = errors.New("local push root must be an ordinary, non-symlink directory")
	ErrRootChanged = errors.New("local push root identity changed or is unavailable")
)

type RootGrant struct {
	Server         string    `json:"server"`
	Account        string    `json:"account"`
	SourceID       uint64    `json:"source_id"`
	DeviceID       string    `json:"device_id"`
	RootID         string    `json:"root_id"`
	Path           string    `json:"path"`
	Fingerprint    string    `json:"fingerprint"`
	StrongIdentity bool      `json:"strong_identity"`
	CreatedAt      time.Time `json:"created_at"`
}

// PrepareRootGrant may be called only after a local, user-initiated native
// folder picker. It does not create an xDrive Source, bind a remote Source,
// or authorize a Server request to choose a local path.
func PrepareRootGrant(server, account string, sourceID uint64, deviceID, rootPath string) (RootGrant, error) {
	if strings.TrimSpace(server) == "" || strings.TrimSpace(account) == "" || sourceID == 0 {
		return RootGrant{}, fmt.Errorf("local grant requires server, account and source ID")
	}
	if _, err := uuid.Parse(deviceID); err != nil {
		return RootGrant{}, fmt.Errorf("invalid device ID: %w", err)
	}
	abs, fingerprint, strong, err := inspectRoot(rootPath)
	if err != nil {
		return RootGrant{}, err
	}
	return RootGrant{
		Server: server, Account: account, SourceID: sourceID,
		DeviceID: deviceID, RootID: uuid.NewString(), Path: abs,
		Fingerprint: fingerprint, StrongIdentity: strong,
		CreatedAt: time.Now().UTC(),
	}, nil
}

func inspectRoot(path string) (string, string, bool, error) {
	if !filepath.IsAbs(path) {
		return "", "", false, fmt.Errorf("%w: absolute path required", ErrUnsafeRoot)
	}
	abs := filepath.Clean(path)
	for current := abs; ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil {
			return "", "", false, fmt.Errorf("%w: %v", ErrRootChanged, err)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", "", false, ErrUnsafeRoot
		}
		if current == abs && !info.IsDir() {
			return "", "", false, ErrUnsafeRoot
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
	}
	info, err := os.Lstat(abs)
	if err != nil {
		return "", "", false, fmt.Errorf("%w: %v", ErrRootChanged, err)
	}
	id, strong, err := platformRootIdentity(abs, info)
	if err != nil {
		return "", "", false, err
	}
	sum := sha256.Sum256([]byte("xdrive-local-root-v1\x00" + id))
	return abs, hex.EncodeToString(sum[:]), strong, nil
}

func VerifyRootGrant(grant RootGrant) error {
	if grant.SourceID == 0 || strings.TrimSpace(grant.Server) == "" ||
		strings.TrimSpace(grant.Account) == "" {
		return ErrRootChanged
	}
	if _, err := uuid.Parse(grant.RootID); err != nil {
		return ErrRootChanged
	}
	if _, err := uuid.Parse(grant.DeviceID); err != nil {
		return ErrRootChanged
	}
	if len(grant.Fingerprint) != 64 {
		return ErrRootChanged
	}
	path, fingerprint, strong, err := inspectRoot(grant.Path)
	if err != nil {
		return err
	}
	if path != grant.Path || fingerprint != grant.Fingerprint || strong != grant.StrongIdentity {
		return ErrRootChanged
	}
	return nil
}

func grantFile(configDir, server, account, rootID string) (string, error) {
	parsed, err := uuid.Parse(rootID)
	if err != nil {
		return "", fmt.Errorf("invalid local root ID: %w", err)
	}
	if strings.TrimSpace(configDir) == "" || strings.TrimSpace(server) == "" ||
		strings.TrimSpace(account) == "" {
		return "", errors.New("local root registry scope required")
	}
	scope := sha256.Sum256([]byte(server + "\x00" + account))
	return filepath.Join(configDir, "localpush", hex.EncodeToString(scope[:16]), parsed.String()+".json"), nil
}

// SaveRootGrant stores only the local user-approved path and identity; no
// device secret is put into the JSON. Existing grants cannot be overwritten.
func SaveRootGrant(configDir string, grant RootGrant) error {
	if err := VerifyRootGrant(grant); err != nil {
		return err
	}
	file, err := grantFile(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		return err
	}
	if _, err := os.Stat(file); err == nil {
		return errors.New("local Root grant already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	data, err := json.MarshalIndent(grant, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(file), ".root-grant-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), file); err != nil {
		return err
	}
	return os.Chmod(file, 0o600)
}

func LoadRootGrant(configDir, server, account, rootID string) (RootGrant, error) {
	path, err := grantFile(configDir, server, account, rootID)
	if err != nil {
		return RootGrant{}, err
	}
	f, err := os.Open(path)
	if err != nil {
		return RootGrant{}, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 64<<10+1))
	if err != nil {
		return RootGrant{}, err
	}
	if len(data) > 64<<10 {
		return RootGrant{}, errors.New("local Root grant record is too large")
	}
	var grant RootGrant
	if err := json.Unmarshal(data, &grant); err != nil {
		return RootGrant{}, err
	}
	if grant.Server != server || grant.Account != account || grant.RootID != rootID {
		return RootGrant{}, errors.New("local Root grant belongs to another scope")
	}
	if err := VerifyRootGrant(grant); err != nil {
		return RootGrant{}, err
	}
	return grant, nil
}

func RemoveRootGrant(configDir, server, account, rootID string) error {
	file, err := grantFile(configDir, server, account, rootID)
	if err != nil {
		return err
	}
	if err := os.Remove(file); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
