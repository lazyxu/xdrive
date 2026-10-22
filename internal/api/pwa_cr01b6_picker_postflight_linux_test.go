//go:build linux

package api

// CR-01b6: inspect genuine production Web Files picker output after real
// Chromium, Caddy TLS-H2, Go UploadSession and LocalCAS commit.
import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPWACR01B6RealFilesPickerPostflight(t *testing.T) {
	if os.Getenv("XD_PWA_CR01B6_REAL_PICKER_PHYSICAL") != "1" {
		t.Skip("explicit production Files chooser and physical PostgreSQL/LocalCAS only")
	}
	dsn, root := os.Getenv("XD_TEST_DATABASE_URL"), os.Getenv("XD_STORAGE_ROOT")
	if dsn == "" || root == "" {
		t.Fatal("real PostgreSQL and LocalCAS fixture required")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	var owner meta.User
	if err := db.Where("username = ?", "pwa-b2b2b1-owner").First(&owner).Error; err != nil {
		t.Fatal("authentic Files picker owner missing")
	}
	var nodes []meta.Node
	if err := db.Where("owner_id = ? AND name = ? AND deleted_at IS NULL",
		owner.ID, "pwa-cr01b6-picker-1m.bin").Find(&nodes).Error; err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 1 || nodes[0].Type != meta.NodeTypeFile || nodes[0].Revision != 1 {
		t.Fatal("Files picker must produce exactly one live revision-1 file")
	}
	node := nodes[0]
	var file meta.File
	if err := db.Where("node_id = ?", node.ID).First(&file).Error; err != nil {
		t.Fatal(err)
	}
	const size = int64(1 << 20)
	if file.Size != size {
		t.Fatal("picker file size differs from OS-selected input")
	}
	expected := sha256.New()
	buf := make([]byte, 64<<10)
	for offset := int64(0); offset < size; offset += int64(len(buf)) {
		for i := range buf {
			pos := offset + int64(i)
			buf[i] = byte((pos*13 + (pos >> 6) + 9) % 251)
		}
		if _, err := expected.Write(buf); err != nil {
			t.Fatal(err)
		}
	}
	want := fmt.Sprintf("%x", expected.Sum(nil))
	if file.SHA256 != want {
		t.Fatal("Files picker original SHA-256 disagrees with independent expected bytes")
	}
	key, err := storage.ContentAddressedKey(want)
	if err != nil || file.StorageKey != key {
		t.Fatal("Files picker persistent CAS key invalid")
	}
	var blob meta.ContentBlob
	if err := db.Where("sha256 = ?", want).First(&blob).Error; err != nil {
		t.Fatal(err)
	}
	if blob.State != meta.ContentBlobStateReady || blob.Size != size ||
		blob.RefCount < 1 || blob.StorageKey != key {
		t.Fatal("picker CAS blob must be ready and referenced")
	}
	var sessions []meta.UploadSession
	if err := db.Where("owner_id = ? AND result_node_id = ?", owner.ID, node.ID).
		Find(&sessions).Error; err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 || sessions[0].Status != meta.UploadStatusFinalized ||
		sessions[0].TotalSize != size || sessions[0].SHA256 != want {
		t.Fatal("picker upload must have one independently finalized durable UploadSession")
	}
	local, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	f, err := local.Open(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	got := sha256.New()
	n, readErr := io.Copy(got, f)
	closeErr := f.Close()
	if readErr != nil || closeErr != nil || n != size || fmt.Sprintf("%x", got.Sum(nil)) != want {
		t.Fatal("picker actual full CAS bytes and SHA-256 mismatch")
	}
	t.Log("PWA_CR01B6_REAL_FILES_PICKER_CAS_VERIFIED bytes=1048576 owner_acl=true")
}
