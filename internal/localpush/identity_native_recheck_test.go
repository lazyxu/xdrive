//go:build linux || windows

package localpush

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func localIdentityNativeRecheckFixture(t *testing.T) (RootGrant, string, string, LocalIdentityNativeRecheckRequest, string) {
	t.Helper()
	grant, config, root, candidates := localEvidenceLiveFixture(t)
	generation, err := LoadLocalReconcileEvidence(context.Background(), config, grant, 7)
	if err != nil {
		t.Fatal(err)
	}
	batch, err := HashCurrentLocalEvidenceBatch(context.Background(), config, grant, 7, candidates[:1])
	if err != nil || len(batch.Digests) != 1 {
		t.Fatalf("native fixture cannot hash current original: %+v %v", batch, err)
	}
	request := LocalIdentityNativeRecheckRequest{
		SourceID: grant.SourceID, SourceRevision: 7,
		PreviousSnapshotSHA256: generation.PreviousSHA256,
		CurrentSnapshotSHA256:  generation.CurrentSHA256,
		Candidate:              candidates[0], ExpectedSHA256: batch.Digests[0].SHA256,
		ExpectedSize: batch.Digests[0].Size,
	}
	return grant, config, root, request, batch.Digests[0].CurrentRelativePath
}

func TestLocalIdentityNativeRecheckUsesStoredRootAndVerifiedOriginal(t *testing.T) {
	grant, config, _, request, relative := localIdentityNativeRecheckFixture(t)
	if got, err := RecheckLocalIdentityNativeCandidate(context.Background(), config, grant, request); err == nil || got.SourceID != 0 {
		t.Fatalf("unstored Root was accepted: %+v %v", got, err)
	}
	if err := SaveRootGrant(config, grant); err != nil {
		t.Fatal(err)
	}
	got, err := RecheckLocalIdentityNativeCandidate(context.Background(), config, grant, request)
	if err != nil || got.SourceID != request.SourceID || got.SourceRevision != request.SourceRevision ||
		got.RootID != grant.RootID || got.DeviceID != grant.DeviceID ||
		got.PreviousSnapshotSHA256 != request.PreviousSnapshotSHA256 ||
		got.CurrentSnapshotSHA256 != request.CurrentSnapshotSHA256 ||
		got.CurrentRelativePath != relative || got.SHA256 != request.ExpectedSHA256 ||
		got.Size != request.ExpectedSize {
		t.Fatalf("fresh private native evidence not bound to exact request: %+v %v", got, err)
	}
	encoded, err := json.Marshal(got)
	if err != nil || string(encoded) != "{}" || strings.Contains(string(encoded), relative) ||
		strings.Contains(string(encoded), grant.RootID) {
		t.Fatalf("native proof leaked into JSON: %s %v", encoded, err)
	}
	for name, mutate := range map[string]func(*LocalIdentityNativeRecheckRequest){
		"wrong-source":         func(r *LocalIdentityNativeRecheckRequest) { r.SourceID++ },
		"wrong-revision":       func(r *LocalIdentityNativeRecheckRequest) { r.SourceRevision++ },
		"wrong-old-generation": func(r *LocalIdentityNativeRecheckRequest) { r.PreviousSnapshotSHA256 = strings.Repeat("3", 64) },
		"wrong-new-generation": func(r *LocalIdentityNativeRecheckRequest) { r.CurrentSnapshotSHA256 = strings.Repeat("4", 64) },
		"wrong-hash":           func(r *LocalIdentityNativeRecheckRequest) { r.ExpectedSHA256 = strings.Repeat("5", 64) },
		"wrong-length":         func(r *LocalIdentityNativeRecheckRequest) { r.ExpectedSize++ },
		"oversized":            func(r *LocalIdentityNativeRecheckRequest) { r.ExpectedSize = maxLocalIdentityNativeRecheckBytes + 1 },
		"forged-current-key":   func(r *LocalIdentityNativeRecheckRequest) { r.Candidate.CurrentPathKey = strings.Repeat("6", 64) },
		"forged-native-key":    func(r *LocalIdentityNativeRecheckRequest) { r.Candidate.NativeIdentityKey = strings.Repeat("7", 64) },
	} {
		t.Run(name, func(t *testing.T) {
			bad := request
			mutate(&bad)
			got, err := RecheckLocalIdentityNativeCandidate(context.Background(), config, grant, bad)
			if err == nil || got.SourceID != 0 || got.CurrentRelativePath != "" {
				t.Fatalf("invalid expected identity gained private native observation: %+v %v", got, err)
			}
		})
	}
	if err := RemoveRootGrant(config, grant.Server, grant.Account, grant.RootID); err != nil {
		t.Fatal(err)
	}
	if got, err := RecheckLocalIdentityNativeCandidate(context.Background(), config, grant, request); err == nil || got.SourceID != 0 {
		t.Fatalf("removed local Root authorization accepted: %+v %v", got, err)
	}
}

func TestLocalIdentityNativeRecheckRejectsNativeChangesAndCancellation(t *testing.T) {
	grant, config, root, request, relative := localIdentityNativeRecheckFixture(t)
	if err := SaveRootGrant(config, grant); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got, err := RecheckLocalIdentityNativeCandidate(ctx, config, grant, request); !errors.Is(err, context.Canceled) || got.SourceID != 0 {
		t.Fatalf("cancelled recheck gained observation: %+v %v", got, err)
	}
	if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(relative)), []byte("changed current original"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got, err := RecheckLocalIdentityNativeCandidate(context.Background(), config, grant, request); err == nil || got.SourceID != 0 {
		t.Fatalf("mutated original accepted: %+v %v", got, err)
	}
}

func TestLocalIdentityNativeRecheckRejectsRotatedGenerationAndReplacedRoot(t *testing.T) {
	grant, config, root, request, _ := localIdentityNativeRecheckFixture(t)
	if err := SaveRootGrant(config, grant); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "extra.txt"), []byte("new generation"), 0o600); err != nil {
		t.Fatal(err)
	}
	deltaScan(t, config, grant)
	if got, err := RecheckLocalIdentityNativeCandidate(context.Background(), config, grant, request); err == nil || got.SourceID != 0 {
		t.Fatalf("rotated CURRENT manifest accepted: %+v %v", got, err)
	}
	if err := os.Rename(root, root+"-old"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if got, err := RecheckLocalIdentityNativeCandidate(context.Background(), config, grant, request); err == nil || got.SourceID != 0 {
		t.Fatalf("swapped Root identity accepted: %+v %v", got, err)
	}
}
