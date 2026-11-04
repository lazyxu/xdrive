package main

import (
	"fmt"

	"gorm.io/gorm"
)

// installNodeParentOwnershipFence makes parent-row FOR UPDATE locks a real
// writer fence for child creation and reparenting. The composite key enforces
// that a child and its parent belong to the same Owner.
//
// NOT VALID is intentional: legacy cross-owner ParentID edges must remain
// readable for safe migration/review, but all new or changed references are
// checked immediately by PostgreSQL.
func installNodeParentOwnershipFence(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("node parent ownership fence requires a database")
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_id_owner ON xd_nodes(id, owner_id)`).Error; err != nil {
		return fmt.Errorf("create node parent ownership reference index: %w", err)
	}
	if err := db.Exec(`
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'fk_xd_nodes_parent_owner'
		  AND conrelid = 'xd_nodes'::regclass
	) THEN
		ALTER TABLE xd_nodes
			ADD CONSTRAINT fk_xd_nodes_parent_owner
			FOREIGN KEY (parent_id, owner_id)
			REFERENCES xd_nodes (id, owner_id)
			NOT VALID;
	END IF;
END $$;
`).Error; err != nil {
		return fmt.Errorf("install node parent ownership fence: %w", err)
	}
	return nil
}
