package baidumapjsapi

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"testing"
	"time"
)

func sampleReleaseAttestation(t *testing.T) (JSAPI4ReleaseAttestation, ed25519.PublicKey, JSAPI4ReleaseScope, time.Time) {
	t.Helper()
	seed := bytes.Repeat([]byte{0x5a}, ed25519.SeedSize)
	privateKey := ed25519.NewKeyFromSeed(seed)
	publicKey := privateKey.Public().(ed25519.PublicKey)
	now := time.Date(2026, time.October, 15, 18, 0, 0, 0, time.UTC)
	scope := JSAPI4ReleaseScope{
		ServerBuildSHA256:    sha256.Sum256([]byte("fixture-build-only")),
		ResourcePolicySHA256: sha256.Sum256([]byte("fixture-reviewed-policy-only")),
		TrustedOriginSHA256:  sha256.Sum256([]byte("https://gallery.example.invalid")),
		BrowserAKRevision:    17,
		ReleaseEpoch:         23,
	}
	a := JSAPI4ReleaseAttestation{
		Format:       jsapi4ReleaseFormat,
		Scope:        scope,
		PlatformMask: jsapi4RequiredPlatforms,
		IssuedUnix:   now.Unix(),
		ExpiresUnix:  now.Add(2 * time.Minute).Unix(),
	}
	copy(a.Signature[:], ed25519.Sign(privateKey, jsapi4ReleaseMessage(a)))
	return a, publicKey, scope, now
}

func TestJSAPI4AttestationSignatureOnlyNotRuntimePermission(t *testing.T) {
	a, public, expected, now := sampleReleaseAttestation(t)
	if err := verifyJSAPI4ReleaseAttestation(a, public, expected, now); err != nil {
		t.Fatalf("synthetic signature rejected: %v", err)
	}
	if !JSAPI4ChildInventoryComplete() && jsapi4PinnedProductionPublicKey != "" {
		t.Fatal("unreviewed inventory must not have a production signer")
	}
	if err := VerifyPinnedJSAPI4ProductionRelease(a, expected, now); !errors.Is(err, ErrGateClosed) {
		t.Fatalf("fixture wrongly activated JSAPI4 runtime: %v", err)
	}
}

func TestJSAPI4AttestationTamperingAndOldRevisionRejected(t *testing.T) {
	a, public, expected, now := sampleReleaseAttestation(t)
	for _, mutate := range []func(*JSAPI4ReleaseAttestation){
		func(v *JSAPI4ReleaseAttestation) { v.Format++ },
		func(v *JSAPI4ReleaseAttestation) { v.Scope.ServerBuildSHA256[0] ^= 1 },
		func(v *JSAPI4ReleaseAttestation) { v.Scope.ResourcePolicySHA256[0] ^= 1 },
		func(v *JSAPI4ReleaseAttestation) { v.Scope.TrustedOriginSHA256[0] ^= 1 },
		func(v *JSAPI4ReleaseAttestation) { v.Scope.BrowserAKRevision++ },
		func(v *JSAPI4ReleaseAttestation) { v.Scope.ReleaseEpoch++ },
		func(v *JSAPI4ReleaseAttestation) { v.PlatformMask = 0b011 },
		func(v *JSAPI4ReleaseAttestation) { v.PlatformMask = 0b1111 },
		func(v *JSAPI4ReleaseAttestation) { v.IssuedUnix-- },
		func(v *JSAPI4ReleaseAttestation) { v.ExpiresUnix++ },
		func(v *JSAPI4ReleaseAttestation) { v.Signature[0] ^= 1 },
	} {
		candidate := a
		mutate(&candidate)
		if err := verifyJSAPI4ReleaseAttestation(candidate, public, expected, now); !errors.Is(err, errJSAPI4ReleaseProofDenied) {
			t.Fatalf("tampered release accepted: %#v err=%v", candidate, err)
		}
	}
	for _, mutate := range []func(*JSAPI4ReleaseScope){
		func(s *JSAPI4ReleaseScope) { s.BrowserAKRevision++ },
		func(s *JSAPI4ReleaseScope) { s.ReleaseEpoch++ },
		func(s *JSAPI4ReleaseScope) { s.ServerBuildSHA256[0] ^= 1 },
		func(s *JSAPI4ReleaseScope) { s.ResourcePolicySHA256[0] ^= 1 },
		func(s *JSAPI4ReleaseScope) { s.TrustedOriginSHA256[0] ^= 1 },
	} {
		s := expected
		mutate(&s)
		if err := verifyJSAPI4ReleaseAttestation(a, public, s, now); !errors.Is(err, errJSAPI4ReleaseProofDenied) {
			t.Fatal("stale build/config/policy/revocation proof accepted")
		}
	}
}

