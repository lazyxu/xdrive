package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

func TestVerifyLocalPushPhysicalStagingChecksActualFileAndLimits(t *testing.T) {
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	data := bytes.Repeat([]byte("real-owning-agent-bytes-"), 1400)
	hash := sha256.Sum256(data)
	stage := meta.LocalPushStaging{
		StageID: uuid.NewString(), TotalSize: int64(len(data)),
		ContentSHA256: hex.EncodeToString(hash[:]),
		Status:        localPushStageReady, ExpiresAt: time.Now().Add(time.Minute),
	}
	key, err := localPushStageStoreKey(stage.StageID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := local.Put(context.Background(), key, bytes.NewReader(data)); err != nil {
		t.Fatal(err)
	}
	if err := verifyLocalPushPhysicalStaging(context.Background(), local, stage); err != nil {
		t.Fatalf("exact physical stage rejected: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := verifyLocalPushPhysicalStaging(ctx, local, stage); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled temporary physical read accepted: %v", err)
	}
	bad := stage
	bad.TotalSize = localPushStageMaxBytes + 1
	if err := verifyLocalPushPhysicalStaging(context.Background(), local, bad); err == nil {
		t.Fatal("oversized temporary stage accepted")
	}
	bad = stage
	bad.ExpiresAt = time.Now().Add(-time.Second)
	if err := verifyLocalPushPhysicalStaging(context.Background(), local, bad); err == nil {
		t.Fatal("expired temporary stage accepted")
	}
	bad = stage
	bad.Status = localPushStageReserved
	if err := verifyLocalPushPhysicalStaging(context.Background(), local, bad); err == nil {
		t.Fatal("reserved but unwritten stage accepted")
	}
	corrupt := bytes.Repeat([]byte{0x8d}, len(data))
	if _, err := local.Put(context.Background(), key, bytes.NewReader(corrupt)); err != nil {
		t.Fatal(err)
	}
	if err := verifyLocalPushPhysicalStaging(context.Background(), local, stage); err == nil {
		t.Fatal("same-length out-of-band physical corruption accepted")
	}
	if _, err := local.Put(context.Background(), key, bytes.NewReader(data)); err != nil {
		t.Fatal(err)
	}
	if err := local.Delete(context.Background(), key); err != nil {
		t.Fatal(err)
	}
	if err := verifyLocalPushPhysicalStaging(context.Background(), local, stage); err == nil {
		t.Fatal("missing physical stage admitted from database status")
	}
}

func TestVerifyLocalPushPhysicalStagingRejectsSymlink(t *testing.T) {
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	data := []byte("staging-must-be-regular")
	sum := sha256.Sum256(data)
	stage := meta.LocalPushStaging{
		StageID: uuid.NewString(), TotalSize: int64(len(data)),
		ContentSHA256: hex.EncodeToString(sum[:]),
		Status:        localPushStageReady, ExpiresAt: time.Now().Add(time.Minute),
	}
	key, err := localPushStageStoreKey(stage.StageID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := local.Put(context.Background(), key, bytes.NewReader(data)); err != nil {
		t.Fatal(err)
	}
	full := filepath.Join(local.FilesystemRoot(), filepath.FromSlash(key))
	other := filepath.Join(t.TempDir(), "external")
	if err := os.WriteFile(other, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(full); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(other, full); err != nil {
		t.Skipf("platform cannot create test symlink: %v", err)
	}
	if err := verifyLocalPushPhysicalStaging(context.Background(), local, stage); err == nil {
		t.Fatal("symlinked temporary storage file admitted")
	}
}
