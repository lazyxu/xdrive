//go:build linux

package localpush

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// A matching content digest is not an original-file identity. Replacing the
// pathname with a new inode while the old descriptor remains open must deny.
func TestHeldCurrentOriginalRejectsSameBytesPathReplacement(t *testing.T) {
	grant, config, root, snapshot, digest, body := localNativeStagingFixture(t)
	if !grant.StrongIdentity {
		t.Skip("native file identity is not strong")
	}
	if err := SaveRootGrant(config, grant); err != nil {
		t.Fatal(err)
	}
	original := filepath.Join(root, "source.bin")
	parked := original + ".old"
	calls := 0
	got, err := WithHeldCurrentOriginalReadCheckpoint(
		context.Background(), config, grant, snapshot, "source.bin", digest, int64(len(body)),
		func(context.Context, NativeHeldCurrentOriginal) error {
			calls++
			if err := os.Rename(original, parked); err != nil {
				return err
			}
			return os.WriteFile(original, body, 0o600)
		})
	if err == nil || got.ContentSHA256 != "" || calls != 1 {
		t.Fatalf("path replacement reused original identity: %+v calls=%d %v", got, calls, err)
	}
}
