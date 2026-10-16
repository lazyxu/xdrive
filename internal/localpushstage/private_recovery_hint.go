package localpushstage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/localpush"
)

const (
	localStageRecoveryRecordVersion = 1
	localStageRecoveryMaxFiles      = 128
	localStageRecoveryMaxBytes      = 4096
)

var errLocalStageRecovery = errors.New("private local Stage recovery hint is unavailable")

// LocalOriginalRecoveryHint is a PRIVATE, non-authoritative local disk hint.
// It only locates a potential historical Stage after Agent restart. A future
// owner-bound Server physical receipt read and fresh native verification are
// both separately required. None of these fields may enter Desktop IPC.
type LocalOriginalRecoveryHint struct {
	Stage        LocalOriginalServerStage `json:"-"`
	RelativePath string                   `json:"-"`
	CreatedAt    time.Time                `json:"-"`
}

type localStageRecoveryDisk struct {
	Version         int       `json:"version"`
	SourceID        uint64    `json:"source_id"`
	Revision        uint64    `json:"revision"`
	DeviceID        string    `json:"device_id"`
	RootID          string    `json:"root_id"`
	RootFingerprint string    `json:"root_fingerprint"`
	StageID         string    `json:"stage_id"`
	RelativePath    string    `json:"relative_path"`
	CurrentPathKey  string    `json:"current_path_key"`
	SnapshotSHA256  string    `json:"snapshot_sha256"`
	SHA256          string    `json:"sha256"`
	Size            int64     `json:"size"`
	CreatedAt       time.Time `json:"created_at"`
}

// The scope key is derived from Server/account, registered device, Root, and
// Source. No local absolute Root path, bearer token, or account is stored in
// the directory name. The private recovery directory must not overlap Root.
func localStageRecoveryDir(configDir string, grant localpush.RootGrant) (string, error) {
	if configDir == "" || grant.SourceID == 0 {
		return "", errLocalStageRecovery
	}
	root, err := filepath.Abs(grant.Path)
	if err != nil {
		return "", errLocalStageRecovery
	}
	config, err := filepath.Abs(configDir)
	if err != nil {
		return "", errLocalStageRecovery
	}
	for _, pair := range [][2]string{{root, config}, {config, root}} {
		relative, err := filepath.Rel(pair[0], pair[1])
		if err != nil {
			return "", errLocalStageRecovery
		}
		if relative == "." || (relative != ".." &&
			!strings.HasPrefix(relative, ".."+string(filepath.Separator))) {
			return "", errLocalStageRecovery
		}
	}
	key := sha256.Sum256([]byte("xdrive-stage-recovery-v1\x00" +
		grant.Server + "\x00" + grant.Account + "\x00" + grant.DeviceID + "\x00" +
		grant.RootID + "\x00" + strconv.FormatUint(grant.SourceID, 10)))
	return filepath.Join(config, "localpush", "stage-recovery", hex.EncodeToString(key[:16])), nil
}

func localStageRecoveryScope(configDir string, grant localpush.RootGrant) (string, error) {
	if err := localpush.VerifyRootGrant(grant); err != nil || !grant.StrongIdentity {
		return "", errLocalStageRecovery
	}
	saved, err := localpush.LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil || saved != grant {
		return "", errLocalStageRecovery
	}
	return localStageRecoveryDir(configDir, grant)
}

func localStageRecoveryValidate(grant localpush.RootGrant, record localStageRecoveryDisk) bool {
	id, err := uuid.Parse(record.StageID)
	if err != nil || id.String() != record.StageID ||
		record.Version != localStageRecoveryRecordVersion ||
		record.SourceID != grant.SourceID || record.Revision == 0 ||
		record.DeviceID != grant.DeviceID || record.RootID != grant.RootID ||
		record.RootFingerprint != grant.Fingerprint ||
		!localPrecommitDigest(record.SHA256) ||
		!localPrecommitDigest(record.SnapshotSHA256) ||
		!localPrecommitDigest(record.CurrentPathKey) ||
		record.Size < 0 || record.Size > localOriginalServerStageMaxBytes ||
		record.CreatedAt.IsZero() || len(record.RelativePath) > 2048 {
		return false
	}
	key, err := localpush.LocalInventoryPathKey(grant, "file", record.RelativePath)
	return err == nil && key == record.CurrentPathKey
}

