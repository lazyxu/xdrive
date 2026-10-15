package storage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func localPushTestStageKey() string {
	return UploadStagingDir + "/localpush/" + uuid.NewString() + ".part"
}

func TestLocalPushPinnedStageFencesWritersCleanupAndPromotion(t *testing.T) {
	root := t.TempDir()
	owner, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	peer, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	key := localPushTestStageKey()
	body := []byte("original-agent-temporary-bytes")
	if _, err := owner.Put(context.Background(), key, bytes.NewReader(body)); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(body)
	canonical, err := ContentAddressedKey(hex.EncodeToString(digest[:]))
	if err != nil {
		t.Fatal(err)
	}
	pinned, err := owner.OpenPinnedLocalPushStage(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	defer pinned.Close()
	blocked := func(name string, f func(context.Context) error) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 140*time.Millisecond)
		defer cancel()
		if err := f(ctx); !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("%s bypassed an active cross-Server stage pin: %v", name, err)
		}
	}
	blocked("put", func(ctx context.Context) error {
		_, err := peer.Put(ctx, key, strings.NewReader("other bytes"))
		return err
	})
	blocked("delete", func(ctx context.Context) error { return peer.Delete(ctx, key) })
	blocked("staging janitor", func(ctx context.Context) error { return peer.DeleteStaging(ctx, key) })
	blocked("promote to canonical CAS", func(ctx context.Context) error {
		return peer.Promote(ctx, key, canonical, int64(len(body)))
	})
	got, err := io.ReadAll(pinned)
	if err != nil || !bytes.Equal(got, body) {
		t.Fatalf("pinned temporary content changed during cooperating writers: %q %v", got, err)
	}
	if err := pinned.Close(); err != nil {
		t.Fatal(err)
	}
	// After Close, the write/rename admission can proceed, but this test
	// proves only storage lifetime cooperation, NOT any SQL/CAS reference.
	if err := peer.Promote(context.Background(), key, canonical, int64(len(body))); err != nil {
		t.Fatal(err)
	}
	check, err := owner.OpenPinnedCAS(context.Background(), canonical)
	if err != nil {
		t.Fatal(err)
	}
	read, err := io.ReadAll(check)
	_ = check.Close()
	if err != nil || !bytes.Equal(read, body) {
		t.Fatalf("physical canonical content changed: %q %v", read, err)
	}
	if err := owner.Delete(context.Background(), canonical); err != nil {
		t.Fatal(err)
	}
}

func TestLocalPushPinnedStageRejectsWrongKeySymlinkAndCancellation(t *testing.T) {
	owner, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	key := localPushTestStageKey()
	for _, invalid := range []string{
		"some-temp-file",
		UploadStagingDir + "/localpush/not-uuid.part",
		UploadStagingDir + "/localpush/../localpush/" + strings.TrimPrefix(key, UploadStagingDir+"/localpush/"),
	} {
		if got, err := owner.OpenPinnedLocalPushStage(context.Background(), invalid); err == nil || got != nil {
			t.Fatalf("invalid stage accepted: %q %v", invalid, err)
		}
		if _, err := owner.Put(context.Background(), invalid, strings.NewReader("wrong")); err == nil &&
			strings.HasPrefix(filepath.ToSlash(filepath.Clean(filepath.FromSlash(invalid))), UploadStagingDir+"/localpush/") {
			t.Fatalf("noncanonical stage writer bypassed lifecycle lease: %q", invalid)
		}
	}
	if runtime.GOOS == "windows" {
		// On Windows an upper-case namespace prefix aliases the same
		// physical file. It must not bypass a stage's exclusive lease.
		alias := strings.ToUpper(UploadStagingDir) +
			strings.TrimPrefix(key, UploadStagingDir)
		if _, err := owner.Put(context.Background(), alias, strings.NewReader("alias")); err == nil {
			t.Fatal("case-aliased Windows stage write bypassed lifecycle lease")
		}
		if pin, err := owner.OpenPinnedLocalPushStage(context.Background(), alias); err == nil || pin != nil {
			t.Fatalf("case-aliased Windows stage pin accepted: %v", err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got, err := owner.OpenPinnedLocalPushStage(ctx, key); !errors.Is(err, context.Canceled) || got != nil {
		t.Fatalf("canceled stage pin admitted: %v", err)
	}
	if _, err := owner.Put(context.Background(), key, strings.NewReader("one")); err != nil {
		t.Fatal(err)
	}
	full := filepath.Join(owner.FilesystemRoot(), filepath.FromSlash(key))
	external := filepath.Join(t.TempDir(), "outside")
	if err := os.WriteFile(external, []byte("one"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(full); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(external, full); err != nil {
		t.Skipf("platform does not permit symlink creation: %v", err)
	}
	if got, err := owner.OpenPinnedLocalPushStage(context.Background(), key); err == nil || got != nil {
		t.Fatalf("symlinked private stage became a trusted pinned handle: %v", err)
	}
}
