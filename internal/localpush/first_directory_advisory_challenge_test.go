package localpush

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func advisoryChallengeSample(t *testing.T) (LocalFirstDirectoryAdvisoryChallenge, LocalFirstDirectoryNativeObservation, string, time.Time) {
	t.Helper()
	now := time.Date(2026, time.October, 17, 0, 0, 0, 0, time.UTC)
	challenge, err := NewLocalFirstDirectoryAdvisoryChallenge(
		3, 42, 7, 29, uuid.NewString(), uuid.NewString(), strings.Repeat("a", 64), now,
	)
	if err != nil {
		t.Fatal(err)
	}
	key, err := LocalInventoryPathKey(
		RootGrant{SourceID: challenge.SourceID, RootID: challenge.RootID},
		"directory", "Camera Roll",
	)
	if err != nil {
		t.Fatal(err)
	}
	observed := LocalFirstDirectoryNativeObservation{
		SourceID: challenge.SourceID, SourceRevision: challenge.SourceRevision,
		DeviceID: challenge.DeviceID, RootID: challenge.RootID,
		RelativeDirectory: "Camera Roll", CurrentPathKey: key,
		NativeIdentityKey:      strings.Repeat("b", 64),
		PreviousSnapshotSHA256: strings.Repeat("c", 64),
		CurrentSnapshotSHA256:  strings.Repeat("d", 64),
		NativeObserved:         true,
	}
	return challenge, observed, "valid-owning-device-credential-only", now
}

func TestLocalFirstDirectoryAdvisoryChallengeBindsExactPrivateScope(t *testing.T) {
	challenge, observed, token, now := advisoryChallengeSample(t)
	ctx := context.Background()
	sealed, err := SealLocalFirstDirectoryAdvisoryObservation(ctx, observed, challenge, token, now)
	if err != nil || !VerifyLocalFirstDirectoryAdvisoryObservation(ctx, sealed, challenge, token, now) {
		t.Fatalf("private MAC not verified: %v", err)
	}
	for name, value := range map[string]any{"challenge": challenge, "seal": sealed} {
		body, err := json.Marshal(value)
		if err != nil || string(body) != "{}" || strings.Contains(string(body), observed.RelativeDirectory) ||
			strings.Contains(string(body), token) {
			t.Fatalf("private %s leaked serialized evidence: %s %v", name, body, err)
		}
	}
	another, err := NewLocalFirstDirectoryAdvisoryChallenge(
		challenge.OwnerID, challenge.SourceID, challenge.SourceRevision,
		challenge.TargetNodeID, challenge.DeviceID, challenge.RootID,
		challenge.RootFingerprint, now,
	)
	if err != nil || another.Nonce == challenge.Nonce {
		t.Fatalf("challenge nonce not freshly random: %v", err)
	}
	if VerifyLocalFirstDirectoryAdvisoryObservation(ctx, sealed, another, token, now) ||
		VerifyLocalFirstDirectoryAdvisoryObservation(ctx, sealed, challenge, "wrong-device-token-credential", now) ||
		VerifyLocalFirstDirectoryAdvisoryObservation(ctx, sealed, challenge, token, challenge.ExpiresAt) {
		t.Fatal("stale, foreign, or expired advisory MAC accepted")
	}
	// Repeated Verify is intentionally possible without a durable Server nonce
	// ledger: no caller may interpret a MAC as one-use authorization.
	if !VerifyLocalFirstDirectoryAdvisoryObservation(ctx, sealed, challenge, token, now) {
		t.Fatal("advisory-only verification unexpectedly mutated state")
	}
}

