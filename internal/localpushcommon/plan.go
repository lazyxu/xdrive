// Package localpushcommon defines the file identity handed from the trusted
// owning Agent planner to xDrive's existing resumable upload engine.
// It does not authorize a Source, commit a backup, or replace Server ACLs.
package localpushcommon

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"hash"
	"path"
	"regexp"
	"strconv"
	"strings"
)

var ErrInvalidPlan = errors.New("invalid private local Push upload plan")

var (
	canonicalUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	canonicalHash = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

// Target identifies exactly one existing Node revision or one new file under
// a previously authorized directory. A rename/move is a planner decision,
// never derived from a caller-controlled absolute local pathname.
type Target struct {
	ParentID         uint64
	NodeID           uint64
	ExpectedRevision uint64
	Name             string
}

// Plan must be assembled from an already authenticated Device/Root, verified
// native Inventory and immutable target decision. OperationID is generated ONCE
// and persisted by the planner; never mint a new ID to retry an uncertain file.
type Plan struct {
	Server, Account, OwnerSession     string
	DeviceID, RootID, RootFingerprint string
	SourceID, SourceRevision          uint64
	OperationID                       string
	RelativePath                      string
	NativeIdentityKey                 string
	ContentSHA256                     string
	Size                              int64
	Target                            Target
}

func validField(value string) bool {
	return value != "" && len(value) <= 2048 && strings.TrimSpace(value) == value &&
		!strings.ContainsAny(value, "\x00\r\n")
}

func validRelativePath(value string) bool {
	if value == "" || len(value) > 4096 || path.Clean(value) != value ||
		strings.ContainsAny(value, "\\:\x00\r\n") || strings.HasPrefix(value, "/") {
		return false
	}
	for _, part := range strings.Split(value, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

func (p Plan) Validate() error {
	if !validField(p.Server) || !validField(p.Account) || !validField(p.OwnerSession) ||
		!canonicalUUID.MatchString(p.DeviceID) || !canonicalUUID.MatchString(p.RootID) ||
		!canonicalUUID.MatchString(p.OperationID) ||
		!canonicalHash.MatchString(p.RootFingerprint) ||
		!canonicalHash.MatchString(p.NativeIdentityKey) ||
		!canonicalHash.MatchString(p.ContentSHA256) ||
		p.SourceID == 0 || p.SourceRevision == 0 || p.Size < 0 ||
		!validRelativePath(p.RelativePath) {
		return ErrInvalidPlan
	}
	newFile := p.Target.ParentID != 0 && p.Target.NodeID == 0 && p.Target.ExpectedRevision == 0 &&
		p.Target.Name == path.Base(p.RelativePath) && len(p.Target.Name) <= 255
	update := p.Target.ParentID == 0 && p.Target.NodeID != 0 && p.Target.ExpectedRevision != 0 &&
		p.Target.Name == ""
	if !newFile && !update {
		return ErrInvalidPlan
	}
	return nil
}

func writeField(h hash.Hash, value string) {
	var prefix [8]byte
	binary.BigEndian.PutUint64(prefix[:], uint64(len(value)))
	_, _ = h.Write(prefix[:])
	_, _ = h.Write([]byte(value))
}

// ResumeKey is a stable, non-secret identity for one file operation. SHA-256
// domain separation prevents cross-target/source/session and snapshot reuse.
// This key is NOT an authorization token and never replaces Server ACLs. The
// 24-hour generic UploadSession TTL is not a durable Push checkpoint.
func (p Plan) ResumeKey() (string, error) {
	if err := p.Validate(); err != nil {
		return "", err
	}
	h := sha256.New()
	for _, field := range []string{
		"xdrive/localpush/common-upload/v1",
		p.Server, p.Account, p.OwnerSession, p.DeviceID, p.RootID,
		p.RootFingerprint,
		strconv.FormatUint(p.SourceID, 10), strconv.FormatUint(p.SourceRevision, 10),
		p.OperationID, p.RelativePath, p.NativeIdentityKey, p.ContentSHA256,
		strconv.FormatInt(p.Size, 10),
		strconv.FormatUint(p.Target.ParentID, 10),
		strconv.FormatUint(p.Target.NodeID, 10),
		strconv.FormatUint(p.Target.ExpectedRevision, 10), p.Target.Name,
	} {
		writeField(h, field)
	}
	return "lp2_" + hex.EncodeToString(h.Sum(nil)), nil
}
