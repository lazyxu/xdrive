//go:build linux || windows

package localpush

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func localEvidenceLiveFixture(t *testing.T) (RootGrant, string, string, []LocalEvidenceContentCandidate) {
	t.Helper()
	root, grant, config := deltaFixture(t)
	for name, body := range map[string]string{
		"before-a.txt": "immutable-original-A",
		"before-b.txt": "immutable-original-B",
	} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	deltaScan(t, config, grant)
	for from, to := range map[string]string{
		"before-a.txt": "after-a.txt",
		"before-b.txt": "after-b.txt",
	} {
		if err := os.Rename(filepath.Join(root, from), filepath.Join(root, to)); err != nil {
			t.Fatal(err)
		}
	}
	deltaScan(t, config, grant)
	if _, err := PublishLocalReconcileEvidence(context.Background(), config, grant, 7); err != nil {
		t.Fatal(err)
	}
	var hints []InventoryRenameHint
	if _, err := StreamInventoryNativeRenameHints(context.Background(), config, grant, 8,
		func(batch []InventoryRenameHint) error {
			hints = append(hints, batch...)
			return nil
		}); err != nil {
		t.Fatal(err)
	}
	if len(hints) != 2 {
		// On a platform/filesystem without a strong native identifier the
		// conservative rename stage cannot supply candidates.
		t.Skipf("no strong single-link native rename candidates: %d", len(hints))
	}
	candidates := make([]LocalEvidenceContentCandidate, 0, len(hints))
	for _, hint := range hints {
		oldKey, err := LocalInventoryPathKey(grant, "file", hint.PreviousPath)
		if err != nil {
			t.Fatal(err)
		}
		newKey, err := LocalInventoryPathKey(grant, "file", hint.CurrentPath)
		if err != nil {
			t.Fatal(err)
		}
		candidates = append(candidates, LocalEvidenceContentCandidate{
			PreviousPathKey: oldKey, CurrentPathKey: newKey,
			NativeIdentityKey: hint.NativeIdentityKey,
		})
	}
	return grant, config, root, candidates
}

