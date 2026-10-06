package humanize

import (
	"fmt"
	"math"
)

var binaryByteUnits = [...]string{"B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB"}

// Bytes formats a byte count for user-facing output while keeping machine
// contracts free to carry exact integer byte values.
func Bytes(value float64) string {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		value = 0
	}
	unit := 0
	for value >= 1024 && unit < len(binaryByteUnits)-1 {
		value /= 1024
		unit++
	}
	if unit == 0 {
		return fmt.Sprintf("%.0f %s", value, binaryByteUnits[unit])
	}
	return fmt.Sprintf("%.1f %s", value, binaryByteUnits[unit])
}