func TestLocalFirstDirectoryAdvisoryTamperingFailsClosed(t *testing.T) {
	challenge, observed, token, now := advisoryChallengeSample(t)
	ctx := context.Background()
	sealed, err := SealLocalFirstDirectoryAdvisoryObservation(ctx, observed, challenge, token, now)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name string
		edit func(*LocalFirstDirectoryAdvisoryChallenge, *LocalFirstDirectoryAdvisorySeal)
	}{
		{"owner", func(c *LocalFirstDirectoryAdvisoryChallenge, _ *LocalFirstDirectoryAdvisorySeal) { c.OwnerID++ }},
		{"source", func(c *LocalFirstDirectoryAdvisoryChallenge, _ *LocalFirstDirectoryAdvisorySeal) { c.SourceID++ }},
		{"revision", func(c *LocalFirstDirectoryAdvisoryChallenge, _ *LocalFirstDirectoryAdvisorySeal) { c.SourceRevision++ }},
		{"target", func(c *LocalFirstDirectoryAdvisoryChallenge, _ *LocalFirstDirectoryAdvisorySeal) { c.TargetNodeID++ }},
		{"device", func(c *LocalFirstDirectoryAdvisoryChallenge, _ *LocalFirstDirectoryAdvisorySeal) {
			c.DeviceID = uuid.NewString()
		}},
		{"root", func(c *LocalFirstDirectoryAdvisoryChallenge, _ *LocalFirstDirectoryAdvisorySeal) {
			c.RootID = uuid.NewString()
		}},
		{"fingerprint", func(c *LocalFirstDirectoryAdvisoryChallenge, _ *LocalFirstDirectoryAdvisorySeal) {
			c.RootFingerprint = strings.Repeat("f", 64)
		}},
		{"nonce", func(c *LocalFirstDirectoryAdvisoryChallenge, _ *LocalFirstDirectoryAdvisorySeal) { c.Nonce[0] ^= 1 }},
		{"issued", func(c *LocalFirstDirectoryAdvisoryChallenge, _ *LocalFirstDirectoryAdvisorySeal) {
			c.IssuedAt = c.IssuedAt.Add(time.Second)
		}},
		{"expires", func(c *LocalFirstDirectoryAdvisoryChallenge, _ *LocalFirstDirectoryAdvisorySeal) {
			c.ExpiresAt = c.ExpiresAt.Add(-time.Second)
		}},
		{"name", func(_ *LocalFirstDirectoryAdvisoryChallenge, s *LocalFirstDirectoryAdvisorySeal) {
			s.Observation.RelativeDirectory = "Other"
		}},
		{"path-key", func(_ *LocalFirstDirectoryAdvisoryChallenge, s *LocalFirstDirectoryAdvisorySeal) {
			s.Observation.CurrentPathKey = strings.Repeat("e", 64)
		}},
		{"native-key", func(_ *LocalFirstDirectoryAdvisoryChallenge, s *LocalFirstDirectoryAdvisorySeal) {
			s.Observation.NativeIdentityKey = strings.Repeat("e", 64)
		}},
		{"previous", func(_ *LocalFirstDirectoryAdvisoryChallenge, s *LocalFirstDirectoryAdvisorySeal) {
			s.Observation.PreviousSnapshotSHA256 = strings.Repeat("e", 64)
		}},
		{"current", func(_ *LocalFirstDirectoryAdvisoryChallenge, s *LocalFirstDirectoryAdvisorySeal) {
			s.Observation.CurrentSnapshotSHA256 = strings.Repeat("e", 64)
		}},
		{"fake-complete", func(_ *LocalFirstDirectoryAdvisoryChallenge, s *LocalFirstDirectoryAdvisorySeal) {
			s.Observation.BackupComplete = true
		}},
		{"fake-commit", func(_ *LocalFirstDirectoryAdvisoryChallenge, s *LocalFirstDirectoryAdvisorySeal) {
			s.Observation.CommitSupported = true
		}},
		{"fake-authority", func(_ *LocalFirstDirectoryAdvisoryChallenge, s *LocalFirstDirectoryAdvisorySeal) {
			s.Observation.Authoritative = true
		}},
		{"fake-delete", func(_ *LocalFirstDirectoryAdvisoryChallenge, s *LocalFirstDirectoryAdvisorySeal) {
			s.Observation.MissingInferenceSafe = true
		}},
		{"tag", func(_ *LocalFirstDirectoryAdvisoryChallenge, s *LocalFirstDirectoryAdvisorySeal) { s.Tag[0] ^= 1 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			modifiedChallenge, modifiedSeal := challenge, sealed
			tc.edit(&modifiedChallenge, &modifiedSeal)
			if VerifyLocalFirstDirectoryAdvisoryObservation(ctx, modifiedSeal, modifiedChallenge, token, now) {
				t.Fatal("modified private scope or native observation passed HMAC")
			}
		})
	}
}

