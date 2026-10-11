package mediaworker

// DefaultMemoryMiB mirrors the optional isolated container's Compose default.
// Only values within the immutable, operator-reviewed resource budget are
// supported by administrator configuration.
const DefaultMemoryMiB = 768

func ValidMemoryMiB(value int) bool {
	return value >= 256 && value <= 4096 && value%128 == 0
}
