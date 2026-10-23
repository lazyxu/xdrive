//go:build linux || windows

package localpush

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/lazyxu/xdrive/internal/localpushcommon"
)

const maxCommonUploadVersionedPlansPerPath = 4096

// The immutable operation name deliberately excludes the file's content hash:
// two different local contents cannot mint separate Operations against the
// same remote Node revision. Only a newly proven committed revision advances.
func commonUploadVersionedName(sourceRevision uint64, target localpushcommon.Target) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf(
		"xdrive/localpush/target-revision-slot/v1\x00%d\x00%d\x00%d\x00%d\x00%s",
		sourceRevision, target.ParentID, target.NodeID, target.ExpectedRevision, target.Name)))
	return "operation-" + hex.EncodeToString(sum[:]) + ".json"
}

// Preserve OS-independent canonical paths for both root and nested files.
// No renderer pathname is accepted and the private journal key is a SHA-256
// digest, never a filesystem directory chosen from an untrusted relative path.
func validCommonUploadVersionedRelativePath(relativePath string) bool {
	if relativePath == "" || len(relativePath) > 4096 ||
		path.Clean(relativePath) != relativePath ||
		strings.HasPrefix(relativePath, "/") ||
		strings.ContainsAny(relativePath, "\\:\x00\r\n") {
		return false
	}
	for _, part := range strings.Split(relativePath, "/") {
		if part == "" || part == "." || part == ".." || len(part) > 255 {
			return false
		}
	}
	return true
}

func commonUploadVersionedPathDir(dir, relativePath string, create bool) (string, error) {
	if !validCommonUploadVersionedRelativePath(relativePath) {
		return "", ErrCommonUploadPlanQuarantined
	}
	sum := sha256.Sum256([]byte("xdrive/localpush/versioned-path/v1\x00" + relativePath))
	subdir := filepath.Join(dir, "path-"+hex.EncodeToString(sum[:]))
	if create {
		if err := os.Mkdir(subdir, 0o700); err != nil && !errors.Is(err, os.ErrExist) {
			return "", ErrCommonUploadPlanQuarantined
		}
	}
	info, err := os.Lstat(subdir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 ||
		(runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
		return "", ErrCommonUploadPlanQuarantined
	}
	return subdir, nil
}

func commonUploadVersionedSlot(dir, relativePath string, sourceRevision uint64,
	target localpushcommon.Target,
) (string, error) {
	if sourceRevision == 0 {
		return "", ErrCommonUploadPlanQuarantined
	}
	subdir, err := commonUploadVersionedPathDir(dir, relativePath, true)
	if err != nil {
		return "", err
	}
	return filepath.Join(subdir, commonUploadVersionedName(sourceRevision, target)), nil
}

// ListVerifiedCommonUploadVersionedPlans opens ONLY the Agent-private records
// for one Root-relative file. All past original Operations stay on disk and
// none is deleted on success. Callers MUST check each relevant record's
// ORIGINAL authenticated SQL receipt before skipping, overwriting, or
// claiming an incrementally completed file. This is not remote Node evidence.
func ListVerifiedCommonUploadVersionedPlans(configDir string, grant RootGrant,
	ownerSession, relativePath string,
) ([]localpushcommon.Plan, error) {
	deny := ErrCommonUploadPlanQuarantined
	if ownerSession == "" || !grant.StrongIdentity {
		return nil, deny
	}
	persisted, err := LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil || !sameLocalIdentityRoot(persisted, grant) {
		return nil, deny
	}
	dir, err := commonUploadPlanJournalDir(configDir, grant)
	if err != nil {
		return nil, deny
	}
	if _, err := os.Lstat(commonUploadPlanSlot(dir, relativePath)); !errors.Is(err, os.ErrNotExist) {
		return nil, deny
	}
	subdir, err := commonUploadVersionedPathDir(dir, relativePath, false)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		// An absent directory is the only permitted empty state.
		// A symlink or invalid permission is never treated as empty.
		_, statErr := os.Lstat(filepath.Join(dir, "path-"+commonUploadVersionedPathHash(relativePath)))
		if errors.Is(statErr, os.ErrNotExist) {
			return nil, nil
		}
		return nil, deny
	}
	entries, err := os.ReadDir(subdir)
	if err != nil || len(entries) > maxCommonUploadVersionedPlansPerPath {
		return nil, deny
	}
	out := make([]localpushcommon.Plan, 0, len(entries))
	seen := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), "operation-") ||
			!strings.HasSuffix(entry.Name(), ".json") {
			return nil, deny
		}
		_, plan, err := readCommonUploadPlanSlot(filepath.Join(subdir, entry.Name()), ownerSession)
		if err != nil || plan.RelativePath != relativePath ||
			plan.Server != grant.Server || plan.Account != grant.Account ||
			plan.DeviceID != grant.DeviceID || plan.RootID != grant.RootID ||
			plan.RootFingerprint != grant.Fingerprint ||
			plan.SourceID != grant.SourceID ||
			entry.Name() != commonUploadVersionedName(plan.SourceRevision, plan.Target) {
			return nil, deny
		}
		if _, exists := seen[plan.OperationID]; exists {
			return nil, deny
		}
		seen[plan.OperationID] = struct{}{}
		out = append(out, plan)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Target.ExpectedRevision != out[j].Target.ExpectedRevision {
			return out[i].Target.ExpectedRevision < out[j].Target.ExpectedRevision
		}
		return out[i].OperationID < out[j].OperationID
	})
	return out, nil
}

func commonUploadVersionedPathHash(relativePath string) string {
	sum := sha256.Sum256([]byte("xdrive/localpush/versioned-path/v1\x00" + relativePath))
	return hex.EncodeToString(sum[:])
}
