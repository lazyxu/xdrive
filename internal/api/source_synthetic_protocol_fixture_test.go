package api

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// seedSyntheticSourceForProtocolTest preserves generic SourceRun/CRUD protocol
// coverage without exposing an arbitrary-target Source creation route to HTTP
// clients. The "test" kind exists only as an isolated PostgreSQL test fixture.
func seedSyntheticSourceForProtocolTest(
	t *testing.T, db *gorm.DB, targetID uint64,
	name, direction, syncMode, runMode, ignoreRules string,
) sourceDTO {
	t.Helper()
	var target meta.Node
	if err := db.Where("id = ? AND deleted_at IS NULL", targetID).Take(&target).Error; err != nil {
		t.Fatalf("load synthetic Source target: %v", err)
	}
	source := meta.Source{
		OwnerID: target.OwnerID,
		Name: name,
		Kind: "test",
		Direction: direction,
		SyncMode: syncMode,
		RunMode: runMode,
		Status: meta.SourceStatusActive,
		ScheduleType: "interval",
		ScheduleExpression: "6h",
		Revision: 1,
		TargetNodeID: &targetID,
		IgnoreRules: ignoreRules,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatalf("insert synthetic Source fixture: %v", err)
	}
	return (&Server{DB: db}).sourceDTO(source)
}
