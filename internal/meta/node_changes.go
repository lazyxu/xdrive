package meta

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

type NodeChange struct {
	ID        uint64    `gorm:"primaryKey;autoIncrement;index:idx_xd_node_changes_owner_cursor,priority:2"`
	OwnerID   uint64    `gorm:"not null;index:idx_xd_node_changes_owner_cursor,priority:1"`
	NodeID    uint64    `gorm:"not null;index"`
	CreatedAt time.Time `gorm:"not null;index"`
}

func (NodeChange) TableName() string { return "xd_node_changes" }

// InstallNodeChangeJournal creates the append-only dirty-node journal and a
// transaction-local trigger on xd_nodes. The trigger intentionally records
// only owner/node identity: readers materialize the current node state when
// consuming a cursor window, which naturally coalesces rapid writes.
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
		INSERT INTO xd_node_changes (owner_id, node_id, created_at)
		VALUES (OLD.owner_id, OLD.id, NOW());
		RETURN OLD;
	END IF;

	INSERT INTO xd_node_changes (owner_id, node_id, created_at)
	VALUES (NEW.owner_id, NEW.id, NOW());
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
