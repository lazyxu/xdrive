package api

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Real isolated PG17 integration for the same-transaction durable result
// primitive. The admission/bind HTTP route is intentionally not enabled here.
func TestLocalPushCommonUploadImmutableOriginalReceiptTx(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("authentic PostgreSQL required")
	}
	admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "lpcommon_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := admin.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = admin.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := parsed.Query()
	q.Set("search_path", schema)
	parsed.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{}, &meta.ClientDevice{},
		&meta.Source{}, &meta.LocalSourceBinding{}, &meta.UploadSession{},
		&meta.LocalPushCommonUploadOperation{},
	); err != nil {
		t.Fatal(err)
	}
	for _, index := range []string{"idx_xd_local_common_upload_resume", "idx_xd_local_common_upload_session"} {
		if !db.Migrator().HasIndex(&meta.LocalPushCommonUploadOperation{}, index) {
			t.Fatalf("durable operation lacks %s", index)
		}
	}
	user := meta.User{Username: "lpcommon", PasswordHash: "fixture", SessionVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	device := meta.ClientDevice{ID: uuid.NewString(), OwnerID: user.ID, Name: "owning desktop", Platform: "windows", CredentialHash: strings.Repeat("a", 64)}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{OwnerID: user.ID, Name: "Backup", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{OwnerID: user.ID, Name: "Local", Kind: meta.SourceKindLocalFolder,
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		Status: meta.SourceStatusPaused, Revision: 7, TargetNodeID: &root.ID}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	rootID := uuid.NewString()
	fingerprint := strings.Repeat("b", 64)
	if err := db.Create(&meta.LocalSourceBinding{
		SourceID: source.ID, OwnerID: user.ID, DeviceID: device.ID,
		RootID: rootID, RootFingerprint: fingerprint,
	}).Error; err != nil {
		t.Fatal(err)
	}
	target := meta.Node{OwnerID: user.ID, ParentID: &root.ID, Name: "first.txt", Type: meta.NodeTypeFile, Revision: 1}
	if err := db.Create(&target).Error; err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("c", 64)
	if err := db.Create(&meta.File{NodeID: target.ID, Size: 5, SHA256: hash, StorageKey: ".xdrive-blobs/sha256/c"}).Error; err != nil {
		t.Fatal(err)
	}
	sid := uuid.NewString()
	resume := "lp2_" + strings.Repeat("d", 64)
	session := meta.UploadSession{
		ID: sid, OwnerID: user.ID, ParentID: &root.ID, Name: target.Name,
		ConflictPolicy: meta.UploadConflictPolicyFail, TotalSize: 5, ChunkSize: 8 << 20,
		ChunkCount: 1, SHA256: hash, ResumeKey: resume,
		Status: meta.UploadStatusActive, ExpiresAt: time.Now().Add(24 * time.Hour),
	}
	if err := db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	op := meta.LocalPushCommonUploadOperation{
		OperationID: uuid.NewString(), OwnerID: user.ID, OwnerSession: user.SessionVersion,
		DeviceID: device.ID, RootID: rootID, RootFingerprint: fingerprint,
		SourceID: source.ID, SourceRevision: source.Revision, SourceTargetID: root.ID,
		ResumeKey: resume, UploadSessionID: &sid, TargetParentID: &root.ID,
		TargetName: target.Name, ContentSHA256: hash, TotalSize: 5,
		State: meta.LocalPushCommonUploadBound,
	}
	if err := db.Create(&op).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Microsecond)

	// Failure of the surrounding normal upload finalization must also roll
	// back the per-file terminal; the helper must NOT independently commit.
	stop := errors.New("simulate ordinary finalize rollback")
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := persistLocalPushCommonUploadFinalizedTx(tx, session, target.ID, hash, 5, now); err != nil {
			return err
		}
		return stop
	})
	if !errors.Is(err, stop) {
		t.Fatalf("rollback: %v", err)
	}
	var unchanged meta.LocalPushCommonUploadOperation
	if err := db.Where("operation_id = ?", op.OperationID).Take(&unchanged).Error; err != nil {
		t.Fatal(err)
	}
	if unchanged.State != meta.LocalPushCommonUploadBound || unchanged.CommittedAt != nil || unchanged.ResultNodeID != nil {
		t.Fatal("original checkpoint escaped rolled-back upload transaction")
	}

	// Revoke and wrong/mutable data must be denied while the original row
	// remains reserved. Each negative state is rolled back for the next case.
	for name, mutate := range map[string]func(*gorm.DB) error{
		"revoked device": func(tx *gorm.DB) error {
			return tx.Model(&meta.ClientDevice{}).Where("id = ?", device.ID).Update("revoked_at", now).Error
		},
		"wrong Source revision": func(tx *gorm.DB) error {
			return tx.Model(&meta.Source{}).Where("id = ?", source.ID).Update("revision", source.Revision+1).Error
		},
		"wrong Root fingerprint": func(tx *gorm.DB) error {
			return tx.Model(&meta.LocalSourceBinding{}).Where("source_id = ?", source.ID).Update("root_fingerprint", strings.Repeat("e", 64)).Error
		},
		"wrong content": func(tx *gorm.DB) error {
			return tx.Model(&meta.File{}).Where("node_id = ?", target.ID).Update("sha256", strings.Repeat("f", 64)).Error
		},
		"changed Node revision": func(tx *gorm.DB) error {
			return tx.Model(&meta.Node{}).Where("id = ?", target.ID).Update("revision", 2).Error
		},
		"rotated Owner session": func(tx *gorm.DB) error {
			return tx.Model(&meta.User{}).Where("id = ?", user.ID).Update("session_version", 2).Error
		},
	} {
		t.Run(name, func(t *testing.T) {
			err := db.Transaction(func(tx *gorm.DB) error {
				if err := mutate(tx); err != nil {
					return err
				}
				if err := persistLocalPushCommonUploadFinalizedTx(tx, session, target.ID, hash, 5, now); !errors.Is(err, errLocalPushCommonUploadUnavailable) {
					t.Fatalf("unsafe durable result: %v", err)
				}
				return stop
			})
			if !errors.Is(err, stop) {
				t.Fatal(err)
			}
		})
	}

	if err := db.Transaction(func(tx *gorm.DB) error {
		return persistLocalPushCommonUploadFinalizedTx(tx, session, target.ID, hash, 5, now)
	}); err != nil {
		t.Fatalf("original commit: %v", err)
	}
	var committed meta.LocalPushCommonUploadOperation
	if err := db.Where("operation_id = ?", op.OperationID).Take(&committed).Error; err != nil {
		t.Fatal(err)
	}
	if committed.State != meta.LocalPushCommonUploadCommitted ||
		committed.ResultNodeID == nil || *committed.ResultNodeID != target.ID ||
		committed.ResultNodeRevision != 1 || committed.CommittedAt == nil {
		t.Fatalf("missing immutable original operation: %+v", committed)
	}
	if err := db.Model(&meta.Node{}).Where("id = ?", target.ID).Update("revision", 3).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.File{}).Where("node_id = ?", target.ID).Update("sha256", strings.Repeat("f", 64)).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("operation_id = ?", op.OperationID).Take(&committed).Error; err != nil {
		t.Fatal(err)
	}
	if committed.ResultNodeRevision != 1 || committed.ContentSHA256 != hash {
		t.Fatal("durable original result followed mutable current Node")
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		return persistLocalPushCommonUploadFinalizedTx(tx, session, target.ID, hash, 5, now)
	}); !errors.Is(err, errLocalPushCommonUploadUnavailable) {
		t.Fatalf("terminal row was not immutable: %v", err)
	}
}