func TestLocalFirstDirectoryAdvisoryRejectsBogusChallengesAndCancellation(t *testing.T) {
	challenge, observed, token, now := advisoryChallengeSample(t)
	ctx := context.Background()
	for name, modify := range map[string]func(*LocalFirstDirectoryAdvisoryChallenge){
		"empty-owner":     func(c *LocalFirstDirectoryAdvisoryChallenge) { c.OwnerID = 0 },
		"empty-target":    func(c *LocalFirstDirectoryAdvisoryChallenge) { c.TargetNodeID = 0 },
		"empty-nonce":     func(c *LocalFirstDirectoryAdvisoryChallenge) { c.Nonce = [32]byte{} },
		"bad-device":      func(c *LocalFirstDirectoryAdvisoryChallenge) { c.DeviceID = "foreign" },
		"bad-root":        func(c *LocalFirstDirectoryAdvisoryChallenge) { c.RootID = "not-a-root" },
		"bad-fingerprint": func(c *LocalFirstDirectoryAdvisoryChallenge) { c.RootFingerprint = "untrusted" },
		"long-lived":      func(c *LocalFirstDirectoryAdvisoryChallenge) { c.ExpiresAt = c.IssuedAt.Add(3 * time.Minute) },
		"expired":         func(c *LocalFirstDirectoryAdvisoryChallenge) { c.ExpiresAt = now },
		"future":          func(c *LocalFirstDirectoryAdvisoryChallenge) { c.IssuedAt = now.Add(time.Second) },
		"negative-window": func(c *LocalFirstDirectoryAdvisoryChallenge) { c.ExpiresAt = c.IssuedAt.Add(-time.Second) },
	} {
		t.Run(name, func(t *testing.T) {
			bad := challenge
			modify(&bad)
			if _, err := SealLocalFirstDirectoryAdvisoryObservation(ctx, observed, bad, token, now); err == nil {
				t.Fatal("invalid challenge sealed")
			}
		})
	}
	for _, invalid := range []string{"", "too-short", strings.Repeat("z", 513)} {
		if _, err := SealLocalFirstDirectoryAdvisoryObservation(ctx, observed, challenge, invalid, now); err == nil {
			t.Fatal("invalid credential signed a challenge")
		}
	}
	if _, err := SealLocalFirstDirectoryAdvisoryObservation(ctx, observed, challenge, token, now.Add(-time.Second)); err == nil {
		t.Fatal("future challenge accepted on skewed local clock")
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := SealLocalFirstDirectoryAdvisoryObservation(cancelled, observed, challenge, token, now); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled challenge signed", err)
	}
	sealed, err := SealLocalFirstDirectoryAdvisoryObservation(ctx, observed, challenge, token, now)
	if err != nil || VerifyLocalFirstDirectoryAdvisoryObservation(cancelled, sealed, challenge, token, now) {
		t.Fatal("cancelled MAC verified", err)
	}
	var empty LocalFirstDirectoryAdvisorySeal
	if VerifyLocalFirstDirectoryAdvisoryObservation(ctx, empty, challenge, token, now) {
		t.Fatal("zero MAC accepted")
	}
}
