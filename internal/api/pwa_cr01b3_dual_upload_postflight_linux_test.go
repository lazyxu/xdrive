//go:build linux

package api

// CR-01b3: independent read-only PostgreSQL/LocalCAS postflight for a SECOND
// genuinely concurrent Chromium Owner upload session. Never seed or rewrite
// bytes, mock a database result or claim two-window acceptance from just HTTP.
import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPWACR01B3RealSecondWindowPhysicalPostflight(t *testing.T) {
	if os.Getenv("XD_PWA_CR01B3_DUAL_PHYSICAL") != "1" {
		t.Skip("explicit two real Chromium uploads and genuine LocalCAS readback only")
	}
	dsn, root := os.Getenv("XD_TEST_DATABASE_URL"), os.Getenv("XD_STORAGE_ROOT")
	if dsn == "" || root == "" {
		t.Fatal("genuine PostgreSQL and LocalCAS fixture required")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	var owner meta.User
	if err := db.Where("username = ?", "pwa-b2b2b1-owner").First(&owner).Error; err != nil {
		t.Fatal("genuine original Owner does not exist")
	}
	var sessions []meta.UploadSession
	if err := db.Where("owner_id = ? AND resume_key = ?",
		owner.ID, "pwa-cr01b3-independent-peer-6m").Find(&sessions).Error; err != nil {
		t.Fatal("second independent upload lookup failed")
	}
	if len(sessions) != 1 {
		t.Fatalf("expected exactly one other durable Owner upload, got %d", len(sessions))
	}
	session := sessions[0]
	const size = int64(6 << 20)
	const chunk = int64(8 << 20)
	if session.Status != meta.UploadStatusFinalized || session.TotalSize != size ||
		session.ChunkSize != chunk || session.ChunkCount != 1 ||
		session.ResultNodeID == nil || session.QuotaReservedBytes != 0 {
		t.Fatal("second true 6MiB browser session not finalized exactly once")
	}
	var original []meta.UploadSession
	if err := db.Where("owner_id = ? AND resume_key = ?",
		owner.ID, "pwa-b2b2b2-17m-hot").Find(&original).Error; err != nil {
		t.Fatal("original 17MiB Owner UploadSession missing")
	}
	if len(original) != 1 || original[0].Status != meta.UploadStatusFinalized ||
		original[0].ResultNodeID == nil || original[0].ID == session.ID ||
		original[0].SHA256 == session.SHA256 {
		t.Fatal("two browser uploads were not distinct durable finalized sessions")
	}
	var node meta.Node
	if err := db.Where("id = ? AND owner_id = ? AND deleted_at IS NULL",
		*session.ResultNodeID, owner.ID).First(&node).Error; err != nil {
		t.Fatal("second real Node missing")
	}
	if node.Type != meta.NodeTypeFile || node.Name != "pwa-cr01b3-peer-upload.bin" ||
		node.ID == *original[0].ResultNodeID || node.Revision != 1 {
		t.Fatal("peer file was not a separate live original-revision-1 Node")
	}
	var file meta.File
	if err := db.Where("node_id = ?", node.ID).First(&file).Error; err != nil {
		t.Fatal("peer live File missing")
	}
	if file.Size != size || file.SHA256 == "" || file.SHA256 != session.SHA256 {
		t.Fatal("peer File bytes/hash disagree with durable UploadSession")
	}
	var count int64
	if err := db.Model(&meta.FileVersion{}).Where("node_id = ?", node.ID).
		Count(&count).Error; err != nil || count != 0 {
		t.Fatal("second new File unexpectedly created version history")
	}
	var blob meta.ContentBlob
	if err := db.Where("sha256 = ?", file.SHA256).First(&blob).Error; err != nil {
		t.Fatal("peer ContentBlob missing")
	}
	key, err := storage.ContentAddressedKey(file.SHA256)
	if err != nil || blob.StorageKey != key || file.StorageKey != key ||
		blob.Size != size || blob.State != meta.ContentBlobStateReady || blob.RefCount < 1 {
		t.Fatal("peer independent CAS key/state/size/reference invalid")
	}
	local, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	physical, err := local.Open(context.Background(), key)
	if err != nil {
		t.Fatal("peer genuine CAS content cannot be opened")
	}
	actual := sha256.New()
	bytesRead, readErr := io.Copy(actual, physical)
	closeErr := physical.Close()
	if readErr != nil || closeErr != nil || bytesRead != size {
		t.Fatal("peer complete 6MiB physical CAS readback failed")
	}
	// Same public mathematical fixture formula as the real second Chromium page.
	// Independently recreate ALL bytes, not just a sampled/header digest.
	expected := sha256.New()
	buffer := make([]byte, 64<<10)
	for start := int64(0); start < size; start += int64(len(buffer)) {
		n := int64(len(buffer))
		if n > size-start {
			n = size - start
		}
		for i := int64(0); i < n; i++ {
			offset := start + i
			buffer[i] = byte((offset*17 + (offset >> 5) + 7) % 251)
		}
		if _, err := expected.Write(buffer[:n]); err != nil {
			t.Fatal(err)
		}
	}
	want, got := hex.EncodeToString(expected.Sum(nil)), hex.EncodeToString(actual.Sum(nil))
	if want != got || want != file.SHA256 || want != session.SHA256 || len(want) != 64 {
		t.Fatal("peer genuine 6MiB physical bytes and SQL/CAS hashes mismatch")
	}
	t.Log("PWA_CR01B3_REAL_DUAL_UPLOAD_POSTFLIGHT_OK peer_bytes=6291456 independent_live_owner_sessions=2")
}
