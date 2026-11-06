package api

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// A Pull worker can end its SyncRun before an admitted UploadSession is
// finalized. Such an upload may have SourceRunID without direct SourceID or
// SourceTargetID. Archiving the original Source must still fence it.
func TestSourceArchiveGuardRunOnlyUploadAndForeignSourceIsolation(t *testing.T) {
	db, _, owner, stranger, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.SyncRun{}, &meta.UploadSession{}); err != nil {
		t.Fatal(err)
	}
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "run-only target")
	unrelatedTarget := createFilePropertiesDir(t, db, owner.ID, root.ID, "unrelated target")
	source := meta.Source{
		OwnerID: owner.ID, Name: "Run only Pull", Kind: "synology_files",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusPaused,
		Revision: 1, TargetNodeID: &target.ID,
	}
	unrelated := meta.Source{
		OwnerID: owner.ID, Name: "Unrelated Pull", Kind: "synology_files",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusPaused,
		Revision: 1, TargetNodeID: &unrelatedTarget.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&unrelated).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	run := meta.SyncRun{
		ID: uuid.NewString(), SourceID: source.ID, SourceRevision: 1,
		Mode: meta.SourceRunModeSync, Trigger: meta.SyncRunTriggerScheduled,
		Status: meta.SyncRunStatusCompleted, StartedAt: now.Add(-time.Minute),
		FinishedAt: &now,
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	session := meta.UploadSession{
		ID: uuid.NewString(), OwnerID: owner.ID, SourceRunID: run.ID,
		ParentID: &target.ID, Name: "original.bin",
		ConflictPolicy: meta.UploadConflictPolicyFail,
		TotalSize: 4, ChunkSize: 4 << 20, ChunkCount: 1,
		Status: meta.UploadStatusActive, ExpiresAt: now.Add(time.Hour),
	}
	if err := db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	check := func(src meta.Source, blocked bool) {
		t.Helper()
		err := db.Transaction(func(tx *gorm.DB) error {
			return requireSourceNoUnsettledWritesTx(tx, src)
		})
		if blocked && !errors.Is(err, errSourceUnsettledWrites) {
			t.Fatalf("Source %d missing RunID-only upload fence: %v", src.ID, err)
		}
		if !blocked && err != nil {
			t.Fatalf("Source %d unexpectedly blocked: %v", src.ID, err)
		}
	}
	check(source, true)
	check(unrelated, false)
	// A different Owner's old session must not be treated as this Source's
	// own write, even if a malformed or migrated row has the same RunID.
	if err := db.Model(&meta.UploadSession{}).Where("id = ?", session.ID).
		Update("owner_id", stranger.ID).Error; err != nil {
		t.Fatal(err)
	}
	check(source, false)
	if err := db.Model(&meta.UploadSession{}).Where("id = ?", session.ID).
		Updates(map[string]any{
			"owner_id": owner.ID, "expires_at": now.Add(-time.Minute),
		}).Error; err != nil {
		t.Fatal(err)
	}
	check(source, false)
	if err := db.Model(&meta.UploadSession{}).Where("id = ?", session.ID).
		Updates(map[string]any{
			"expires_at": now.Add(time.Hour), "status": meta.UploadStatusFinalized,
		}).Error; err != nil {
		t.Fatal(err)
	}
	check(source, false)
}
