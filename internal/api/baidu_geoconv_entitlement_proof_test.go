package api

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"testing"
	"time"
)

func TestBaiduGeoconvAccountProofRequiresTrustedExactCurrentScope(t *testing.T) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	other, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1792216800, 0).UTC()
	baseScope := baiduGeoconvAccountEvidenceScope{
		OwnerID: 71, SessionVersion: 4, ServerAKRevision: 8, EvidenceRevision: 2,
		EvidenceSHA256: sha256.Sum256([]byte("synthetic privately reviewed provider terms")),
		MinuteCaps:     baiduGeoconvQuotaLimits{OwnerRequests: 1, FleetRequests: 4, OwnerPoints: 1, FleetPoints: 12},
		CadenceCaps:    baiduGeoconvCadenceCaps{OwnerSecond: 1, FleetSecond: 2, OwnerDay: 17, FleetDay: 80},
	}
	proof := baiduGeoconvAccountEvidenceProof{
		Format: baiduGeoconvEvidenceFormat, Scope: baseScope,
		IssuedUnix: now.Unix() - 30, ExpiresUnix: now.Unix() + 150,
	}
	sign := func(p *baiduGeoconvAccountEvidenceProof) {
		t.Helper()
		msg := baiduGeoconvAccountEvidenceMessage(*p)
		copy(p.Signature[:], ed25519.Sign(private, msg))
		clear(msg)
	}
	sign(&proof)
	verify := func(ctx context.Context, got baiduGeoconvAccountEvidenceProof, key ed25519.PublicKey,
		scope baiduGeoconvAccountEvidenceScope, clock time.Time, want bool) {
		t.Helper()
		err := verifyBaiduGeoconvAccountEvidence(ctx, got, key, scope, clock)
		if want && err != nil {
			t.Fatal("valid offline signed proof rejected")
		}
		if !want && !errors.Is(err, errBaiduGeoconvDispatchUnavailable) {
			t.Fatal("invalid proof accepted or non-opaque error returned")
		}
	}
	verify(context.Background(), proof, public, baseScope, now, true)
	verify(context.Background(), proof, other, baseScope, now, false)
	verify(context.Background(), proof, nil, baseScope, now, false)
	verify(nil, proof, public, baseScope, now, false)
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	verify(cancelled, proof, public, baseScope, now, false)
	verify(context.Background(), proof, public, baseScope, now.Add(-time.Minute), false)
	verify(context.Background(), proof, public, baseScope, now.Add(3*time.Minute), false)
	for _, mutate := range []func(*baiduGeoconvAccountEvidenceScope){
		func(s *baiduGeoconvAccountEvidenceScope) { s.OwnerID++ },
		func(s *baiduGeoconvAccountEvidenceScope) { s.SessionVersion++ },
		func(s *baiduGeoconvAccountEvidenceScope) { s.ServerAKRevision++ },
		func(s *baiduGeoconvAccountEvidenceScope) { s.EvidenceRevision++ },
		func(s *baiduGeoconvAccountEvidenceScope) { s.EvidenceSHA256[0] ^= 1 },
		func(s *baiduGeoconvAccountEvidenceScope) { s.MinuteCaps.OwnerRequests++ },
		func(s *baiduGeoconvAccountEvidenceScope) { s.CadenceCaps.OwnerDay-- },
	} {
		s := baseScope
		mutate(&s)
		verify(context.Background(), proof, public, s, now, false)
	}
	for _, mutate := range []func(*baiduGeoconvAccountEvidenceProof){
		func(p *baiduGeoconvAccountEvidenceProof) { p.Format++ },
		func(p *baiduGeoconvAccountEvidenceProof) { p.IssuedUnix++ },
		func(p *baiduGeoconvAccountEvidenceProof) { p.ExpiresUnix++ },
		func(p *baiduGeoconvAccountEvidenceProof) { p.Scope.OwnerID++ },
		func(p *baiduGeoconvAccountEvidenceProof) { p.Scope.MinuteCaps.FleetRequests++ },
		func(p *baiduGeoconvAccountEvidenceProof) { p.Signature[0] ^= 1 },
	} {
		p := proof
		mutate(&p)
		verify(context.Background(), p, public, baseScope, now, false)
	}
	// A freshly signed malformed proof still fails local ceilings / true cap checks.
	for _, mutate := range []func(*baiduGeoconvAccountEvidenceScope){
		func(s *baiduGeoconvAccountEvidenceScope) { s.OwnerID = 0 },
		func(s *baiduGeoconvAccountEvidenceScope) { s.OwnerID = baiduGeoconvQuotaMaxOwnerID + 1 },
		func(s *baiduGeoconvAccountEvidenceScope) { s.SessionVersion = 0 },
		func(s *baiduGeoconvAccountEvidenceScope) { s.ServerAKRevision = 0 },
		func(s *baiduGeoconvAccountEvidenceScope) { s.EvidenceRevision = 0 },
		func(s *baiduGeoconvAccountEvidenceScope) { s.EvidenceSHA256 = [32]byte{} },
		func(s *baiduGeoconvAccountEvidenceScope) { s.MinuteCaps.OwnerRequests = 0 },
		func(s *baiduGeoconvAccountEvidenceScope) { s.MinuteCaps.FleetRequests = 100 },
		func(s *baiduGeoconvAccountEvidenceScope) { s.MinuteCaps.OwnerPoints = 21 },
		func(s *baiduGeoconvAccountEvidenceScope) { s.MinuteCaps.FleetPoints = 201 },
		func(s *baiduGeoconvAccountEvidenceScope) { s.CadenceCaps.OwnerSecond = 3 },
		func(s *baiduGeoconvAccountEvidenceScope) { s.CadenceCaps.FleetSecond = 3 },
		func(s *baiduGeoconvAccountEvidenceScope) { s.CadenceCaps.OwnerDay = 201 },
		func(s *baiduGeoconvAccountEvidenceScope) { s.CadenceCaps.FleetDay = 4001 },
	} {
		p := proof
		mutate(&p.Scope)
		sign(&p)
		verify(context.Background(), p, public, p.Scope, now, false)
	}
	for _, duration := range []int64{0, -1, 301} {
		p := proof
		p.ExpiresUnix = p.IssuedUnix + duration
		sign(&p)
		verify(context.Background(), p, public, baseScope, now, false)
	}
	// Even a cryptographically valid test-signed proof cannot open production.
	if err := verifyPinnedBaiduGeoconvAccountEvidence(context.Background(), proof, baseScope, now); !errors.Is(err, errBaiduGeoconvDispatchUnavailable) {
		t.Fatal("synthetic evidence unlocked production Geoconv")
	}
}
