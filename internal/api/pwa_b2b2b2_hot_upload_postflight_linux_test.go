//go:build linux

package api

// P0-B2b2b-2: independent Go reader AFTER Browser uploaded chunk0 to Go A,
// Go A was SIGKILLed, and the same session was resumed/finalized through Go B.
// This test does not seed data, replace bytes, mock HTTP, or alter product code.
import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPWARealGoHotUploadPhysicalPostflight(t *testing.T) {
	if os.Getenv("XD_PWA_B2B2B2_PHYSICAL") != "1" {
		t.Skip("explicit real cross-process 17 MiB postflight only")
	}
	dsn, root := os.Getenv("XD_TEST_DATABASE_URL"), os.Getenv("XD_STORAGE_ROOT")
	if dsn == "" || root == "" {
		t.Fatal("original real PostgreSQL URL and Local CAS root required")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	var user meta.User
	if err := db.Where("username = ?", "pwa-b2b2b1-owner").First(&user).Error; err != nil {
		t.Fatal("real persistent owner missing:", err)
	}
	var sessions []meta.UploadSession
	if err := db.Where("owner_id = ? AND resume_key = ?", user.ID, "pwa-b2b2b2-17m-hot").
		Find(&sessions).Error; err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 {
		t.Fatalf("exactly one original durable upload session required, got %d", len(sessions))
	}
	session := sessions[0]
	const size = int64(17 << 20)
	const chunk = int64(8 << 20)
	if session.Status != meta.UploadStatusFinalized ||
		session.TotalSize != size || session.ChunkSize != chunk ||
		session.ChunkCount != 3 || session.ResultNodeID == nil ||
		session.QuotaReservedBytes != 0 {
		t.Fatal("original resumable upload session not durably finalized")
	}
	var node meta.Node
	if err := db.Where("id = ? AND owner_id = ? AND deleted_at IS NULL",
		*session.ResultNodeID, user.ID).First(&node).Error; err != nil {
		t.Fatal("final live Owner Node missing:", err)
	}
	if node.Type != meta.NodeTypeFile || node.Name != "pwa-b2b2b2-hot-upload.bin" {
		t.Fatal("physical committed Node not the intended upload")
	}
	var file meta.File
	if err := db.Where("node_id = ?", node.ID).First(&file).Error; err != nil {
		t.Fatal("committed File row missing:", err)
	}
	if file.Size != size || file.SHA256 == "" || file.SHA256 != session.SHA256 {
		t.Fatal("committed File and original upload session hash/size mismatch")
	}
	var blob meta.ContentBlob
	if err := db.Where("sha256 = ?", file.SHA256).First(&blob).Error; err != nil {
		t.Fatal("durable physical CAS ref missing:", err)
	}
	key, err := storage.ContentAddressedKey(file.SHA256)
	if err != nil || file.StorageKey != key ||
		blob.StorageKey != key || blob.Size != size ||
		blob.State != meta.ContentBlobStateReady || blob.RefCount < 1 {
		t.Fatal("CAS reference, hash, state, refcount or physical key mismatch")
	}
	local, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	physical, err := local.Open(context.Background(), key)
	if err != nil {
		t.Fatal("physical Local CAS object missing:", err)
	}
	actualHash := sha256.New()
	physicalBytes, copyErr := io.Copy(actualHash, physical)
	closeErr := physical.Close()
	if copyErr != nil || closeErr != nil || physicalBytes != size {
		t.Fatalf("independent full Local CAS readback failed: bytes=%d copy=%v close=%v",
			physicalBytes, copyErr, closeErr)
	}
	// Independently regenerate every expected byte, not sampled data,
	// using the same public mathematical fixture specification as the browser.
	expectedHash := sha256.New()
	buffer := make([]byte, 64<<10)
	for start := int64(0); start < size; start += int64(len(buffer)) {
		n := int64(len(buffer))
		if size-start < n {
			n = size - start
		}
		for i := int64(0); i < n; i++ {
			offset := start + i
			buffer[i] = byte((offset*31 + (offset >> 7)) % 251)
		}
		if _, err := expectedHash.Write(buffer[:n]); err != nil {
			t.Fatal(err)
		}
	}
	expected := hex.EncodeToString(expectedHash.Sum(nil))
	found := hex.EncodeToString(actualHash.Sum(nil))
	if expected != found || expected != file.SHA256 ||
		expected != session.SHA256 || len(expected) != 64 {
		t.Fatalf("real full 17 MiB CAS checksum mismatch: expectedMatches=%t fileMatches=%t sessionMatches=%t",
			expected == found, expected == file.SHA256, expected == session.SHA256)
	}
	// An initial new Node starts at revision 1. Historical FileVersion rows
	// record replaced content only on OVERWRITE, not the current live File.
	// Reject both unexpected history and unexpected live revision.
	var versions int64
	if err := db.Model(&meta.FileVersion{}).Where("node_id = ?", node.ID).
		Count(&versions).Error; err != nil || versions != 0 || node.Revision != 1 {
		t.Fatalf("new file must be live revision 1 with zero old history rows: revision=%d history=%d err=%v",
			node.Revision, versions, err)
	}
	t.Log(fmt.Sprintf("PWA_B2B2B2_REAL_POSTFLIGHT_OK bytes=%d chunks=3 physicalCAS_SHA256=true sameOriginalSession=true", physicalBytes))
}
