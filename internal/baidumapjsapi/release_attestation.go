package baidumapjsapi

import (
	"crypto/ed25519"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"time"
)

// A3b2d2b3b1 verifies the CRYPTOGRAPHIC BINDING of a prospective operator
// attestation. A signature proves possession of its key, NOT that a Baidu
// licence, platform isolation, resource inventory or raw HAR audit exists.
// There is no production signer, trusted public key, HTTP route or network IO.
const (
	jsapi4ReleaseFormat      byte = 1
	jsapi4RequiredPlatforms  byte = 0b111 // Web, Mobile Web, Desktop
	jsapi4MaxReleaseValidity      = 5 * time.Minute
	jsapi4ReleaseDomain           = "xdrive/baidu-jsapi4/operator-release/v1\x00"
	// Deliberately unprovisioned: no operator-approved signing authority or
	// source-reviewed complete JSAPI4 inventory exists in production.
	jsapi4PinnedProductionPublicKey = ""
)

var errJSAPI4ReleaseProofDenied = errors.New("jsapi release attestation unavailable")

// JSAPI4ReleaseScope must ultimately be populated from CURRENT trusted Server
// build/origin/configuration/revocation state, never from a query, signed statement,
// persisted browser setting or admin-supplied policy hash.
type JSAPI4ReleaseScope struct {
	ServerBuildSHA256    [32]byte
	ResourcePolicySHA256 [32]byte
	TrustedOriginSHA256  [32]byte
	BrowserAKRevision    uint64
	ReleaseEpoch         uint64
}

// JSAPI4ReleaseAttestation is a fixed-size, domain-separated Ed25519 envelope.
// The signature has no licence or authorization semantics of its own.
type JSAPI4ReleaseAttestation struct {
	Format       byte
	Scope        JSAPI4ReleaseScope
	PlatformMask byte
	IssuedUnix   int64
	ExpiresUnix  int64
	Signature    [ed25519.SignatureSize]byte
}

func jsapi4ReleaseScopeValid(s JSAPI4ReleaseScope) bool {
	var empty [32]byte
	return s.BrowserAKRevision != 0 && s.ReleaseEpoch != 0 &&
		subtle.ConstantTimeCompare(s.ServerBuildSHA256[:], empty[:]) != 1 &&
		subtle.ConstantTimeCompare(s.ResourcePolicySHA256[:], empty[:]) != 1 &&
		subtle.ConstantTimeCompare(s.TrustedOriginSHA256[:], empty[:]) != 1
}

func jsapi4ReleaseMessage(a JSAPI4ReleaseAttestation) []byte {
	// Domain + exact field order, fixed sizes and big-endian integers. No JSON
	// canonicalization, variable-length strings, secret keys or untrusted URLs.
	b := make([]byte, len(jsapi4ReleaseDomain)+1+32+32+32+8+8+1+8+8)
	pos := copy(b, jsapi4ReleaseDomain)
	b[pos] = a.Format
	pos++
	pos += copy(b[pos:], a.Scope.ServerBuildSHA256[:])
	pos += copy(b[pos:], a.Scope.ResourcePolicySHA256[:])
	pos += copy(b[pos:], a.Scope.TrustedOriginSHA256[:])
	binary.BigEndian.PutUint64(b[pos:], a.Scope.BrowserAKRevision)
	pos += 8
	binary.BigEndian.PutUint64(b[pos:], a.Scope.ReleaseEpoch)
	pos += 8
	b[pos] = a.PlatformMask
	pos++
	binary.BigEndian.PutUint64(b[pos:], uint64(a.IssuedUnix))
	pos += 8
	binary.BigEndian.PutUint64(b[pos:], uint64(a.ExpiresUnix))
	return b
}

// verifyJSAPI4ReleaseAttestation is a testable private primitive for an
// eventually code-pinned key. Its caller MUST supply a separately trusted
// public key and independently refreshed expected scope. It never activates
// a JSAPI runtime, even if a synthetic fixture verifies successfully.
func verifyJSAPI4ReleaseAttestation(a JSAPI4ReleaseAttestation, trustedKey ed25519.PublicKey, expected JSAPI4ReleaseScope, now time.Time) error {
	if len(trustedKey) != ed25519.PublicKeySize || now.IsZero() || now.Unix() <= 0 ||
		a.Format != jsapi4ReleaseFormat || a.PlatformMask != jsapi4RequiredPlatforms ||
		!jsapi4ReleaseScopeValid(expected) || !jsapi4ReleaseScopeValid(a.Scope) ||
		a.Scope.BrowserAKRevision != expected.BrowserAKRevision ||
		a.Scope.ReleaseEpoch != expected.ReleaseEpoch ||
		subtle.ConstantTimeCompare(a.Scope.ServerBuildSHA256[:], expected.ServerBuildSHA256[:]) != 1 ||
		subtle.ConstantTimeCompare(a.Scope.ResourcePolicySHA256[:], expected.ResourcePolicySHA256[:]) != 1 ||
		subtle.ConstantTimeCompare(a.Scope.TrustedOriginSHA256[:], expected.TrustedOriginSHA256[:]) != 1 ||
		a.IssuedUnix <= 0 || a.ExpiresUnix <= a.IssuedUnix ||
		a.ExpiresUnix-a.IssuedUnix > int64(jsapi4MaxReleaseValidity/time.Second) ||
		now.Unix() < a.IssuedUnix || now.Unix() >= a.ExpiresUnix {
		return errJSAPI4ReleaseProofDenied
	}
	message := jsapi4ReleaseMessage(a)
	defer clear(message)
	if !ed25519.Verify(trustedKey, message, a.Signature[:]) {
		return errJSAPI4ReleaseProofDenied
	}
	return nil
}

// VerifyPinnedJSAPI4ProductionRelease validates the operator's actual
// source-pinned Ed25519 public key, a COMPLETE independently reviewed child
// inventory and the exact current Server build/policy/origin/Browser AK/epoch
// scope. A signature is not a provider licence: release metadata must only be
// pinned after separate legal and raw-HAR audits and Server policy review.
// Empty/invalid pin and incomplete inventory always fail closed.
// Never accept this key from an administrator field or browser request.
func VerifyPinnedJSAPI4ProductionRelease(a JSAPI4ReleaseAttestation, expected JSAPI4ReleaseScope, now time.Time) error {
	if jsapi4PinnedProductionPublicKey == "" || !JSAPI4ChildInventoryComplete() {
		return ErrGateClosed
	}
	key, err := base64.StdEncoding.Strict().DecodeString(jsapi4PinnedProductionPublicKey)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return ErrGateClosed
	}
	if verifyJSAPI4ReleaseAttestation(a, ed25519.PublicKey(key), expected, now) != nil {
		return ErrGateClosed
	}
	return nil
}

// JSAPI4ProductionSignerPinned checks ONLY the syntax of the build-pinned
// Ed25519 public key. It is not a licence, operator approval or live release.
func JSAPI4ProductionSignerPinned() bool {
	if jsapi4PinnedProductionPublicKey == "" {
		return false
	}
	key, err := base64.StdEncoding.Strict().DecodeString(jsapi4PinnedProductionPublicKey)
	return err == nil && len(key) == ed25519.PublicKeySize
}
