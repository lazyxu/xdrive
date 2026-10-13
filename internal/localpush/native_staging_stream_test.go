//go:build linux || windows

package localpush

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func localNativeStagingFixture(t *testing.T) (RootGrant, string, string, string, string, []byte) {
	t.Helper()
	root, grant, config := deltaFixture(t)
	body := bytes.Repeat([]byte("original-native-staging-file-"), 27000)
	if err := os.WriteFile(filepath.Join(root, "source.bin"), body, 0o600); err != nil {
		t.Fatal(err)
	}
	snapshot := deltaScan(t, config, grant)
	sum := sha256.Sum256(body)
	return grant, config, root, snapshot.SnapshotSHA256, hex.EncodeToString(sum[:]), body
}

func TestStreamCurrentInventoryFileToStagingUsesPersistedRootAndExactBytes(t *testing.T) {
	grant, config, _, snapshot, digest, body := localNativeStagingFixture(t)
	var pending bytes.Buffer
	if got, err := StreamCurrentInventoryFileToStaging(
		context.Background(), config, grant, snapshot, "source.bin", digest, &pending, nil,
	); err == nil || got.SHA256 != "" || pending.Len() != 0 {
		t.Fatalf("unsigned native Root streamed bytes: %+v %v", got, err)
	}
	if err := SaveRootGrant(config, grant); err != nil {
		t.Fatal(err)
	}
	pending.Reset()
	var updates int
	result, err := StreamCurrentInventoryFileToStaging(
		context.Background(), config, grant, snapshot, "source.bin", digest, &pending,
		func(done, total int64) error {
			updates++
			if done < 1 || done > total || total != int64(len(body)) {
				t.Fatalf("invalid transient staging progress %d/%d", done, total)
			}
			return nil
		})
	if err != nil || pending.Len() != len(body) || !bytes.Equal(pending.Bytes(), body) ||
		result.SHA256 != digest || result.Size != int64(len(body)) ||
		result.SnapshotSHA256 != snapshot || updates < 2 {
		t.Fatalf("native bytes not staged correctly: %+v updates=%d err=%v", result, updates, err)
	}
	encoded, err := json.Marshal(result)
	if err != nil || string(encoded) != "{}" {
		t.Fatalf("Agent-private Source bytes disclosed through JSON: %s %v", encoded, err)
	}
}

func TestStreamCurrentInventoryFileToStagingRejectsInvalidAndRotatedEvidence(t *testing.T) {
	grant, config, root, snapshot, digest, _ := localNativeStagingFixture(t)
	if err := SaveRootGrant(config, grant); err != nil {
		t.Fatal(err)
	}
	for name, testCase := range map[string]struct{ snapshot, relative, digest string }{
		"invalid snapshot": {strings.Repeat("f", 64), "source.bin", digest},
		"unsafe traversal": {snapshot, "../outside.bin", digest},
		"unknown file":     {snapshot, "other.bin", digest},
		"invalid digest":   {snapshot, "source.bin", strings.Repeat("Z", 64)},
	} {
		t.Run(name, func(t *testing.T) {
			var target bytes.Buffer
			got, err := StreamCurrentInventoryFileToStaging(context.Background(),
				config, grant, testCase.snapshot, testCase.relative, testCase.digest, &target, nil)
			if err == nil || got.SHA256 != "" || target.Len() != 0 {
				t.Fatalf("invalid current manifest staged bytes: %+v err=%v", got, err)
			}
		})
	}
	// A valid but incorrect digest can only fail after the native bytes are
	// copied. Caller MUST DISCARD the partially trusted staging buffer.
	var staging bytes.Buffer
	if got, err := StreamCurrentInventoryFileToStaging(context.Background(),
		config, grant, snapshot, "source.bin", strings.Repeat("a", 64), &staging, nil); err == nil ||
		got.SHA256 != "" || staging.Len() == 0 {
		t.Fatalf("wrong expected content became authoritative: %+v err=%v", got, err)
	}
	if err := os.WriteFile(filepath.Join(root, "new.txt"), []byte("rotate"), 0o600); err != nil {
		t.Fatal(err)
	}
	deltaScan(t, config, grant)
	staging.Reset()
	if got, err := StreamCurrentInventoryFileToStaging(context.Background(),
		config, grant, snapshot, "source.bin", digest, &staging, nil); err == nil ||
		got.SHA256 != "" || staging.Len() != 0 {
		t.Fatalf("rotated private journal allowed a source copy: %+v err=%v", got, err)
	}
}

type rejectNativeStagingWriter struct{}

func (rejectNativeStagingWriter) Write([]byte) (int, error) {
	return 0, errors.New("local staging capacity exhausted")
}

type shortNativeStagingWriter struct{}

func (shortNativeStagingWriter) Write(p []byte) (int, error) {
	return len(p) / 2, nil
}

func TestStreamCurrentInventoryFileToStagingStopsAtWriterErrorAndCancellation(t *testing.T) {
	grant, config, _, snapshot, digest, _ := localNativeStagingFixture(t)
	if err := SaveRootGrant(config, grant); err != nil {
		t.Fatal(err)
	}
	for _, writer := range []io.Writer{rejectNativeStagingWriter{}, shortNativeStagingWriter{}} {
		if got, err := StreamCurrentInventoryFileToStaging(context.Background(),
			config, grant, snapshot, "source.bin", digest, writer, nil); err == nil || got.SHA256 != "" {
			t.Fatalf("failed/short stage sink accepted: %+v err=%v", got, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var staging bytes.Buffer
	got, err := StreamCurrentInventoryFileToStaging(ctx, config, grant,
		snapshot, "source.bin", digest, &staging, func(done, _ int64) error {
			if done > 0 {
				cancel()
			}
			return nil
		})
	if !errors.Is(err, context.Canceled) || got.SHA256 != "" || staging.Len() == 0 {
		t.Fatalf("cancelled native staging gained a verified result: %+v %v", got, err)
	}
}

func TestStreamCurrentInventoryFileToStagingRevocationAndChangedNativeFile(t *testing.T) {
	grant, config, root, snapshot, digest, _ := localNativeStagingFixture(t)
	if err := SaveRootGrant(config, grant); err != nil {
		t.Fatal(err)
	}
	if err := os.Truncate(filepath.Join(root, "source.bin"), 123); err != nil {
		t.Fatal(err)
	}
	var staging bytes.Buffer
	if got, err := StreamCurrentInventoryFileToStaging(context.Background(),
		config, grant, snapshot, "source.bin", digest, &staging, nil); err == nil ||
		got.SHA256 != "" {
		t.Fatalf("mutated original staged as complete: %+v %v", got, err)
	}
	if err := RemoveRootGrant(config, grant.Server, grant.Account, grant.RootID); err != nil {
		t.Fatal(err)
	}
	staging.Reset()
	if got, err := StreamCurrentInventoryFileToStaging(context.Background(),
		config, grant, snapshot, "source.bin", digest, &staging, nil); err == nil ||
		got.SHA256 != "" || staging.Len() != 0 {
		t.Fatalf("revoked native Root staged bytes: %+v %v", got, err)
	}
}