func localStageRecoveryReadFile(path string, grant localpush.RootGrant) (localStageRecoveryDisk, error) {
	var empty localStageRecoveryDisk
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return empty, errLocalStageRecovery
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		return empty, errLocalStageRecovery
	}
	file, err := os.Open(path)
	if err != nil {
		return empty, errLocalStageRecovery
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, localStageRecoveryMaxBytes+1))
	if err != nil || len(data) > localStageRecoveryMaxBytes {
		return empty, errLocalStageRecovery
	}
	var result localStageRecoveryDisk
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		return empty, errLocalStageRecovery
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) ||
		!localStageRecoveryValidate(grant, result) {
		return empty, errLocalStageRecovery
	}
	return result, nil
}

func localStageRecoveryCheckDirs(dir string) error {
	// Reject preexisting symlink/junction-like directories rather than
	// following a redirect into the user's original data tree.
	for _, part := range []string{filepath.Dir(filepath.Dir(dir)), filepath.Dir(dir), dir} {
		info, err := os.Lstat(part)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return errLocalStageRecovery
		}
		if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
			return errLocalStageRecovery
		}
	}
	return nil
}

func localStageRecoveryFile(dir, stageID string) (string, error) {
	id, err := uuid.Parse(stageID)
	if err != nil || id.String() != stageID {
		return "", errLocalStageRecovery
	}
	return filepath.Join(dir, stageID+".json"), nil
}

// SaveLocalOriginalRecoveryHint atomically records a fully staged original
// BEFORE StageVerifiedNativeOriginalBytes returns success. No CAS, SQL, Run,
// or backup authorization is conferred. Distinct Stage UUIDs survive slot
// replacement; duplicate writes must match immutable provenance EXACTLY.
// This bounded hint set fails closed when 128 unresolved candidates remain.
func SaveLocalOriginalRecoveryHint(ctx context.Context, configDir string,
	grant localpush.RootGrant, stage LocalOriginalServerStage, relativePath string,
) error {
	if ctx == nil || ctx.Err() != nil || stage.SourceID != grant.SourceID ||
		stage.Revision == 0 {
		return errLocalStageRecovery
	}
	dir, err := localStageRecoveryScope(configDir, grant)
	if err != nil {
		return errLocalStageRecovery
	}
	record := localStageRecoveryDisk{
		Version:  localStageRecoveryRecordVersion,
		SourceID: stage.SourceID, Revision: stage.Revision,
		DeviceID: grant.DeviceID, RootID: grant.RootID,
		RootFingerprint: grant.Fingerprint, StageID: stage.StageID,
		RelativePath: relativePath, CurrentPathKey: stage.CurrentPathKey,
		SnapshotSHA256: stage.SnapshotSHA256, SHA256: stage.SHA256,
		Size: stage.Size, CreatedAt: time.Now().UTC(),
	}
	if !localStageRecoveryValidate(grant, record) {
		return errLocalStageRecovery
	}
	dest, err := localStageRecoveryFile(dir, stage.StageID)
	if err != nil {
		return errLocalStageRecovery
	}
	if err := os.MkdirAll(dir, 0o700); err != nil ||
		localStageRecoveryCheckDirs(dir) != nil {
		return errLocalStageRecovery
	}
	if prior, err := localStageRecoveryReadFile(dest, grant); err == nil {
		if prior.SourceID == record.SourceID && prior.Revision == record.Revision &&
			prior.StageID == record.StageID && prior.DeviceID == record.DeviceID &&
			prior.RootID == record.RootID && prior.RootFingerprint == record.RootFingerprint &&
			prior.RelativePath == record.RelativePath &&
			prior.CurrentPathKey == record.CurrentPathKey &&
			prior.SnapshotSHA256 == record.SnapshotSHA256 &&
			prior.SHA256 == record.SHA256 && prior.Size == record.Size {
			return ctx.Err()
		}
		return errLocalStageRecovery
	} else if _, statErr := os.Lstat(dest); statErr == nil || !errors.Is(statErr, os.ErrNotExist) {
		return errLocalStageRecovery
	}
	files, err := os.ReadDir(dir)
	if err != nil || len(files) >= localStageRecoveryMaxFiles {
		return errLocalStageRecovery
	}
	data, err := json.Marshal(record)
	if err != nil || len(data) > localStageRecoveryMaxBytes {
		return errLocalStageRecovery
	}
	tmp, err := os.CreateTemp(dir, ".uncommitted-stage-*.tmp")
	if err != nil {
		return errLocalStageRecovery
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return errLocalStageRecovery
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return errLocalStageRecovery
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return errLocalStageRecovery
	}
	if err := tmp.Close(); err != nil {
		return errLocalStageRecovery
	}
	if err := ctx.Err(); err != nil || localStageRecoveryScopeStillCurrent(configDir, grant) != nil {
		return errLocalStageRecovery
	}
	// Atomic file publication; a power cut after file fsync but before
	// parent directory sync may still lose the hint. No durability claim.
	if err := os.Rename(tmp.Name(), dest); err != nil {
		return errLocalStageRecovery
	}
	return nil
}

