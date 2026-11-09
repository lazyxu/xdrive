package main

import (
	"testing"

	"gorm.io/gorm"
)

// Each isolated migration fixture owns its SQL connection pool. Close it
// even after t.Fatal so hundreds of tests cannot exhaust PostgreSQL's
// max_connections before the later fail-closed safety cases execute.
func trackMigrationTestDB(t *testing.T, db *gorm.DB) {
	t.Helper()
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
}
