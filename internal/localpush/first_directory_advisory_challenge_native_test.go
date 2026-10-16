//go:build linux || windows

package localpush

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLocalFirstDirectoryAdvisorySealRealNativeAndStalePhysicalReplacement(t *testing.T) {
	grant, configDir, nativeRoot, request := firstDirectoryNativeFixture(t)
	if err := SaveRootGrant(configDir, grant); err != nil {
		t.Fatal(err)
	}
	observed, err := RecheckLocalFirstDirectoryNative(
		context.Background(), configDir, grant, request,
	)
	if err != nil || !observed.NativeObserved {
		t.Fatalf("real sealed CURRENT/native directory precondition failed: %+v %v", observed, err)
	}
	now := time.Now().UTC()
	challenge, err := NewLocalFirstDirectoryAdvisoryChallenge(
		3, grant.SourceID, request.SourceRevision, 29,
		grant.DeviceID, grant.RootID, grant.Fingerprint, now,
	)
	if err != nil {
		t.Fatal(err)
	}
	const token = "test-private-owning-device-secret"
	sealed, err := SealLocalFirstDirectoryAdvisoryObservation(
		context.Background(), observed, challenge, token, now,
	)
	if err != nil || !VerifyLocalFirstDirectoryAdvisoryObservation(
		context.Background(), sealed, challenge, token, now,
	) {
		t.Fatalf("real native identity was not MAC-bound: %v", err)
	}
	physical := filepath.Join(nativeRoot, request.RelativeDirectory)
	if err := os.Rename(physical, physical+"-old"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(physical, 0o700); err != nil {
		t.Fatal(err)
	}
	newObservation, err := RecheckLocalFirstDirectoryNative(
		context.Background(), configDir, grant, request,
	)
	if err == nil || newObservation.NativeObserved {
		t.Fatalf("replaced OS directory accepted as CURRENT: %+v %v", newObservation, err)
	}
	// Crucial negative boundary: the OLD signed value can still pass an
	// integrity-only MAC check after filesystem replacement. This is expected,
	// not authorization. Future Server admission MUST include a fresh native
	// handle/lifetime fence and durable one-time challenge consumption.
	if !VerifyLocalFirstDirectoryAdvisoryObservation(
		context.Background(), sealed, challenge, token, now,
	) {
		t.Fatal("advisory MAC unexpectedly claimed live filesystem state")
	}
	if sealed.Observation.Authoritative || sealed.Observation.CommitSupported ||
		sealed.Observation.BackupComplete || sealed.Observation.MissingInferenceSafe {
		t.Fatal("expired physical evidence granted write, backup or Mirror authority")
	}
}
