package main

import (
	"fmt"

	"gorm.io/gorm"
)

// Do not silently rewrite existing Sources. If legacy names collide under
// the accepted Owner+Direction case-folding rule, fail startup without losing
// the previously installed unique index. PostgreSQL rolls back both DDL
// statements if the replacement index cannot be created.
func migrateSourceNameNamespaceIndex(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("source namespace migration requires a database")
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("DROP INDEX IF EXISTS idx_xd_sources_owner_name").Error; err != nil {
			return fmt.Errorf("drop legacy Source name index: %w", err)
		}
		if err := tx.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_sources_owner_direction_name ON xd_sources(owner_id, direction, lower(name))").Error; err != nil {
			return fmt.Errorf("create Owner+Direction Source name index: %w", err)
		}
		return nil
	})
}
