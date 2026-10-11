package mediaworker

// The isolated FFmpeg Worker PID budget applies only to that optional container.
// It never changes Server, PostgreSQL, Caddy, Pull Worker or user Sources.
const DefaultPIDsLimit = 128

func ValidPIDsLimit(value int) bool {
	return value >= 64 && value <= 1024 && value%32 == 0
}
