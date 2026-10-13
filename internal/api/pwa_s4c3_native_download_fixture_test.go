//go:build linux

package api

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"fmt"
	"io"
	"syscall"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

// S4C3-B1 is an isolated test fixture, never a production download path.
// Its deterministic AES-CTR content is written to physical canonical CAS,
// not sparse/truncated to fabricate a 1 GiB native download.
type pwaS4C3NativeSeed struct {
	nodeID     uint64
	name       string
	size       int64
	sha        string
	storageKey string
	allocated  int64
}

type pwaS4C3ZeroReader struct{}

func (pwaS4C3ZeroReader) Read(p []byte) (int, error) {
	clear(p)
	return len(p), nil
}

func pwaS4C3Stream(t *testing.T, size int64) io.Reader {
	t.Helper()
	key := sha256.Sum256([]byte("xdrive-s4c3b1-test-only-aes-256-ctr-source"))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		t.Fatal(err)
	}
	return io.LimitReader(&cipher.StreamReader{
		S: cipher.NewCTR(block, make([]byte, aes.BlockSize)),
		R: pwaS4C3ZeroReader{},
	}, size)
}

func pwaS4C3SeedNativeFile(t *testing.T, db *gorm.DB, local *storage.Local, ownerID, folderID uint64, sizeGiB int64) pwaS4C3NativeSeed {
	t.Helper()
	if sizeGiB != 1 && sizeGiB != 4 {
		t.Fatal("S4C3 native fixture supports only 1 or 4 GiB")
	}
	size := sizeGiB << 30
	sourceHash := sha256.New()
	verified, err := io.Copy(sourceHash, pwaS4C3Stream(t, size))
	if err != nil || verified != size {
		t.Fatalf("S4C3 source hash stream failed: copied=%d err=%v", verified, err)
	}
	expectedHash := fmt.Sprintf("%x", sourceHash.Sum(nil))
	key, err := storage.ContentAddressedKey(expectedHash)
	if err != nil {
		t.Fatal(err)
	}
	written, err := local.Put(context.Background(), key, pwaS4C3Stream(t, size))
	if err != nil || written != size {
		t.Fatalf("S4C3 genuine Local CAS write failed: written=%d err=%v", written, err)
	}
	file, err := local.Open(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	info, statErr := file.Stat()
	closeErr := file.Close()
	if statErr != nil || closeErr != nil || info.Size() != size {
		t.Fatalf("S4C3 CAS file stat failed: stat=%v close=%v", statErr, closeErr)
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		t.Fatal("S4C3 Linux physical allocation evidence unavailable")
	}
	allocated := stat.Blocks * 512
	if allocated < size*98/100 {
		t.Fatalf("S4C3 source is sparse: allocated=%d size=%d", allocated, size)
	}
	name := fmt.Sprintf("pwa-s4c3b1-native-%dgib.bin", sizeGiB)
	node := meta.Node{
		OwnerID: ownerID, ParentID: &folderID, Type: meta.NodeTypeFile,
		Name: name, Revision: 1,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.ContentBlob{
		SHA256: expectedHash, Size: size, StorageKey: key,
		RefCount: 1, State: meta.ContentBlobStateReady,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID: node.ID, Size: size, StorageKey: key, SHA256: expectedHash,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.FileVersion{
		NodeID: node.ID, Revision: 1, Size: size,
		StorageKey: key, SHA256: expectedHash,
	}).Error; err != nil {
		t.Fatal(err)
	}
	return pwaS4C3NativeSeed{
		nodeID: node.ID, name: name, size: size,
		sha: expectedHash, storageKey: key, allocated: allocated,
	}
}

func pwaS4C3VerifyPhysicalCAS(t *testing.T, db *gorm.DB, local *storage.Local, seed pwaS4C3NativeSeed) {
	t.Helper()
	var file meta.File
	if err := db.Where("node_id = ?", seed.nodeID).First(&file).Error; err != nil {
		t.Fatal(err)
	}
	if file.Size != seed.size || file.SHA256 != seed.sha || file.StorageKey != seed.storageKey {
		t.Fatal("S4C3 original file metadata changed during native download")
	}
	var blob meta.ContentBlob
	if err := db.Where("sha256 = ?", seed.sha).First(&blob).Error; err != nil {
		t.Fatal(err)
	}
	if blob.StorageKey != seed.storageKey || blob.Size != seed.size ||
		blob.State != meta.ContentBlobStateReady || blob.RefCount < 1 {
		t.Fatal("S4C3 canonical CAS reference invalid after native download")
	}
	original, err := local.Open(context.Background(), seed.storageKey)
	if err != nil {
		t.Fatal(err)
	}
	check := sha256.New()
	read, copyErr := io.Copy(check, original)
	closeErr := original.Close()
	if copyErr != nil || closeErr != nil || read != seed.size ||
		fmt.Sprintf("%x", check.Sum(nil)) != seed.sha {
		t.Fatalf("S4C3 independent physical CAS full SHA mismatch: bytes=%d copyErr=%v closeErr=%v", read, copyErr, closeErr)
	}
	t.Logf("PWA_S4C3_NATIVE_CAS_VERIFIED bytes=%d physicallyAllocated=true fullSHA=true", seed.size)
}