func TestJSAPI4AttestationTimingAndWrongSignerRejected(t *testing.T) {
	a, public, expected, now := sampleReleaseAttestation(t)
	if err := verifyJSAPI4ReleaseAttestation(a, public, expected, now.Add(-time.Second)); !errors.Is(err, errJSAPI4ReleaseProofDenied) {
		t.Fatal("premature attestation accepted")
	}
	if err := verifyJSAPI4ReleaseAttestation(a, public, expected, time.Unix(a.ExpiresUnix, 0)); !errors.Is(err, errJSAPI4ReleaseProofDenied) {
		t.Fatal("expired attestation accepted")
	}
	for _, candidate := range []JSAPI4ReleaseAttestation{
		func() JSAPI4ReleaseAttestation { z := a; z.IssuedUnix = 0; return z }(),
		func() JSAPI4ReleaseAttestation { z := a; z.ExpiresUnix = z.IssuedUnix; return z }(),
		func() JSAPI4ReleaseAttestation {
			z := a
			z.ExpiresUnix = z.IssuedUnix + int64(6*time.Minute/time.Second)
			return z
		}(),
	} {
		if err := verifyJSAPI4ReleaseAttestation(candidate, public, expected, now); !errors.Is(err, errJSAPI4ReleaseProofDenied) {
			t.Fatal("unsafe attestation time accepted")
		}
	}
	if err := verifyJSAPI4ReleaseAttestation(a, nil, expected, now); !errors.Is(err, errJSAPI4ReleaseProofDenied) {
		t.Fatal("missing trusted key accepted")
	}
	other := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x31}, 32)).Public().(ed25519.PublicKey)
	if err := verifyJSAPI4ReleaseAttestation(a, other, expected, now); !errors.Is(err, errJSAPI4ReleaseProofDenied) {
		t.Fatal("different signing identity accepted")
	}
}

func TestJSAPI4AttestationEmptyEvidenceAndDomainIsolation(t *testing.T) {
	a, public, expected, now := sampleReleaseAttestation(t)
	a.Scope.ServerBuildSHA256 = [32]byte{}
	if err := verifyJSAPI4ReleaseAttestation(a, public, expected, now); !errors.Is(err, errJSAPI4ReleaseProofDenied) {
		t.Fatal("empty build hash accepted")
	}
	zero := JSAPI4ReleaseScope{}
	a, public, _, now = sampleReleaseAttestation(t)
	if err := verifyJSAPI4ReleaseAttestation(a, public, zero, now); !errors.Is(err, errJSAPI4ReleaseProofDenied) {
		t.Fatal("missing trusted current state accepted")
	}
	// Same key, different domain/payload is never a valid JSAPI4 release.
	seed := bytes.Repeat([]byte{0x5a}, ed25519.SeedSize)
	privateKey := ed25519.NewKeyFromSeed(seed)
	copy(a.Signature[:], ed25519.Sign(privateKey, []byte("some other product operation")))
	if err := verifyJSAPI4ReleaseAttestation(a, public, expected, now); !errors.Is(err, errJSAPI4ReleaseProofDenied) {
		t.Fatal("cross-domain signature accepted")
	}
}
