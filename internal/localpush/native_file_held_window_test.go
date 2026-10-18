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

func TestHeldCurrentOriginalRetainsNativeFileWindowAndRedactsIdentity(t *testing.T) {
	grant, config, _, snapshot, digest, body := localNativeStagingFixture(t)
	if !grant.StrongIdentity {
		t.Skip("native file handle strong identity unavailable")
	}
	if err := SaveRootGrant(config, grant); err != nil {
		t.Fatal(err)
	}
	calls := 0
	got, err := WithHeldCurrentOriginalReadCheckpoint(
		context.Background(), config, grant, snapshot, "source.bin", digest, int64(len(body)),
		func(ctx context.Context, held NativeHeldCurrentOriginal) error {
			calls++
			if ctx.Err() != nil || held.SourceID != grant.SourceID ||
				held.DeviceID != grant.DeviceID || held.RootID != grant.RootID ||
				held.SnapshotSHA256 != snapshot || held.ContentSHA256 != digest ||
				held.Size != int64(len(body)) || held.RelativePath != "source.bin" {
				t.Fatalf("wrong original native descriptor scope: %+v", held)
			}
			key, keyErr := LocalInventoryPathKey(grant, "file", "source.bin")
			if keyErr != nil || held.PathKey != key || held.NativeKey == "" {
				t.Fatalf("native Root path binding invalid: %+v %v", held, keyErr)
			}
			raw, jsonErr := json.Marshal(held)
			if jsonErr != nil || string(raw) != "{}" {
				t.Fatalf("native Root/private identity leaked: %q %v", raw, jsonErr)
			}
			return nil
		})
	if err != nil || calls != 1 || got.ContentSHA256 != digest ||
		got.SnapshotSHA256 != snapshot || got.Size != int64(len(body)) {
		t.Fatalf("held native original read failed: %+v calls=%d %v", got, calls, err)
	}
	raw, err := json.Marshal(got)
	if err != nil || string(raw) != "{}" {
		t.Fatalf("native observation escaped in JSON: %q %v", raw, err)
	}
}

func TestHeldCurrentOriginalRejectsInPlaceChangeDuringCheckpoint(t *testing.T) {
	grant, config, root, snapshot, digest, body := localNativeStagingFixture(t)
	if !grant.StrongIdentity {
		t.Skip("strong native identity unavailable")
	}
	if err := SaveRootGrant(config, grant); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "source.bin")
	calls := 0
	got, err := WithHeldCurrentOriginalReadCheckpoint(
		context.Background(), config, grant, snapshot, "source.bin", digest, int64(len(body)),
		func(context.Context, NativeHeldCurrentOriginal) error {
			calls++
			mutated := append([]byte(nil), body...)
			mutated[len(mutated)/2] ^= 0xff
			return os.WriteFile(file, mutated, 0o600)
		})
	if err == nil || got.ContentSHA256 != "" || calls != 1 {
		t.Fatalf("mutated inode accepted as held original: %+v calls=%d %v", got, calls, err)
	}
}

func TestHeldCurrentOriginalRejectsRevokedRootAndCancelledWindow(t *testing.T) {
	for _, scenario := range []string{"revoked", "cancelled", "bad-snapshot", "bad-content", "no-callback"} {
		t.Run(scenario, func(t *testing.T) {
			grant, config, _, snapshot, digest, body := localNativeStagingFixture(t)
			if !grant.StrongIdentity {
				t.Skip("strong native identity unavailable")
			}
			if err := SaveRootGrant(config, grant); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			calls := 0
			var cb func(context.Context, NativeHeldCurrentOriginal) error = func(context.Context, NativeHeldCurrentOriginal) error {
				calls++
				switch scenario {
				case "revoked":
					return RemoveRootGrant(config, grant.Server, grant.Account, grant.RootID)
				case "cancelled":
					cancel()
				}
				return nil
			}
			switch scenario {
			case "bad-snapshot":
				snapshot = strings.Repeat("e", 64)
			case "bad-content":
				digest = strings.Repeat("f", 64)
			case "no-callback":
				cb = nil
			}
			got, err := WithHeldCurrentOriginalReadCheckpoint(ctx, config, grant,
				snapshot, "source.bin", digest, int64(len(body)), cb)
			if err == nil || got.ContentSHA256 != "" {
				t.Fatalf("%s gave unauthorized held observation: %+v %v", scenario, got, err)
			}
			if scenario == "cancelled" && !errors.Is(err, context.Canceled) {
				t.Fatalf("lost native callback cancellation: %v", err)
			}
			if (scenario == "bad-snapshot" || scenario == "bad-content" || scenario == "no-callback") && calls != 0 {
				t.Fatalf("%s invoked callback despite invalid original", scenario)
			}
			if (scenario == "revoked" || scenario == "cancelled") && calls != 1 {
				t.Fatalf("%s did not exercise native held window", scenario)
			}
		})
	}
}