func TestLocalEvidenceLiveHashValidatesBothGenerationsAndOriginalBytes(t *testing.T) {
	grant, config, root, candidates := localEvidenceLiveFixture(t)
	result, err := HashCurrentLocalEvidenceBatch(
		context.Background(), config, grant, 7, candidates)
	if err != nil || len(result.Digests) != 2 || result.HashedBytes <= 0 ||
		result.CloudContentVerified || result.Authoritative || result.MissingInferenceSafe {
		t.Fatalf("not a bounded native-only content verification: %+v err=%v", result, err)
	}
	observed := make(map[string]int64)
	for i, got := range result.Digests {
		if got.Size <= 0 || len(got.SHA256) != 64 {
			t.Fatalf("invalid private digest: %+v", got)
		}
		// The relative path is derived only from the sealed CURRENT journal
		// matched by strong native identity and rehashed live file content,
		// never invented from a client-supplied hash or stale previous path.
		pathKey, keyErr := LocalInventoryPathKey(grant, "file", got.CurrentRelativePath)
		if keyErr != nil || pathKey != candidates[i].CurrentPathKey {
			t.Fatalf("private live path is not bound to the current identity: %+v %v", got, keyErr)
		}
		observed[got.SHA256] = got.Size
	}
	// Even accidental JSON serialization of this Agent-private result must
	// not expose a local file name to Web, Desktop or a log payload.
	serialized, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"CurrentRelativePath", "after-a.txt", "after-b.txt"} {
		if strings.Contains(string(serialized), forbidden) {
			t.Fatalf("private source path leaked through JSON: %q", forbidden)
		}
	}
	for _, payload := range []string{"immutable-original-A", "immutable-original-B"} {
		digest := sha256.Sum256([]byte(payload))
		sha := hex.EncodeToString(digest[:])
		if observed[sha] != int64(len(payload)) {
			t.Fatalf("wrong native file digest: sha=%s map=%v", sha, observed)
		}
	}
	wrongOld := append([]LocalEvidenceContentCandidate(nil), candidates...)
	wrongOld[0].PreviousPathKey = strings.Repeat("c", 64)
	if got, err := HashCurrentLocalEvidenceBatch(
		context.Background(), config, grant, 7, wrongOld); err == nil || len(got.Digests) != 0 {
		t.Fatalf("wrong old path gained a file hash: %+v %v", got, err)
	}
	wrongNew := append([]LocalEvidenceContentCandidate(nil), candidates...)
	wrongNew[0].CurrentPathKey = strings.Repeat("d", 64)
	if got, err := HashCurrentLocalEvidenceBatch(
		context.Background(), config, grant, 7, wrongNew); err == nil || len(got.Digests) != 0 {
		t.Fatalf("wrong new path gained a file hash: %+v %v", got, err)
	}
	wrongNative := append([]LocalEvidenceContentCandidate(nil), candidates...)
	wrongNative[0].NativeIdentityKey = strings.Repeat("e", 64)
	if got, err := HashCurrentLocalEvidenceBatch(
		context.Background(), config, grant, 7, wrongNative); err == nil || len(got.Digests) != 0 {
		t.Fatalf("invented native identity accepted: %+v %v", got, err)
	}
	// A stale journal observation must never authorize hashing replaced bytes.
	if err := os.WriteFile(filepath.Join(root, "after-a.txt"),
		[]byte("original changed after scan, before content preflight"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got, err := HashCurrentLocalEvidenceBatch(
		context.Background(), config, grant, 7, candidates); err == nil || len(got.Digests) != 0 {
		t.Fatalf("modified current file accepted: %+v %v", got, err)
	}
}

func TestLocalEvidenceLiveHashRejectsCancellationRotationAndRootSwap(t *testing.T) {
	grant, config, root, candidates := localEvidenceLiveFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got, err := HashCurrentLocalEvidenceBatch(
		ctx, config, grant, 7, candidates); !errors.Is(err, context.Canceled) ||
		len(got.Digests) != 0 {
		t.Fatalf("cancelled hash succeeded: %+v %v", got, err)
	}
	if got, err := HashCurrentLocalEvidenceBatch(
		context.Background(), config, grant, 8, candidates); err == nil ||
		len(got.Digests) != 0 {
		t.Fatalf("stale Source revision accepted: %+v %v", got, err)
	}
	if err := os.WriteFile(filepath.Join(root, "new-file.txt"), []byte("later"), 0o600); err != nil {
		t.Fatal(err)
	}
	deltaScan(t, config, grant)
	if got, err := HashCurrentLocalEvidenceBatch(
		context.Background(), config, grant, 7, candidates); err == nil ||
		len(got.Digests) != 0 {
		t.Fatalf("rotated current generation accepted: %+v %v", got, err)
	}
	if err := os.Rename(root, root+"-old"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if got, err := HashCurrentLocalEvidenceBatch(
		context.Background(), config, grant, 7, candidates); err == nil ||
		len(got.Digests) != 0 {
		t.Fatalf("replacement Root gained private digest: %+v %v", got, err)
	}
}

func TestLocalEvidenceContentCandidatesRejectAmbiguousAndUnboundedClaims(t *testing.T) {
	a := LocalEvidenceContentCandidate{
		PreviousPathKey:   strings.Repeat("1", 64),
		CurrentPathKey:    strings.Repeat("2", 64),
		NativeIdentityKey: strings.Repeat("3", 64),
	}
	b := LocalEvidenceContentCandidate{
		PreviousPathKey:   strings.Repeat("4", 64),
		CurrentPathKey:    strings.Repeat("5", 64),
		NativeIdentityKey: strings.Repeat("6", 64),
	}
	if !validLocalEvidenceContentCandidates([]LocalEvidenceContentCandidate{a, b}) {
		t.Fatal("valid bounded private claims rejected")
	}
	for _, claims := range [][]LocalEvidenceContentCandidate{
		nil, {},
		{a, a},
		{a, {PreviousPathKey: b.PreviousPathKey,
			CurrentPathKey: b.CurrentPathKey, NativeIdentityKey: a.NativeIdentityKey}},
		{a, {PreviousPathKey: a.PreviousPathKey,
			CurrentPathKey: b.CurrentPathKey, NativeIdentityKey: b.NativeIdentityKey}},
		{a, {PreviousPathKey: b.PreviousPathKey,
			CurrentPathKey: a.CurrentPathKey, NativeIdentityKey: b.NativeIdentityKey}},
		{{PreviousPathKey: strings.Repeat("0", 64),
			CurrentPathKey: a.CurrentPathKey, NativeIdentityKey: a.NativeIdentityKey}},
		{{PreviousPathKey: strings.ToUpper(strings.Repeat("a", 64)),
			CurrentPathKey: a.CurrentPathKey, NativeIdentityKey: a.NativeIdentityKey}},
		{{PreviousPathKey: a.PreviousPathKey,
			CurrentPathKey: a.PreviousPathKey, NativeIdentityKey: a.NativeIdentityKey}},
		make([]LocalEvidenceContentCandidate, 65),
	} {
		if validLocalEvidenceContentCandidates(claims) {
			t.Fatalf("invalid/unbounded native claims accepted: %+v", claims)
		}
	}
}
