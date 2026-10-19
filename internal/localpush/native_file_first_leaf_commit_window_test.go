//go:build linux || windows

package localpush

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestFirstLeafCommitWindowHoldsAndRehashesNativeOriginal(t *testing.T) {
	grant, configDir, _, snapshot, digest, body := localNativeStagingFixture(t)
	if !grant.StrongIdentity {
		t.Skip("strong native original identity unavailable")
	}
	if err := SaveRootGrant(configDir, grant); err != nil {
		t.Fatal(err)
	}
	calls := 0
	got, err := WithHeldCurrentOriginalFirstLeafCommitWindow(
		context.Background(), configDir, grant, snapshot, "source.bin",
		digest, int64(len(body)),
		func(ctx context.Context, original NativeHeldCurrentOriginal) error {
			calls++
			if ctx.Err() != nil || original.SourceID != grant.SourceID ||
				original.DeviceID != grant.DeviceID || original.RootID != grant.RootID ||
				original.RelativePath != "source.bin" || original.NativeKey == "" ||
				original.ContentSHA256 != digest || original.SnapshotSHA256 != snapshot ||
				original.Size != int64(len(body)) {
				t.Fatal("specialized write window did not hold the native original")
			}
			return nil
		})
	if err != nil || calls != 1 || got.ContentSHA256 != digest ||
		got.Size != int64(len(body)) || got.NativeKey == "" {
		t.Fatalf("native first-leaf commit window failed: calls=%d err=%v", calls, err)
	}
}

func TestFirstLeafCommitWindowCannotClaimSuccessAfterNativeMutation(t *testing.T) {
	grant, configDir, root, snapshot, digest, body := localNativeStagingFixture(t)
	if !grant.StrongIdentity {
		t.Skip("strong native original identity unavailable")
	}
	if err := SaveRootGrant(configDir, grant); err != nil {
		t.Fatal(err)
	}
	calls := 0
	got, err := WithHeldCurrentOriginalFirstLeafCommitWindow(
		context.Background(), configDir, grant, snapshot, "source.bin",
		digest, int64(len(body)),
		func(context.Context, NativeHeldCurrentOriginal) error {
			calls++
			mutated := append([]byte(nil), body...)
			mutated[len(mutated)/2] ^= 0xff
			return os.WriteFile(filepath.Join(root, "source.bin"), mutated, 0o600)
		})
	if err == nil || calls != 1 || got.NativeKey != "" ||
		got.ContentSHA256 != "" {
		t.Fatalf("modified original promoted to first-leaf proof: calls=%d err=%v", calls, err)
	}
}
