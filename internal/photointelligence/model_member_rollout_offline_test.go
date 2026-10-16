package photointelligence

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

const (
	offlineRolloutTestEpoch  = "0123456789abcdef0123456789abcdef"
	offlineRolloutTestBoot   = "22222222222222222222222222222222"
	offlineRolloutTestS1     = "11111111111111111111111111111111"
	offlineRolloutTestS2     = "33333333333333333333333333333333"
	offlineRolloutTestNow    = int64(1700000010)
	offlineRolloutTestDigest = "e54365c9cfef27c34d0ba5c7b1023e6699622b70744e705afeb56c32c0238eb5"
)

type offlinePreparedFixture struct {
	roster          OfflinePhotoModelExpectedRosterV1
	rosterSignature string
	operatorKey     ed25519.PublicKey
	memberKeys      map[string]ed25519.PublicKey
	memberPrivate   map[string]ed25519.PrivateKey
	reports         map[string]OfflinePhotoModelSignedMemberPreparedV1
}

func offlineMemberPreparedTestFixture(t *testing.T) offlinePreparedFixture {
	t.Helper()
	operatorPrivate := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x10}, ed25519.SeedSize))
	private1 := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x20}, ed25519.SeedSize))
	private2 := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x30}, ed25519.SeedSize))
	roster := OfflinePhotoModelExpectedRosterV1{
		Version: 1, DeploymentEpoch: offlineRolloutTestEpoch, Revision: 73,
		IssuedAt: offlineRolloutTestNow - 10, ExpiresAt: offlineRolloutTestNow + 110,
		ModelBootID:       offlineRolloutTestBoot,
		ExpectedServerIDs: []string{offlineRolloutTestS1, offlineRolloutTestS2},
	}
	rosterBytes, err := offlinePhotoModelExpectedRosterCanonical(roster)
	if err != nil {
		t.Fatal(err)
	}
	rosterHash := sha256.Sum256(rosterBytes)
	rosterDigest := hex.EncodeToString(rosterHash[:])
	memberPrivate := map[string]ed25519.PrivateKey{offlineRolloutTestS1: private1, offlineRolloutTestS2: private2}
	memberKeys := map[string]ed25519.PublicKey{
		offlineRolloutTestS1: private1.Public().(ed25519.PublicKey),
		offlineRolloutTestS2: private2.Public().(ed25519.PublicKey),
	}
	reports := make(map[string]OfflinePhotoModelSignedMemberPreparedV1)
	for n, server := range roster.ExpectedServerIDs {
		claim := OfflinePhotoModelMemberPreparedV1{
			Version: 1, DeploymentEpoch: roster.DeploymentEpoch,
			ModelBootID: roster.ModelBootID, ServerID: server, Revision: roster.Revision,
			RosterSHA256: rosterDigest, IssuedAt: offlineRolloutTestNow - 1,
			ExpiresAt: offlineRolloutTestNow + 20, Nonce: strings.Repeat(string(rune('a'+n)), 32),
			Mode: offlinePhotoModelMemberPreparedMode, RoutesSHA256: offlinePhotoModelExpectedRouteDigest(),
		}
		body, err := offlinePhotoModelMemberPreparedCanonical(claim)
		if err != nil {
			t.Fatal(err)
		}
		reports[server] = OfflinePhotoModelSignedMemberPreparedV1{
			Claim: claim, SignatureHex: hex.EncodeToString(ed25519.Sign(memberPrivate[server], body)),
		}
	}
	return offlinePreparedFixture{
		roster: roster, rosterSignature: hex.EncodeToString(ed25519.Sign(operatorPrivate, rosterBytes)),
		operatorKey: operatorPrivate.Public().(ed25519.PublicKey),
		memberKeys:  memberKeys, memberPrivate: memberPrivate, reports: reports,
	}
}

func (f offlinePreparedFixture) validate(now int64) error {
	return VerifyOfflinePhotoModelAllMembersPreparedV1(f.roster, f.rosterSignature,
		f.operatorKey, offlineRolloutTestEpoch, offlineRolloutTestBoot, 73, now,
		f.memberKeys, f.reports)
}

