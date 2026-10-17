package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

type heldOperationTestScope struct {
	configDir string
	account   userconfig.Config
	source    client.Source
	proof     client.LocalBoundSourceProof
	request   localpush.LocalFirstDirectoryNativeRecheckRequest
	observed  localpush.LocalFirstDirectoryNativeObservation
	grant     localpush.RootGrant
	reads     int
	held      bool
	actions   int
}

func newHeldOperationTestScope(t *testing.T) *heldOperationTestScope {
	t.Helper()
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	configDir := filepath.Join(t.TempDir(), "xdrive")
	root := filepath.Join(t.TempDir(), "Pictures")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	source, _, request, observed := sampleLocalBoundFirstDirectory()
	account := userconfig.Config{Server: "https://owner.test", Username: "alice", SessionID: "session-current"}
	grant, err := localpush.PrepareRootGrant(account.Server, account.Username, source.ID, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	if !grant.StrongIdentity {
		t.Skip("this filesystem does not provide strong native Root identity")
	}
	if err := localpush.SaveRootGrant(configDir, grant); err != nil {
		t.Fatal(err)
	}
	proof := client.LocalBoundSourceProof{
		DeviceID: grant.DeviceID, DeviceToken: "owning-private-token",
		RootID: grant.RootID, RootFingerprint: grant.Fingerprint,
	}
	key, err := localpush.LocalInventoryPathKey(grant, "directory", request.RelativeDirectory)
	if err != nil {
		t.Fatal(err)
	}
	observed.DeviceID = proof.DeviceID
	observed.RootID = proof.RootID
	observed.CurrentPathKey = key
	return &heldOperationTestScope{
		configDir: configDir, account: account, source: source,
		proof: proof, request: request, observed: observed, grant: grant,
	}
}

func (f *heldOperationTestScope) session() (userconfig.Config, error) {
	return f.account, nil
}

func (f *heldOperationTestScope) bound(_ context.Context, id uint64) (client.Source, client.LocalBoundSourceProof, error) {
	f.reads++
	if id != f.source.ID {
		return client.Source{}, client.LocalBoundSourceProof{}, errors.New("wrong native Source")
	}
	return f.source, f.proof, nil
}

func (f *heldOperationTestScope) native(ctx context.Context, proof client.LocalBoundSourceProof,
	request localpush.LocalFirstDirectoryNativeRecheckRequest,
	checkpoint func(context.Context, localpush.LocalFirstDirectoryNativeObservation) error,
) (localpush.LocalFirstDirectoryNativeObservation, error) {
	if proof != f.proof || request != f.request {
		return localpush.LocalFirstDirectoryNativeObservation{}, errors.New("foreign Root selector")
	}
	f.held = true
	err := checkpoint(ctx, f.observed)
	f.held = false
	return f.observed, err
}

func TestHeldLocalOperationMintThenRecoverSameKeyUnderNativeWindow(t *testing.T) {
	f := newHeldOperationTestScope(t)
	var first localPushPrivateRequestKey
	err := withBoundLocalPushHeldRequest(
		context.Background(), f.configDir, f.account, f.source.ID, f.request,
		true, f.session, f.bound, f.native,
		func(_ context.Context, key localPushPrivateRequestKey) error {
			if !f.held || f.reads != 2 || key.bytes == [32]byte{} {
				t.Fatal("fresh key escaped unverified held window")
			}
			f.actions++
			first = key
			return nil
		})
	if err != nil || f.reads != 3 || f.actions != 1 {
		t.Fatalf("owning request not fenced: err=%v reads=%d actions=%d", err, f.reads, f.actions)
	}
	wire, err := json.Marshal(first)
	if err != nil || string(wire) != "{}" {
		t.Fatalf("Agent private request key was serialized: %s err=%v", wire, err)
	}
	f.reads = 0
	err = withBoundLocalPushHeldRequest(
		context.Background(), f.configDir, f.account, f.source.ID, f.request,
		false, f.session, f.bound, f.native,
		func(_ context.Context, key localPushPrivateRequestKey) error {
			if !f.held || f.reads != 2 || key != first {
				t.Fatal("lost-reply recovery widened or replaced request key")
			}
			f.actions++
			return nil
		})
	if err != nil || f.reads != 3 || f.actions != 2 {
		t.Fatalf("exact recovery failed: err=%v reads=%d actions=%d", err, f.reads, f.actions)
	}
	// Repeating the NEW operation is never an accidental retry.
	f.reads = 0
	err = withBoundLocalPushHeldRequest(
		context.Background(), f.configDir, f.account, f.source.ID, f.request,
		true, f.session, f.bound, f.native,
		func(context.Context, localPushPrivateRequestKey) error {
			t.Fatal("a second new operation preempted a still-pending key")
			return nil
		})
	if err == nil {
		t.Fatal("same Source minted a second request key")
	}
}

func TestHeldLocalOperationDeniesChangedScopeBeforeAction(t *testing.T) {
	for _, scenario := range []string{
		"foreign-login", "session-rotated", "revised-source", "changed-target",
		"revoked-device", "replaced-root", "wrong-native-identity",
		"missing-action", "cancel-before",
	} {
		t.Run(scenario, func(t *testing.T) {
			f := newHeldOperationTestScope(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			current := f.session
			readBound := f.bound
			native := f.native
			var action func(context.Context, localPushPrivateRequestKey) error = func(_ context.Context, _ localPushPrivateRequestKey) error {
				f.actions++
				return nil
			}
			switch scenario {
			case "foreign-login":
				f.account.Username = "bob"
			case "session-rotated":
				current = func() (userconfig.Config, error) {
					out := f.account
					out.SessionID = "different-session"
					return out, nil
				}
			case "revised-source":
				f.source.Revision++
			case "changed-target":
				readBound = func(ctx context.Context, id uint64) (client.Source, client.LocalBoundSourceProof, error) {
					if f.reads == 1 {
						next := uint64(500)
						f.source.TargetNodeID = &next
					}
					return f.bound(ctx, id)
				}
			case "revoked-device":
				f.proof.DeviceToken = ""
			case "replaced-root":
				if err := os.Rename(f.grant.Path, f.grant.Path+"-old"); err != nil {
					t.Fatal(err)
				}
				if err := os.Mkdir(f.grant.Path, 0o700); err != nil {
					t.Fatal(err)
				}
			case "wrong-native-identity":
				f.observed.NativeIdentityKey = strings.Repeat("e", 64)
			case "missing-action":
				action = nil
			case "cancel-before":
				cancel()
			}
			err := withBoundLocalPushHeldRequest(
				ctx, f.configDir, f.account, f.source.ID, f.request, true,
				current, readBound, native, action)
			if err == nil || f.actions != 0 {
				t.Fatalf("%s admitted action: err=%v calls=%d", scenario, err, f.actions)
			}
		})
	}
}

func TestHeldLocalOperationDetectsRevocationAfterAction(t *testing.T) {
	f := newHeldOperationTestScope(t)
	err := withBoundLocalPushHeldRequest(
		context.Background(), f.configDir, f.account, f.source.ID, f.request,
		true, f.session, f.bound, f.native,
		func(_ context.Context, _ localPushPrivateRequestKey) error {
			if !f.held || f.reads != 2 {
				t.Fatal("action ran after native handle closure")
			}
			f.actions++
			f.proof.DeviceToken = "" // Simulate revoke before final Server check.
			return nil
		})
	if err == nil || f.actions != 1 || f.reads != 3 {
		t.Fatalf("post-action revoked session became a success: err=%v", err)
	}
}

func TestHeldLocalOperationCancellationCannotClaimSuccess(t *testing.T) {
	f := newHeldOperationTestScope(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	err := withBoundLocalPushHeldRequest(
		ctx, f.configDir, f.account, f.source.ID, f.request,
		true, f.session, f.bound, f.native,
		func(_ context.Context, _ localPushPrivateRequestKey) error {
			f.actions++
			cancel()
			return nil // A callback cannot ignore cancellation to claim success.
		})
	if !errors.Is(err, context.Canceled) || f.actions != 1 {
		t.Fatalf("cancelled native window was accepted: err=%v actions=%d", err, f.actions)
	}
	// The uncertain key is retained for an explicit recovery; not overwritten.
	if _, err := loadLocalPushOperationRequestKey(f.configDir, localPushRequestKeyScope{
		server: f.account.Server, account: f.account.Username, sessionID: f.account.SessionID,
		deviceID: f.proof.DeviceID, rootID: f.proof.RootID, rootFingerprint: f.proof.RootFingerprint,
		sourceID: f.source.ID, revision: f.source.Revision, targetNodeID: *f.source.TargetNodeID,
	}); err != nil {
		t.Fatalf("cancel discarded a potentially sent request: %v", err)
	}
}

func TestHeldLocalOperationMissingKeyCannotRecover(t *testing.T) {
	f := newHeldOperationTestScope(t)
	err := withBoundLocalPushHeldRequest(
		context.Background(), f.configDir, f.account, f.source.ID, f.request,
		false, f.session, f.bound, f.native,
		func(context.Context, localPushPrivateRequestKey) error {
			t.Fatal("recovery without a persisted key executed an action")
			return nil
		})
	if err == nil || f.reads != 2 {
		t.Fatalf("missing private key was accepted or not checked within native window: %v", err)
	}
}
