package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
)

func sampleOwningDirectoryAdvisoryChallenge(t *testing.T) (
	client.Source, client.LocalBoundSourceProof,
	localpush.LocalFirstDirectoryNativeRecheckRequest,
	localpush.LocalFirstDirectoryNativeObservation,
	localpush.LocalFirstDirectoryAdvisoryChallenge,
) {
	t.Helper()
	source, proof, request, observed := sampleLocalBoundFirstDirectory()
	challenge, err := localpush.NewLocalFirstDirectoryAdvisoryChallenge(
		11, source.ID, source.Revision, *source.TargetNodeID,
		proof.DeviceID, proof.RootID, proof.RootFingerprint,
		time.Now().UTC().Add(-time.Second),
	)
	if err != nil {
		t.Fatal(err)
	}
	return source, proof, request, observed, challenge
}

func TestLocalFirstDirectoryOwningSealValidatesTwoBoundReads(t *testing.T) {
	source, proof, request, observed, challenge := sampleOwningDirectoryAdvisoryChallenge(t)
	boundReads, nativeReads := 0, 0
	seal, err := sealLocalBoundFirstDirectoryAdvisory(
		context.Background(), source.ID, request, challenge,
		func(_ context.Context, id uint64) (client.Source, client.LocalBoundSourceProof, error) {
			boundReads++
			if id != source.ID {
				t.Fatal("bound read crossed Source")
			}
			return source, proof, nil
		},
		func(_ context.Context, p client.LocalBoundSourceProof, r localpush.LocalFirstDirectoryNativeRecheckRequest) (localpush.LocalFirstDirectoryNativeObservation, error) {
			nativeReads++
			if p != proof || r != request {
				t.Fatal("native read escaped owning Root/revision")
			}
			return observed, nil
		},
	)
	if err != nil || boundReads != 2 || nativeReads != 1 ||
		!localpush.VerifyLocalFirstDirectoryAdvisoryObservation(
			context.Background(), seal, challenge, proof.DeviceToken, time.Now().UTC(),
		) || seal.Observation.BackupComplete || seal.Observation.CommitSupported ||
		seal.Observation.Authoritative || seal.Observation.MissingInferenceSafe {
		t.Fatalf("owning native advisory seal invalid: %+v err=%v bound=%d native=%d", seal, err, boundReads, nativeReads)
	}
	raw, err := json.Marshal(seal)
	if err != nil || string(raw) != "{}" || strings.Contains(string(raw), proof.DeviceToken) {
		t.Fatalf("private Agent seal escaped JSON: %s %v", raw, err)
	}
}

