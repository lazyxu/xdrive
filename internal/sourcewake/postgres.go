package sourcewake

import (
	"strconv"

	"gorm.io/gorm"
)

const PostgreSQLChannel = "xdrive_source_run_requested"

func Notify(tx *gorm.DB, sourceID uint64) error {
	return tx.Exec("SELECT pg_notify(?, ?)", PostgreSQLChannel, strconv.FormatUint(sourceID, 10)).Error
}
