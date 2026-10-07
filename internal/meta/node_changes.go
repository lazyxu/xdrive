package meta

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

type NodeChange struct {
	ID               uint64    `gorm:"primaryKey;autoIncrement;index:idx_xd_node_changes_owner_cursor,priority:2"`
	OwnerID          uint64    `gorm:"not null;index:idx_xd_node_changes_owner_cursor,priority:1"`
	NodeID           uint64    `gorm:"not null;index"`
	ParentID         *uint64   `gorm:"index"`
	PreviousParentID *uint64   `gorm:"index"`
	CreatedAt        time.Time `gorm:"not null;index"`
}

func (NodeChange) TableName() string { return "xd_node_changes" }

// InstallNodeChangeJournal creates the append-only dirty-node journal and a
// transaction-local trigger on xd_nodes. Each row records the current and
// previous parent so consumers can invalidate every directory affected by a
// create, delete, rename, or move while still coalescing rapid node writes.
func InstallNodeChangeJournal(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("node change journal database is required")
	}
	if err := db.AutoMigrate(&NodeChange{}); err != nil {
		return fmt.Errorf("migrate node change journal: %w", err)
	}
	if err := db.Exec(`
CREATE OR REPLACE FUNCTION xd_record_node_change()
RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		INSERT INTO xd_node_changes (
			owner_id, node_id, parent_id, previous_parent_id, created_at
		)
		VALUES (OLD.owner_id, OLD.id, NULL, OLD.parent_id, NOW());
		RETURN OLD;
	END IF;

	IF TG_OP = 'INSERT' THEN
		INSERT INTO xd_node_changes (
			owner_id, node_id, parent_id, previous_parent_id, created_at
		)
		VALUES (NEW.owner_id, NEW.id, NEW.parent_id, NULL, NOW());
		RETURN NEW;
	END IF;

	INSERT INTO xd_node_changes (
		owner_id, node_id, parent_id, previous_parent_id, created_at
	)
	VALUES (NEW.owner_id, NEW.id, NEW.parent_id, OLD.parent_id, NOW());
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
`).Error; err != nil {
		return fmt.Errorf("create node change journal function: %w", err)
	}
	if err := db.Exec(`DROP TRIGGER IF EXISTS xd_nodes_change_journal ON xd_nodes`).Error; err != nil {
		return fmt.Errorf("drop stale node change journal trigger: %w", err)
	}
	if err := db.Exec(`
CREATE TRIGGER xd_nodes_change_journal
AFTER INSERT OR UPDATE OR DELETE ON xd_nodes
FOR EACH ROW EXECUTE FUNCTION xd_record_node_change()
`).Error; err != nil {
		return fmt.Errorf("create node change journal trigger: %w", err)
	}
	return nil
}
