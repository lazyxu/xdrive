package api

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestSourceNamesAreUniquePerOwnerAndDirection(t *testing.T) {
	db, _, owner, other, _ := setupFilePropertiesTestDB(t)
	if err := db.Exec("DROP INDEX IF EXISTS idx_xd_sources_owner_name").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_sources_owner_direction_name ON xd_sources(owner_id, direction, lower(name))").Error; err != nil {
		t.Fatal(err)
	}
	newSource := func(ownerID uint64, name, direction, status string) meta.Source {
		return meta.Source{
			OwnerID: ownerID, Name: name, Kind: meta.SourceKindLocalFolder,
			Direction: direction, SyncMode: meta.SourceSyncModeBackup,
			RunMode: meta.SourceRunModeScan, Status: status, Revision: 1,
		}
	}

	push := newSource(owner.ID, "Same Name", meta.SourceDirectionPush, meta.SourceStatusPaused)
	if err := db.Create(&push).Error; err != nil {
		t.Fatal(err)
	}
	pull := newSource(owner.ID, "same name", meta.SourceDirectionPull, meta.SourceStatusPaused)
	pull.Kind = yikeSourceKind
	if err := db.Create(&pull).Error; err != nil {
		t.Fatalf("Push and Pull should have separate name namespaces: %v", err)
	}

	duplicatePull := newSource(owner.ID, "SAME NAME", meta.SourceDirectionPull, meta.SourceStatusPaused)
	duplicatePull.Kind = synologySourceKind
	if err := db.Create(&duplicatePull).Error; err == nil {
		t.Fatal("different Pull connectors must share one case-insensitive Owner namespace")
	}

	archived := newSource(owner.ID, "Archived Name", meta.SourceDirectionPull, meta.SourceStatusArchived)
	if err := db.Create(&archived).Error; err != nil {
		t.Fatal(err)
	}
	reuseArchived := newSource(owner.ID, "archived name", meta.SourceDirectionPull, meta.SourceStatusPaused)
	reuseArchived.Kind = synologyFilesSourceKind
	if err := db.Create(&reuseArchived).Error; err == nil {
		t.Fatal("archived Sources must continue reserving their names")
	}

	otherOwner := newSource(other.ID, "Same Name", meta.SourceDirectionPush, meta.SourceStatusPaused)
	if err := db.Create(&otherOwner).Error; err != nil {
		t.Fatalf("different Owners may reuse a name: %v", err)
	}
}