func TestOfflinePhotoModelAllMembersPreparedCurrentSignedFixture(t *testing.T) {
	f := offlineMemberPreparedTestFixture(t)
	const signatureGolden = "9d70a0193d0933f75898701e07e6889f0db07c5eec0a2b134998e2ec89fc694efb42891b58d912e0d1c078f25b4b1f6be48bf0b3139922725e80b18edc41700c"
	if f.reports[offlineRolloutTestS1].SignatureHex != signatureGolden {
		t.Fatal("offline member-prepared v1 signature golden drifted")
	}
	if got := offlinePhotoModelExpectedRouteDigest(); got != offlineRolloutTestDigest {
		t.Fatalf("unexpected complete model-route digest: %q", got)
	}
	if err := f.validate(offlineRolloutTestNow); err != nil {
		t.Fatalf("complete independent two-member signed test fixture rejected: %v", err)
	}
	if err := f.validate(offlineRolloutTestNow + 19); err != nil {
		t.Fatalf("final valid second rejected: %v", err)
	}
	// A signature binds only a supplied TEST capability assertion. It is not
	// a signed runtime session, real routed request, or all-replica drain ACK.
	claim := f.reports[offlineRolloutTestS1].Claim
	canonical, err := offlinePhotoModelMemberPreparedCanonical(claim)
	if err != nil || !bytes.HasPrefix(canonical, []byte("xdrive.photo.member-prepared.v1\n1\n")) {
		t.Fatalf("unexpected canonical member transcript: %v", err)
	}
	if len(canonical) > 1024 || !bytes.HasSuffix(canonical, []byte("\n")) {
		t.Fatalf("malformed member transcript")
	}
}

func TestOfflinePhotoModelAllMembersPreparedRejectsMixedOldAbsentOrUntrusted(t *testing.T) {
	cases := map[string]func(f *offlinePreparedFixture){
		"missing member report":     func(f *offlinePreparedFixture) { delete(f.reports, offlineRolloutTestS2) },
		"unknown extra member":      func(f *offlinePreparedFixture) { f.reports[strings.Repeat("f", 32)] = f.reports[offlineRolloutTestS1] },
		"missing pinned member key": func(f *offlinePreparedFixture) { delete(f.memberKeys, offlineRolloutTestS2) },
		"unknown pinned member key": func(f *offlinePreparedFixture) {
			f.memberKeys[strings.Repeat("f", 32)] = f.memberKeys[offlineRolloutTestS1]
		},
		"mixed legacy mode": func(f *offlinePreparedFixture) {
			c := f.reports[offlineRolloutTestS2]
			c.Claim.Mode = "legacy"
			f.reports[offlineRolloutTestS2] = c
		},
		"all ready runtime assertion forbidden": func(f *offlinePreparedFixture) {
			c := f.reports[offlineRolloutTestS2]
			c.Claim.Mode = "enforced-v1"
			f.reports[offlineRolloutTestS2] = c
		},
		"bad signature": func(f *offlinePreparedFixture) {
			c := f.reports[offlineRolloutTestS2]
			c.SignatureHex = strings.Repeat("0", 128)
			f.reports[offlineRolloutTestS2] = c
		},
		"invalid signing public key": func(f *offlinePreparedFixture) {
			f.memberKeys[offlineRolloutTestS1] = make([]byte, ed25519.PublicKeySize)
		},
		"duplicate signing public key": func(f *offlinePreparedFixture) {
			f.memberKeys[offlineRolloutTestS2] = f.memberKeys[offlineRolloutTestS1]
		},
		"operator/member key reused":             func(f *offlinePreparedFixture) { f.memberKeys[offlineRolloutTestS2] = f.operatorKey },
		"wrong operator root":                    func(f *offlinePreparedFixture) { f.operatorKey = make([]byte, ed25519.PublicKeySize) },
		"wrong roster signature":                 func(f *offlinePreparedFixture) { f.rosterSignature = strings.Repeat("0", 128) },
		"wrong roster epoch":                     func(f *offlinePreparedFixture) { f.roster.DeploymentEpoch = strings.Repeat("f", 32) },
		"changed member roster after signatures": func(f *offlinePreparedFixture) { f.roster.ExpectedServerIDs[1] = strings.Repeat("4", 32) },
		"tampered roster digest": func(f *offlinePreparedFixture) {
			c := f.reports[offlineRolloutTestS1]
			c.Claim.RosterSHA256 = strings.Repeat("f", 64)
			f.reports[offlineRolloutTestS1] = c
		},
		"wrong server identity": func(f *offlinePreparedFixture) {
			c := f.reports[offlineRolloutTestS1]
			c.Claim.ServerID = offlineRolloutTestS2
			f.reports[offlineRolloutTestS1] = c
		},
		"wrong model boot": func(f *offlinePreparedFixture) {
			c := f.reports[offlineRolloutTestS1]
			c.Claim.ModelBootID = strings.Repeat("f", 32)
			f.reports[offlineRolloutTestS1] = c
		},
		"wrong revision": func(f *offlinePreparedFixture) {
			c := f.reports[offlineRolloutTestS1]
			c.Claim.Revision++
			f.reports[offlineRolloutTestS1] = c
		},
		"wrong deployment epoch": func(f *offlinePreparedFixture) {
			c := f.reports[offlineRolloutTestS1]
			c.Claim.DeploymentEpoch = strings.Repeat("f", 32)
			f.reports[offlineRolloutTestS1] = c
		},
		"partial route coverage": func(f *offlinePreparedFixture) {
			c := f.reports[offlineRolloutTestS1]
			c.Claim.RoutesSHA256 = strings.Repeat("a", 64)
			f.reports[offlineRolloutTestS1] = c
		},
		"future peer statement": func(f *offlinePreparedFixture) {
			c := f.reports[offlineRolloutTestS1]
			c.Claim.IssuedAt = offlineRolloutTestNow + 6
			f.reports[offlineRolloutTestS1] = c
		},
		"expired peer statement": func(f *offlinePreparedFixture) {
			c := f.reports[offlineRolloutTestS1]
			c.Claim.ExpiresAt = offlineRolloutTestNow
			c.Claim.IssuedAt = offlineRolloutTestNow - 20
			f.reports[offlineRolloutTestS1] = c
		},
		"overlong peer ttl": func(f *offlinePreparedFixture) {
			c := f.reports[offlineRolloutTestS1]
			c.Claim.ExpiresAt = c.Claim.IssuedAt + 31
			f.reports[offlineRolloutTestS1] = c
		},
		"invalid nonce": func(f *offlinePreparedFixture) {
			c := f.reports[offlineRolloutTestS1]
			c.Claim.Nonce = ""
			f.reports[offlineRolloutTestS1] = c
		},
		"uppercase signature": func(f *offlinePreparedFixture) {
			c := f.reports[offlineRolloutTestS1]
			c.SignatureHex = strings.ToUpper(c.SignatureHex)
			f.reports[offlineRolloutTestS1] = c
		},
		"stale roster time": func(f *offlinePreparedFixture) { f.roster.ExpiresAt = offlineRolloutTestNow },
	}
	for name, modify := range cases {
		t.Run(name, func(t *testing.T) {
			f := offlineMemberPreparedTestFixture(t)
			f.roster.ExpectedServerIDs = append([]string(nil), f.roster.ExpectedServerIDs...)
			modify(&f)
			if err := f.validate(offlineRolloutTestNow); err == nil {
				t.Fatal("untrusted mixed-version or incomplete membership accepted")
			}
		})
	}
}

