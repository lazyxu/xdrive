package photointelligence

import (
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

const photoHostTrustAnchorMaxBytes = 4096
const photoHostTrustAnchorDomain = "xdrive.photo.trust-anchor.v1"

var ErrPhotoHostTrustAnchorUnverified = errors.New("photo host trust anchor material unverified")

// PhotoHostTrustAnchorV1 contains only public material. It cannot attest a
// running Server/model, authorize inference, or permit host stop/restart.
// No application runtime currently uses these keys for authentication.
type PhotoHostTrustAnchorV1 struct {
	DeploymentEpoch string
	Revision        uint64
	OperatorKey     ed25519.PublicKey
	MemberKeys      map[string]ed25519.PublicKey
}

func photoHostTrustLowerHex(value string, length int) bool {
	if len(value) != length {
		return false
	}
	for i := range value {
		c := value[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

// ReadPinnedPhotoHostTrustAnchorV1 checks bounded public material read from a
// DEPLOYMENT-OWNED absolute file path against a separately supplied SHA-256
// pin. Both inputs MUST come from operator deployment configuration, NEVER
// an HTTP request or user-provided sync folder. The result is material-only
// evidence, NOT a trusted fleet or model identity.
func ReadPinnedPhotoHostTrustAnchorV1(path, pinnedSHA256 string) (PhotoHostTrustAnchorV1, error) {
	zero := PhotoHostTrustAnchorV1{}
	if path == "" || filepath.Clean(path) != path || !filepath.IsAbs(path) ||
		!photoHostTrustLowerHex(pinnedSHA256, 64) {
		return zero, ErrPhotoHostTrustAnchorUnverified
	}
	before, err := os.Lstat(path)
	if err != nil || !before.Mode().IsRegular() || before.Size() <= 0 ||
		before.Size() > photoHostTrustAnchorMaxBytes ||
		(runtime.GOOS != "windows" && before.Mode().Perm()&0022 != 0) {
		return zero, ErrPhotoHostTrustAnchorUnverified
	}
	file, err := os.Open(path)
	if err != nil {
		return zero, ErrPhotoHostTrustAnchorUnverified
	}
	defer file.Close()
	after, err := file.Stat()
	if err != nil || !after.Mode().IsRegular() || !os.SameFile(before, after) ||
		after.Size() <= 0 || after.Size() > photoHostTrustAnchorMaxBytes {
		return zero, ErrPhotoHostTrustAnchorUnverified
	}
	content, err := io.ReadAll(io.LimitReader(file, photoHostTrustAnchorMaxBytes+1))
	if err != nil || len(content) == 0 || len(content) > photoHostTrustAnchorMaxBytes ||
		int64(len(content)) != after.Size() {
		return zero, ErrPhotoHostTrustAnchorUnverified
	}
	actual := sha256.Sum256(content)
	actualHex := hex.EncodeToString(actual[:])
	if subtle.ConstantTimeCompare([]byte(actualHex), []byte(pinnedSHA256)) != 1 {
		return zero, ErrPhotoHostTrustAnchorUnverified
	}
	return parsePhotoHostTrustAnchorV1(content)
}

// Canonical, trailing-LF, ASCII-only public bundle:
// domain / deployment epoch / operator public key / positive revision /
// member count / sorted "server-id public-key" entries. No private keys.
func parsePhotoHostTrustAnchorV1(raw []byte) (PhotoHostTrustAnchorV1, error) {
	zero := PhotoHostTrustAnchorV1{}
	if len(raw) == 0 || len(raw) > photoHostTrustAnchorMaxBytes || raw[len(raw)-1] != '\n' {
		return zero, ErrPhotoHostTrustAnchorUnverified
	}
	for _, b := range raw {
		if b != '\n' && (b < 0x20 || b > 0x7e) {
			return zero, ErrPhotoHostTrustAnchorUnverified
		}
	}
	lines := strings.Split(string(raw), "\n")
	if len(lines) < 7 || lines[len(lines)-1] != "" ||
		lines[0] != photoHostTrustAnchorDomain ||
		!photoHostTrustLowerHex(lines[1], 32) ||
		!photoHostTrustLowerHex(lines[2], 64) {
		return zero, ErrPhotoHostTrustAnchorUnverified
	}
	revision, err := strconv.ParseUint(lines[3], 10, 64)
	if err != nil || revision == 0 || revision >= 1<<60 || strconv.FormatUint(revision, 10) != lines[3] {
		return zero, ErrPhotoHostTrustAnchorUnverified
	}
	memberCount, err := strconv.Atoi(lines[4])
	if err != nil || memberCount < 1 || memberCount > 32 ||
		strconv.Itoa(memberCount) != lines[4] || len(lines) != 6+memberCount {
		return zero, ErrPhotoHostTrustAnchorUnverified
	}
	operator, _ := hex.DecodeString(lines[2])
	seen := map[string]struct{}{string(operator): {}}
	members := make(map[string]ed25519.PublicKey, memberCount)
	previous := ""
	for _, line := range lines[5 : 5+memberCount] {
		parts := strings.Split(line, " ")
		if len(parts) != 2 || !photoHostTrustLowerHex(parts[0], 32) ||
			!photoHostTrustLowerHex(parts[1], 64) ||
			(previous != "" && parts[0] <= previous) {
			return zero, ErrPhotoHostTrustAnchorUnverified
		}
		key, _ := hex.DecodeString(parts[1])
		if _, reused := seen[string(key)]; reused {
			return zero, ErrPhotoHostTrustAnchorUnverified
		}
		seen[string(key)] = struct{}{}
		members[parts[0]] = ed25519.PublicKey(key)
		previous = parts[0]
	}
	return PhotoHostTrustAnchorV1{
		DeploymentEpoch: lines[1], Revision: revision,
		OperatorKey: ed25519.PublicKey(operator), MemberKeys: members,
	}, nil
}
