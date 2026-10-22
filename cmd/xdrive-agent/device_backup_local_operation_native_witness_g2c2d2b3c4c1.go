package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"strconv"
	"strings"

	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushrunner"
)

// Agent-private, non-serializable evidence correlated to the ORIGINAL
// Operation and native file. It is not independent OS remote attestation.
// A future trusted transport must never set "held=true" from caller input.
type localPushOriginalHeldWitness struct {
	operationID string
	generation  uint64
	stageID     string
	digest      string
}

func (localPushOriginalHeldWitness) MarshalJSON() ([]byte, error) {
	return []byte("{}"), nil
}

func validLocalPushNativeWitnessDigest(value string) bool {
	if len(value) != 64 || value == strings.Repeat("0", 64) {
		return false
	}
	for i := 0; i < len(value); i++ {
		c := value[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// boundOriginalNativeWitnessDigest derives a domain-separated,
// length-prefixed HMAC from the OS-private request key, original SQL
// Operation/Stage, authenticated Owner scope and native file identity.
// Its caller MUST already hold the original OS fd and kernel Writer Claim.
// This is local CORRELATION ONLY: even a matching HMAC does not itself prove
// kernel lock ownership to another machine.
func boundOriginalNativeWitnessDigest(
	key [32]byte, scope localpushrunner.Scope,
	st localpushrunner.Staged, op localpushrunner.Operation,
	native localpush.NativeHeldCurrentOriginal,
) (string, error) {
	if key == ([32]byte{}) ||
		!validLocalPushRequestUUID(scope.DeviceID) ||
		!validLocalPushRequestUUID(scope.RootID) ||
		!validLocalPushRequestUUID(st.StageID) ||
		!validLocalPushRequestUUID(op.ID) ||
		!localPushFirstLeafNameValid(scope.RelativePath) ||
		scope.Server == "" || strings.TrimSpace(scope.Server) != scope.Server ||
		scope.Account == "" || strings.TrimSpace(scope.Account) != scope.Account ||
		scope.SessionID == "" || scope.SourceID == 0 || scope.Revision == 0 ||
		scope.TargetNodeID == 0 ||
		!validLocalPushNativeWitnessDigest(scope.RootFingerprint) ||
		!validLocalPushNativeWitnessDigest(scope.ContentSHA256) ||
		st.SourceID != scope.SourceID || st.Revision != scope.Revision ||
		st.ContentSHA256 != scope.ContentSHA256 || st.Size != scope.Size ||
		op.Generation == 0 || op.SourceID != scope.SourceID ||
		op.Revision != scope.Revision ||
		native.SourceID != scope.SourceID || native.DeviceID != scope.DeviceID ||
		native.RootID != scope.RootID ||
		native.RelativePath != scope.RelativePath ||
		native.ContentSHA256 != scope.ContentSHA256 || native.Size != scope.Size ||
		!validLocalPushNativeWitnessDigest(native.PathKey) ||
		!validLocalPushNativeWitnessDigest(native.SnapshotSHA256) ||
		!validLocalPushNativeWitnessDigest(native.NativeKey) {
		return "", errLocalPushDriverDenied
	}
	fields := []string{
		"xdrive/localpush-held-original-operation-v1",
		scope.Server, scope.Account, scope.SessionID, scope.DeviceID,
		scope.RootID, scope.RootFingerprint,
		strconv.FormatUint(scope.SourceID, 10),
		strconv.FormatUint(scope.Revision, 10),
		strconv.FormatUint(scope.TargetNodeID, 10),
		scope.RelativePath, scope.ContentSHA256,
		strconv.FormatInt(scope.Size, 10),
		st.StageID, op.ID, strconv.FormatUint(op.Generation, 10),
		native.PathKey, native.SnapshotSHA256, native.NativeKey,
	}
	mac := hmac.New(sha256.New, key[:])
	for _, field := range fields {
		var lenPrefix [8]byte
		binary.BigEndian.PutUint64(lenPrefix[:], uint64(len(field)))
		_, _ = mac.Write(lenPrefix[:])
		_, _ = mac.Write([]byte(field))
	}
	return hex.EncodeToString(mac.Sum(nil)), nil
}

// Used by the genuine owning Desktop first-file Commit while inside the
// independently held and post-hashed original native file descriptor.
// The EXISTING live Writer method additionally holds the exact original
// Claim's native kernel lock throughout the callback, including HTTP CAS/SQL.
// Never materialize a reusable terminal/cancel/retirement ticket here.
func (d *localPushFirstLeafDriver) withBoundOriginalLiveWriterWitness(
	ctx context.Context, scope localpushrunner.Scope,
	native localpush.NativeHeldCurrentOriginal,
	st localpushrunner.Staged, op localpushrunner.Operation,
	observe func(context.Context, localPushOriginalHeldWitness) error,
) error {
	if d == nil || ctx == nil || ctx.Err() != nil ||
		observe == nil || !d.liveWriterRequired || d.liveWriter == nil ||
		!d.operationMatches(scope, st, op) ||
		!d.nativeMatches(scope, native) {
		return errLocalPushDriverDenied
	}
	return d.withCurrentOriginalLiveWriterProof(
		ctx, scope, native, func(heldCtx context.Context) error {
			digest, err := boundOriginalNativeWitnessDigest(
				d.key.bytes, scope, st, op, native)
			if err != nil {
				return errLocalPushDriverDenied
			}
			return observe(heldCtx, localPushOriginalHeldWitness{
				operationID: op.ID, generation: op.Generation,
				stageID: st.StageID, digest: digest,
			})
		},
	)
}