func TestOfflinePhotoModelAllMembersPreparedRejectsExpiredOrUnsigned(t *testing.T) {
	f := offlineMemberPreparedTestFixture(t)
	if err := f.validate(offlineRolloutTestNow + 20); err == nil {
		t.Fatal("expired readiness accepted")
	}
	if err := f.validate(offlineRolloutTestNow - 7); err == nil {
		t.Fatal("future readiness accepted")
	}
	if err := f.validate(f.roster.ExpiresAt); err == nil {
		t.Fatal("expired signed roster accepted")
	}
}

func TestOfflinePhotoModelMemberPreparedCanonicalRejectsClaimDrift(t *testing.T) {
	f := offlineMemberPreparedTestFixture(t)
	c := f.reports[offlineRolloutTestS1].Claim
	invalid := []OfflinePhotoModelMemberPreparedV1{
		func() OfflinePhotoModelMemberPreparedV1 { x := c; x.Version = 2; return x }(),
		func() OfflinePhotoModelMemberPreparedV1 { x := c; x.Revision = 0; return x }(),
		func() OfflinePhotoModelMemberPreparedV1 { x := c; x.Mode = "legacy"; return x }(),
		func() OfflinePhotoModelMemberPreparedV1 { x := c; x.RoutesSHA256 = ""; return x }(),
		func() OfflinePhotoModelMemberPreparedV1 {
			x := c
			x.RosterSHA256 = strings.ToUpper(x.RosterSHA256)
			return x
		}(),
		func() OfflinePhotoModelMemberPreparedV1 { x := c; x.ExpiresAt = x.IssuedAt; return x }(),
		func() OfflinePhotoModelMemberPreparedV1 { x := c; x.IssuedAt = -1; return x }(),
		func() OfflinePhotoModelMemberPreparedV1 { x := c; x.Nonce = strings.Repeat("Z", 32); return x }(),
	}
	for i, x := range invalid {
		if _, err := offlinePhotoModelMemberPreparedCanonical(x); err == nil {
			t.Fatalf("invalid variant %d accepted", i)
		}
	}
}