func TestLocalFirstDirectoryOwningSealRejectsDriftBeforeAndAfterNative(t *testing.T) {
	scenarios := []string{
		"foreign-source", "foreign-target", "foreign-device", "foreign-root",
		"foreign-fingerprint", "wrong-revision", "revoked-last-token",
		"changed-target-after-native", "wrong-native-identity",
		"fake-native-authority", "native-denied", "cancel-before", "cancel-native",
	}
	for _, scenario := range scenarios {
		t.Run(scenario, func(t *testing.T) {
			source, proof, request, observed, challenge := sampleOwningDirectoryAdvisoryChallenge(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			switch scenario {
			case "foreign-source":
				challenge.SourceID++
			case "foreign-target":
				challenge.TargetNodeID++
			case "foreign-device":
				challenge.DeviceID = uuid.NewString()
			case "foreign-root":
				challenge.RootID = uuid.NewString()
			case "foreign-fingerprint":
				challenge.RootFingerprint = strings.Repeat("f", 64)
			case "wrong-revision":
				challenge.SourceRevision++
			case "wrong-native-identity":
				observed.NativeIdentityKey = strings.Repeat("e", 64)
			case "fake-native-authority":
				observed.CommitSupported = true
			case "cancel-before":
				cancel()
			}
			boundReads, nativeReads := 0, 0
			seal, err := sealLocalBoundFirstDirectoryAdvisory(
				ctx, source.ID, request, challenge,
				func(_ context.Context, _ uint64) (client.Source, client.LocalBoundSourceProof, error) {
					boundReads++
					if boundReads == 2 {
						switch scenario {
						case "revoked-last-token":
							proof.DeviceToken = ""
						case "changed-target-after-native":
							target := uint64(999)
							source.TargetNodeID = &target
						}
					}
					return source, proof, nil
				},
				func(_ context.Context, _ client.LocalBoundSourceProof, _ localpush.LocalFirstDirectoryNativeRecheckRequest) (localpush.LocalFirstDirectoryNativeObservation, error) {
					nativeReads++
					switch scenario {
					case "native-denied":
						return localpush.LocalFirstDirectoryNativeObservation{}, errors.New("raw private native path")
					case "cancel-native":
						cancel()
					}
					return observed, nil
				},
			)
			if err == nil || seal.Observation.NativeObserved || seal.Tag != ([32]byte{}) {
				t.Fatalf("stale or forged private seal accepted: %+v err=%v", seal, err)
			}
			if strings.Contains(err.Error(), "raw private native path") {
				t.Fatalf("Agent leaked raw native error: %v", err)
			}
			if (scenario == "foreign-source" || scenario == "cancel-before") &&
				(boundReads != 0 || nativeReads != 0) {
				t.Fatalf("unsafe IO before basic preflight: bound=%d native=%d", boundReads, nativeReads)
			}
			if (scenario == "foreign-target" || scenario == "foreign-device" ||
				scenario == "foreign-root" || scenario == "foreign-fingerprint" ||
				scenario == "wrong-revision") && nativeReads != 0 {
				t.Fatal("mismatched challenge reached native filesystem")
			}
			if strings.HasPrefix(scenario, "cancel-") && !errors.Is(err, context.Canceled) {
				t.Fatalf("cancellation was not propagated: %v", err)
			}
		})
	}
}

func TestLocalFirstDirectoryHeldOwningSealRechecksBoundScopeInsideOpenWindow(t *testing.T) {
	source, proof, request, observed, challenge := sampleOwningDirectoryAdvisoryChallenge(t)
	serverReads, nativeReads := 0, 0
	held := false
	seal, err := sealLocalBoundFirstDirectoryAdvisoryHeld(
		context.Background(), source.ID, request, challenge,
		func(_ context.Context, _ uint64) (client.Source, client.LocalBoundSourceProof, error) {
			serverReads++
			if (serverReads == 1 && held) || (serverReads == 2 && !held) {
				return client.Source{}, client.LocalBoundSourceProof{}, errors.New("Server proof read after releasing native directory")
			}
			return source, proof, nil
		},
		func(ctx context.Context, p client.LocalBoundSourceProof,
			req localpush.LocalFirstDirectoryNativeRecheckRequest,
			checkpoint func(context.Context, localpush.LocalFirstDirectoryNativeObservation) error,
		) (localpush.LocalFirstDirectoryNativeObservation, error) {
			nativeReads++
			if p != proof || req != request {
				return localpush.LocalFirstDirectoryNativeObservation{}, errors.New("foreign native selector")
			}
			held = true
			err := checkpoint(ctx, observed)
			held = false
			return observed, err
		},
	)
	if err != nil || held || serverReads != 2 || nativeReads != 1 ||
		!localpush.VerifyLocalFirstDirectoryAdvisoryObservation(
			context.Background(), seal, challenge, proof.DeviceToken, time.Now().UTC(),
		) || seal.Observation.BackupComplete || seal.Observation.CommitSupported ||
		seal.Observation.Authoritative || seal.Observation.MissingInferenceSafe {
		t.Fatalf("held owning seal not verified inside open native window: %+v err=%v server=%d native=%d", seal, err, serverReads, nativeReads)
	}
	body, err := json.Marshal(seal)
	if err != nil || string(body) != "{}" {
		t.Fatalf("held owning seal escaped private JSON: %s err=%v", body, err)
	}
}

func TestLocalFirstDirectoryHeldOwningSealRejectsRevokedProof(t *testing.T) {
	source, proof, request, observed, challenge := sampleOwningDirectoryAdvisoryChallenge(t)
	serverReads, held := 0, false
	seal, err := sealLocalBoundFirstDirectoryAdvisoryHeld(
		context.Background(), source.ID, request, challenge,
		func(_ context.Context, _ uint64) (client.Source, client.LocalBoundSourceProof, error) {
			serverReads++
			if serverReads == 2 {
				if !held {
					return client.Source{}, client.LocalBoundSourceProof{}, errors.New("native handle was already released")
				}
				proof.DeviceToken = ""
			}
			return source, proof, nil
		},
		func(ctx context.Context, _ client.LocalBoundSourceProof,
			_ localpush.LocalFirstDirectoryNativeRecheckRequest,
			checkpoint func(context.Context, localpush.LocalFirstDirectoryNativeObservation) error,
		) (localpush.LocalFirstDirectoryNativeObservation, error) {
			held = true
			err := checkpoint(ctx, observed)
			held = false
			return observed, err
		},
	)
	if err == nil || seal.Observation.NativeObserved || seal.Tag != ([32]byte{}) ||
		serverReads != 2 {
		t.Fatalf("revoked owning proof produced a seal: %+v err=%v reads=%d", seal, err, serverReads)
	}
}