func localStageRecoveryScopeStillCurrent(configDir string, grant localpush.RootGrant) error {
	_, err := localStageRecoveryScope(configDir, grant)
	return err
}

func localStageRecoveryLoad(ctx context.Context, configDir string,
	grant localpush.RootGrant, stageID string,
) (LocalOriginalRecoveryHint, error) {
	var empty LocalOriginalRecoveryHint
	if ctx == nil || ctx.Err() != nil {
		return empty, errLocalStageRecovery
	}
	dir, err := localStageRecoveryScope(configDir, grant)
	if err != nil || localStageRecoveryCheckDirs(dir) != nil {
		return empty, errLocalStageRecovery
	}
	path, err := localStageRecoveryFile(dir, stageID)
	if err != nil {
		return empty, errLocalStageRecovery
	}
	disk, err := localStageRecoveryReadFile(path, grant)
	if err != nil || disk.StageID != stageID || ctx.Err() != nil ||
		localStageRecoveryScopeStillCurrent(configDir, grant) != nil {
		return empty, errLocalStageRecovery
	}
	return LocalOriginalRecoveryHint{
		Stage: LocalOriginalServerStage{
			SourceID: disk.SourceID, Revision: disk.Revision,
			StageID: disk.StageID, Size: disk.Size, SHA256: disk.SHA256,
			SnapshotSHA256: disk.SnapshotSHA256, CurrentPathKey: disk.CurrentPathKey,
		},
		RelativePath: disk.RelativePath, CreatedAt: disk.CreatedAt,
	}, nil
}

// ReadLocalOriginalRecoveryHint and ListLocalOriginalRecoveryHints are
// LOCAL disk-only methods, never remotely callable and never a resume queue.
func ReadLocalOriginalRecoveryHint(ctx context.Context, configDir string,
	grant localpush.RootGrant, stageID string,
) (LocalOriginalRecoveryHint, error) {
	return localStageRecoveryLoad(ctx, configDir, grant, stageID)
}

func ListLocalOriginalRecoveryHints(ctx context.Context, configDir string,
	grant localpush.RootGrant,
) ([]LocalOriginalRecoveryHint, error) {
	if ctx == nil || ctx.Err() != nil {
		return nil, errLocalStageRecovery
	}
	dir, err := localStageRecoveryScope(configDir, grant)
	if err != nil {
		return nil, errLocalStageRecovery
	}
	entries, err := os.ReadDir(dir)
	if err != nil || localStageRecoveryCheckDirs(dir) != nil ||
		len(entries) > localStageRecoveryMaxFiles {
		return nil, errLocalStageRecovery
	}
	out := make([]LocalOriginalRecoveryHint, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			return nil, errLocalStageRecovery
		}
		id := strings.TrimSuffix(entry.Name(), ".json")
		record, err := localStageRecoveryLoad(ctx, configDir, grant, id)
		if err != nil {
			return nil, errLocalStageRecovery
		}
		out = append(out, record)
	}
	if ctx.Err() != nil {
		return nil, errLocalStageRecovery
	}
	return out, nil
}
